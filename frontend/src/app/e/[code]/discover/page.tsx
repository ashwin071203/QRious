import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Compass, UserPlus } from "lucide-react";
import { Logo } from "@/components/ui/Misc";

export const metadata: Metadata = { title: "Discover people" };

/**
 * Discover People entry (PRD §3.2 Option 1). Public discovery ships in Phase 4; until then this page explains
 * what's coming. It never creates identity or participation (BR-02).
 */
export default function DiscoverPage({ params }: { params: Promise<{ code: string }> }) {
  return <DiscoverInterim params={params} />;
}

function DiscoverInterim({ params }: { params: Promise<{ code: string }> }) {
  return (
    <main className="ambient grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-md text-center">
        <Logo />
        <div className="card mt-8 p-8">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-grad-primary text-white shadow-[var(--shadow-glow)]"><Compass className="size-8" /></div>
          <h1 className="mt-5 font-display text-2xl font-bold">Discover People is almost here</h1>
          <p className="mt-3 text-sm text-text-2">
            Soon you&apos;ll be able to browse the public profiles of people at this event — search by name, explore interests and skills —
            without creating an account.
          </p>
          <p className="mt-3 text-sm text-text-2">Create your profile now so others can discover you when it opens.</p>
          <Suspense fallback={<div className="mt-6 h-[100px]" />}>
            <DiscoverLinks params={params} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function DiscoverLinks({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <div className="mt-6 grid gap-2">
      <Link href={`/e/${code}/join`} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-grad-primary font-semibold">
        <UserPlus className="size-4" /> Create My Profile
      </Link>
      <Link href={`/e/${code}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl text-text-2 hover:text-text">
        <ArrowLeft className="size-4" /> Back to event
      </Link>
    </div>
  );
}
