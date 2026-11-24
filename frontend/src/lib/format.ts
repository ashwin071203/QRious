/** Event times are stored in UTC and shown in the event's local time zone (PRD §12.5). */

export function formatEventDate(startsAt: string, endsAt: string, timeZone: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone });
  const sameDay = day.format(start) === day.format(end);
  if (sameDay) return day.format(start);
  const short = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone });
  return `${short.format(start)} – ${day.format(end)}`;
}

export function formatEventTime(startsAt: string, endsAt: string, timeZone: string): string {
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone });
  const tz = new Intl.DateTimeFormat("en-IN", { timeZoneName: "short", timeZone }).formatToParts(new Date(startsAt))
    .find((p) => p.type === "timeZoneName")?.value;
  return `${time.format(new Date(startsAt))} – ${time.format(new Date(endsAt))}${tz ? ` ${tz}` : ""}`;
}

export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

export function relativeTime(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export const networkingStatusLabel: Record<string, { label: string; tone: "live" | "soon" | "paused" | "ended" }> = {
  open: { label: "Networking live", tone: "live" },
  not_open: { label: "Networking opens soon", tone: "soon" },
  paused: { label: "Networking paused", tone: "paused" },
  ended: { label: "Event ended", tone: "ended" },
  archived: { label: "Event archived", tone: "ended" },
};

export const availabilityLabel: Record<string, string> = {
  available_now: "Available now",
  open_to_conversations: "Open to conversations",
  meet_new_people: "Looking to meet new people",
  looking_for_collaborators: "Looking for collaborators",
  quick_conversations: "Up for quick conversations",
  temporarily_unavailable: "Temporarily unavailable",
  discovery_paused: "Discovery paused",
};

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
