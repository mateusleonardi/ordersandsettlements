/**
 * Boots an in-memory Mongo replica set and starts the Next dev server on
 * port 3210 against it. Used as the Playwright webServer command, so e2e
 * runs are fully self-contained (no local Mongo or .env required).
 */
import { spawn } from "node:child_process";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

// Spawn the Next binary directly (no pnpm wrapper in between) so killing
// this process reliably kills the server too.
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", "3210"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      MONGODB_URI: replSet.getUri(),
      MONGODB_DB: "e2e",
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
