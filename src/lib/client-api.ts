"use client";

/** Client-side fetch wrapper: unwraps the API's canonical error shape. */

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.details = payload.details;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: ApiErrorPayload } | null)?.error;
    throw new ApiError(
      error ?? { code: "INTERNAL", message: `Request failed (${res.status})` },
    );
  }
  return body as T;
}
