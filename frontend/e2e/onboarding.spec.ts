import { expect, test } from "@playwright/test";

const QR = process.env.E2E_QR_CODE ?? "DEMO2026QRUS";
const shots = process.env.E2E_SCREENSHOTS;

function uniqueUsername(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

test("QR landing shows exactly two primary options (NN-03)", async ({ page }, info) => {
  await page.goto(`/e/${QR}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const options = page.getByRole("region", { name: "Choose how to continue" }).getByRole("link");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("Discover People");
  await expect(options.nth(1)).toContainText("Create My Profile");
  if (shots) await page.screenshot({ path: `${shots}/landing-${info.project.name}.png`, fullPage: true });
});

test("Journey B: new attendee creates a profile, saves recovery code and lands on event home — not Discover", async ({ page, context }, info) => {
  const username = uniqueUsername("e2e");
  await page.goto(`/e/${QR}`);
  await page.getByRole("link", { name: /Create My Profile/ }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${QR}/join`));

  await page.getByLabel("Display name").fill("Playwright Tester");
  await page.getByLabel("Username").fill(username);
  await expect(page.getByText("Available")).toBeVisible();

  // Interests: pick a suggestion and add a custom one
  const interestSearch = page.getByLabel("Search interests");
  await interestSearch.fill("Indie");
  await page.getByRole("button", { name: /^Indie$/ }).first().click();
  await interestSearch.fill("Vaporwave crate digging");
  await page.getByRole("button", { name: /Add “Vaporwave crate digging”/ }).click();

  // Skills via alias: "guitarist" matches Guitar
  await page.getByLabel("Search skills").first().fill("guitarist");
  await page.getByRole("button", { name: /^Guitar$/ }).first().click();

  // Anonymous visibility defaults ON and requires consent (D-08)
  await expect(page.getByRole("switch", { name: /Visible to visitors without a profile/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Create profile & join event" }).click();
  await expect(page.getByText("Please confirm, or turn public visibility off.")).toBeVisible();
  await page.getByLabel(/I understand and agree/).check();
  if (shots) await page.screenshot({ path: `${shots}/join-form-${info.project.name}.png`, fullPage: true });

  await page.getByRole("button", { name: "Create profile & join event" }).click();

  // Recovery code is shown once (D-13)
  const code = page.locator('code[aria-label="Recovery code"]');
  await expect(code).toHaveText(/^QRS(-[0-9A-Z]{4}){6}$/);
  if (shots) await page.screenshot({ path: `${shots}/recovery-code-${info.project.name}.png`, fullPage: true });
  const recoveryCode = (await code.textContent())!;
  const continueButton = page.getByRole("button", { name: "Go to event home" });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel("I've saved my recovery code").check();
  await continueButton.click();

  // Lands on event networking home — never Discover (NN-10)
  await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+\/home$/);
  await expect(page).not.toHaveURL(/discover/);
  await expect(page.getByText("You're in,", { exact: true })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/event-home-${info.project.name}.png`, fullPage: true });

  // Session is an HttpOnly cookie, invisible to page scripts (PRD §12.1)
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "qr_s" || c.name === "__Host-qr_s");
  expect(session?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("qr_s");

  // Profile persists
  await page.goto("/app/profile");
  await expect(page.getByRole("heading", { name: "Playwright Tester" })).toBeVisible();
  await expect(page.getByText(`@${username}`)).toBeVisible();
  await expect(page.getByText("Vaporwave crate digging")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/profile-${info.project.name}.png`, fullPage: true });

  // Returning to the landing page: still two options, recognised as returning attendee (PRD §3.4)
  await page.goto(`/e/${QR}`);
  await expect(page.getByRole("region", { name: "Choose how to continue" }).getByRole("link")).toHaveCount(2);
  await expect(page.getByText(/You've joined/)).toBeVisible();
  await page.getByRole("link", { name: /Create My Profile/ }).click();
  await expect(page.getByRole("heading", { name: "You're already on QRious" })).toBeVisible();

  // Recovery on a "new device"
  const fresh = await page.context().browser()!.newContext();
  const device2 = await fresh.newPage();
  await device2.goto(new URL("/recover", page.url()).toString());
  await device2.getByLabel("Username").fill(username);
  await device2.getByLabel("Recovery code", { exact: true }).fill(recoveryCode.toLowerCase());
  await device2.getByRole("button", { name: "Recover my profile" }).click();
  await expect(device2.locator('code[aria-label="Recovery code"]')).toHaveText(/^QRS(-[0-9A-Z]{4}){6}$/);
  await device2.getByLabel("I've saved my recovery code").check();
  await device2.getByRole("button", { name: "Continue" }).click();
  await expect(device2).toHaveURL(/\/app\/events\/[0-9a-f-]+\/home$/);
  await fresh.close();

  // The original device was signed out by recovery
  await page.goto("/app/profile");
  await expect(page).toHaveURL(/signin=required|\/$/);
});

test("Anonymous visitor is never signed in by browsing (BR-02)", async ({ page, context }) => {
  await page.goto(`/e/${QR}`);
  await page.getByRole("link", { name: /Discover People/ }).click();
  await expect(page.getByRole("heading", { name: /Discover People/ })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name.includes("qr_s"))).toBe(false);
  await page.goto("/app");
  await expect(page).toHaveURL(/signin=required/);
});

test("Invalid QR code shows a helpful message", async ({ page }) => {
  await page.goto("/e/NOTAREALCODE");
  await expect(page.getByRole("heading", { name: "We don't recognise this QR code" })).toBeVisible();
});
