"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Shield } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/Overlay";
import { RecoveryCodeCard } from "@/components/RecoveryCodeCard";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";

export default function AccountPage() {
  const { me } = useOrg();
  const toast = useToast();
  const qc = useQueryClient();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [pwErr, setPwErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [token, setToken] = useState("");

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("pw");
    setPwErr({});
    try {
      await api("/organizer/auth/change-password", { method: "POST", body: pw });
      setPw({ currentPassword: "", newPassword: "" });
      toast("success", "Password changed. Other sessions were signed out.");
    } catch (err) {
      if (err instanceof ApiError && err.errors) setPwErr(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]!])));
      else toast("error", err instanceof ApiError ? err.message : "Couldn't change the password.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Account" subtitle={`${me.user?.displayName} · ${me.user?.email}`} />
      <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
        <form onSubmit={changePassword} className="card space-y-4 p-5">
          <h2 className="flex items-center gap-2 font-display font-semibold"><Lock className="size-4 text-accent" />Change password</h2>
          <Field label="Current password" htmlFor="cp" error={pwErr.currentPassword}><Input id="cp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password" htmlFor="np" error={pwErr.newPassword} hint="At least 12 characters."><Input id="np" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <Button type="submit" loading={busy === "pw"}>Update password</Button>
        </form>
        {code ? <RecoveryCodeCard code={code} title="New recovery code" doneLabel="Done" onDone={() => setCode(null)} /> : (
          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-display font-semibold"><KeyRound className="size-4 text-accent" />Recovery code</h2>
            <p className="text-sm text-text-2">Used with your email to reset your password. Creating a new one invalidates the old code.</p>
            <Button variant="secondary" loading={busy === "rc"} onClick={async () => { setBusy("rc"); try { setCode((await api<{ recoveryCode: string }>("/organizer/auth/recovery-code", { method: "POST" })).recoveryCode); } catch (e) { toast("error", e instanceof ApiError ? e.message : "Failed."); } finally { setBusy(null); } }}>Create new recovery code</Button>
          </section>
        )}
        {!me.user?.isAdmin && (
          <section className="card space-y-3 p-5 lg:col-span-2">
            <h2 className="flex items-center gap-2 font-display font-semibold"><Shield className="size-4 text-accent" />Platform administrator setup</h2>
            <p className="text-sm text-text-2">Only for the QRious operator: enter the one-time bootstrap token to become the first platform administrator.</p>
            <div className="flex gap-2">
              <Input type="password" aria-label="Bootstrap token" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bootstrap token" className="max-w-sm" />
              <Button variant="secondary" loading={busy === "admin"} onClick={async () => {
                setBusy("admin");
                try { await api("/organizer/auth/bootstrap-admin", { method: "POST", body: { token } }); toast("success", "You're now a platform administrator."); await qc.invalidateQueries(); }
                catch (e) { toast("error", e instanceof ApiError ? e.message : "Failed."); } finally { setBusy(null); }
              }}>Activate</Button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
