"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-all duration-200 select-none " +
  "disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-grad-primary text-white shadow-[var(--shadow-glow)] hover:brightness-110",
  secondary: "bg-card-2 text-text border border-line-strong hover:border-accent/60 hover:bg-card-2/80",
  ghost: "text-text-2 hover:text-text hover:bg-white/5",
  danger: "bg-error/15 text-error border border-error/30 hover:bg-error/25",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-14 px-6 text-base",
};

type Common = { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode; className?: string; children?: ReactNode };

export function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }: Common & ComponentProps<"button">) {
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", icon, className, children, href, ...rest }: Common & ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
