import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end journeys against a running app (no seed data needed — tests create their own organizer/event/attendees).
 *   docker compose -f ../infra/docker-compose.yml up -d && npm run db:migrate && npm run build && npm start
 *   npm run test:e2e            (or E2E_BASE_URL=https://your-deployment npm run test:e2e)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
  ],
});
