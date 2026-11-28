"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AtSign } from "lucide-react";
import { AttendeeNav, PageContainer, TopBar } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Field, Input, TextArea } from "@/components/ui/Form";
import { Skeleton } from "@/components/ui/Misc";
import { PhotoPicker } from "@/components/PhotoPicker";
import { TagPicker, type PickedTag } from "@/components/TagPicker";
import { SocialLinksEditor, type SocialLinkDraft } from "@/components/SocialLinksEditor";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { keys, useProfile } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import type { OwnProfile } from "@/lib/types";

export default function EditProfilePage() {
  const { data } = useProfile();
  return (
    <>
      <TopBar title="Edit profile" />
      <PageContainer className="max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Edit profile</h1>
        <p className="mt-1 text-sm text-text-2">Changes apply to your global profile at every event.</p>
        {data ? <Editor profile={data} /> : <div className="mt-6 space-y-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>}
      </PageContainer>
      <AttendeeNav />
    </>
  );
}

const toPicked = (t: { id: string; name: string; pending?: boolean }): PickedTag => ({ id: t.id, name: t.name, pending: t.pending });
const toInput = (t: PickedTag) => (t.id ? { id: t.id } : { name: t.name });

function Editor({ profile }: { profile: OwnProfile }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [form, setForm] = useState({
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio ?? "",
    profession: profile.profession ?? "",
    company: profile.company ?? "",
    location: profile.location ?? "",
    lookingForText: profile.lookingForText ?? "",
    canOfferText: profile.canOfferText ?? "",
  });
  const [interests, setInterests] = useState<PickedTag[]>(profile.interests.map(toPicked));
  const [skills, setSkills] = useState<PickedTag[]>(profile.skills.map(toPicked));
  const [lookingForSkills, setLookingForSkills] = useState<PickedTag[]>(profile.lookingForSkills.map(toPicked));
  const [links, setLinks] = useState<SocialLinkDraft[]>(profile.socialLinks.map((l) => ({ platform: l.platform, url: l.url, visibility: l.visibility })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const existingPhoto = !photoRemoved && profile.photo ? { blob: new Blob(), url: profile.photo.url } : null;
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const usernameLocked = profile.usernameChangeAvailableAt && new Date(profile.usernameChangeAvailableAt) > new Date();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.displayName.trim()) errs.displayName = "Display name is required.";
    if (interests.length === 0) errs.interests = "Keep at least one interest.";
    if (skills.length === 0) errs.skills = "Keep at least one skill.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const patch: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) {
        const original = (profile as unknown as Record<string, string | null>)[k] ?? "";
        if (v.trim() !== original) patch[k] = v.trim();
      }
      if (Object.keys(patch).length) await api("/me/profile", { method: "PATCH", body: patch });
      await api("/me/profile/interests", { method: "PUT", body: { items: interests.map(toInput) } });
      await api("/me/profile/skills", { method: "PUT", body: { items: skills.map(toInput) } });
      await api("/me/profile/looking-for-skills", { method: "PUT", body: { items: lookingForSkills.map(toInput) } });
      await api("/me/profile/social-links", { method: "PUT", body: { links: links.filter((l) => l.url.trim()) } });
      if (photo) {
        const fd = new FormData();
        fd.append("file", photo.blob, "photo.jpg");
        await api("/me/profile/photo", { method: "PUT", body: fd });
      } else if (photoRemoved && profile.photo) {
        await api("/me/profile/photo", { method: "DELETE" });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: keys.profile }), qc.invalidateQueries({ queryKey: keys.session })]);
      toast("success", "Profile saved");
      router.push("/app/profile");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]!])));
        if (err.code === "username_taken" || err.code === "username_change_too_soon") setErrors((x) => ({ ...x, username: err.message }));
        toast("error", err.errors ? "Please fix the highlighted fields." : err.message);
      } else toast("error", "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-6 space-y-5" noValidate>
      <section className="card space-y-5 p-5">
        <PhotoPicker name={form.displayName} value={photo ?? existingPhoto} onChange={(v) => { setPhoto(v); if (!v) setPhotoRemoved(true); }} />
        <Field label="Display name" required htmlFor="dn" error={errors.displayName} counter={{ value: form.displayName.length, max: 60 }}>
          <Input id="dn" value={form.displayName} maxLength={60} onChange={set("displayName")} aria-invalid={!!errors.displayName} />
        </Field>
        <Field label="Username" required htmlFor="un" error={errors.username}
          hint={usernameLocked ? `You can change your username again after ${formatDateTime(profile.usernameChangeAvailableAt!)}.` : "You can change it once every 30 days."}>
          <div className="relative">
            <AtSign className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" />
            <Input id="un" className="pl-9" value={form.username} disabled={!!usernameLocked} maxLength={30} autoCapitalize="none" spellCheck={false}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, "") }))} />
          </div>
        </Field>
        <Field label="Short bio" optional htmlFor="bio" counter={{ value: form.bio.length, max: 500 }} error={errors.bio}>
          <TextArea id="bio" value={form.bio} maxLength={500} onChange={set("bio")} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Profession / role" optional htmlFor="pr" error={errors.profession}><Input id="pr" value={form.profession} maxLength={100} onChange={set("profession")} /></Field>
          <Field label="Company / college" optional htmlFor="co" error={errors.company}><Input id="co" value={form.company} maxLength={100} onChange={set("company")} /></Field>
        </div>
        <Field label="Location" optional htmlFor="lo" error={errors.location}><Input id="lo" value={form.location} maxLength={100} onChange={set("location")} /></Field>
      </section>

      <section className="card space-y-5 p-5">
        <Field label="Interests" required error={errors.interests}><TagPicker kind="interests" value={interests} onChange={setInterests} /></Field>
        <Field label="Skills" required error={errors.skills}><TagPicker kind="skills" value={skills} onChange={setSkills} /></Field>
      </section>

      <section className="card space-y-5 p-5">
        <Field label="What I'm looking for" optional htmlFor="lf" counter={{ value: form.lookingForText.length, max: 500 }}>
          <TextArea id="lf" value={form.lookingForText} maxLength={500} onChange={set("lookingForText")} />
        </Field>
        <Field label="Skills I'm looking for" optional><TagPicker kind="skills" value={lookingForSkills} onChange={setLookingForSkills} max={10} /></Field>
        <Field label="What I can offer" optional htmlFor="co2" counter={{ value: form.canOfferText.length, max: 500 }}>
          <TextArea id="co2" value={form.canOfferText} maxLength={500} onChange={set("canOfferText")} />
        </Field>
      </section>

      <section className="card p-5">
        <Field label="Social & portfolio links" optional error={errors.socialLinks} hint="Choose who can see each link. Public links are visible to visitors without a profile.">
          <SocialLinksEditor value={links} onChange={setLinks} />
        </Field>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" loading={saving}>Save changes</Button>
      </div>
    </form>
  );
}
