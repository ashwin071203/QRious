import type { NextRequest } from "next/server";
import { readLocalMedia } from "@/server/core/media";

/** Serves locally stored media in development (deployments use Vercel Blob URLs directly). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  if (key.some((k) => k === ".." || k.includes("\\"))) return new Response("Not found", { status: 404 });
  const data = await readLocalMedia(key.join("/"));
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" } });
}
