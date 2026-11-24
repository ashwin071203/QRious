"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, AtSign, Check, ChevronDown, Eye, Loader2, ShieldCheck, X } from "lucide-react";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import type { CreateProfileResponse, QrResolution, SessionStatus, UsernameAvailability } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, TextArea, Toggle } from "@/components/ui/Form";
import { Avatar, Logo } from "@/components/ui/Misc";
import { TagPicker, type PickedTag } from "@/components/TagPicker";
import { PhotoPicker } from "@/components/PhotoPicker";
import { SocialLinksEditor, type SocialLinkDraft } from "@/components/SocialLinksEditor";
import { RecoveryCodeCard } from "@/components/RecoveryCodeCard";

type Stage = { kind: "loading" } | { kind: "error"; message: string } | { kind: "returning"; session: SessionStatus } | { kind: "form" } | { kind: "recovery"; code: string; redirectTo: string };

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_]|\.(?!\.)){1,28}[a-z0-9_]$/;

export function JoinFlow({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [qr, setQr] = useState<QrResolution | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      try {
        const resolution = await api<QrResolution>(`/public/qr/${encodeURIComponent(code)}`);
        setQr(resolution);
        if (resolution.state !== "valid" || !resolution.event) {
          router.replace(`/e/${code}`);
          return;
        }
        const session = await api<SessionStatus>(`/me/session?eventId=${resolution.event.id}`);
        setStage(session.authenticated ? { kind: "returning", session } : { kind: "form" });
      } catch (e) {
        setStage({ kind: "error", message: e instanceof ApiError ? e.message : "Something went wrong." });
      }
    })();
  }, [code, router]);

  const event = qr?.event;

  return (
    <main className="ambient min-h-dvh pb-16">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
          <Link href={`/e/${code}`} className="rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text" aria-label="Back to event">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-text-2">{event?.name ?? "Event"}</p>
            <p className="font-display text-[15px] font-semibold">Create my profile</p>
          </div>
          <Logo className="hidden text-base sm:inline-flex" />
        </div>
      </header>

      <div className="mx-auto max-w-xl px-4 pt-6">
        <AnimatePresence mode="wait">
          {stage.kind === "loading" && (
            <motion.div key="l" className="grid place-items-center py-24 text-text-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Loader2 className="size-6 animate-spin" />
            </motion.div>
          )}
          {stage.kind === "error" && (
            <motion.div key="e" className="card p-6 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className="text-text-2">{stage.message}</p>
              <Button className="mt-4" onClick={() => location.reload()}>Try again</Button>
            </motion.div>
          )}
          {stage.kind === "returning" && event && (
            <motion.div key="r" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ContinueAs session={stage.session} eventId={event.id} code={code} />
            </motion.div>
          )}
          {stage.kind === "form" && event && (
            <motion.div key="f" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <ProfileForm code={code} eventId={event.id} onCreated={(r) => {
                if (r.recoveryCode) setStage({ kind: "recovery", code: r.recoveryCode, redirectTo: r.redirectTo });
                else router.replace(r.redirectTo);
              }} />
            </motion.div>
          )}
          {stage.kind === "recovery" && (
            <motion.div key="rc" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <RecoveryCodeCard code={stage.code} title="You're in! Save your recovery code" onDone={() => router.replace(stage.redirectTo)} doneLabel="Go to event home" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

/** Returning attendee with a valid session: reuse the global profile; no duplicate creation (PRD §3.4). */
function ContinueAs({ session, eventId, code }: { session: SessionStatus; eventId: string; code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = session.profile!;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ redirectTo: string }>(`/events/${eventId}/participation`, { method: "POST", body: { qrCode: code } });
      router.replace(r.redirectTo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't join the event.");
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 text-center">
      <Avatar name={profile.displayName} src={profile.photo?.url} size={88} className="mx-auto ring-2 ring-primary/50 ring-offset-4 ring-offset-card" />
      <h1 className="mt-5 font-display text-2xl font-bold">You&apos;re already on QRious</h1>
      <p className="mt-2 text-text-2">
        Signed in as <span className="font-medium text-text">{profile.displayName}</span> <span className="text-text-2">@{profile.username}</span>
      </p>
      <p className="mt-3 text-sm text-text-2">Your profile works at every event. No need to create another one.</p>
      {error && <p role="alert" className="mt-4 text-sm text-error">{error}</p>}
      <Button size="lg" className="mt-6 w-full" loading={busy} onClick={join}>
        {session.isParticipant ? "Go to event home" : `Continue as ${profile.displayName}`}
      </Button>
      <p className="mt-4 text-xs text-text-2">Not you? Use a different browser profile to create a separate account.</p>
    </div>
  );
}

function ProfileForm({ code, eventId, onCreated }: { code: string; eventId: string; onCreated: (r: CreateProfileResponse) => void }) {
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ name: string; result: UsernameAvailability } | null>(null);
  const [interests, setInterests] = useState<PickedTag[]>([]);
  const [skills, setSkills] = useState<PickedTag[]>([]);
  const [more, setMore] = useState(false);
  const [bio, setBio] = useState("");
  const [profession, setProfession] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [lookingForText, setLookingForText] = useState("");
  const [lookingForSkills, setLookingForSkills] = useState<PickedTag[]>([]);
  const [canOfferText, setCanOfferText] = useState("");
  const [links, setLinks] = useState<SocialLinkDraft[]>([]);
  const [isPublic, setIsPublic] = useState(true);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);

  // Suggest a username from the display name until the user edits it.
  const username = usernameDraft ?? suggestUsername(displayName);
  const setUsername = (value: string) => setUsernameDraft(value);
  const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();
  const usernameFormatOk = USERNAME_RE.test(normalizedUsername);
  const availability = usernameFormatOk && checked?.name === normalizedUsername ? checked.result : null;
  const checking = usernameFormatOk && checked?.name !== normalizedUsername;
  const setAvailability = (result: UsernameAvailability) => setChecked({ name: normalizedUsername, result });

  useEffect(() => {
    if (!usernameFormatOk) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<UsernameAvailability>(`/onboarding/username-availability?u=${encodeURIComponent(normalizedUsername)}`, { signal: ctrl.signal })
        .then((result) => setChecked({ name: normalizedUsername, result }))
        .catch(() => {});
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [normalizedUsername, usernameFormatOk]);

  // One key per form session: retries after network loss replay instead of duplicating (PRD §12.5).
  const storageKey = `qrious:onboard:${code}`;
  const idempotencyKey = useMemo(() => {
    if (typeof window === "undefined") return newIdempotencyKey();
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const k = newIdempotencyKey();
    sessionStorage.setItem(storageKey, k);
    return k;
  }, [storageKey]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!displayName.trim()) e.displayName = "Display name is required.";
    if (!normalizedUsername) e.username = "Username is required.";
    else if (!usernameFormatOk) e.username = "3–30 characters: lowercase letters, numbers, _ and single dots. Start with a letter or number.";
    else if (availability && !availability.available) e.username = availability.reason ?? "That username is taken.";
    if (interests.length === 0) e.interests = "Choose at least one interest.";
    if (skills.length === 0) e.skills = "Choose at least one skill.";
    if (isPublic && !consent) e.anonymousVisibilityConsent = "Please confirm, or turn public visibility off.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) {
      document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    setPhase("Creating your profile…");
    const toInput = (t: PickedTag) => (t.id ? { id: t.id } : { name: t.name });
    try {
      const response = await api<CreateProfileResponse>("/onboarding/profile", {
        method: "POST",
        idempotencyKey,
        body: {
          qrCode: code,
          displayName: displayName.trim(),
          username: normalizedUsername,
          interests: interests.map(toInput),
          skills: skills.map(toInput),
          isPublic,
          anonymousVisibilityConsent: isPublic && consent,
          bio: bio.trim() || null,
          profession: profession.trim() || null,
          company: company.trim() || null,
          location: location.trim() || null,
          lookingForText: lookingForText.trim() || null,
          canOfferText: canOfferText.trim() || null,
          lookingForSkills: lookingForSkills.map(toInput),
          socialLinks: links.filter((l) => l.url.trim()).map((l) => ({ platform: l.platform, url: l.url.trim(), visibility: l.visibility })),
        },
      });
      sessionStorage.removeItem(storageKey);

      if (photo) {
        setPhase("Uploading your photo…");
        try {
          const form = new FormData();
          form.append("file", photo.blob, "photo.jpg");
          await api("/me/profile/photo", { method: "PUT", body: form });
        } catch {
          // Photo is optional: the profile is complete; the user can retry from their profile.
        }
      }
      onCreated(response);
    } catch (e) {
      setSubmitting(false);
      setPhase(null);
      if (!(e instanceof ApiError)) return setFormError("Something went wrong. Please try again.");
      if (e.code === "existing_identity") return window.location.reload();
      if (e.code === "username_taken") {
        setAvailability({ available: false, normalized: normalizedUsername, reason: e.message, suggestions: (e.extra.suggestions as string[]) ?? [] });
        setErrors({ username: e.message });
        return;
      }
      if (e.errors) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.errors)) mapped[k] = v[0]!;
        setErrors(mapped);
      }
      setFormError(e.code === "rate_limited" ? e.message : e.errors ? "Please fix the highlighted fields." : e.message);
    }
  }

  const err = (k: string) => errors[k];

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div>
        <h1 className="font-display text-[1.75rem] leading-tight font-bold">Let people know who you are</h1>
        <p className="mt-1.5 text-text-2">Four quick things and you&apos;re in. Your profile works at every QRious event.</p>
      </div>

      <section className="card space-y-5 p-5">
        <PhotoPicker name={displayName} value={photo} onChange={setPhoto} />

        <div data-error={!!err("displayName")}>
          <Field label="Display name" required htmlFor="displayName" error={err("displayName")} hint="Doesn't need to be unique." counter={{ value: displayName.length, max: 60 }}>
            <Input id="displayName" value={displayName} maxLength={60} autoComplete="nickname" placeholder="e.g. Priya Sharma"
              aria-invalid={!!err("displayName")} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
        </div>

        <div data-error={!!err("username")}>
          <Field label="Username" required htmlFor="username" error={err("username")}
            hint={<UsernameHint ok={usernameFormatOk} checking={checking} availability={availability} />}>
            <div className="relative">
              <AtSign className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" aria-hidden />
              <Input id="username" value={username} maxLength={31} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className="pl-9" aria-invalid={!!err("username")}
                onChange={(e) => { setUsername(e.target.value.replace(/\s/g, "")); }} />
            </div>
          </Field>
          {availability && !availability.available && availability.suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-text-2">Try:</span>
              {availability.suggestions.map((s) => (
                <button key={s} type="button" onClick={() => { setUsername(s); setErrors((x) => ({ ...x, username: "" })); }}
                  className="rounded-full border border-line-strong px-2.5 py-1 text-accent-light hover:border-accent">@{s}</button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card space-y-3 p-5" data-error={!!err("interests")}>
        <Field label="Interests" required error={err("interests")} hint="Pick what you're into — suggestions match this event.">
          <TagPicker kind="interests" value={interests} onChange={setInterests} eventId={eventId} invalid={!!err("interests")} />
        </Field>
      </section>

      <section className="card space-y-3 p-5" data-error={!!err("skills")}>
        <Field label="Skills" required error={err("skills")} hint="What you're good at. Helps the right people find you.">
          <TagPicker kind="skills" value={skills} onChange={setSkills} eventId={eventId} invalid={!!err("skills")} />
        </Field>
      </section>

      <section className="card overflow-hidden">
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
          className="flex w-full items-center justify-between px-5 py-4 text-left">
          <span>
            <span className="block font-medium">Add more <span className="text-sm font-normal text-text-2">(optional)</span></span>
            <span className="text-sm text-text-2">Bio, profession, what you&apos;re looking for, links</span>
          </span>
          <ChevronDown className={`size-5 text-text-2 transition-transform ${more ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence initial={false}>
          {more && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="space-y-5 border-t border-line px-5 py-5">
                <Field label="Short bio" optional htmlFor="bio" error={err("bio")} counter={{ value: bio.length, max: 500 }}>
                  <TextArea id="bio" value={bio} maxLength={500} onChange={(e) => setBio(e.target.value)} placeholder="A line or two about you" />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Profession / role" optional htmlFor="profession" error={err("profession")}>
                    <Input id="profession" value={profession} maxLength={100} onChange={(e) => setProfession(e.target.value)} placeholder="e.g. Music producer" />
                  </Field>
                  <Field label="Company / college" optional htmlFor="company" error={err("company")}>
                    <Input id="company" value={company} maxLength={100} onChange={(e) => setCompany(e.target.value)} />
                  </Field>
                </div>
                <Field label="Location" optional htmlFor="location" error={err("location")}>
                  <Input id="location" value={location} maxLength={100} onChange={(e) => setLocation(e.target.value)} placeholder="City or area" />
                </Field>
                <Field label="What I'm looking for" optional htmlFor="lookingFor" error={err("lookingForText")} counter={{ value: lookingForText.length, max: 500 }}>
                  <TextArea id="lookingFor" value={lookingForText} maxLength={500} onChange={(e) => setLookingForText(e.target.value)} placeholder="e.g. A vocalist for my indie project" />
                </Field>
                <Field label="Skills I'm looking for" optional hint="Helps Smart Matching find the right people.">
                  <TagPicker kind="skills" value={lookingForSkills} onChange={setLookingForSkills} eventId={eventId} max={10} placeholder="e.g. Singing, Drums" />
                </Field>
                <Field label="What I can offer" optional htmlFor="canOffer" error={err("canOfferText")} counter={{ value: canOfferText.length, max: 500 }}>
                  <TextArea id="canOffer" value={canOfferText} maxLength={500} onChange={(e) => setCanOfferText(e.target.value)} placeholder="e.g. Mixing & mastering, studio time" />
                </Field>
                <Field label="Social & portfolio links" optional error={err("socialLinks")} hint="Visible to event members by default — never to visitors without a profile unless you choose Public.">
                  <SocialLinksEditor value={links} onChange={setLinks} />
                </Field>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Anonymous visibility with explicit consent (D-08) */}
      <section className="card space-y-4 p-5" data-error={!!err("anonymousVisibilityConsent")}>
        <Toggle checked={isPublic} onChange={(v) => { setIsPublic(v); if (!v) setConsent(false); }}
          label={<span className="inline-flex items-center gap-2"><Eye className="size-4 text-accent" /> Visible to visitors without a profile</span>}
          description="People browsing this event without an account can find you in Discover People." />
        {isPublic && (
          <div className="rounded-2xl border border-line bg-bg-2 p-4 text-sm">
            <p className="font-medium text-text">What visitors without a profile can see</p>
            <ul className="mt-2 grid gap-1 text-text-2 sm:grid-cols-2">
              {["Display name & username", "Profile photo", "Short bio & profession", "Interests & skills"].map((x) => (
                <li key={x} className="flex items-center gap-2"><Check className="size-4 text-success" />{x}</li>
              ))}
              {["Social links", "Company & location", "Messages & connections"].map((x) => (
                <li key={x} className="flex items-center gap-2"><X className="size-4 text-error" />{x}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-2">Only for events you join. You can turn this off anytime in Privacy settings.</p>
            <div className="mt-3">
              <Checkbox checked={consent} onChange={setConsent}>I understand and agree that people without an account can see my public profile.</Checkbox>
            </div>
            {err("anonymousVisibilityConsent") && <p role="alert" className="mt-2 text-sm text-error">{err("anonymousVisibilityConsent")}</p>}
          </div>
        )}
      </section>

      {formError && <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{formError}</p>}

      <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-bg via-bg/95 to-transparent px-4 pt-6 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {phase ?? "Create profile & join event"}
        </Button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-text-2">
          <ShieldCheck className="size-3.5" /> No email or password needed.
        </p>
      </div>
    </form>
  );
}

function UsernameHint({ ok, checking, availability }: { ok: boolean; checking: boolean; availability: UsernameAvailability | null }) {
  if (!ok) return <>Unique across QRious. Lowercase letters, numbers, _ and dots.</>;
  if (checking) return <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> Checking…</span>;
  if (availability?.available) return <span className="inline-flex items-center gap-1.5 text-success"><Check className="size-3.5" /> Available</span>;
  if (availability && !availability.available) return <span className="text-error">{availability.reason}</span>;
  return <>Unique across QRious.</>;
}

function suggestUsername(displayName: string): string {
  return displayName.toLowerCase().normalize("NFKD").replace(/[^\w\s.]/g, "").trim().replace(/\s+/g, ".").replace(/\.{2,}/g, ".").slice(0, 30);
}
