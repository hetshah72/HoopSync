import { z } from "zod";

/** A 24-char hex string - the wire form of a MongoDB ObjectId. */
export const objectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
