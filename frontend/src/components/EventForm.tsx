"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, TextArea } from "@/components/ui/Form";
import { api, ApiError } from "@/lib/api";
import { isoToZonedInput, TIME_ZONES, zonedInputToIso } from "@/lib/format";
import type { Category, OrgEventDetail } from "@/lib/types";

export type EventFormValue = { name: string; categoryId: string; description: string; venueName: string; venueAddress: string; city: string; timeZone: string; start: string; end: string; website: string; maxParticipants: string };

export function initialForm(e?: OrgEventDetail): EventFormValue {
  const tz = e?.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata");
  return {
    name: e?.name ?? "", categoryId: e?.categoryId ?? "", description: e?.description ?? "", venueName: e?.venueName ?? "", venueAddress: e?.venueAddress ?? "",
    city: e?.city ?? "", timeZone: tz, start: e ? isoToZonedInput(e.startsAt, tz) : "", end: e ? isoToZonedInput(e.endsAt, tz) : "", website: e?.website ?? "",
    maxParticipants: e?.maxParticipants ? String(e.maxParticipants) : "",
  };
}

/** Create/edit event (M14): required name, category, date, start/end time, venue; optional rest. */
export function EventForm({ initial, submitLabel, onSubmit }: { initial: EventFormValue; submitLabel: string; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/public/categories") });
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof EventFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const zones = TIME_ZONES.includes(f.timeZone) ? TIME_ZONES : [f.timeZone, ...TIME_ZONES];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = "Enter an event name.";
    if (!f.categoryId) errs.categoryId = "Choose a category.";
    if (!f.venueName.trim()) errs.venueName = "Enter the venue.";
    const startsAt = zonedInputToIso(f.start, f.timeZone);
    const endsAt = zonedInputToIso(f.end, f.timeZone);
    if (!startsAt) errs.startsAt = "Choose the start date and time.";
    if (!endsAt) errs.endsAt = "Choose the end date and time.";
    if (startsAt && endsAt && endsAt <= startsAt) errs.endsAt = "The end must be after the start.";
    const max = f.maxParticipants.trim() ? Number(f.maxParticipants) : null;
    if (max !== null && (!Number.isInteger(max) || max < 1)) errs.maxParticipants = "Enter a whole number, or leave empty.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await onSubmit({ name: f.name, categoryId: f.categoryId, description: f.description, venueName: f.venueName, venueAddress: f.venueAddress, city: f.city,
        timeZone: f.timeZone, startsAt, endsAt, website: f.website, maxParticipants: max });
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]!])));
      else setErrors({ form: err instanceof ApiError ? err.message : "Couldn't save the event." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <section className="card space-y-5 p-5">
        <Field label="Event name" required htmlFor="name" error={errors.name}><Input id="name" maxLength={150} value={f.name} onChange={set("name")} placeholder="e.g. Indie Nights Live" /></Field>
        <Field label="Category" required htmlFor="cat" error={errors.categoryId} hint="Sets smart defaults for interests, skills and networking goals.">
          <Select id="cat" className="h-12" value={f.categoryId} onChange={set("categoryId")}>
            <option value="">Choose…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Description" optional htmlFor="desc" counter={{ value: f.description.length, max: 5000 }} error={errors.description}><TextArea id="desc" maxLength={5000} value={f.description} onChange={set("description")} /></Field>
      </section>
      <section className="card grid gap-5 p-5 sm:grid-cols-2">
        <Field label="Starts" required htmlFor="start" error={errors.startsAt}><Input id="start" type="datetime-local" value={f.start} onChange={set("start")} /></Field>
        <Field label="Ends" required htmlFor="end" error={errors.endsAt}><Input id="end" type="datetime-local" value={f.end} onChange={set("end")} /></Field>
        <Field label="Time zone" htmlFor="tz" error={errors.timeZone} hint="Times are shown to attendees in this zone."><Select id="tz" className="h-12" value={f.timeZone} onChange={set("timeZone")}>{zones.map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Max participants" optional htmlFor="max" error={errors.maxParticipants}><Input id="max" inputMode="numeric" value={f.maxParticipants} onChange={set("maxParticipants")} placeholder="No limit" /></Field>
      </section>
      <section className="card grid gap-5 p-5 sm:grid-cols-2">
        <Field label="Venue" required htmlFor="venue" error={errors.venueName}><Input id="venue" maxLength={150} value={f.venueName} onChange={set("venueName")} /></Field>
        <Field label="City" optional htmlFor="city" error={errors.city}><Input id="city" maxLength={100} value={f.city} onChange={set("city")} /></Field>
        <Field label="Address" optional htmlFor="addr" error={errors.venueAddress}><Input id="addr" maxLength={300} value={f.venueAddress} onChange={set("venueAddress")} /></Field>
        <Field label="Website" optional htmlFor="web" error={errors.website}><Input id="web" inputMode="url" value={f.website} onChange={set("website")} placeholder="https://" /></Field>
      </section>
      {errors.form && <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-sm text-error">{errors.form}</p>}
      <div className="flex justify-end"><Button type="submit" size="lg" loading={busy}>{submitLabel}</Button></div>
    </form>
  );
}
