import { MongoMemoryReplSet } from "mongodb-memory-server";
import { closeMongo } from "../../src/lib/db";

/**
 * Integration test harness. Boots a real Mongo (in-memory, single-node
 * replica set so multi-document transactions work) and calls the actual
 * route handlers as plain functions: same code path as production, no HTTP
 * server needed.
 */

let replSet: MongoMemoryReplSet | null = null;

export async function startTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replSet.getUri();
  process.env.MONGODB_DB = `test_${Math.random().toString(36).slice(2, 10)}`;
}

export async function stopTestDb(): Promise<void> {
  await closeMongo();
  if (replSet) await replSet.stop();
  replSet = null;
}

// ---------------------------------------------------------------------------
// Request builders

const BASE = "http://test.local";

export function jsonRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

export async function readBody<T = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  return (await res.json()) as T;
}

/** Extracts the session cookie pair ("session=<token>") from a response. */
export function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No Set-Cookie header in response");
  const pair = setCookie.split(";")[0];
  if (!pair.startsWith("session=")) throw new Error("Unexpected cookie");
  return pair;
}

// ---------------------------------------------------------------------------
// High-level helpers used across tests

import { POST as signupRoute } from "../../src/app/api/auth/signup/route";
import { POST as ordersPost, GET as ordersGet } from "../../src/app/api/orders/route";
import {
  GET as orderGet,
  PATCH as orderPatch,
  DELETE as orderDelete,
} from "../../src/app/api/orders/[id]/route";
import { POST as paymentsPost } from "../../src/app/api/orders/[id]/payments/route";
import { POST as refundsPost } from "../../src/app/api/orders/[id]/refunds/route";
import { GET as exportGet } from "../../src/app/api/orders/export/route";

let userCounter = 0;

export async function signupUser(): Promise<{ cookie: string; email: string }> {
  userCounter += 1;
  const email = `user${userCounter}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
  const res = await signupRoute(
    jsonRequest("POST", "/api/auth/signup", { email, password: "password123" }),
    undefined,
  );
  if (res.status !== 201) {
    throw new Error(`Signup failed: ${res.status} ${await res.text()}`);
  }
  return { cookie: sessionCookie(res), email };
}

export interface OrderInput {
  customer?: string;
  currency?: string;
  dueDate?: string;
  lineItems?: Array<{ description: string; quantity: number; unitPrice: string | number }>;
}

export async function createOrderVia(
  cookie: string,
  input: OrderInput = {},
): Promise<Response> {
  return ordersPost(
    jsonRequest(
      "POST",
      "/api/orders",
      {
        customer: "Acme LLC",
        currency: "USD",
        dueDate: "2030-01-01",
        lineItems: [{ description: "Widget", quantity: 2, unitPrice: "500" }],
        ...input,
      },
      { cookie },
    ),
    undefined,
  );
}

export async function payVia(
  cookie: string,
  orderId: string,
  amount: string | number,
  extra?: { idempotencyKey?: string; date?: string; note?: string },
): Promise<Response> {
  return paymentsPost(
    jsonRequest(
      "POST",
      `/api/orders/${orderId}/payments`,
      { amount, date: extra?.date ?? "2030-01-01", note: extra?.note },
      {
        cookie,
        ...(extra?.idempotencyKey
          ? { "Idempotency-Key": extra.idempotencyKey }
          : {}),
      },
    ),
    ctx({ id: orderId }),
  );
}

export async function refundVia(
  cookie: string,
  orderId: string,
  amount: string | number,
): Promise<Response> {
  return refundsPost(
    jsonRequest(
      "POST",
      `/api/orders/${orderId}/refunds`,
      { amount, date: "2030-01-02" },
      { cookie },
    ),
    ctx({ id: orderId }),
  );
}

export const routes = {
  ordersGet,
  ordersPost,
  orderGet,
  orderPatch,
  orderDelete,
  paymentsPost,
  refundsPost,
  exportGet,
};
