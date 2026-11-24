import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp, { type Metadata, type Sharp } from "sharp";
import { put, del } from "@vercel/blob";
import { AppError } from "./errors";
import { base64url } from "@/server/lib/rules";

/**
 * Object storage: Vercel Blob in deployments (BLOB_READ_WRITE_TOKEN), local disk in development, memory in tests.
 * Keys are random (unguessable URLs).
 */
type Stored = { key: string; url: string };
const memory = new Map<string, Buffer>();
const LOCAL_ROOT = path.join(process.cwd(), ".data", "media");

function mode(): "blob" | "local" | "memory" {
  if (process.env.QRIOUS_STORAGE === "memory") return "memory";
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "local";
}

async function store(key: string, data: Buffer, contentType: string): Promise<Stored> {
  const m = mode();
  if (m === "blob") {
    const res = await put(key, data, { access: "public", contentType, addRandomSuffix: false, cacheControlMaxAge: 31536000 });
    return { key, url: res.url };
  }
  if (m === "memory") {
    memory.set(key, data);
    return { key, url: `https://media.test/${key}` };
  }
  const file = path.join(LOCAL_ROOT, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return { key, url: `/media/${key}` };
}

export async function removeMedia(urls: (string | null | undefined)[]): Promise<void> {
  const list = urls.filter((u): u is string => !!u);
  if (!list.length) return;
  try {
    const m = mode();
    if (m === "blob") await del(list.filter((u) => u.startsWith("https://")));
    else if (m === "memory") list.forEach((u) => memory.delete(u.replace("https://media.test/", "")));
    else for (const u of list) if (u.startsWith("/media/")) await rm(path.join(LOCAL_ROOT, u.slice(7)), { force: true });
  } catch {
    /* orphaned objects are tolerated */
  }
}

export async function readLocalMedia(key: string): Promise<Buffer | null> {
  const file = path.resolve(LOCAL_ROOT, key);
  if (!file.startsWith(LOCAL_ROOT + path.sep)) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Decodes (never trusting extension/MIME), validates, auto-orients and re-encodes to WebP — strips EXIF/GPS. */
async function decode(file: Blob | null): Promise<Sharp> {
  if (!file || typeof file === "string") throw new AppError(400, "image_invalid", "Choose an image to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError(400, "image_too_large", "Images must be 4 MB or smaller.");
  if (file.size === 0) throw new AppError(400, "image_invalid", "The file is empty.");
  const buf = Buffer.from(await file.arrayBuffer());
  const img = sharp(buf, { limitInputPixels: 16_000_000, failOn: "error" });
  let meta: Metadata;
  try {
    meta = await img.metadata();
  } catch {
    throw new AppError(400, "image_invalid", "The file is not a supported image (JPEG, PNG or WebP).");
  }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format))
    throw new AppError(400, "image_invalid", "The file is not a supported image (JPEG, PNG or WebP).");
  if ((meta.width ?? 0) < 64 || (meta.height ?? 0) < 64) throw new AppError(400, "image_too_small", "Images must be at least 64×64 pixels.");
  if ((meta.width ?? 0) > 6000 || (meta.height ?? 0) > 6000) throw new AppError(400, "image_too_large", "Images must be at most 6000×6000 pixels.");
  return img.rotate();
}

const randomKey = (prefix: string) => `${prefix}/${base64url(randomBytes(16))}`;

export async function saveSquareImage(file: Blob | null, prefix: string, sizes: number[]): Promise<Record<number, Stored>> {
  const img = await decode(file);
  const key = randomKey(prefix);
  const out: Record<number, Stored> = {};
  try {
    for (const size of sizes) {
      const data = await img.clone().resize(size, size, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toBuffer();
      out[size] = await store(`${key}/${size}.webp`, data, "image/webp");
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "image_invalid", "The image could not be processed.");
  }
  return out;
}

export async function saveBanner(file: Blob | null): Promise<Stored> {
  const img = await decode(file);
  try {
    const data = await img.resize(1600, 900, { fit: "cover", position: "attention" }).webp({ quality: 80 }).toBuffer();
    return await store(`${randomKey("banners")}.webp`, data, "image/webp");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "image_invalid", "The image could not be processed.");
  }
}
