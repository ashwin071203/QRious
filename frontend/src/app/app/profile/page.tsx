"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Briefcase, Building2, Eye, EyeOff, Link2, MapPin, PencilLine, Settings, Target, Gift } from "lucide-react";
import { AttendeeNav, PageContainer, TopBar } from "@/components/AppShell";
import { Avatar, Chip, Skeleton } from "@/components/ui/Misc";
import { ButtonLink } from "@/components/ui/Button";
import { useProfile } from "@/lib/queries";
import { PLATFORMS } from "@/components/SocialLinksEditor";

const visibilityLabel = { public: "Public", members: "Event members", connections: "Connections" } as const;

export default function ProfilePage() {
  const { data: p, isLoading } = useProfile();

  return (
    <>
      <TopBar title="Profile" />
      <PageContainer className="max-w-3xl">
        {isLoading || !p ? (
          <div className="space-y-4"><Skeleton className="h-48" /><Skeleton className="h-32" /></div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <section className="card overflow-hidden p-0">
              <div className="h-24 bg-[radial-gradient(120%_120%_at_0%_0%,#8b5cf6_0%,#2a1e42_55%,#19112b_100%)]" />
              <div className="-mt-12 px-5 pb-5">
                <div className="flex items-end justify-between gap-3">
                  <Avatar name={p.displayName} src={p.photo?.url} size={96} className="ring-4 ring-card" />
                  <div className="flex gap-2">
                    <ButtonLink href="/app/settings" variant="secondary" size="sm" icon={<Settings className="size-4" />}>Settings</ButtonLink>
                    <ButtonLink href="/app/profile/edit" size="sm" icon={<PencilLine className="size-4" />}>Edit</ButtonLink>
                  </div>
                </div>
                <h1 className="mt-3 font-display text-2xl font-bold">{p.displayName}</h1>
                <p className="text-text-2">@{p.username}</p>
                {p.bio && <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line">{p.bio}</p>}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-text-2">
                  {p.profession && <span className="inline-flex items-center gap-1.5"><Briefcase className="size-4" />{p.profession}</span>}
                  {p.company && <span className="inline-flex items-center gap-1.5"><Building2 className="size-4" />{p.company}</span>}
                  {p.location && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{p.location}</span>}
                </div>
                <Link href="/app/settings#privacy" className="mt-4 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-text-2 hover:border-accent/50">
                  {p.privacy.isPublic ? <><Eye className="size-3.5 text-success" /> Visible to visitors without a profile</> : <><EyeOff className="size-3.5" /> Hidden from visitors without a profile</>}
                </Link>
              </div>
            </section>

            <TagSection title="Interests" tags={p.interests} />
            <TagSection title="Skills" tags={p.skills} />

            {(p.lookingForText || p.lookingForSkills.length > 0 || p.canOfferText) && (
              <section className="card grid gap-5 p-5 sm:grid-cols-2">
                <div>
                  <h2 className="flex items-center gap-2 font-medium"><Target className="size-4 text-accent" /> Looking for</h2>
                  {p.lookingForText && <p className="mt-2 text-sm text-text-2">{p.lookingForText}</p>}
                  {p.lookingForSkills.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{p.lookingForSkills.map((t) => <Chip key={t.id}>{t.name}</Chip>)}</div>}
                </div>
                {p.canOfferText && (
                  <div>
                    <h2 className="flex items-center gap-2 font-medium"><Gift className="size-4 text-accent" /> Can offer</h2>
                    <p className="mt-2 text-sm text-text-2">{p.canOfferText}</p>
                  </div>
                )}
              </section>
            )}

            {p.socialLinks.length > 0 && (
              <section className="card p-5">
                <h2 className="flex items-center gap-2 font-medium"><Link2 className="size-4 text-accent" /> Links</h2>
                <ul className="mt-3 space-y-2">
                  {p.socialLinks.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                      <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate text-accent-light hover:underline">
                        <span className="text-text-2">{PLATFORMS.find((x) => x.value === l.platform)?.label}: </span>{l.url.replace(/^https:\/\//, "")}
                      </a>
                      <span className="shrink-0 rounded-full bg-bg-2 px-2 py-0.5 text-xs text-text-2">{visibilityLabel[l.visibility]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </motion.div>
        )}
      </PageContainer>
      <AttendeeNav />
    </>
  );
}

function TagSection({ title, tags }: { title: string; tags: { id: string; name: string; pending?: boolean }[] }) {
  return (
    <section className="card p-5">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((t) => <Chip key={t.id} tone={t.pending ? "pending" : "default"} title={t.pending ? "New tag — visible on your profile, pending review" : undefined}>{t.name}</Chip>)}
      </div>
    </section>
  );
}
