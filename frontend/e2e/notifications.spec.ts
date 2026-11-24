import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { organizerCreatesEvent, uid } from "./helpers";

/**
 * Browsers disable web push in incognito-like contexts, so the receiving device uses a persistent profile in a
 * throwaway folder: Google Chrome when installed (real FCM endpoint), otherwise Playwright's Chromium.
 */
async function persistentContext(view: Parameters<typeof chromium.launchPersistentContext>[1], baseURL: string) {
  const dir = mkdtempSync(join(tmpdir(), "qrious-push-"));
  for (const channel of ["chrome", "chromium"]) {
    try { return { ctx: await chromium.launchPersistentContext(dir, { ...view, channel, headless: true, permissions: ["notifications"], baseURL }), dir }; } catch { /* try next */ }
  }
  throw new Error("No Chromium-based browser available for the push test");
}
test("Notifications: centre, unread badge, click-through, and a real web push delivered to the service worker", async ({ browser, baseURL, browserName }, info) => {
  test.setTimeout(240_000);
  test.slow(); // launches extra browsers and waits on the real push service
  test.skip(browserName !== "chromium", "Push service available in Chromium");
  const mobile = info.project.name === "mobile";
  const view = mobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } };
  const { ctx: orgCtx, page: orgPage, code } = await organizerCreatesEvent(browser, view);
  const headers = { "X-QRious-Client": "web", origin: baseURL!.replace(/\/$/, "") };
  const dirs: string[] = [];
  async function person(name: string, persistent = false) {
    let ctx: BrowserContext;
    if (persistent) { const p = await persistentContext(view, baseURL!); ctx = p.ctx; dirs.push(p.dir); } else ctx = await browser.newContext({ ...view, permissions: ["notifications"] });
    const r = await ctx.request.post("/api/v1/onboarding/profile", { headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      data: { qrCode: code, displayName: name, username: `${name.toLowerCase()}${uid()}`.slice(0, 30), interests: [{ name: "Indie" }], skills: [{ name: "Guitar" }], isPublic: false, anonymousVisibilityConsent: false } });
    expect(r.status()).toBe(201);
    const body = await r.json();
    return { ctx, page: ctx.pages()[0] ?? (await ctx.newPage()), profileId: body.profile.id as string, eventId: body.eventId as string };
  }
  const a = await person("Avery");
  const b = await person("Blake", true);

  // Organizer: a new attendee joined → bell badge and notification centre entry linking to Participants
  await orgPage.goto("/organizer/notifications");
  await expect(orgPage.getByRole("button", { name: /joined Jam Session E2E|New attendee at Jam Session E2E/ }).first()).toBeVisible({ timeout: 25_000 });
  await expect(orgPage.getByRole("link", { name: /Notifications, \d+ unread/ }).filter({ visible: true }).first()).toBeVisible({ timeout: 25_000 });
  await orgPage.getByRole("button", { name: /joined Jam Session E2E|New attendee at Jam Session E2E/ }).first().click();
  await expect(orgPage).toHaveURL(/\/organizer\/participants\?event=/);

  // Blake turns on push for this device (real browser push service)
  await b.page.goto("/app/settings");
  const turnOn = b.page.getByRole("button", { name: "Turn on" });
  await expect(turnOn).toBeVisible({ timeout: 45_000 });
  await turnOn.click();
  // The first registration with the browser push service can take a while on a fresh profile.
  await expect(b.page.getByText("On — you'll be notified even when QRious isn't open.")).toBeVisible({ timeout: 60_000 });
  await b.page.goto("/app/events");
  await b.page.evaluate(() => {
    (window as unknown as { __pushes: unknown[] }).__pushes = [];
    navigator.serviceWorker.addEventListener("message", (e) => (window as unknown as { __pushes: unknown[] }).__pushes.push(e.data));
  });

  // Avery sends a connection request → Blake's device receives the push (service worker) and the in-app centre shows it
  const req = await a.ctx.request.post(`/api/v1/events/${a.eventId}/connections`, { headers, data: { profileId: b.profileId } });
  expect(req.status()).toBe(201);
  await expect.poll(async () => b.page.evaluate(() => (window as unknown as { __pushes: { type: string; category: string }[] }).__pushes.find((p) => p.type === "qrious:notification")?.category),
    { timeout: 60_000 }).toBe("connections");
  await b.page.goto("/app/notifications");
  const item = b.page.getByRole("button", { name: /Avery wants to connect \(unread\)/ });
  await expect(item).toBeVisible();
  await item.click();
  await expect(b.page).toHaveURL(/\/app\/connections/);
  await b.page.goto("/app/notifications");
  await expect(b.page.getByRole("button", { name: "Avery wants to connect", exact: true })).toBeVisible();

  // Turning push off removes this device
  await b.page.goto("/app/settings");
  await b.page.getByRole("button", { name: "Turn off" }).click();
  await expect(b.page.getByRole("button", { name: "Turn on" })).toBeVisible({ timeout: 20_000 });
  for (const c of [orgCtx, a.ctx, b.ctx]) await c.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
