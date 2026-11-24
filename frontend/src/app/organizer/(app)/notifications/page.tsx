"use client";

import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Overlay";
import { NotificationCenter } from "@/components/notifications/Notifications";

/** Organizer notification centre: registrations, events & QR, engagement, billing & allowance, team, security, announcements. */
export default function OrganizerNotificationsPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" subtitle="Activity across your organization and events." actions={<ButtonLink href="/organizer/account#notifications" variant="secondary" size="sm">Settings</ButtonLink>} />
      <NotificationCenter role="organizer" />
    </div>
  );
}
