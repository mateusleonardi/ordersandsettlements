/**
 * Domain error with a stable machine-readable code, an HTTP status and
 * optional structured details (e.g. the maximum allowed payment amount).
 * API routes translate these into the canonical error response shape:
 * `{ error: { code, message, details? } }`.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "ORDER_NOT_EDITABLE"
  | "OVERPAYMENT"
  | "REFUND_EXCEEDS_PAID"
  | "CONFLICT"
  | "INTERNAL";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function notFound(resource = "Resource"): DomainError {
  return new DomainError("NOT_FOUND", `${resource} not found`, 404);
}

export function unauthorized(): DomainError {
  return new DomainError("UNAUTHORIZED", "Authentication required", 401);
}
