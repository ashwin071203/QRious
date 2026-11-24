import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/ui/Misc";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <main className="ambient min-h-dvh px-5 py-10">
      <article className="mx-auto max-w-2xl space-y-5 text-[15px] leading-relaxed text-text-2 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text">
        <Link href="/"><Logo /></Link>
        <h1 className="font-display text-3xl font-bold text-text">Terms of use</h1>
        <p>By using QRious you agree to use it respectfully and lawfully.</p>
        <h2>Be respectful</h2>
        <p>No harassment, spam, hate, impersonation, sexual content or sharing other people&apos;s private information. Use block and report if someone makes you uncomfortable. We may suspend accounts that break these rules.</p>
        <h2>Your content</h2>
        <p>You own what you post. You give QRious permission to display it to the audiences you choose, so the service can work.</p>
        <h2>Organizers</h2>
        <p>Organizers are responsible for the events they publish and must not use QRious to collect attendee data beyond what attendees share. Exports only include attendees who consented.</p>
        <h2>No guarantees</h2>
        <p>Joining an event on QRious doesn&apos;t prove someone attended. Meet people in public places and use your judgement.</p>
        <h2>Paid plans</h2>
        <p>The essential networking features are free. Paid plans, when available, add optional features and can be cancelled at any time; access continues until the end of the paid period.</p>
      </article>
    </main>
  );
}
