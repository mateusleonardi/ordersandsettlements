import { MongoClient, Db, Collection, ObjectId } from "mongodb";
import type { CurrencyCode } from "../domain/money";

/**
 * Mongo access layer. A single cached client per process (serverless-safe via
 * globalThis) plus explicit index creation: indexes are part of the schema
 * design, so they live in code and are ensured once on first connection.
 */

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

export interface LineItemDoc {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface OrderDoc {
  _id: ObjectId;
  userId: ObjectId;
  customer: string;
  currency: CurrencyCode;
  /** Calendar date (YYYY-MM-DD); overdue comparison happens in UTC. */
  dueDate: string;
  lineItems: LineItemDoc[];
  subtotalMinor: number;
  totalMinor: number;
  /**
   * Denormalized sum of payments minus refunds. This field is the concurrency
   * guard: payments are recorded via a conditional update on it, so two
   * concurrent payments can never push it past `totalMinor`.
   */
  netPaidMinor: number;
  /** Number of payment/refund entries; > 0 makes the order read-only. */
  paymentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentDoc {
  _id: ObjectId;
  orderId: ObjectId;
  userId: ObjectId;
  type: "payment" | "refund";
  amountMinor: number;
  currency: CurrencyCode;
  /** Calendar date the payment was made (YYYY-MM-DD). */
  date: string;
  note?: string;
  idempotencyKey?: string;
  createdAt: Date;
}

export interface AuditDoc {
  _id: ObjectId;
  userId: ObjectId;
  orderId: ObjectId;
  event:
    | "order_created"
    | "order_updated"
    | "order_deleted"
    | "payment_recorded"
    | "refund_recorded";
  /** Derived status before/after the event, for status-change history. */
  statusBefore?: string;
  statusAfter?: string;
  data?: Record<string, unknown>;
  createdAt: Date;
}

export interface Collections {
  users: Collection<UserDoc>;
  sessions: Collection<SessionDoc>;
  orders: Collection<OrderDoc>;
  payments: Collection<PaymentDoc>;
  auditLogs: Collection<AuditDoc>;
}

interface Mongo {
  client: MongoClient;
  db: Db;
  collections: Collections;
}

declare global {
  var __mongo: Promise<Mongo> | undefined;
}

async function connect(): Promise<Mongo> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "orders_settlements");
  const collections: Collections = {
    users: db.collection<UserDoc>("users"),
    sessions: db.collection<SessionDoc>("sessions"),
    orders: db.collection<OrderDoc>("orders"),
    payments: db.collection<PaymentDoc>("payments"),
    auditLogs: db.collection<AuditDoc>("audit_logs"),
  };
  await ensureIndexes(collections);
  return { client, db, collections };
}

async function ensureIndexes(c: Collections): Promise<void> {
  await Promise.all([
    c.users.createIndex({ email: 1 }, { unique: true }),
    c.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    // TTL: Mongo purges expired sessions automatically.
    c.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // Every order query is tenant-scoped, so userId leads every index.
    c.orders.createIndex({ userId: 1, createdAt: -1 }),
    c.orders.createIndex({ userId: 1, dueDate: 1 }),
    c.payments.createIndex({ orderId: 1, createdAt: 1 }),
    c.payments.createIndex({ userId: 1, createdAt: -1 }),
    // Idempotency: the same (order, type, key) can only ever produce one
    // entry. `type` is part of the key so a payment and a refund can never
    // shadow each other's idempotency key on the same order. Partial: only
    // docs that actually carry a key are constrained.
    c.payments.createIndex(
      { orderId: 1, type: 1, idempotencyKey: 1 },
      {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $exists: true } },
      },
    ),
    c.auditLogs.createIndex({ orderId: 1, createdAt: 1 }),
    c.auditLogs.createIndex({ userId: 1, createdAt: -1 }),
  ]);
}

export function getMongo(): Promise<Mongo> {
  if (!globalThis.__mongo) {
    globalThis.__mongo = connect().catch((err) => {
      // Do not cache a failed connection attempt.
      globalThis.__mongo = undefined;
      throw err;
    });
  }
  return globalThis.__mongo;
}

/** Test helper: closes and forgets the cached client. */
export async function closeMongo(): Promise<void> {
  const cached = globalThis.__mongo;
  globalThis.__mongo = undefined;
  if (cached) {
    const { client } = await cached.catch(() => ({ client: null }) as never);
    if (client) await client.close();
  }
}

export { ObjectId };
