import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load test environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Run tests sequentially for user journey flows
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for sequential test execution
  reporter: [["html"], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // Application tests: assume the platform is already initialized (seeded DB).
      // This is the default project run by `npm run test:e2e`.
      name: "application",
      testIgnore: "**/bootstrap/**",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Bootstrap tests: assume the platform DOES NOT exist yet (unseeded DB).
      // A fundamentally different lifecycle, so it lives in its own project.
      // Run via `npm run test:e2e:bootstrap` against a freshly reset database.
      name: "bootstrap",
      testMatch: "**/bootstrap/**",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI
    ? {
        // In CI, start production server (app must be built first)
        command: "npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120000,
      }
    : {
        // In development, use dev server
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120000,
      },
});
