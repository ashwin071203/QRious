import { Suspense } from "react";
import type { Metadata } from "next";
import { Loader2 } from "lucide-react";
import { RequireAttendee } from "@/components/AppShell";

export const metadata: Metadata = { title: "QRious", robots: { index: false, follow: false } };

const Loading = () => <div className="grid min-h-dvh place-items-center text-text-2"><Loader2 className="size-6 animate-spin" aria-label="Loading" /></div>;

export default function AttendeeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ambient min-h-dvh">
      <Suspense fallback={<Loading />}>
        <RequireAttendee>{children}</RequireAttendee>
      </Suspense>
    </div>
  );
}
