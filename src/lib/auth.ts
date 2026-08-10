import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getMongo, ObjectId, type UserDoc } from "./db";
import { DomainError, unauthorized } from "../domain/errors";

/**
 * Session-based auth. The browser holds an opaque random token in an
 * httpOnly cookie; the server stores only a SHA-256 hash of it (a database
 * leak does not leak usable tokens). Sessions expire after 7 days via a
 * Mongo TTL index. No JWT: opaque tokens are revocable and carry no data.
 */

export const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function signup(email: string, password: string): Promise<UserDoc> {
  const { collections } = await getMongo();
  const passwordHash = await hashPassword(password);
  const doc: UserDoc = {
    _id: new ObjectId(),
    email,
    passwordHash,
    createdAt: new Date(),
  };
  try {
    await collections.users.insertOne(doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new DomainError(
        "EMAIL_TAKEN",
        "An account with this email already exists",
        409,
      );
    }
    throw err;
  }
  return doc;
}

export async function login(
  email: string,
  password: string,
): Promise<UserDoc> {
  const { collections } = await getMongo();
  const user = await collections.users.findOne({ email });
  // Hash comparison runs even for unknown emails (constant-shape timing).
  const ok = await verifyPassword(
    password,
    user?.passwordHash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvali",
  );
  if (!user || !ok) {
    throw new DomainError(
      "INVALID_CREDENTIALS",
      "Invalid email or password",
      401,
    );
  }
  return user;
}

export async function createSession(userId: ObjectId): Promise<{
  token: string;
  cookie: string;
}> {
  const { collections } = await getMongo();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  await collections.sessions.insertOne({
    _id: new ObjectId(),
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return { token, cookie: serializeSessionCookie(token, SESSION_TTL_MS) };
}

export async function destroySession(token: string): Promise<void> {
  const { collections } = await getMongo();
  await collections.sessions.deleteOne({ tokenHash: hashToken(token) });
}

export function expiredSessionCookie(): string {
  return serializeSessionCookie("", 0);
}

function serializeSessionCookie(token: string, maxAgeMs: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  return parseSessionToken(header);
}

export function parseSessionToken(cookieHeader: string): string | null {
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = pair.slice(eq + 1).trim();
      return value || null;
    }
  }
  return null;
}

export async function getUserByToken(
  token: string | null,
): Promise<UserDoc | null> {
  if (!token) return null;
  const { collections } = await getMongo();
  const session = await collections.sessions.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  return collections.users.findOne({ _id: session.userId });
}

/** Resolves the authenticated user from a request or throws 401. */
export async function requireUser(req: Request): Promise<UserDoc> {
  const user = await getUserByToken(readSessionToken(req));
  if (!user) throw unauthorized();
  return user;
}

export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 11000
  );
}
