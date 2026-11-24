import { expect, type Browser, type Page } from "@playwright/test";

/** Shared E2E helpers (no tests here). */
export const shots = process.env.E2E_SCREENSHOTS;
export const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
export const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
export const utcInput = (d: Date) => d.toISOString().slice(0, 16);

export async function organizerCreatesEvent(browser: Browser, opts: Parameters<Browser["newContext"]>[0] = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto("/organizer/register");
  await page.getByLabel("Your name").fill("Event Host");
  await page.getByLabel("Email").fill(`host${uid()}@example.com`);
  await page.getByLabel("Password").fill("a long organizer passphrase");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator('code[aria-label="Recovery code"]')).toHaveText(/^QRS(-[0-9A-Z]{4}){6}$/);
  await page.getByLabel("I've saved my recovery code").check();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();

  await page.getByLabel("Organization name").fill(`Collective ${uid()}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await page.getByRole("link", { name: "New event" }).first().click();
  await page.getByLabel("Event name").fill("Jam Session E2E");
  await page.getByLabel("Category").selectOption({ label: "Concert" });
  await page.getByLabel("Time zone").selectOption("UTC");
  const now = Date.now();
  await page.getByLabel("Starts").fill(utcInput(new Date(now - 3600_000)));
  await page.getByLabel("Ends").fill(utcInput(new Date(now + 5 * 3600_000)));
  await page.getByLabel("Venue").fill("The Studio");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("button", { name: "Pause networking" })).toBeVisible();
  await shot(page, "organizer-event");
  await page.getByRole("tab", { name: "QR code" }).click();
  await expect(page.getByAltText(/QR code for/)).toBeVisible();
  const url = (await page.locator("p.font-mono").textContent())!.trim();
  await shot(page, "organizer-qr");
  return { ctx, page, code: url.split("/e/")[1]! };
}

