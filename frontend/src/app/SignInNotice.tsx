"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ScanLine } from "lucide-react";

export function SignInNotice() {
  const params = useSearchParams();
  if (params.get("signin") !== "required") return null;
  return (
    <div className="mx-auto max-w-6xl px-5">
      <div className="glass flex flex-col gap-2 rounded-2xl px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2"><ScanLine className="size-4 text-accent" /> Scan an event QR code to create your profile, or recover an existing one.</span>
        <Link href="/recover" className="font-medium text-accent-light hover:underline">Recover my profile →</Link>
      </div>
    </div>
  );
}
