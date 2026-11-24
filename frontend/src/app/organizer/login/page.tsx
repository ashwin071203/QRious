"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AuthFrame } from "@/components/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { api, ApiError } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/organizer/auth/login", { method: "POST", body: { email, password } });
      await qc.invalidateQueries();
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/organizer/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {error && <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-sm text-error">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
      <div className="flex justify-between text-sm">
        <Link href="/organizer/register" className="text-accent-light hover:underline">Create an organizer account</Link>
        <Link href="/organizer/recover" className="text-text-2 hover:text-text">Forgot password?</Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthFrame title="Organizer sign in" subtitle="Manage your events, QR codes and participants.">
      <Suspense><LoginForm /></Suspense>
    </AuthFrame>
  );
}
