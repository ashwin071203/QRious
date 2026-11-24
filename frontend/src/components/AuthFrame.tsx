"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Misc";
import { LazyHeroScene } from "@/components/three/LazyHeroScene";

/** Organizer auth layout with the lazy 3D hero (D-07: 3D only on marketing + organizer login). */
export function AuthFrame({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return (
    <main className="ambient grid min-h-dvh lg:grid-cols-2">
      <section className="relative hidden overflow-hidden border-r border-line lg:block">
        <LazyHeroScene />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />
        <div className="absolute bottom-10 left-10 max-w-md">
          <h2 className="font-display text-4xl font-bold">Turn your event into a <span className="text-grad">networking space</span>.</h2>
          <p className="mt-3 text-text-2">Create the event, print one QR code, and let attendees find the people they came to meet.</p>
        </div>
      </section>
      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <Link href="/" className="inline-block"><Logo /></Link>
          <h1 className="mt-8 font-display text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-text-2">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
