"use client";

import dynamic from "next/dynamic";
import { useClientValue } from "@/lib/client-store";

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false, loading: () => <Fallback /> });

function Fallback() {
  return <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,rgba(139,92,246,0.35),transparent_70%),radial-gradient(40%_40%_at_70%_70%,rgba(232,121,249,0.25),transparent_70%)]" aria-hidden />;
}

/**
 * 3D network hero (D-07). Loaded lazily, never blocks content, and replaced by a static gradient when the user
 * prefers reduced motion, WebGL is unavailable, or the device reports little memory.
 */
export function LazyHeroScene() {
  const enabled = useClientValue(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowMemory = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) < 4;
    let webgl = false;
    try { webgl = !!document.createElement("canvas").getContext("webgl2"); } catch { webgl = false; }
    return !reduced && !lowMemory && webgl;
  }, false);
  return <div className="absolute inset-0" aria-hidden>{enabled ? <HeroScene /> : <Fallback />}</div>;
}
