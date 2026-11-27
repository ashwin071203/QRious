import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage, Placeholder } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Refund & Cancellation Policy" };

export default function RefundsPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy">
      <p>Last updated: <Placeholder>date</Placeholder></p>
      <p>
        Networking on QRious is free. This policy covers the optional paid plans: Premium for attendees (₹99 per month or
        ₹799 per year), Pro (₹499 per month) and Business (₹1,499 per month) for organizers, and the one-time Single Event
        (₹199). Payments are processed securely by Razorpay.
      </p>

      <h2>Cancelling a subscription</h2>
      <p>
        You can cancel Premium, Pro or Business at any time: attendees from Premium in the app, organizers from Billing in
        the organizer dashboard. Cancelling stops future renewals. You keep your paid features until the end of the period
        you&apos;ve already paid for, and you won&apos;t be charged again. Your profile, connections, events and data are never
        deleted because a plan ends.
      </p>

      <h2>Refunds for subscriptions</h2>
      <p><Placeholder>Say whether subscription payments are refundable, and if so, within how many days of the charge and under which conditions (for example: a first-time charge, or a renewal you didn&apos;t intend).</Placeholder></p>
      <p>When a subscription payment is refunded in full, the paid features it unlocked end at that point.</p>

      <h2>Single Event purchases</h2>
      <p><Placeholder>Say whether a Single Event purchase can be refunded, for example only while it hasn&apos;t been used to create an event, and within how many days.</Placeholder></p>
      <p>
        If an unused Single Event is refunded, it is removed from your organization. If it has already been used, the event
        you created with it stays: we never delete an event because of a refund.
      </p>

      <h2>Failed or duplicate payments</h2>
      <p>
        If a payment fails, you aren&apos;t charged. If money was debited but the payment failed, or you were charged twice
        for the same thing, <Placeholder>say what you will do, for example a full refund of the extra charge</Placeholder>.
      </p>

      <h2>How to request a refund</h2>
      <p>
        <Placeholder>Say how to ask: for example email the support address on the Contact page with the account email or username and the date and amount of the payment.</Placeholder>{" "}
        See <Link href="/contact" className="text-accent-light underline">Contact us</Link>.
      </p>

      <h2>How long refunds take</h2>
      <p>
        Approved refunds are returned to the original payment method through Razorpay. <Placeholder>State the timeline, for example: we start the refund within N working days, and banks usually take 5–7 working days to credit it.</Placeholder>
      </p>

      <h2>Changes to this policy</h2>
      <p><Placeholder>Say how you&apos;ll tell people when this policy changes.</Placeholder></p>
    </LegalPage>
  );
}
