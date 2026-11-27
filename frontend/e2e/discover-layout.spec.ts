import { expect, test } from "@playwright/test";
import { organizerCreatesEvent, shot, uid } from "./helpers";

/** Regression: person cards on Discover must stay inside a narrow phone screen even with long names and skills. */
test("Discover: person cards fit the screen on a narrow phone", async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== "mobile", "Mobile layout check");
  test.setTimeout(120_000);
  const view = { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true };
  const { ctx: orgCtx, code } = await organizerCreatesEvent(browser, view);
  const headers = { "X-QRious-Client": "web", origin: baseURL!.replace(/\/$/, "") };
  async function person(name: string, skill: string) {
    const ctx = await browser.newContext(view);
    const r = await ctx.request.post("/api/v1/onboarding/profile", { headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      data: { qrCode: code, displayName: name, username: `u${uid()}${name.replace(/\W/g, "").toLowerCase()}`.slice(0, 30),
        interests: [{ name: "Indie" }], skills: [{ name: skill }], isPublic: false, anonymousVisibilityConsent: false } });
    expect(r.status()).toBe(201);
    return { ctx, eventId: (await r.json()).eventId as string };
  }
  const viewer = await person("Viewer", "Guitar");
  const other = await person("Maximiliana Wolfeschlegelsteinhausen", "Audioengineeringandmasteringspecialist");
  const page = await viewer.ctx.newPage();
  await page.goto(`/app/events/${viewer.eventId}/discover`);
  const card = page.getByRole("link", { name: /Maximiliana/ }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(600); // card entrance animation
  const box = await card.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await shot(page, "discover-narrow");
  for (const c of [orgCtx, viewer.ctx, other.ctx]) await c.close();
});
