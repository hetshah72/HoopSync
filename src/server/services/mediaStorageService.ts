import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import {
  isGcsConfigured,
  uploadBufferToGcs,
} from "@/server/external/gcsClient";
import { createMediaAsset } from "@/server/repositories/mediaAssetRepository";
import { ExternalServiceError } from "@/server/errors";
import type {
  MediaAssetContributor,
  MediaAssetDoc,
  MediaAssetSource,
  MediaAssetType,
} from "@/types/db";

const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

export interface StoreUploadInput {
  userId: string;
  buffer: Buffer;
  contentType: string;
  /**
   * Extension without the dot, derived from what the bytes actually are -
   * never from a client-supplied filename.
   */
  extension: string;
  /** Object-name prefix inside the bucket, e.g. `shot-sessions/<userId>`. */
  gcsPrefix: string;
  /** Sub-directory under `public/uploads` for the dev-only fallback. */
  localDir: string;
  type: MediaAssetType;
  /**
   * What the file is, in prose. The storage location is appended to it to
   * form the asset's `licenseNotes`, so provenance always records both.
   */
  describe: string;
  signedUrlTtlMs?: number;
  /**
   * Content provenance (BRD 7.14). All three are optional and default to what
   * every pre-existing caller already meant - a player uploading their own
   * footage - so adding admin ingestion did not require touching
   * `videoStorageService` or `avatarStorageService`.
   */
  rights?: {
    source?: MediaAssetSource;
    contributor?: MediaAssetContributor;
    /** Who owns it. Defaults to the uploading player. */
    rightsHolder?: string;
    attribution?: string;
    sourceUrl?: string;
    durationSeconds?: number;
    /**
     * The licence terms themselves. Composed with the storage description
     * rather than replacing it, so `licenseNotes` records both what permission
     * we hold and where the bytes live - the property this field's doc comment
     * has always claimed.
     */
    licenseNotes?: string;
    /**
     * Set when the rights are already settled at upload time - HoopSync's own
     * material, or a player's own footage. A coach's or a licensor's upload
     * leaves this absent and waits for a human (see `mediaRightsService`).
     */
    clearedBy?: ObjectId;
  };
}

/** What an upload records when the caller says nothing: the player's own clip. */
const DEFAULT_RIGHTS_HOLDER = "The HoopSync player who recorded it";

/**
 * Stores an uploaded file and records its provenance as a media asset.
 *
 * Uses real GCS when GCS_BUCKET_NAME/GCS_SERVICE_ACCOUNT_KEY_JSON are
 * configured. Otherwise, in development only, falls back to writing the file
 * under public/uploads (served directly by Next.js's static file handling)
 * so the full upload flow can be exercised without cloud credentials -
 * mirroring the dev-only pattern already used for local sign-in
 * (auth.config.ts). This fallback is never available in production: a
 * missing GCS config there is a real configuration error, not something to
 * silently work around.
 *
 * Every kind of upload routes through here rather than each caller repeating
 * the GCS-or-local decision, so a future change of storage provider is one
 * edit rather than one per media type.
 */
export async function storeUpload({
  userId,
  buffer,
  contentType,
  extension,
  gcsPrefix,
  localDir,
  type,
  describe,
  signedUrlTtlMs,
  rights,
}: StoreUploadInput): Promise<MediaAssetDoc> {
  const filename = `${randomUUID()}.${extension}`;

  // Provenance is assembled once and shared by both storage branches, so the
  // two paths can never record different rights for the same upload.
  // The admin's licence terms lead; the storage location follows. Letting
  // `describe` alone fill this field would satisfy the validator while losing
  // the actual permission, which is the opposite of traceable.
  const licenseNotesFor = (storage: string) =>
    rights?.licenseNotes
      ? `${rights.licenseNotes} (${describe}, ${storage})`
      : `${describe}, ${storage}`;

  const provenance = {
    type,
    source: rights?.source ?? ("original" as const),
    contributor: rights?.contributor ?? ("user" as const),
    rightsHolder: rights?.rightsHolder ?? DEFAULT_RIGHTS_HOLDER,
    uploadedBy: new ObjectId(userId),
    createdAt: new Date(),
    ...(rights?.attribution ? { attribution: rights.attribution } : {}),
    ...(rights?.sourceUrl ? { sourceUrl: rights.sourceUrl } : {}),
    ...(rights?.durationSeconds !== undefined
      ? { durationSeconds: rights.durationSeconds }
      : {}),
    ...(rights?.clearedBy
      ? { rightsClearedAt: new Date(), rightsClearedBy: rights.clearedBy }
      : {}),
  };

  if (isGcsConfigured()) {
    const url = await uploadBufferToGcs(
      buffer,
      `${gcsPrefix}/${filename}`,
      contentType,
      signedUrlTtlMs,
    );
    return createMediaAsset({
      ...provenance,
      url,
      licenseNotes: licenseNotesFor("stored in GCS"),
    });
  }

  if (process.env.NODE_ENV === "production") {
    throw new ExternalServiceError(
      "File storage isn't configured (GCS_BUCKET_NAME/GCS_SERVICE_ACCOUNT_KEY_JSON missing).",
    );
  }

  const directory = path.join(LOCAL_UPLOAD_ROOT, localDir);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), buffer);

  return createMediaAsset({
    ...provenance,
    url: `/uploads/${localDir}/${filename}`,
    licenseNotes: licenseNotesFor(
      "stored locally (dev only - GCS not configured in this environment)",
    ),
  });
}
