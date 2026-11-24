import "server-only";
import type { NextRequest } from "next/server";
import { AppError } from "./errors";
import { rateLimit } from "./platform";
import { getDb, type DB } from "@/server/db";

export type CookieOpts = { maxAgeSec?: number; expires?: Date };

/** Per-request context passed to every route handler. */
export class Ctx {
  readonly url: URL;
  readonly ip: string;
  readonly userAgent: string | null;
  readonly secure: boolean;
  readonly setCookies: string[] = [];
  params: Record<string, string> = {};
  private _body: unknown;
  private _bodyRead = false;
  private cache = new Map<string, unknown>();

  constructor(readonly req: NextRequest) {
    this.url = new URL(req.url);
    // Vercel overwrites X-Forwarded-For with the real client IP; elsewhere it's best-effort.
    this.ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "127.0.0.1";
    this.userAgent = req.headers.get("user-agent");
    const proto = req.headers.get("x-forwarded-proto") ?? this.url.protocol.replace(":", "");
    this.secure = proto === "https";
  }

  get db(): DB {
    return getDb();
  }

  /** Memoize per-request lookups (e.g. the authenticated attendee). */
  async once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key) as Promise<T>;
  }

  async json<T = Record<string, unknown>>(): Promise<T> {
    if (!this._bodyRead) {
      this._bodyRead = true;
      const text = await this.req.text();
      if (text.length > 256 * 1024) throw new AppError(413, "payload_too_large", "The request is too large.");
      try {
        this._body = text ? JSON.parse(text) : {};
      } catch {
        throw new AppError(400, "bad_request", "The request body must be valid JSON.");
      }
      if (typeof this._body !== "object" || this._body === null || Array.isArray(this._body))
        throw new AppError(400, "bad_request", "The request body must be a JSON object.");
    }
    return this._body as T;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  queryAll(name: string): string[] {
    return this.url.searchParams.getAll(name).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  }

  cookie(name: string): string | undefined {
    return this.req.cookies.get(name)?.value;
  }

  /** Session cookies are host-only (no Domain), HttpOnly, SameSite=Lax; __Host- prefix + Secure over HTTPS. */
  cookieName(base: string) {
    return this.secure ? `__Host-${base}` : base;
  }

  setCookie(base: string, value: string, opts: CookieOpts) {
    const parts = [`${this.cookieName(base)}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
    if (this.secure) parts.push("Secure");
    if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`, `Max-Age=${Math.max(0, Math.floor((opts.expires.getTime() - Date.now()) / 1000))}`);
    else if (opts.maxAgeSec !== undefined) parts.push(`Max-Age=${opts.maxAgeSec}`);
    this.setCookies.push(parts.join("; "));
  }

  clearCookie(base: string) {
    this.setCookie(base, "", { maxAgeSec: 0 });
  }

  readSessionCookie(base: string): string | undefined {
    return this.cookie(`__Host-${base}`) ?? this.cookie(base);
  }

  async limit(name: string, limit: number, windowSec: number, subject?: string) {
    await rateLimit(`${name}:${subject ?? `ip:${this.ip}`}`, limit, windowSec);
  }
}

export type Handler = (ctx: Ctx) => Promise<unknown>;
export type Route = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; handler: Handler; csrfExempt?: boolean };

export class Reply {
  constructor(readonly status: number, readonly body: unknown, readonly headers: Record<string, string> = {}) {}
}
export const reply = (status: number, body?: unknown, headers?: Record<string, string>) => new Reply(status, body, headers);

type Compiled = Route & { re: RegExp; keys: string[] };

export function compile(routes: Route[]): Compiled[] {
  return routes.map((r) => {
    const keys: string[] = [];
    const re = new RegExp(
      "^" + r.path.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$",
    );
    return { ...r, re, keys };
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** CSRF: cookie-authenticated writes must come from this site (Origin) and carry the app header. */
function csrfOk(req: NextRequest): boolean {
  const client = req.headers.get("x-qrious-client");
  if (client !== "web" && client !== "mobile") return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let origin = req.headers.get("origin");
  if (!origin) {
    const ref = req.headers.get("referer");
    if (ref) try { origin = new URL(ref).origin; } catch { origin = null; }
  }
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function problem(err: AppError, traceId: string): Response {
  const body: Record<string, unknown> = { status: err.status, title: titleFor(err.status), detail: err.message, code: err.code, traceId, ...err.extra };
  if (err.errors) body.errors = err.errors;
  const headers: Record<string, string> = { "Content-Type": "application/problem+json", "Cache-Control": "no-store" };
  if (err.status === 429 && typeof err.extra.retryAfter === "number") headers["Retry-After"] = String(err.extra.retryAfter);
  return new Response(JSON.stringify(body), { status: err.status, headers });
}

function titleFor(s: number) {
  return ({ 400: "Invalid request", 401: "Not authorized", 403: "Forbidden", 404: "Not found", 409: "Conflict", 413: "Payload too large", 422: "Unprocessable request", 429: "Too many requests" } as Record<number, string>)[s] ?? "Error";
}

export async function dispatch(req: NextRequest, segments: string[], table: Compiled[]): Promise<Response> {
  const traceId = crypto.randomUUID().slice(0, 8);
  const path = "/" + segments.map(decodeURIComponent).join("/");
  const method = req.method as Route["method"];
  const ctx = new Ctx(req);
  try {
    let matched: Compiled | undefined;
    let pathMatched = false;
    for (const r of table) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      matched = r;
      ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]!]));
      break;
    }
    if (!matched) throw pathMatched ? new AppError(405, "method_not_allowed", "Method not allowed.") : new AppError(404, "not_found", "Not found.");
    for (const [k, v] of Object.entries(ctx.params)) {
      if (/id$/i.test(k) && !isUuid(v)) throw new AppError(404, "not_found", "Not found.");
    }
    if (method !== "GET" && !matched.csrfExempt && !csrfOk(req)) {
      throw new AppError(403, "csrf_blocked", "This request didn't come from the QRious app.");
    }

    const result = await matched.handler(ctx);
    const res = result instanceof Response ? result
      : result instanceof Reply
        ? (result.status === 204 ? new Response(null, { status: 204, headers: result.headers })
          : Response.json(result.body ?? null, { status: result.status, headers: result.headers }))
        : result === undefined ? new Response(null, { status: 204 }) : Response.json(result);
    res.headers.set("Cache-Control", res.headers.get("Cache-Control") ?? "no-store");
    for (const c of ctx.setCookies) res.headers.append("Set-Cookie", c);
    return res;
  } catch (e) {
    if (e instanceof AppError) {
      const res = problem(e, traceId);
      for (const c of ctx.setCookies) res.headers.append("Set-Cookie", c);
      return res;
    }
    console.error(`[api ${traceId}] ${method} ${path}`, e);
    return problem(new AppError(500, "server_error", "Something went wrong. Please try again."), traceId);
  }
}
