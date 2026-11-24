import type { NextRequest } from "next/server";

/**
 * Same-origin proxy to the ASP.NET Core API (D-10).
 * The browser only ever talks to this origin, so the API's host-only session cookie is first-party here —
 * no custom domain required. The proxy adds the client IP and a shared secret so the API can trust it.
 */

const API = process.env.API_INTERNAL_URL ?? "http://localhost:5080";
const SECRET = process.env.QRIOUS_PROXY_SECRET ?? "";

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "idempotency-key",
  "x-qrious-client",
  "authorization",
];

const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
  "server",
]);

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const target = new URL(`/api/v1/${path.map(encodeURIComponent).join("/")}`, API);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  if (SECRET) headers.set("x-qrious-proxy", SECRET);

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    // Free-tier API instances sleep when idle; tell the client to retry shortly.
    return Response.json(
      { status: 503, title: "Waking up", detail: "The networking server is waking up. Please try again in a few seconds.", code: "server_waking" },
      { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } },
    );
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  out.set("cache-control", "no-store");

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
