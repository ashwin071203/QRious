"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AtSign, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Logo } from "@/components/ui/Misc";
import { RecoveryCodeCard } from "@/components/RecoveryCodeCard";
import { api, ApiError } from "@/lib/api";

/** Account recovery with username + recovery code (D-13). A username alone never recovers an account. */
export default function RecoverPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !code.trim()) return setError("Enter your username and recovery code.");
    setBusy(true);
    try {
      const r = await api<{ newRecoveryCode: string }>("/recovery", { method: "POST", body: { username: username.trim(), recoveryCode: code.trim() } });
      qc.clear();
      setNewCode(r.newRecoveryCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ambient grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 inline-block"><Logo /></Link>
        {newCode ? (
          <RecoveryCodeCard code={newCode} title="Welcome back! Here's your new recovery code"
            doneLabel="Continue" onDone={() => router.replace("/app")} />
        ) : (
          <form onSubmit={submit} className="card space-y-5 p-6" noValidate>
            <div>
              <span className="grid size-12 place-items-center rounded-2xl bg-card-2 text-accent"><KeyRound className="size-6" /></span>
              <h1 className="mt-4 font-display text-2xl font-bold">Recover your profile</h1>
              <p className="mt-1.5 text-sm text-text-2">
                Changed phones or cleared your browser? Enter your username and the recovery code you saved when you created your profile.
              </p>
            </div>
            <Field label="Username" htmlFor="u">
              <div className="relative">
                <AtSign className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" />
                <Input id="u" className="pl-9" value={username} autoCapitalize="none" spellCheck={false} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
              </div>
            </Field>
            <Field label="Recovery code" htmlFor="c" hint="Looks like QRS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX">
              <Input id="c" value={code} autoCapitalize="characters" spellCheck={false} autoComplete="one-time-code" className="font-mono tracking-wider"
                onChange={(e) => setCode(e.target.value)} placeholder="QRS-…" />
            </Field>
            {error && <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-sm text-error">{error}</p>}
            <Button type="submit" size="lg" className="w-full" loading={busy}>Recover my profile</Button>
            <p className="text-xs text-text-2">
              For your security, other devices will be signed out and you&apos;ll get a new recovery code. After 5 wrong attempts, recovery is paused for an hour.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
