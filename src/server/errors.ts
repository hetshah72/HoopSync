import "server-only";

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = "NOT_FOUND";
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = "UNAUTHORIZED";
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = "FORBIDDEN";
}

/** The request was well-formed but collides with existing state (e.g. an
 * email that already has an account). */
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = "CONFLICT";
}

export class ExternalServiceError extends AppError {
  readonly statusCode = 502;
  readonly code = "EXTERNAL_SERVICE_ERROR";
}

export class RateLimitError extends AppError {
  readonly statusCode = 429;
  readonly code = "RATE_LIMITED";
}
