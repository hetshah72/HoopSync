import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: ApiErrorBody = { error: { code, message, details } };
  return NextResponse.json(body, { status });
}

/**
 * Wraps a Route Handler so every thrown AppError (and Zod validation error)
 * maps to a consistent JSON error response, and anything unexpected is
 * logged server-side and returned as an opaque 500 - never a raw stack trace
 * to the client.
 */
export function withErrorHandling<
  Args extends unknown[],
  R extends Response,
>(handler: (...args: Args) => Promise<R>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AppError) {
        return jsonError(err.statusCode, err.code, err.message, err.details);
      }
      if (err instanceof ZodError) {
        return jsonError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed.",
          err.flatten(),
        );
      }
      logger.error({ err }, "Unhandled error in route handler");
      return jsonError(500, "INTERNAL_ERROR", "Something went wrong.");
    }
  };
}
