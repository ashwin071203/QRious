import "server-only";
import { headers } from "next/headers";

/**
 * Server-side calls to PUBLIC API endpoints (e.g. QR landing SSR). Passes the visitor's IP with the proxy
 * secret so per-IP rate limits apply to the visitor, not to the web server.
 */
export async function serverApi<T>(path: string): Promise<{ status: number; data: T | null }> {
  const api = process.env.API_INTERNAL_URL ?? "http://localhost:5080";
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  const reqHeaders: Record<string, string> = { Accept: "application/json" };
  if (ip) reqHeaders["x-forwarded-for"] = ip;
  if (process.env.QRIOUS_PROXY_SECRET) reqHeaders["x-qrious-proxy"] = process.env.QRIOUS_PROXY_SECRET;

  try {
    const res = await fetch(`${api}/api/v1${path}`, { headers: reqHeaders, cache: "no-store" });
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    return { status: 503, data: null };
  }
}
