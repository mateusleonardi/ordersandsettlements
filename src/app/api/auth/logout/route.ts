import { handle, json } from "@/lib/http";
import { destroySession, expiredSessionCookie, readSessionToken } from "@/lib/auth";

export const POST = handle(async (req) => {
  const token = readSessionToken(req);
  if (token) await destroySession(token);
  return json({ ok: true }, 200, { "Set-Cookie": expiredSessionCookie() });
});
