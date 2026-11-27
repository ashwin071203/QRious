import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage, Placeholder } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Contact us" };

export default function ContactPage() {
  return (
    <LegalPage title="Contact us">
      <p>We&apos;re happy to help with your account, events, payments, refunds or anything else about QRious.</p>

      <h2>Support</h2>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-text">Email</dt>
        <dd><Placeholder>support email address</Placeholder></dd>
        <dt className="font-medium text-text">Phone</dt>
        <dd><Placeholder>support phone number, or remove this row</Placeholder></dd>
        <dt className="font-medium text-text">Hours</dt>
        <dd><Placeholder>support hours and expected reply time, for example Mon–Fri, 10:00–18:00 IST, replies within 2 working days</Placeholder></dd>
      </dl>

      <h2>Business details</h2>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-text">Legal name</dt>
        <dd><Placeholder>registered business or owner name, as on your Razorpay account</Placeholder></dd>
        <dt className="font-medium text-text">Address</dt>
        <dd><Placeholder>registered address</Placeholder></dd>
      </dl>

      <h2>Grievances</h2>
      <p><Placeholder>Grievance officer name and email, if you need one, or remove this section</Placeholder></p>

      <h2>Payments and refunds</h2>
      <p>
        For a payment question, include the account email or username and the date and amount of the payment. See also
        our <Link href="/refunds" className="text-accent-light underline">Refund &amp; Cancellation Policy</Link>.
      </p>

      <h2>Safety</h2>
      <p>To report someone, use Report on their profile or in the chat. That&apos;s the fastest way to reach our moderators.</p>
    </LegalPage>
  );
}
