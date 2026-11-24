"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AuthFrame } from "@/components/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { RecoveryCodeCard } from "@/components/RecoveryCodeCard";
import { api, ApiError } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await api<{ recoveryCode: string }>("/organizer/auth/register", { method: "POST", body: form });
      await qc.invalidateQueries();
      setCode(r.recoveryCode);
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]!])));
      setError(err instanceof ApiError ? err.message : "Couldn't create the account.");
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return (
      <AuthFrame title="Account created" subtitle="One more thing before you start.">
        <RecoveryCodeCard code={code} title="Save your recovery code" doneLabel="Continue to dashboard" onDone={() => router.replace("/organizer/dashboard")} />
        <p className="mt-3 text-xs text-text-2">Use it with your email to reset your password if you ever forget it.</p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Create an organizer account" subtitle="Free to start. Publish events and share one QR code.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Your name" htmlFor="n" error={errors.displayName}><Input id="n" autoComplete="name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
        <Field label="Email" htmlFor="e" error={errors.email}><Input id="e" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Password" htmlFor="p" error={errors.password} hint="At least 12 characters. A short phrase works well.">
          <Input id="p" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error && !Object.keys(errors).length && <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-sm text-error">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Create account</Button>
        <p className="text-sm text-text-2">Already have an account? <Link href="/organizer/login" className="text-accent-light hover:underline">Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}
