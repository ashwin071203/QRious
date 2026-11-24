"use client";

import { AttendeePage } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/Overlay";
import { ButtonLink } from "@/components/ui/Button";
import { NotificationCenter } from "@/components/notifications/Notifications";

/** Attendee notification centre: messages, groups, connections, events, Smart Match, Premium, account, security, announcements. */
export default function NotificationsPage() {
  return (
    <AttendeePage title="Notifications" className="max-w-3xl">
      <PageHeader title="Notifications" actions={<ButtonLink href="/app/settings#notifications" variant="secondary" size="sm">Settings</ButtonLink>} />
      <NotificationCenter role="attendee" />
    </AttendeePage>
  );
}
