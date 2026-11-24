"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Camera, ImagePlus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Misc";

const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/**
 * Downscales to a 1024 px square-cropped JPEG (≈ 100–400 KB) in the browser before upload: saves mobile data
 * and keeps requests under free-tier proxy body limits. The server still validates and re-encodes (PRD §12.2).
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const side = Math.min(bitmap.width, bitmap.height);
  const target = Math.min(1024, side);
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, target, target);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.86),
  );
}

/** Upload / take / preview / replace / remove a profile photo (PRD §3.2 "Profile Photo Functionality"). */
export function PhotoPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: { blob: Blob; url: string } | null;
  onChange: (photo: { blob: Blob; url: string } | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept(file: File | Blob) {
    setError(null);
    if (file.size > MAX_INPUT_BYTES) return setError("That photo is too large (max 15 MB before resizing).");
    if (file instanceof File && file.type && !ACCEPTED.includes(file.type)) return setError("Please choose a JPEG, PNG or WebP image.");
    setBusy(true);
    try {
      const blob = await prepareImage(file);
      if (value) URL.revokeObjectURL(value.url);
      onChange({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setError("We couldn't read that image. Try a different photo.");
    } finally {
      setBusy(false);
    }
  }

  const isTouch = typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const canUseCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  return (
    <div className="flex items-center gap-5">
      <div className="relative">
        <AnimatePresence mode="wait">
          <motion.div key={value?.url ?? "empty"} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
            {value ? (
              <Avatar name={name || "You"} src={value.url} size={96} className="ring-2 ring-primary/60 ring-offset-4 ring-offset-bg" />
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="grid size-24 place-items-center rounded-full border-2 border-dashed border-line-strong bg-bg-2 text-text-2 transition hover:border-accent hover:text-accent"
                aria-label="Add a profile photo"
              >
                <ImagePlus className="size-8" />
              </button>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" loading={busy} icon={value ? <RefreshCw className="size-4" /> : <ImagePlus className="size-4" />}
            onClick={() => fileInput.current?.click()}>
            {value ? "Replace" : "Upload"}
          </Button>
          {(isTouch || canUseCamera) && (
            <Button type="button" size="sm" variant="secondary" icon={<Camera className="size-4" />}
              onClick={() => (isTouch ? captureInput.current?.click() : setCameraOpen(true))}>
              Take photo
            </Button>
          )}
          {value && (
            <Button type="button" size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => { URL.revokeObjectURL(value.url); onChange(null); }}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-text-2">{error ? <span className="text-error">{error}</span> : "JPEG, PNG or WebP. Location data is removed."}</p>
      </div>

      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void accept(f); e.target.value = ""; }} />
      <input ref={captureInput} type="file" accept="image/*" capture="user" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void accept(f); e.target.value = ""; }} />

      <AnimatePresence>{cameraOpen && <CameraModal onClose={() => setCameraOpen(false)} onCapture={(b) => { setCameraOpen(false); void accept(b); }} />}</AnimatePresence>
    </div>
  );
}

function CameraModal({ onClose, onCapture }: { onClose: () => void; onCapture: (blob: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("Camera access was blocked. You can upload a photo instead."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1); // un-mirror the selfie preview
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(b), "image/jpeg", 0.92);
  }

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal aria-label="Take a photo">
      <motion.div className="card w-full max-w-md overflow-hidden p-0" initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.97 }}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-medium">Take a photo</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-2 hover:bg-white/5 hover:text-text" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="relative aspect-square bg-black">
          {error ? <p className="grid h-full place-items-center p-6 text-center text-sm text-text-2">{error}</p>
            : <video ref={video} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />}
        </div>
        <div className="flex justify-end gap-2 p-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={snap} disabled={!!error} icon={<Camera className="size-4" />}>Capture</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
