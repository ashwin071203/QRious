import { expect, test, type Browser, type Page } from "@playwright/test";
import { organizerCreatesEvent, shot, uid } from "./helpers";

/**
 * Full product journeys (PRD §8, Journeys A–E) against a running deployment — no seed data needed:
 * the test creates its own organizer, event and attendees.
 */
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
  await expect(page.getByLabel("Selected interests").getByText("Indie")).toBeVisible();
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
    await expect(p.getByLabel("Selected skills").first().getByText("Singing")).toBeVisible();
  });
  await expect(singer.page).not.toHaveURL(/discover/);
  await shot(singer.page, "event-home");
  const producer = await attendeeJoins(browser, code, "Rohan Producer", async (p) => {
    await p.getByLabel("Search skills").first().fill("Music production");
    await p.getByRole("button", { name: /^Music production$/ }).first().click();
    await expect(p.getByLabel("Selected skills").first().getByText("Music production")).toBeVisible();
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

test("Organizer QR Management, Participants and Networking are real pages; mobile uses a bottom tab bar", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const mobile = info.project.name === "mobile";
  const { ctx, page, code } = await organizerCreatesEvent(browser, mobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });

  await page.goto("/organizer/qr");
  await expect(page.getByRole("heading", { name: "QR Management", level: 1 })).toBeVisible();
  await expect(page.getByAltText(/QR code for Jam Session E2E/)).toBeVisible();
  if (mobile) await expect(page.getByText(`/e/${code}`)).toBeVisible();
  else await expect(page.getByLabel("Event link")).toHaveValue(new RegExp(`/e/${code}$`)); // desktop: copyable link field
  await expect(page).toHaveURL(/\/organizer\/qr\?event=[0-9a-f-]+$/);

  await page.goto("/organizer/participants");
  await expect(page.getByRole("heading", { name: "Participants", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jam Session E2E" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toHaveCount(0);

  await page.goto("/organizer/networking");
  await expect(page.getByRole("heading", { name: "Networking", level: 1 })).toBeVisible();
  await expect(page.getByRole("switch").first()).toBeVisible();
  await shot(page, `organizer-networking-${info.project.name}`);

  const nav = page.getByRole("navigation", { name: "Organizer" }).filter({ visible: true });
  if (mobile) {
    // Bottom tab bar, not top icons
    const box = (await nav.boundingBox())!;
    expect(box.y).toBeGreaterThan((page.viewportSize()!.height) / 2);
    await nav.getByRole("link", { name: "QR" }).click();
    await expect(page).toHaveURL(/\/organizer\/qr/);
    await expect(nav.getByRole("link", { name: "QR" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await shot(page, "organizer-more-sheet");
    await sheet.getByRole("link", { name: "Networking" }).click();
    await expect(page).toHaveURL(/\/organizer\/networking/);
    await expect(sheet).toBeHidden();
  } else {
    await nav.getByRole("link", { name: "Participants" }).click();
    await expect(page).toHaveURL(/\/organizer\/participants/);
    await expect(nav.getByRole("link", { name: "Participants" })).toHaveAttribute("aria-current", "page");
  }
  await ctx.close();
});

test("Starter: 3 lifetime free events, then upgrade options; premium tools show upgrade hints", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const mobile = info.project.name === "mobile";
  const { ctx, page } = await organizerCreatesEvent(browser, mobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
  const orgId = (await (await page.request.get("/api/v1/organizer/me")).json()).organizations[0].id as string;
  await page.goto("/organizer/billing");
  await expect(page.getByText("1 of 3 used")).toBeVisible();
  for (const price of ["₹499", "₹1,499", "₹199"]) await expect(page.getByText(price).first()).toBeVisible();
  // Use the remaining two free events through the API (same session); the UI then blocks the 4th
  const cats = await (await page.request.get("/api/v1/public/categories")).json();
  const start = new Date(Date.now() + 86_400_000);
  for (const n of [2, 3]) {
    const r = await page.request.post(`/api/v1/organizations/${orgId}/events`, { headers: { "X-QRious-Client": "web", origin: new URL(page.url()).origin },
      data: { name: `Extra ${n}`, categoryId: cats[0].id, venueName: "Hall", startsAt: start.toISOString(), endsAt: new Date(+start + 7_200_000).toISOString() } });
    expect(r.status()).toBe(201);
  }
  const blocked = await page.request.post(`/api/v1/organizations/${orgId}/events`, { headers: { "X-QRious-Client": "web", origin: new URL(page.url()).origin },
    data: { name: "Fourth", categoryId: cats[0].id, venueName: "Hall", startsAt: start.toISOString(), endsAt: new Date(+start + 7_200_000).toISOString() } });
  expect(blocked.status()).toBe(402);
  await page.goto("/organizer/events/new");
  await expect(page.getByRole("heading", { name: "You've used your 3 free events" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Upgrade to Pro/ })).toBeVisible();
  await expect(page.getByLabel("Event name")).toHaveCount(0);
  await page.goto("/organizer/networking");
  await expect(page.getByText("Custom suggestions").first()).toBeVisible();
  if (!mobile) {
    await page.goto("/organizer/participants");
    await expect(page.getByRole("link", { name: "Export · Pro" })).toBeVisible();
    await expect(page.getByText("Detailed participant statistics")).toBeVisible();
  }
  await shot(page, `organizer-starter-${info.project.name}`);
  await ctx.close();
});

test("Messaging: group with connections only, unread badges clear on reading, activity status", async ({ browser, baseURL }, info) => {
  test.setTimeout(180_000);
  const mobile = info.project.name === "mobile";
  const view = mobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } };
  const { ctx: orgCtx, code } = await organizerCreatesEvent(browser, view);
  await orgCtx.close();
  const headers = { "X-QRious-Client": "web", origin: baseURL!.replace(/\/$/, "") };
  async function person(name: string) {
    const ctx = await browser.newContext(view);
    const r = await ctx.request.post("/api/v1/onboarding/profile", { headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      data: { qrCode: code, displayName: name, username: `${name.toLowerCase()}${uid()}`.slice(0, 30), interests: [{ name: "Indie" }], skills: [{ name: "Guitar" }], isPublic: false, anonymousVisibilityConsent: false } });
    expect(r.status()).toBe(201);
    const body = await r.json();
    return { ctx, page: await ctx.newPage(), profileId: body.profile.id as string, eventId: body.eventId as string, name };
  }
  const [a, b, c, stranger] = await Promise.all([person("Avery"), person("Blake"), person("Casey"), person("Drew")]);
  const connect = async (x: typeof a, y: typeof a) => {
    const r = await x.ctx.request.post(`/api/v1/events/${x.eventId}/connections`, { headers, data: { profileId: y.profileId } });
    expect(r.status()).toBe(201);
    expect((await y.ctx.request.post(`/api/v1/connections/${(await r.json()).id}/accept`, { headers })).status()).toBe(200);
  };
  await connect(a, b);
  await connect(a, c);

  // Create the group in the UI: only connections are offered (the stranger isn't)
  await a.page.goto("/app/messages");
  await a.page.getByRole("button", { name: "New group" }).click();
  const dialog = a.page.getByRole("dialog", { name: "New group" });
  await expect(dialog.getByRole("checkbox", { name: /Blake/ })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /Drew/ })).toHaveCount(0);
  await dialog.getByLabel("Group name").fill("Jam crew");
  await dialog.getByRole("checkbox", { name: /Blake/ }).click();
  await dialog.getByRole("checkbox", { name: /Casey/ }).click();
  await dialog.getByRole("button", { name: /Create group/ }).click();
  await expect(a.page).toHaveURL(/\/app\/messages\/[0-9a-f-]+$/);
  const groupUrl = a.page.url();
  await expect(a.page.getByText(/created the group “Jam crew”/).first()).toBeVisible();
  await a.page.getByLabel("Message", { exact: true }).fill("Welcome to the crew!");
  await a.page.getByRole("button", { name: "Send" }).click();
  await expect(a.page.getByText("Welcome to the crew!")).toBeVisible();

  // Blake: unread badge on Messages, per-conversation count, cleared after reading
  await b.page.goto("/app/messages");
  const row = b.page.getByRole("link", { name: /Jam crew, 1 unread/ });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(b.page.getByRole("link", { name: "Messages, 1 unread" }).filter({ visible: true })).toBeVisible();
  const readDone = b.page.waitForResponse((r) => r.url().includes("/read") && r.request().method() === "POST");
  await row.click();
  await expect(b.page.getByText("Welcome to the crew!").first()).toBeVisible();
  await expect(b.page.getByText("Avery", { exact: true }).first()).toBeVisible(); // sender name in the group
  expect((await readDone).status()).toBe(204);
  await b.page.goto("/app/messages");
  await expect(b.page.getByRole("link", { name: "Jam crew", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(b.page.getByRole("link", { name: "Messages", exact: true }).filter({ visible: true })).toBeVisible({ timeout: 20_000 }); // badge cleared

  // Group info: members, roles and activity status of connections; Blake (member) can't manage
  await b.page.goto(groupUrl);
  await b.page.getByRole("button", { name: "Group info" }).first().click();
  const infoDialog = b.page.getByRole("dialog", { name: "Group info" });
  await expect(infoDialog.getByText("Admin", { exact: true })).toBeVisible();
  await expect(infoDialog.getByText("Active now")).toBeVisible(); // Avery is a connection and active
  await expect(infoDialog.getByRole("button", { name: "Add members" })).toHaveCount(0);
  await infoDialog.getByRole("button", { name: "Close" }).click();

  // Direct chat header shows activity status
  const dmR = await a.ctx.request.post("/api/v1/conversations", { headers, data: { profileId: b.profileId, eventId: a.eventId } });
  await b.page.goto(`/app/messages/${(await dmR.json()).id}`);
  await expect(b.page.getByText("Active now").first()).toBeVisible();

  // The stranger can't open the group
  await stranger.page.goto(groupUrl);
  await expect(stranger.page.getByText(/no longer part of|not found/i)).toBeVisible();
  for (const p of [a, b, c, stranger]) await p.ctx.close();
});

