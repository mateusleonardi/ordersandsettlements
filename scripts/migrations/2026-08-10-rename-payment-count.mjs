/**
 * One-off migration: orders created before the paymentCount -> entryCount
 * rename still carry the old field, which made them appear read-only in the
 * UI (undefined entryCount). Renames the field in place; idempotent.
 *
 *   node --env-file=.env.local scripts/migrations/2026-08-10-rename-payment-count.mjs
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "orders_settlements");
const result = await db
  .collection("orders")
  .updateMany(
    { entryCount: { $exists: false } },
    { $rename: { paymentCount: "entryCount" } },
  );
console.log(`Migrated ${result.modifiedCount} order(s).`);
await client.close();
