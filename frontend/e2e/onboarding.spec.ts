import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Full product journeys (PRD §8, Journeys A–E) against a running deployment — no seed data needed:
 * the test creates its own organizer, event and attendees.
 */
const shots = process.env.E2E_SCREENSHOTS;
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const utcInput = (d: Date) => d.toISOString().slice(0, 16);

async function organizerCreatesEvent(browser: Browser) {
  const ctx = await browser.newContext();
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

async function attendeeJoins(browser: Browser, code: string, name: string, extra: (p: Page) => Promise<void> = async () => {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`/e/${code}`);
  const options = page.getByRole("region", { name: "Choose how to continue" }).getByRole("link");
  await expect(options).toHaveCount(2);
  await options.filter({ hasText: "Create My Profile" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Username").fill(`${name.toLowerCase().replace(/\s/g, "")}${uid()}`.slice(0, 30));
  await expect(page.getByText("Available", { exact: true })).toBeVisible();
  await page.getByLabel("Search interests").fill("Indie");
  await page.getByRole("button", { name: /^Indie$/ }).first().click();
  await extra(page);
  await page.getByLabel(/I understand and agree/).check();
  await page.getByRole("button", { name: "Create profile & join event" }).click();
  await page.getByLabel("I've saved my recovery code").check();
  await page.getByRole("button", { name: "Go to event home" }).click();
  await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+\/home$/);
  return { ctx, page };
}

test("Journeys A–E: organizer publishes, attendees join via QR, discover, connect and chat", async ({ browser }) => {
  test.setTimeout(240_000);
  const { code } = await organizerCreatesEvent(browser);

  // Journey B — new attendees land on event home, never Discover
  const singer = await attendeeJoins(browser, code, "Asha Singer", async (p) => {
    await p.getByLabel("Search skills").first().fill("vocalist");
    await p.getByRole("button", { name: /^Singing$/ }).first().click();
  });
  await expect(singer.page).not.toHaveURL(/discover/);
  await shot(singer.page, "event-home");
  const producer = await attendeeJoins(browser, code, "Rohan Producer", async (p) => {
    await p.getByLabel("Search skills").first().fill("Music production");
    await p.getByRole("button", { name: /^Music production$/ }).first().click();
  });

  const eventBase = producer.page.url().replace(/\/home$/, "");
  // Journey D — discover → profile → connect with a note
  await producer.page.goto(`${eventBase}/discover`);
  await expect(producer.page.getByText("Asha Singer")).toBeVisible();
  await shot(producer.page, "discover");
  await producer.page.getByText("Asha Singer").first().click();
  await producer.page.getByRole("button", { name: "Connect" }).click();
  await producer.page.getByLabel(/Add a note/).fill("Loved your voice — want to collab?");
  await producer.page.getByRole("button", { name: "Send request" }).click();
  await expect(producer.page.getByRole("button", { name: /Requested/ })).toBeVisible();

  await singer.page.goto("/app/connections");
  await singer.page.getByRole("tab", { name: /Received/ }).click();
  await expect(singer.page.getByText("Loved your voice")).toBeVisible();
  await singer.page.getByRole("button", { name: "Accept" }).click();
  await expect(singer.page).toHaveURL(/\/app\/messages\/[0-9a-f-]+$/);
  await singer.page.getByLabel("Message", { exact: true }).fill("Hey Rohan! Let's do it");
  await singer.page.getByRole("button", { name: "Send" }).click();
  await expect(singer.page.getByText("Hey Rohan! Let's do it").filter({ visible: true }).first()).toBeVisible();

  await producer.page.goto("/app/messages");
  await producer.page.getByText("Asha Singer").first().click();
  await expect(producer.page).toHaveURL(/\/app\/messages\/[0-9a-f-]+$/);
  await expect(producer.page.getByText("Hey Rohan! Let's do it").filter({ visible: true }).first()).toBeVisible();
  await producer.page.getByLabel("Message", { exact: true }).fill("Awesome, see you at the stage!");
  await producer.page.keyboard.press("Enter");
  await expect(singer.page.getByText("Awesome, see you at the stage!").filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 }); // delivered by polling
  await shot(singer.page, "chat");

  // Smart Matches + Event Pulse render for members
  await producer.page.goto("/app/events");
  await expect(producer.page.getByText("Jam Session E2E").first()).toBeVisible();
  await producer.page.goto(`${eventBase}/pulse`);
  await expect(producer.page.getByText("Participating")).toBeVisible();
  await shot(producer.page, "pulse");
  await producer.page.goto(`${eventBase}/matches`);
  await expect(producer.page.getByRole("heading", { name: "Smart Matches" })).toBeVisible();

  // Journey A — anonymous visitor sees opted-in public profiles; member actions are gated; no session
  const anon = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const ap = await anon.newPage();
  await ap.goto(`/e/${code}`);
  await shot(ap, "landing");
  await ap.getByRole("link", { name: /Discover People/ }).click();
  await expect(ap.getByText("Asha Singer")).toBeVisible();
  await ap.getByText("Asha Singer").first().click();
  await ap.getByRole("button", { name: "Connect" }).click();
  await expect(ap.getByText("Create your profile to continue")).toBeVisible();
  await shot(ap, "public-profile-gate");
  expect((await anon.cookies()).some((c) => c.name.includes("qr_s"))).toBe(false);

  // Journey C — returning attendee keeps a single identity
  await singer.page.goto(`/e/${code}`);
  await expect(singer.page.getByText(/You've joined/)).toBeVisible();
  await singer.page.getByRole("region", { name: "Choose how to continue" }).getByRole("link").filter({ hasText: "Create My Profile" }).click();
  await expect(singer.page.getByRole("heading", { name: "You're already on QRious" })).toBeVisible();

  for (const c of [singer.ctx, producer.ctx, anon]) await c.close();
});

test("Invalid QR code shows a helpful message", async ({ page }) => {
  await page.goto("/e/NOTAREALCODE");
  await expect(page.getByRole("heading", { name: "We don't recognise this QR code" })).toBeVisible();
});

test("Marketing home renders and protected areas redirect", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One event.");
  await shot(page, "home");
  await page.goto("/app");
  await expect(page).toHaveURL(/signin=required/);
  await page.goto("/organizer/dashboard");
  await expect(page).toHaveURL(/\/organizer\/login/);
});
