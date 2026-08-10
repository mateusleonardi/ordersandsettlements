import { ZodError, z } from "zod";
import { DomainError } from "../domain/errors";

/**
 * Route-handler helpers. Handlers stay plain `(Request) => Response`
 * functions (no next/headers), which keeps them directly callable from
 * integration tests. Every error leaves through `handle`, so the error shape
 * is consistent across the whole API: `{ error: { code, message, details? } }`.
 */

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): Response {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>;

export function handle<Ctx = unknown>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof DomainError) {
        return errorResponse(err.code, err.message, err.httpStatus, err.details);
      }
      if (err instanceof ZodError) {
        return errorResponse(
          "VALIDATION_ERROR",
          summarizeZodError(err),
          400,
          z.treeifyError(err),
        );
      }
      console.error("Unhandled API error:", err);
      return errorResponse("INTERNAL", "Something went wrong", 500);
    }
  };
}

function summarizeZodError(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "Invalid request";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/** Parses the JSON body, turning malformed JSON into a 400 DomainError. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }
}
