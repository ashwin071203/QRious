"use client";

import { NotificationSettingsPanel } from "@/components/notifications/Notifications";
import { disablePush } from "@/lib/push";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ShieldBan, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/Misc";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Eye, KeyRound, LogOut, MonitorSmartphone, ShieldCheck, X } from "lucide-react";
import { AttendeeNav, PageContainer, TopBar } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Checkbox, Select, Toggle } from "@/components/ui/Form";
import { Skeleton } from "@/components/ui/Misc";
import { RecoveryCodeCard } from "@/components/RecoveryCodeCard";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { keys, useProfile } from "@/lib/queries";
import { formatDateTime, relativeTime } from "@/lib/format";
import type { OwnProfile, SessionInfo, Visibility } from "@/lib/types";

export default function SettingsPage() {
  const { data: profile } = useProfile();
  return (
    <>
      <TopBar title="Settings" />
      <PageContainer className="max-w-2xl space-y-5">
        <h1 className="font-display text-2xl font-bold">Privacy &amp; settings</h1>
        {profile ? <PrivacySection profile={profile} /> : <Skeleton className="h-48" />}
        <NotificationPrefsSection />
        <BlockedSection />
        <RecoverySection />
        <SessionsSection />
        <section className="card flex flex-wrap gap-2 p-5">
          <Link href="/app/premium" className="rounded-xl border border-line-strong px-3 py-2 text-sm hover:border-accent/50">Plan &amp; billing</Link>
          <Link href="/app/saved" className="rounded-xl border border-line-strong px-3 py-2 text-sm hover:border-accent/50">Saved profiles</Link>
          <Link href="/app/events" className="rounded-xl border border-line-strong px-3 py-2 text-sm hover:border-accent/50">My events</Link>
        </section>
        <DeleteAccountSection />
      </PageContainer>
      <AttendeeNav />
    </>
  );
}

function SectionTitle({ icon, title, description, id }: { icon: React.ReactNode; title: string; description?: string; id?: string }) {
  return (
    <div id={id} className="flex scroll-mt-20 items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-card-2 text-accent">{icon}</span>
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-text-2">{description}</p>}
      </div>
    </div>
  );
}

/** Anonymous visibility can be turned off anytime; turning it on needs explicit consent (D-08). */
function PrivacySection({ profile }: { profile: OwnProfile }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function update(body: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      await api("/me/privacy", { method: "PATCH", body });
      await qc.invalidateQueries({ queryKey: keys.profile });
      toast("success", message);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't update privacy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-5 p-5">
      <SectionTitle id="privacy" icon={<Eye className="size-5" />} title="Profile visibility" description="Control who can see you." />
      <Toggle
        checked={profile.privacy.isPublic}
        disabled={busy}
        onChange={(v) => (v ? (setConsent(false), setConfirmOpen(true)) : update({ isPublic: false }, "You're now hidden from visitors without a profile"))}
        label="Visible to visitors without a profile"
        description={profile.privacy.isPublic
          ? `On since ${profile.privacy.anonymousVisibilityConsentedAt ? formatDateTime(profile.privacy.anonymousVisibilityConsentedAt) : "you joined"}. People browsing events you join without an account can see your public profile.`
          : "Off. Only people with a QRious profile at the same event can find you."}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <VisibilitySelect label="Company / college" value={profile.privacy.companyVisibility} disabled={busy}
          onChange={(v) => update({ companyVisibility: v }, "Company visibility updated")} />
        <VisibilitySelect label="Location" value={profile.privacy.locationVisibility} disabled={busy}
          onChange={(v) => update({ locationVisibility: v }, "Location visibility updated")} />
      </div>
      <p className="text-xs text-text-2">Social link visibility is set per link when you edit your profile.</p>
      <Toggle
        checked={profile.privacy.showActivityStatus}
        disabled={busy}
        onChange={(v) => update({ showActivityStatus: v }, v ? "Your connections can see when you're active" : "Your activity status is hidden")}
        label="Show my activity status"
        description={profile.privacy.showActivityStatus
          ? "Your connections see “Active now” or when you were last seen. Only connections, never strangers."
          : "Hidden. While it's off you also won't see when others are active."}
      />


      <AnimatePresence>
        {confirmOpen && (
          <motion.div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-4 backdrop-blur-sm sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            role="dialog" aria-modal aria-label="Make profile visible">
            <motion.div className="card w-full max-w-md p-6" initial={{ y: 30 }} animate={{ y: 0 }} exit={{ y: 30 }}>
              <div className="flex items-start justify-between">
                <h3 className="font-display text-lg font-semibold">Show your profile to visitors?</h3>
                <button onClick={() => setConfirmOpen(false)} aria-label="Close" className="text-text-2 hover:text-text"><X className="size-5" /></button>
              </div>
              <p className="mt-2 text-sm text-text-2">
                Visitors without a QRious account at events you join will see your display name, username, photo, bio, profession, interests and skills.
                Social links, company and location stay hidden unless you set them to Public.
              </p>
              <div className="mt-4"><Checkbox checked={consent} onChange={setConsent}>I understand and agree.</Checkbox></div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                <Button disabled={!consent} loading={busy} onClick={async () => {
                  await update({ isPublic: true, anonymousVisibilityConsent: true }, "Your profile is visible to visitors");
                  setConfirmOpen(false);
                }}>Make visible</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function VisibilitySelect({ label, value, onChange, disabled }: { label: string; value: Visibility; onChange: (v: Visibility) => void; disabled?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Visibility)} className="h-11">
        <option value="public">Public</option>
        <option value="members">Event members</option>
        <option value="connections">Connections only</option>
      </Select>
    </label>
  );
}

function RecoverySection() {
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: keys.recoveryStatus, queryFn: () => api<{ hasActiveCode: boolean; createdAt: string | null }>("/me/recovery-code/status") });
  const [confirming, setConfirming] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    setBusy(true);
    try {
      const r = await api<{ recoveryCode: string }>("/me/recovery-code/regenerate", { method: "POST" });
      setNewCode(r.recoveryCode);
      setConfirming(false);
      void refetch();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't create a new code.");
    } finally {
      setBusy(false);
    }
  }

  if (newCode) return <RecoveryCodeCard code={newCode} title="Your new recovery code" doneLabel="Done" onDone={() => setNewCode(null)} />;

  return (
    <section className="card space-y-4 p-5">
      <SectionTitle id="recovery" icon={<KeyRound className="size-5" />} title="Account recovery"
        description="Use your username and recovery code to get back in on a new phone or after clearing your browser." />
      <p className="text-sm text-text-2">
        {data?.hasActiveCode ? <>Current code created {data.createdAt ? relativeTime(data.createdAt) : ""}. For your security we never show it again.</> : "You don't have an active recovery code."}
      </p>
      {confirming ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <p className="text-warning">Your current code will stop working immediately.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy} onClick={regenerate}>Create new code</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>{data?.hasActiveCode ? "Create a new recovery code" : "Create recovery code"}</Button>
      )}
    </section>
  );
}

function SessionsSection() {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: keys.sessions, queryFn: () => api<SessionInfo[]>("/me/sessions") });

  async function revoke(id: string, current: boolean) {
    await api(`/me/sessions/${id}`, { method: "DELETE" });
    if (current) return signOutDone();
    await qc.invalidateQueries({ queryKey: keys.sessions });
    toast("success", "Device signed out");
  }

  async function signOut() {
    await disablePush("attendee").catch(() => {}); // shared devices: stop pushes for this account here
    await api("/me/session/logout", { method: "POST" }).catch(() => {});
    signOutDone();
  }

  function signOutDone() {
    qc.clear();
    router.replace("/");
  }

  const others = data?.filter((s) => !s.isCurrent) ?? [];

  return (
    <section className="card space-y-4 p-5">
      <SectionTitle icon={<MonitorSmartphone className="size-5" />} title="Signed-in devices"
        description="Sessions end after 30 days without use, and after 180 days at most." />
      {isLoading && <Skeleton className="h-16" />}
      <ul className="divide-y divide-line">
        {data?.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">{s.device}{s.isCurrent && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">This device</span>}</p>
              <p className="text-xs text-text-2">Active {relativeTime(s.lastSeenAt)} · expires {formatDateTime(s.expiresAt < s.absoluteExpiresAt ? s.expiresAt : s.absoluteExpiresAt)}</p>
            </div>
            {!s.isCurrent && <Button size="sm" variant="ghost" onClick={() => revoke(s.id, false)}>Sign out</Button>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {others.length > 0 && (
          <Button variant="secondary" icon={<ShieldCheck className="size-4" />} onClick={async () => {
            await api("/me/sessions/revoke-others", { method: "POST" });
            await qc.invalidateQueries({ queryKey: keys.sessions });
            toast("success", "Other devices signed out");
          }}>Sign out other devices</Button>
        )}
        <Button variant="danger" icon={<LogOut className="size-4" />} onClick={signOut}>Sign out</Button>
      </div>
      <p className="text-xs text-text-2">Before signing out, make sure you&apos;ve saved your recovery code. It&apos;s the only way back in.</p>
    </section>
  );
}

function NotificationPrefsSection() {
  return (
    <section className="card space-y-4 p-5">
      <SectionTitle id="notifications" icon={<Bell className="size-5" />} title="Notifications" description="Choose what you hear about, in the app and as push notifications." />
      <NotificationSettingsPanel role="attendee" />
    </section>
  );
}

function BlockedSection() {
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: ["blocks"], queryFn: () => api<{ profileId: string; displayName: string; username: string; thumbnailUrl: string | null }[]>("/me/blocks") });
  return (
    <section className="card space-y-4 p-5">
      <SectionTitle icon={<ShieldBan className="size-5" />} title="Blocked people" description="They can't find, connect with or message you." />
      {!data ? <Skeleton className="h-16" /> : data.length === 0 ? <p className="text-sm text-text-2">You haven&apos;t blocked anyone.</p> : (
        <ul className="divide-y divide-line">
          {data.map((b) => (
            <li key={b.profileId} className="flex items-center gap-3 py-2.5">
              <Avatar name={b.displayName} src={b.thumbnailUrl} size={36} />
              <span className="min-w-0 flex-1 truncate text-sm">{b.displayName} <span className="text-text-2">@{b.username}</span></span>
              <Button size="sm" variant="ghost" onClick={async () => { await api(`/me/blocks/${b.profileId}`, { method: "DELETE" }); toast("success", "Unblocked"); refetch(); }}>Unblock</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeleteAccountSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: ["deletion"], queryFn: () => api<{ pending: boolean; scheduledFor: string | null }>("/me/deletion-request") });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card space-y-3 border-error/20 p-5">
      <SectionTitle icon={<Trash2 className="size-5" />} title="Delete account" description="Your profile is hidden immediately and permanently deleted after 14 days." />
      {data?.pending ? (
        <div className="space-y-2 text-sm">
          <p className="text-warning">Deletion scheduled for {data.scheduledFor ? formatDateTime(data.scheduledFor) : "soon"}.</p>
          <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); await api("/me/deletion-request", { method: "DELETE" }).catch(() => {}); await qc.invalidateQueries(); refetch(); setBusy(false); }}>Cancel deletion</Button>
        </div>
      ) : <Button variant="danger" onClick={() => setOpen(true)}>Delete my account</Button>}
      <ConfirmDialog open={open} onClose={() => setOpen(false)} danger busy={busy} confirmLabel="Delete account" title="Delete your account?"
        body="Your profile will be hidden from everyone right away and other devices signed out. After 14 days your profile, photo and connections are permanently removed. Messages you sent remain visible to the other person as 'Deleted user'. You can cancel within 14 days from this device."
        onConfirm={async () => {
          setBusy(true);
          try { await api("/me/deletion-request", { method: "POST" }); toast("success", "Deletion scheduled"); setOpen(false); await qc.invalidateQueries(); refetch(); }
          catch (e) { toast("error", e instanceof ApiError ? e.message : "Couldn't schedule deletion."); }
          finally { setBusy(false); }
        }} />
    </section>
  );
}
