import { z } from "zod";
import {
  CONTENT_MAX_DURATION_SECONDS,
  INGESTIBLE_CONTRIBUTORS,
  INGESTIBLE_SOURCES,
  requiresLicenseNotes,
} from "@/lib/content-ingest";
import { objectIdString } from "@/lib/validation/common";

/**
 * The rights facts an admin must supply alongside a clip (BRD 7.14).
 *
 * The conditional licence requirement is enforced here *and* by the
 * `mediaAssets` $jsonSchema. That is deliberate duplication: the schema is the
 * backstop for every write path including the seed, and this is what produces
 * a usable error on the form instead of a raw MongoServerError.
 */
export const ingestContentSchema = z
  .object({
    source: z.enum(INGESTIBLE_SOURCES),
    contributor: z.enum(INGESTIBLE_CONTRIBUTORS),
    rightsHolder: z
      .string()
      .trim()
      .min(1, "Name who owns this content.")
      .max(200),
    attribution: z.string().trim().max(200).optional().or(z.literal("")),
    sourceUrl: z
      .string()
      .trim()
      .url("Enter a full URL, or leave this empty.")
      .max(2000)
      .optional()
      .or(z.literal("")),
    licenseNotes: z.string().trim().max(1000).optional().or(z.literal("")),
    title: z.string().trim().min(1, "Give this clip a title.").max(120),
    body: z.string().trim().min(1, "Say what the clip shows.").max(500),
    durationSeconds: z.coerce
      .number()
      .positive()
      .max(
        CONTENT_MAX_DURATION_SECONDS,
        `Clips must be ${CONTENT_MAX_DURATION_SECONDS} seconds or shorter.`,
      )
      .optional(),
  })
  .refine(
    (value) => !requiresLicenseNotes(value.source) || Boolean(value.licenseNotes),
    {
      path: ["licenseNotes"],
      message:
        "Record the licence terms - licensed and public-domain content must be traceable back to its permission.",
    },
  );

export type IngestContentInput = z.infer<typeof ingestContentSchema>;

export const clearRightsSchema = z.object({
  assetId: objectIdString,
});

export const attachAssetSchema = z.object({
  assetId: objectIdString,
  feedItemId: objectIdString,
});
