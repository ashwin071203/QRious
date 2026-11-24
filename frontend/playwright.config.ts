import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running stack (API + web). Locally:
 *   docker compose -f infra/docker-compose.yml up -d
 *   dotnet run --project backend/src/QRious.Api   (seeds demo event DEMO2026QRUS)
 *   npm run build && npm start                     (in /frontend)
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
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
