import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/ui/Misc";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <main className="ambient min-h-dvh px-5 py-10">
      <article className="mx-auto max-w-2xl space-y-5 text-[15px] leading-relaxed text-text-2 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text">
        <Link href="/"><Logo /></Link>
        <h1 className="font-display text-3xl font-bold text-text">Privacy</h1>
        <p>QRious helps people at the same event find and connect with each other. We collect as little as possible and you stay in control of what others see.</p>
        <h2>What we collect</h2>
        <p>Attendees: the profile you create (display name, username, interests, skills and any optional details or photo you add), the events you join, your event status, connections, messages and reports. We don&apos;t ask attendees for an email, phone number or password. Organizers: name, email, password (stored only as a secure hash) and the event and organization details they enter.</p>
        <h2>Who can see your profile</h2>
        <p>If you leave &ldquo;Visible to visitors without a profile&rdquo; on, people browsing an event you joined can see your display name, username, photo, bio, profession, interests and skills. People with a profile at the same event can also see details you share with members. Social links, company and location are only shown to the audiences you choose. Organizers see a member-level card and never your private messages.</p>
        <h2>Messages</h2>
        <p>Only you and your accepted connection can read your conversation. Platform moderators see a message only if a participant attaches it to a report.</p>
        <h2>Event Pulse</h2>
        <p>Event Pulse shows totals only. Groups smaller than five people are never shown.</p>
        <h2>Sign-in and recovery</h2>
        <p>Your device keeps a secure, HttpOnly session cookie. Your recovery code is shown once and stored only as a keyed hash. Sessions expire after 30 days without use and after 180 days in total.</p>
        <h2>Your choices</h2>
        <p>You can edit your profile, hide from anonymous visitors, pause discovery per event, block and report people, sign out other devices and delete your account (hidden immediately, permanently removed after 14 days).</p>
        <h2>Photos</h2>
        <p>Uploaded photos are re-encoded and location data is removed.</p>
      </article>
    </main>
  );
}
