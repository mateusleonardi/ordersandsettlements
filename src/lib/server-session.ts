import { cookies } from "next/headers";
import { getUserByToken } from "./auth";
import { SESSION_COOKIE } from "./auth";
import type { UserDoc } from "./db";

/**
 * Session lookup for Server Components (pages), which read cookies via
 * next/headers. API routes read the Cookie header directly (see auth.ts) so
 * they stay callable from integration tests.
 */
export async function getSessionUser(): Promise<UserDoc | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  return getUserByToken(token);
}
