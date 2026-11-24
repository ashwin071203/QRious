import { expect, test } from "@playwright/test";
import { totp } from "../src/server/lib/totp";

/**
 * Admin bootstrap + mandatory TOTP (D-24, D-31). Needs a deployment with NO admin yet and its bootstrap token:
 *   E2E_ADMIN_TOKEN=<token> npm run test:e2e -- admin
 * Skipped otherwise (it would permanently make the test account the platform admin of a live deployment).
 */
const token = process.env.E2E_ADMIN_TOKEN;

test("first admin bootstraps, enrolls an authenticator and must verify per session", async ({ browser }) => {
  test.skip(!token, "E2E_ADMIN_TOKEN not set");
  test.skip(test.info().project.name !== "desktop", "one run is enough — the first run consumes the bootstrap");
  const email = `admin${Date.now().toString(36)}@example.com`;
  const password = "a long admin passphrase here";
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/organizer/register");
  await page.getByLabel("Your name").fill("Platform Admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("I've saved my recovery code").check();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();

  await page.goto("/organizer/account");
  await page.getByLabel(/bootstrap token/i).fill(token!);
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("You're now a platform administrator.")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Secure the admin panel" })).toBeVisible();
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(page.getByAltText("Authenticator setup QR code")).toBeVisible();
  const secret = (await page.locator("code").first().textContent())!.replace(/\s/g, "");
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByText(/That code isn.t right/)).toBeVisible();
  const enabledAt = Date.now();
  await page.getByLabel("6-digit code").fill(totp(secret, enabledAt));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByRole("heading", { name: "Platform admin" })).toBeVisible();
  await page.getByRole("tab", { name: "Audit log" }).click();
  await expect(page.getByText("admin.mfa_enabled").first()).toBeVisible();

  // New session → must verify again (next time-step code; the used one is rejected as a replay)
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto("/organizer/login");
  await p2.getByLabel("Email").fill(email);
  await p2.getByLabel("Password").fill(password);
  await p2.getByRole("button", { name: /sign in/i }).click();
  await p2.waitForURL((u) => !u.pathname.startsWith("/organizer/login"));
  await p2.goto("/admin");
  await expect(p2.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await p2.getByLabel("6-digit code").fill(totp(secret, enabledAt + 30_000));
  await p2.getByRole("button", { name: "Verify" }).click();
  await expect(p2.getByRole("heading", { name: "Platform admin" })).toBeVisible();
  await ctx.close();
  await ctx2.close();
});
