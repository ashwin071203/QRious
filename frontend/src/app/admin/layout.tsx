import { Suspense } from "react";
import type { Metadata } from "next";
import { OrganizerShell } from "@/components/OrganizerShell";

export const metadata: Metadata = { title: "Platform admin", robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
      <OrganizerShell>{children}</OrganizerShell>
    </Suspense>
  );
}
