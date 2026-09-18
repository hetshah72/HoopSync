import "server-only";
import { Storage } from "@google-cloud/storage";
import { ExternalServiceError } from "@/server/errors";

/**
 * Real GCS upload path, used whenever GCS credentials are configured. See
 * mediaStorageService.ts for the dev-only local fallback used when they
 * aren't (mirrors the balldontlie/API-key pattern from P0.4: build the real
 * client now, don't block the rest of the feature on credentials that
 * haven't been provisioned yet).
 */
export function isGcsConfigured(): boolean {
  return Boolean(
    process.env.GCS_BUCKET_NAME && process.env.GCS_SERVICE_ACCOUNT_KEY_JSON,
  );
}

function getStorageClient(): Storage {
  const keyJson = process.env.GCS_SERVICE_ACCOUNT_KEY_JSON;
  if (!keyJson) {
    throw new ExternalServiceError("GCS_SERVICE_ACCOUNT_KEY_JSON is not configured.");
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(keyJson);
  } catch (err) {
    throw new ExternalServiceError(
      "GCS_SERVICE_ACCOUNT_KEY_JSON is not valid JSON.",
      err instanceof Error ? err.message : err,
    );
  }

  return new Storage({
    projectId: process.env.GCS_PROJECT_ID,
    credentials,
  });
}

const DEFAULT_SIGNED_URL_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/**
 * Uploads a buffer and returns a signed read URL for it.
 *
 * `signedUrlTtlMs` is a parameter rather than a constant because the two
 * things we store have genuinely different lifetimes: a session clip is
 * watched from the screen that produced it, while an avatar URL is persisted
 * on the profile and rendered on every screen from then on - a week-long URL
 * there would turn every avatar in the app into a broken image seven days
 * after it was uploaded.
 */
export async function uploadBufferToGcs(
  buffer: Buffer,
  destinationName: string,
  contentType: string,
  signedUrlTtlMs: number = DEFAULT_SIGNED_URL_TTL_MS,
): Promise<string> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new ExternalServiceError("GCS_BUCKET_NAME is not configured.");
  }

  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(destinationName);

  try {
    await file.save(buffer, { contentType, resumable: false });
  } catch (err) {
    throw new ExternalServiceError(
      "Failed to upload the file to Google Cloud Storage.",
      err instanceof Error ? err.message : err,
    );
  }

  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + signedUrlTtlMs,
  });
  return signedUrl;
}
