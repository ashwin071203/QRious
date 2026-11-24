"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Plus, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Tag } from "@/lib/types";
import { Chip } from "@/components/ui/Misc";

export type PickedTag = { id?: string; name: string; pending?: boolean };

/**
 * Searchable interest/skill selection with interactive chips (PRD §3.2):
 * event/category suggestions first, multi-select, custom entries, duplicate prevention via normalization.
 */
export function TagPicker({
  kind,
  value,
  onChange,
  eventId,
  max = 20,
  placeholder,
  invalid,
}: {
  kind: "interests" | "skills";
  value: PickedTag[];
  onChange: (tags: PickedTag[]) => void;
  eventId?: string;
  max?: number;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: query ? "12" : "18" });
        if (query.trim()) params.set("q", query.trim());
        if (eventId) params.set("eventId", eventId);
        setResults(await api<Tag[]>(`/taxonomy/${kind}?${params}`, { signal: ctrl.signal }));
      } catch {
        /* keep previous results on transient errors */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, kind, eventId]);

  const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const selectedKeys = useMemo(() => new Set(value.map((t) => t.id ?? `name:${norm(t.name)}`)), [value]);
  const isSelected = (t: Tag) => selectedKeys.has(t.id) || value.some((v) => norm(v.name) === norm(t.name));

  const toggle = (t: Tag) => {
    if (isSelected(t)) onChange(value.filter((v) => v.id !== t.id && norm(v.name) !== norm(t.name)));
    else if (value.length < max) onChange([...value, { id: t.id, name: t.name }]);
  };

  const trimmed = query.trim().replace(/\s+/g, " ");
  const exactMatch = results.some((r) => norm(r.name) === norm(trimmed)) || value.some((v) => norm(v.name) === norm(trimmed));
  const canAddCustom = trimmed.length >= 2 && trimmed.length <= 50 && !exactMatch && value.length < max;

  const addCustom = () => {
    if (!canAddCustom) return;
    onChange([...value, { name: trimmed, pending: true }]);
    setQuery("");
  };

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label={`Selected ${kind}`}>
          <AnimatePresence initial={false}>
            {value.map((t) => (
              <motion.span
                key={t.id ?? t.name}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                <Chip selected tone={t.pending ? "pending" : "default"} onClick={() => onChange(value.filter((v) => v !== t))}
                  title={t.pending ? "New — added just for you until reviewed" : "Remove"}>
                  {t.name}
                  <X className="size-3.5 opacity-70" aria-label="remove" />
                </Chip>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = results.find((r) => !isSelected(r));
              if (first && norm(first.name).startsWith(norm(trimmed)) && trimmed) toggle(first);
              else addCustom();
              setQuery("");
            }
          }}
          placeholder={placeholder ?? `Search ${kind}`}
          aria-invalid={invalid}
          aria-label={`Search ${kind}`}
          maxLength={50}
          className="h-12 w-full rounded-xl border border-line-strong bg-bg-2 pr-3 pl-10 text-[15px] placeholder:text-text-2/60 focus:border-accent focus:ring-2 focus:ring-primary/30 focus:outline-none aria-[invalid=true]:border-error"
        />
      </div>

      <div className="flex min-h-10 flex-wrap gap-2" aria-busy={loading}>
        {results
          .filter((r) => !isSelected(r))
          .slice(0, query ? 12 : 16)
          .map((r) => (
            <Chip key={r.id} onClick={() => toggle(r)}>
              <Plus className="size-3.5 opacity-60" aria-hidden />
              {r.name}
              {!query && r.suggested && <span className="sr-only">(suggested for this event)</span>}
            </Chip>
          ))}
        {canAddCustom && (
          <Chip onClick={addCustom} tone="pending" className="border-accent/50 text-accent-light">
            <Plus className="size-3.5" aria-hidden />
            Add &ldquo;{trimmed}&rdquo;
          </Chip>
        )}
        {!loading && query && results.length === 0 && !canAddCustom && (
          <span className="py-1.5 text-sm text-text-2">No matches.</span>
        )}
      </div>
      {value.length >= max && (
        <p className="flex items-center gap-1.5 text-xs text-text-2">
          <Check className="size-3.5" /> Maximum of {max} reached.
        </p>
      )}
    </div>
  );
}
