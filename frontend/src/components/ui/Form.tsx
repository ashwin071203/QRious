"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/format";

export function Field({
  label,
  hint,
  error,
  required,
  optional,
  counter,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optional?: boolean;
  counter?: { value: number; max: number };
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-text">
          {label}
          {required && <span className="ml-1 text-pink" aria-hidden>*</span>}
          {optional && <span className="ml-1.5 text-xs font-normal text-text-2">optional</span>}
        </label>
        {counter && (
          <span className={cn("text-xs tabular-nums", counter.value > counter.max ? "text-error" : "text-text-2")}>
            {counter.value}/{counter.max}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-error">{error}</p>
      ) : hint ? (
        <p className="text-xs text-text-2">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl bg-bg-2 border border-line-strong px-3.5 text-[15px] text-text placeholder:text-text-2/60 " +
  "transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-error";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputBase, "h-12", className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputBase, "min-h-24 py-3 resize-y", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(inputBase, "h-10 pr-8 text-sm", className)} {...props}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  hideLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Visually hidden label (still announced), for compact grids. */
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={hideLabel ? "flex" : "flex items-start justify-between gap-4"}>
      <div className={hideLabel ? "sr-only" : "min-w-0"}>
        <label htmlFor={id} className="block text-[15px] font-medium text-text">{label}</label>
        {description && <div className="mt-1 text-sm text-text-2">{description}</div>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-50",
          checked ? "bg-primary border-primary" : "bg-bg-2 border-line-strong",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-[22px] rounded-full bg-white shadow transition-transform duration-200",
            checked && "translate-x-5",
          )}
        />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-md accent-[var(--primary)]"
      />
      <label htmlFor={id} className="cursor-pointer text-sm text-text-2">{children}</label>
    </div>
  );
}
