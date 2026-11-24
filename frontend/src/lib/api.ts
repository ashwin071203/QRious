/**
 * Browser API client. All calls go to the SAME ORIGIN (/api/v1/*), which the Next.js proxy route forwards
 * to the ASP.NET Core API. The session cookie is HttpOnly and first-party; JS never sees tokens (D-10).
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public errors?: Record<string, string[]>,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  fieldError(field: string): string | undefined {
    if (!this.errors) return undefined;
    const key = Object.keys(this.errors).find((k) => k.toLowerCase() === field.toLowerCase());
    return key ? this.errors[key]?.[0] : undefined;
  }
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export async function api<T>(path: string, { method = "GET", body, idempotencyKey, signal }: Options = {}): Promise<T> {
  const headers: Record<string, string> = { "X-QRious-Client": "web", Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: "same-origin", signal, cache: "no-store" });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "We couldn't reach QRious. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const d = (data ?? {}) as Record<string, unknown>;
    const { detail, code, errors, ...rest } = d;
    const extra = Object.fromEntries(Object.entries(rest).filter(([k]) => !["status", "title", "type", "traceId"].includes(k)));
    throw new ApiError(
      res.status,
      (code as string) ?? (res.status === 502 || res.status === 503 ? "server_waking" : "error"),
      (detail as string) ?? friendlyStatus(res.status),
      errors as Record<string, string[]> | undefined,
      extra,
    );
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function friendlyStatus(status: number) {
  if (status === 429) return "You're doing that too often. Please wait a moment.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "The request couldn't be completed.";
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
