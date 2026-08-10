/**
 * Zero-setup local run: boots a disposable in-memory Mongo replica set and
 * starts the Next dev server on :3000 against it. Useful because payments
 * and refunds use multi-document transactions, which MongoDB only supports
 * on replica sets (a plain standalone `mongod` would reject them). Data is
 * discarded on exit.
 */
import { spawn } from "node:child_process";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", "3000"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      MONGODB_URI: replSet.getUri(),
      MONGODB_DB: "dev",
    },
  },
);

async function shutdown(code) {
  child.kill("SIGTERM");
  await replSet.stop();
  process.exit(code ?? 0);
}

child.on("exit", (code) => void shutdown(code));
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
