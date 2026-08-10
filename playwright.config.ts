import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3210",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://localhost:3210/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
