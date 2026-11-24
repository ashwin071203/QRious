import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Handshake, KeyRound, MessageCircle, ScanLine, ShieldCheck, Sparkles, UserPlus, Users, Zap } from "lucide-react";
import { Logo } from "@/components/ui/Misc";
import { SignInNotice } from "./SignInNotice";

const categories = [
  ["concert", "Concerts"], ["music-festival", "Music festivals"], ["wedding", "Weddings"], ["college-festival", "College fests"],
  ["conference", "Conferences"], ["business-meetup", "Business meetups"], ["art-exhibition", "Art exhibitions"], ["cultural-festival", "Cultural festivals"],
] as const;

/**
 * Marketing home. Uses real photography; the Three.js / React Three Fiber hero (D-07) is scheduled for the
 * organizer release and will be lazy-loaded so this page stays fast.
 */
export default function Home() {
  return (
    <main className="ambient min-h-dvh overflow-x-clip">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/recover" className="rounded-xl px-3 py-2 text-text-2 hover:text-text">Recover profile</Link>
          <Link href="/app" className="rounded-xl border border-line-strong px-3 py-2 font-medium hover:border-accent/50">Open app</Link>
        </nav>
      </header>

      <Suspense><SignInNotice /></Suspense>

      <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pt-8 pb-16 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
        <div>
          <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-accent-light">
            <Sparkles className="size-3.5" /> No app install · No passwords
          </span>
          <h1 className="mt-5 font-display text-5xl leading-[1.02] font-bold tracking-tight text-balance sm:text-6xl">
            One event.<br /><span className="text-grad">Many connections.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-text-2">
            Scan the event QR code, see who&apos;s around you, and meet the people who share your interests — at concerts, weddings,
            college fests, conferences and everything in between.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#how" className="inline-flex h-13 items-center gap-2 rounded-2xl bg-grad-primary px-6 font-semibold shadow-[var(--shadow-glow)] hover:brightness-110">
              How it works <ArrowRight className="size-4" />
            </a>
            <Link href="/recover" className="inline-flex h-13 items-center gap-2 rounded-2xl border border-line-strong px-6 font-semibold hover:border-accent/50">
              <KeyRound className="size-4" /> I have a profile
            </Link>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-grad-primary opacity-25 blur-3xl" />
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-line-strong sm:aspect-[4/3] lg:aspect-[4/5]">
            <Image src="/images/site/hero-crowd.webp" alt="A crowd with raised hands at a live concert" fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-transparent to-transparent" />
            <div className="glass absolute right-4 bottom-4 left-4 rounded-2xl p-4">
              <p className="text-xs text-text-2">Live at the event</p>
              <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                {[["Open to talk", "64"], ["Collaborators", "21"], ["New today", "130+"]].map(([k, v]) => (
                  <div key={k}><p className="font-display text-2xl font-bold">{v}</p><p className="text-[11px] text-text-2">{k}</p></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-16">
        <h2 className="font-display text-3xl font-bold">How QRious works</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            { icon: <ScanLine />, title: "Scan the event QR", body: "Use your phone camera or Google Lens. The event page opens right in your browser." },
            { icon: <UserPlus />, title: "Browse or create a profile", body: "Peek at who's here, or create your profile in under a minute — just a name, username, interests and skills." },
            { icon: <Handshake />, title: "Connect & chat", body: "See who's open to talk, get smart matches, send a request and continue the conversation." },
          ].map((s, i) => (
            <div key={s.title} className="card p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-grad-primary text-white [&>svg]:size-5">{s.icon}</span>
                <span className="font-display text-sm text-text-2">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 font-display text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-text-2">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold">Made for every kind of event</h2>
        <p className="mt-2 text-text-2">One reusable profile. Suggestions that adapt to the event you&apos;re at.</p>
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {categories.map(([slug, label]) => (
            <div key={slug} className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-line">
              <Image src={`/images/categories/${slug}.webp`} alt="" fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover transition duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-bg/20 to-transparent" />
              <span className="absolute bottom-3 left-3 font-display font-semibold">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-12 md:grid-cols-3">
        {[
          { icon: <ShieldCheck />, title: "You control your visibility", body: "Choose whether visitors without a profile can see you. Contact details and links stay private unless you share them." },
          { icon: <Zap />, title: "Live Event Pulse", body: "See how many people are open to conversations and what everyone's into — without exposing anyone individually." },
          { icon: <MessageCircle />, title: "Private messaging", body: "Only accepted connections can message each other. Organizers never read your conversations." },
        ].map((f) => (
          <div key={f.title} className="card p-6">
            <span className="grid size-11 place-items-center rounded-2xl bg-card-2 text-accent [&>svg]:size-5">{f.icon}</span>
            <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-text-2">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="relative overflow-hidden rounded-3xl border border-line-strong">
          <Image src="/images/site/networking.webp" alt="" fill sizes="100vw" className="object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/30" />
          <div className="relative max-w-xl p-8 sm:p-12">
            <Users className="size-8 text-accent" />
            <h2 className="mt-4 font-display text-3xl font-bold">Hosting an event?</h2>
            <p className="mt-3 text-text-2">Create your event, print one QR code, and let your attendees find each other. Organizer tools are arriving soon.</p>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-line px-5 py-8 text-sm text-text-2 sm:flex-row">
        <Logo className="text-base" />
        <p>© {2026} QRious · Photos from Unsplash</p>
      </footer>
    </main>
  );
}
