"use client";

import type { ReactNode } from "react";
import { cn, initials } from "@/lib/format";

export function Avatar({ name, src, size = 48, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-grad-primary font-display font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.max(12, size * 0.36) }}
      aria-hidden={!src}
    >
      {src ? (
        // Attendee-uploaded media from object storage (not a Next static asset).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} width={size} height={size} className="size-full object-cover" />
      ) : (
        initials(name) || "?"
      )}
    </span>
  );
}

export function Chip({
  children,
  selected,
  onClick,
  tone = "default",
  className,
  title,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  tone?: "default" | "pending";
  className?: string;
  title?: string;
}) {
  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all duration-150",
    selected
      ? "border-primary bg-primary/20 text-text shadow-[0_0_0_1px_var(--primary)]"
      : "border-line-strong bg-bg-2 text-text-2",
    onClick && "cursor-pointer hover:border-accent/60 hover:text-text active:scale-95",
    tone === "pending" && "border-dashed",
    className,
  );
  return onClick ? (
    <button type="button" className={classes} onClick={onClick} aria-pressed={selected} title={title}>
      {children}
    </button>
  ) : (
    <span className={classes} title={title}>{children}</span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-white/[0.06]", className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card p-5", className)}>{children}</div>;
}

export function StatusDot({ tone }: { tone: "live" | "soon" | "paused" | "ended" }) {
  const color = { live: "bg-success", soon: "bg-warning", paused: "bg-warning", ended: "bg-text-2" }[tone];
  return (
    <span className="relative inline-flex size-2.5">
      {tone === "live" && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", color)} />}
      <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid size-16 place-items-center rounded-2xl border border-line bg-card-2 text-accent">{icon}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {children && <div className="mt-2 max-w-sm text-sm text-text-2">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <defs>
          <linearGradient id="qrg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8B5CF6" />
            <stop offset="1" stopColor="#E879F9" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#qrg)" />
        <rect x="8" y="8" width="7" height="7" rx="2" fill="white" />
        <rect x="17" y="8" width="7" height="7" rx="2" fill="white" fillOpacity=".55" />
        <rect x="8" y="17" width="7" height="7" rx="2" fill="white" fillOpacity=".55" />
        <circle cx="20.5" cy="20.5" r="3.6" fill="white" />
      </svg>
      <span>
        QR<span className="text-grad">ious</span>
      </span>
    </span>
  );
}
