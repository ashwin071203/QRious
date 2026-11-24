"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, Download, KeyRound, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Form";

/**
 * Shows a recovery code exactly once (D-13). The server stores only a hash, so this is the only chance to save it.
 */
export function RecoveryCodeCard({ code, title, onDone, doneLabel }: { code: string; title: string; onDone: () => void; doneLabel: string }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable; the code is visible and selectable */
    }
  }

  function download() {
    const text = `QRious recovery code\n\n${code}\n\nUse this with your username at ${location.origin}/recover if you change phones or clear your browser.\nKeep it private. Anyone with this code and your username can sign in as you.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "qrious-recovery-code.txt" });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card p-6">
      <motion.div initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
        className="grid size-14 place-items-center rounded-2xl bg-grad-primary text-white shadow-[var(--shadow-glow)]">
        <KeyRound className="size-7" />
      </motion.div>
      <h1 className="mt-5 font-display text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-2">
        QRious doesn&apos;t use passwords. If you change phones or clear your browser, this code and your username are the{" "}
        <span className="font-medium text-text">only way back into your profile</span>.
      </p>

      <div className="mt-5 rounded-2xl border border-primary/40 bg-bg-2 p-4 text-center">
        <code className="block font-mono text-lg font-semibold tracking-wider break-all text-accent-light select-all sm:text-xl" aria-label="Recovery code">{code}</code>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={copy} icon={copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}>{copied ? "Copied" : "Copy"}</Button>
        <Button variant="secondary" onClick={download} icon={<Download className="size-4" />}>Download</Button>
      </div>

      <p className="mt-4 flex gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" /> We can&apos;t show this code again. Keep it somewhere private, like your password manager or notes app.
      </p>

      <div className="mt-5">
        <Checkbox checked={saved} onChange={setSaved}>I&apos;ve saved my recovery code</Checkbox>
      </div>
      <Button size="lg" className="mt-5 w-full" disabled={!saved} onClick={onDone}>{doneLabel}</Button>
    </div>
  );
}
