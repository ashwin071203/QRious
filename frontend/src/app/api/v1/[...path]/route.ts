import type { NextRequest } from "next/server";
import { dispatch } from "@/server/core/http";
import { routeTable } from "@/server/routes";

/** QRious API v1 — served by this same origin, so session cookies are first-party (D-10, D-29). */
export const maxDuration = 30;

type Ctx = { params: Promise<{ path: string[] }> };
const handle = async (req: NextRequest, ctx: Ctx) => dispatch(req, (await ctx.params).path, routeTable);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
