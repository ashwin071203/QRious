"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Visibility } from "@/lib/types";
import { Input, Select } from "@/components/ui/Form";

export type SocialLinkDraft = { platform: string; url: string; visibility: Visibility };

export const PLATFORMS: { value: string; label: string; placeholder: string }[] = [
  { value: "instagram", label: "Instagram", placeholder: "instagram.com/yourname" },
  { value: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/yourname" },
  { value: "x", label: "X", placeholder: "x.com/yourname" },
  { value: "github", label: "GitHub", placeholder: "github.com/yourname" },
  { value: "behance", label: "Behance", placeholder: "behance.net/yourname" },
  { value: "dribbble", label: "Dribbble", placeholder: "dribbble.com/yourname" },
  { value: "youtube", label: "YouTube", placeholder: "youtube.com/@yourname" },
  { value: "spotify", label: "Spotify", placeholder: "open.spotify.com/artist/…" },
  { value: "soundcloud", label: "SoundCloud", placeholder: "soundcloud.com/yourname" },
  { value: "portfolio", label: "Portfolio", placeholder: "yourportfolio.com" },
  { value: "website", label: "Website", placeholder: "yourwebsite.com" },
  { value: "other", label: "Other", placeholder: "https://…" },
];

const VISIBILITY: { value: Visibility; label: string }[] = [
  { value: "members", label: "Event members" },
  { value: "connections", label: "Connections only" },
  { value: "public", label: "Public" },
];

export function SocialLinksEditor({ value, onChange }: { value: SocialLinkDraft[]; onChange: (links: SocialLinkDraft[]) => void }) {
  const update = (i: number, patch: Partial<SocialLinkDraft>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      {value.map((link, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-line bg-bg-2/60 p-3">
          <div className="flex gap-2">
            <Select aria-label="Platform" value={link.platform} onChange={(e) => update(i, { platform: e.target.value })} className="w-36 shrink-0">
              {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            <Select aria-label="Who can see this link" value={link.visibility} onChange={(e) => update(i, { visibility: e.target.value as Visibility })} className="min-w-0 flex-1">
              {VISIBILITY.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </Select>
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove link"
              className="grid size-10 shrink-0 place-items-center rounded-xl text-text-2 hover:bg-white/5 hover:text-error">
              <Trash2 className="size-4" />
            </button>
          </div>
          <Input aria-label="Link" inputMode="url" autoCapitalize="none" value={link.url} maxLength={500}
            placeholder={PLATFORMS.find((p) => p.value === link.platform)?.placeholder} onChange={(e) => update(i, { url: e.target.value })} />
        </div>
      ))}
      {value.length < 10 && (
        <button type="button" onClick={() => onChange([...value, { platform: "instagram", url: "", visibility: "members" }])}
          className="inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-medium text-accent-light hover:bg-white/5">
          <Plus className="size-4" /> Add a link
        </button>
      )}
    </div>
  );
}
