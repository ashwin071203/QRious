export const EVENT_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "rounded-full bg-bg-2 px-2 py-0.5 text-text-2" },
  published: { label: "Published", className: "rounded-full bg-warning/15 px-2 py-0.5 text-warning" },
  active: { label: "Networking live", className: "rounded-full bg-success/15 px-2 py-0.5 text-success" },
  networking_paused: { label: "Paused", className: "rounded-full bg-warning/15 px-2 py-0.5 text-warning" },
  ended: { label: "Ended", className: "rounded-full bg-bg-2 px-2 py-0.5 text-text-2" },
  archived: { label: "Archived", className: "rounded-full bg-bg-2 px-2 py-0.5 text-text-2" },
};
