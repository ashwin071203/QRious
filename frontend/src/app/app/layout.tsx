import type { Metadata } from "next";
import { RequireAttendee } from "@/components/AppShell";

export const metadata: Metadata = { title: "QRious", robots: { index: false, follow: false } };

export default function AttendeeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ambient min-h-dvh">
      <RequireAttendee>{children}</RequireAttendee>
    </div>
  );
}
