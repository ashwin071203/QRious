"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, MessageCircle, UserPlus, UserX } from "lucide-react";
import { ProfileDetail } from "@/components/People";
import { EmptyState, Logo, Skeleton } from "@/components/ui/Misc";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Overlay";
import { api, ApiError } from "@/lib/api";
import type { PersonCard } from "@/lib/types";

/** Public profile for anonymous visitors. Member actions explain that a profile is required (BR-03). */
export function PublicPerson({ params }: { params: Promise<{ code: string; profileId: string }> }) {
  const { code, profileId } = use(params);
  const [gate, setGate] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["public-person", code, profileId], retry: false, queryFn: () => api<PersonCard>(`/public/events/${code}/people/${profileId}`) });

  return (
    <main className="ambient min-h-dvh pb-16">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link href={`/e/${code}/discover`} className="rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text" aria-label="Back"><ArrowLeft className="size-5" /></Link>
          <Logo className="text-base" />
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 pt-5">
        {q.isLoading ? <Skeleton className="h-80" /> : q.error ? (
          <div className="card"><EmptyState icon={<UserX className="size-7" />} title="Profile unavailable">{q.error instanceof ApiError ? q.error.message : "Something went wrong."}</EmptyState></div>
        ) : q.data && (
          <ProfileDetail person={q.data} actions={
            <div className="flex flex-wrap gap-2">
              <Button icon={<UserPlus className="size-4" />} onClick={() => setGate("connect with")}>Connect</Button>
              <Button variant="secondary" icon={<MessageCircle className="size-4" />} onClick={() => setGate("message")}>Message</Button>
              <Button variant="secondary" icon={<Bookmark className="size-4" />} onClick={() => setGate("save")}>Save</Button>
            </div>
          } />
        )}
      </div>
      <Modal open={!!gate} onClose={() => setGate(null)} title="Create your profile to continue"
        footer={<><Button variant="ghost" onClick={() => setGate(null)}>Keep browsing</Button><ButtonLink href={`/e/${code}/join`} icon={<UserPlus className="size-4" />}>Create My Profile</ButtonLink></>}>
        <p className="text-sm text-text-2">To {gate} {q.data?.displayName ?? "people"}, you need a QRious profile. It takes under a minute — no email or password.</p>
      </Modal>
    </main>
  );
}
