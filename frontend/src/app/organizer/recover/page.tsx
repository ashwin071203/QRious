"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { RecoveryCodeCard } from "@/components/RecoveryCodeCard";
import { api, ApiError } from "@/lib/api";

/** Password reset with email + recovery code (no email provider needed). */
export default function RecoverOrganizerPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", recoveryCode: "", newPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ newRecoveryCode: string }>("/organizer/auth/recover", { method: "POST", body: form });
      setCode(r.newRecoveryCode);
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors ? Object.values(err.errors)[0]![0]! : err.message) : "Couldn't reset your password.");
    } finally {
      setBusy(false);
    }
  }

  if (code) return (
    <AuthFrame title="Password updated" subtitle="You're signed in. Other sessions were signed out.">
      <RecoveryCodeCard code={code} title="Your new recovery code" doneLabel="Go to dashboard" onDone={() => router.replace("/organizer/dashboard")} />
    </AuthFrame>
  );

  return (
    <AuthFrame title="Reset your password" subtitle="Use the recovery code you saved when you created your account.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Email" htmlFor="e"><Input id="e" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Recovery code" htmlFor="c"><Input id="c" className="font-mono" value={form.recoveryCode} onChange={(e) => setForm({ ...form, recoveryCode: e.target.value })} placeholder="QRS-…" /></Field>
        <Field label="New password" htmlFor="p" hint="At least 12 characters."><Input id="p" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></Field>
        {error && <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-sm text-error">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Reset password</Button>
        <p className="text-sm"><Link href="/organizer/login" className="text-accent-light hover:underline">Back to sign in</Link></p>
      </form>
    </AuthFrame>
  );
}
