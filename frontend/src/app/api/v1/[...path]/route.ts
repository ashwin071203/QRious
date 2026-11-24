import { after, type NextRequest } from "next/server";
import { dispatch } from "@/server/core/http";
import { routeTable } from "@/server/routes";
import { getDb } from "@/server/db";
import { maybeSweep } from "@/server/notifications/api";

/** QRious API v1 — served by this same origin, so session cookies are first-party (D-10, D-29). */
export const maxDuration = 30;

type Ctx = { params: Promise<{ path: string[] }> };
const handle = async (req: NextRequest, ctx: Ctx) => {
  // Reminders, automatic event transitions and pending pushes: at most once a minute, after the response is sent.
  after(() => maybeSweep(getDb()).then(() => undefined, (e) => console.error("[sweep]", e)));
  return dispatch(req, (await ctx.params).path, routeTable);
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
