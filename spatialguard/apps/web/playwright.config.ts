import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  // Leave the owner's real workspace as we found it.
  globalSetup: "./tests/workspace-hygiene.ts",
  globalTeardown: "./tests/workspace-teardown.ts",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.SPATIALGUARD_TEST_URL ?? "http://127.0.0.1:8010",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
