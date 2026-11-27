import Link from "next/link";
import { Logo } from "@/components/ui/Misc";

/** Shared layout for the public legal pages (Privacy, Terms, Refunds, Contact). */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="ambient min-h-dvh px-5 py-10">
      <article className="mx-auto max-w-2xl space-y-5 text-[15px] leading-relaxed text-text-2 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text">
        <Link href="/"><Logo /></Link>
        <h1 className="font-display text-3xl font-bold text-text">{title}</h1>
        {children}
      </article>
    </main>
  );
}

/**
 * Text the owner still has to write. Rendered highlighted so it can't be mistaken for final wording.
 * Search the code for "<Placeholder" to find every one.
 */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-warning/15 px-1 text-warning">[{children}]</mark>;
}
