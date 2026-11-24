"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldAlert } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { AdminMfaGate } from "@/components/AdminMfaGate";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { ConfirmDialog, PageHeader, Tabs, useDebounced } from "@/components/ui/Overlay";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";

type Tab = "overview" | "reports" | "users" | "orgs" | "events" | "taxonomy" | "categories" | "billing" | "audit";
const inr = (m: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format((m ?? 0) / 100);

function useRun() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return { busy, run: async (key: string, fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(key);
    try { await fn(); toast("success", ok); after?.(); } catch (e) { toast("error", e instanceof ApiError ? e.message : "Failed."); } finally { setBusy(null); }
  } };
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <div className="relative mb-4 max-w-md"><Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" /><Input className="pl-10" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <div className="card"><EmptyState icon={<Search className="size-7" />} title="Nothing here" /></div>;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-line text-left text-text-2"><tr>{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-4 py-2.5 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ["admin-system"], queryFn: () => api<{ counts: Record<string, number>; health: Record<string, string | number> }>("/admin/system"), refetchInterval: 30_000 });
  if (!q.data) return <Skeleton className="h-48" />;
  const labels: Record<string, string> = { attendees: "Attendees", attendees_24h: "New attendees (24h)", organizations: "Organizations", events: "Events", live_events: "Live events",
    messages_24h: "Messages (24h)", connections_24h: "Connections (24h)", open_reports: "Open reports", pending_tags: "Pending tags" };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Object.entries(q.data.counts).map(([k, v]) => <div key={k} className="card p-4"><p className="text-xs text-text-2">{labels[k] ?? k}</p><p className="mt-1 font-display text-2xl font-bold">{v}</p></div>)}
      </div>
      <div className="card p-5 text-sm"><h2 className="mb-2 font-display font-semibold">System health</h2>
        {Object.entries(q.data.health).map(([k, v]) => <p key={k} className="flex justify-between border-b border-line py-1.5 last:border-0"><span className="text-text-2">{k}</span><span>{String(v)}</span></p>)}</div>
    </div>
  );
}

function Reports() {
  const [status, setStatus] = useState("open");
  const { busy, run } = useRun();
  const q = useQuery({ queryKey: ["admin-reports", status], queryFn: () => api<Record<string, string | boolean | null>[]>(`/admin/reports?status=${status}`) });
  return (
    <>
      <div className="mb-4"><Tabs value={status} onChange={setStatus} items={[{ value: "open", label: "Open" }, { value: "actioned", label: "Actioned" }, { value: "dismissed", label: "Dismissed" }, { value: "all", label: "All" }]} /></div>
      {!q.data ? <Skeleton className="h-40" /> : !q.data.length ? <div className="card"><EmptyState icon={<ShieldAlert className="size-7" />} title="No reports" /></div> : (
        <ul className="space-y-3">
          {q.data.map((r) => (
            <li key={r.id as string} className="card p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">{r.reported_name as string} <span className="text-text-2">@{r.reported_username as string}</span>{r.reported_status === "suspended" && <span className="ml-2 text-xs text-error">suspended</span>}</p>
                  <p className="text-sm text-text-2">{(r.reason as string).replace(/_/g, " ")} · by {(r.reporter_name as string) ?? "organizer"} · {r.event_name ? `${r.event_name} · ` : ""}{relativeTime(r.created_at as string)}{r.escalated ? " · escalated by organizer" : ""}</p>
                </div>
                <span className="text-xs text-text-2">{r.status as string}</span>
              </div>
              {r.details && <p className="mt-2 text-sm">{r.details as string}</p>}
              {r.message_excerpt && <p className="mt-2 rounded-xl bg-bg-2 px-3 py-2 text-sm text-text-2">Attached message: &ldquo;{r.message_excerpt as string}&rdquo;</p>}
              {["open", "in_review"].includes(r.status as string) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="danger" loading={busy === `${r.id}s`} onClick={() => run(`${r.id}s`, () => api(`/admin/reports/${r.id}/action`, { method: "POST", body: { suspendUser: true, deleteMessage: !!r.message_excerpt, note: "Suspended after review" } }), "User suspended", () => q.refetch())}>Suspend user</Button>
                  {r.message_excerpt && <Button size="sm" variant="secondary" loading={busy === `${r.id}m`} onClick={() => run(`${r.id}m`, () => api(`/admin/reports/${r.id}/action`, { method: "POST", body: { deleteMessage: true, note: "Message removed" } }), "Message removed", () => q.refetch())}>Remove message only</Button>}
                  <Button size="sm" variant="ghost" loading={busy === `${r.id}d`} onClick={() => run(`${r.id}d`, () => api(`/admin/reports/${r.id}/dismiss`, { method: "POST", body: { note: "No violation" } }), "Dismissed", () => q.refetch())}>Dismiss</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Users() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { busy, run } = useRun();
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const data = useQuery({ queryKey: ["admin-users", dq], queryFn: () => api<Record<string, string | number>[]>(`/admin/attendees?q=${encodeURIComponent(dq)}`) });
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Search name or @username" />
      {!data.data ? <Skeleton className="h-40" /> : <Table head={["Attendee", "Status", "Events", "Reports", "Joined", ""]} rows={data.data.map((u) => [
        <span key="n">{u.display_name} <span className="text-text-2">@{u.username}</span></span>, u.status, u.events, u.reports, relativeTime(u.created_at as string),
        <div key="a" className="flex gap-1">
          {u.status === "suspended" ? <Button size="sm" variant="secondary" loading={busy === u.profile_id} onClick={() => run(u.profile_id as string, () => api(`/admin/attendees/${u.profile_id}/restore`, { method: "POST" }), "Restored", () => data.refetch())}>Restore</Button>
            : u.status === "active" && <Button size="sm" variant="danger" onClick={() => setConfirm({ id: u.profile_id as string, name: u.display_name as string })}>Suspend</Button>}
          <Button size="sm" variant="ghost" loading={busy === `${u.profile_id}r`} onClick={() => run(`${u.profile_id}r`, () => api(`/admin/attendees/${u.profile_id}/revoke-sessions`, { method: "POST" }), "Sessions revoked")}>Sign out</Button>
        </div>,
      ])} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={`Suspend ${confirm?.name}?`} body="They're signed out everywhere and hidden from all events until restored." confirmLabel="Suspend" busy={!!busy}
        onConfirm={() => run(confirm!.id, () => api(`/admin/attendees/${confirm!.id}/suspend`, { method: "POST", body: { reason: "Admin action" } }), "Suspended", () => { setConfirm(null); data.refetch(); })} />
    </>
  );
}

function Orgs() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { busy, run } = useRun();
  const orgs = useQuery({ queryKey: ["admin-orgs", dq], queryFn: () => api<Record<string, string | number>[]>(`/admin/organizations?q=${encodeURIComponent(dq)}`) });
  const people = useQuery({ queryKey: ["admin-organizers", dq], queryFn: () => api<{ id: string; email: string; displayName: string; status: string; isAdmin: boolean; createdAt: string }[]>(`/admin/organizers?q=${encodeURIComponent(dq)}`) });
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Search organizations or organizers" />
      <h2 className="mb-2 font-display font-semibold">Organizations</h2>
      {!orgs.data ? <Skeleton className="h-32" /> : <Table head={["Organization", "Owner", "Events", "Status", ""]} rows={orgs.data.map((o) => [o.name, o.owner_email ?? "—", o.events, o.status,
        o.status === "active" ? <Button key="s" size="sm" variant="danger" loading={busy === o.id} onClick={() => run(o.id as string, () => api(`/admin/organizations/${o.id}/suspend`, { method: "POST", body: {} }), "Suspended", () => orgs.refetch())}>Suspend</Button>
          : <Button key="r" size="sm" variant="secondary" loading={busy === o.id} onClick={() => run(o.id as string, () => api(`/admin/organizations/${o.id}/restore`, { method: "POST", body: {} }), "Restored", () => orgs.refetch())}>Restore</Button>])} />}
      <h2 className="mt-6 mb-2 font-display font-semibold">Organizer accounts</h2>
      {!people.data ? <Skeleton className="h-32" /> : <Table head={["Name", "Email", "Role", "Status", ""]} rows={people.data.map((u) => [u.displayName, u.email, u.isAdmin ? "Admin" : "Organizer", u.status,
        u.isAdmin ? null : u.status === "active" ? <Button key="s" size="sm" variant="danger" loading={busy === u.id} onClick={() => run(u.id, () => api(`/admin/organizers/${u.id}/suspend`, { method: "POST" }), "Suspended", () => people.refetch())}>Suspend</Button>
          : <Button key="r" size="sm" variant="secondary" loading={busy === u.id} onClick={() => run(u.id, () => api(`/admin/organizers/${u.id}/restore`, { method: "POST" }), "Restored", () => people.refetch())}>Restore</Button>])} />}
    </>
  );
}

function Events() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { busy, run } = useRun();
  const data = useQuery({ queryKey: ["admin-events", dq], queryFn: () => api<Record<string, string | number>[]>(`/admin/events?q=${encodeURIComponent(dq)}`) });
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Search events" />
      {!data.data ? <Skeleton className="h-40" /> : <Table head={["Event", "Organization", "Starts", "Status", "Participants", ""]} rows={data.data.map((e) => [e.name, e.organization, formatDateTime(e.starts_at as string), `${e.status}${e.moderation_status === "suspended" ? " · suspended" : ""}`, e.participant_count,
        e.moderation_status === "ok" ? <Button key="s" size="sm" variant="danger" loading={busy === e.id} onClick={() => run(e.id as string, () => api(`/admin/events/${e.id}/suspend`, { method: "POST", body: {} }), "Event suspended", () => data.refetch())}>Suspend</Button>
          : <Button key="r" size="sm" variant="secondary" loading={busy === e.id} onClick={() => run(e.id as string, () => api(`/admin/events/${e.id}/restore`, { method: "POST", body: {} }), "Event restored", () => data.refetch())}>Restore</Button>])} />}
    </>
  );
}

function Taxonomy() {
  const [kind, setKind] = useState<"interests" | "skills">("interests");
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [merge, setMerge] = useState<{ id: string; name: string } | null>(null);
  const [target, setTarget] = useState("");
  const dq = useDebounced(q);
  const { busy, run } = useRun();
  const data = useQuery({ queryKey: ["admin-tags", kind, status, dq], queryFn: () => api<{ id: string; name: string; status: string; uses: number; group_name: string | null }[]>(`/admin/${kind}?status=${status}&q=${encodeURIComponent(dq)}`) });
  const approved = useQuery({ queryKey: ["admin-tags-approved", kind], enabled: !!merge, queryFn: () => api<{ id: string; name: string }[]>(`/admin/${kind}?status=approved`) });
  const act = (id: string, body: Record<string, unknown>, ok: string) => run(id + body.action, () => api(`/admin/${kind}/${id}`, { method: "POST", body }), ok, () => data.refetch());
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Tabs value={kind} onChange={setKind} items={[{ value: "interests", label: "Interests" }, { value: "skills", label: "Skills" }]} />
        <Tabs value={status} onChange={setStatus} items={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "merged", label: "Merged" }]} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="max-w-xs flex-1"><SearchBox value={q} onChange={setQ} placeholder="Search" /></div>
        <Input className="max-w-xs" placeholder={`New ${kind.slice(0, -1)}`} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button variant="secondary" disabled={!newName.trim()} onClick={() => run("new", () => api(`/admin/${kind}`, { method: "POST", body: { name: newName } }), "Added", () => { setNewName(""); data.refetch(); })}>Add</Button>
      </div>
      {!data.data ? <Skeleton className="h-40" /> : <Table head={["Name", "Status", "Used by", ""]} rows={data.data.map((t) => [t.name, t.status, t.uses,
        <div key="a" className="flex flex-wrap gap-1">
          {t.status !== "approved" && <Button size="sm" variant="secondary" loading={busy === t.id + "approve"} onClick={() => act(t.id, { action: "approve" }, "Approved")}>Approve</Button>}
          {t.status !== "rejected" && <Button size="sm" variant="ghost" loading={busy === t.id + "reject"} onClick={() => act(t.id, { action: "reject" }, "Rejected")}>Reject</Button>}
          {t.status !== "merged" && <Button size="sm" variant="ghost" onClick={() => { setMerge({ id: t.id, name: t.name }); setTarget(""); }}>Merge…</Button>}
        </div>])} />}
      <ConfirmDialog open={!!merge} onClose={() => setMerge(null)} title={`Merge “${merge?.name}” into…`} confirmLabel="Merge" busy={!!busy}
        body={<Field label="Target" htmlFor="t"><Select id="t" className="h-11" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose</option>{approved.data?.filter((a) => a.id !== merge?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
        onConfirm={() => target && act(merge!.id, { action: "merge", mergeIntoId: target }, "Merged").then(() => setMerge(null))} />
    </>
  );
}

function Categories() {
  const { busy, run } = useRun();
  const [name, setName] = useState("");
  const q = useQuery({ queryKey: ["admin-categories"], queryFn: () => api<{ id: string; name: string; slug: string; isActive: boolean; sortOrder: number }[]>("/admin/categories") });
  return (
    <>
      <div className="mb-4 flex gap-2"><Input className="max-w-xs" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="secondary" disabled={!name.trim()} onClick={() => run("new", () => api("/admin/categories", { method: "POST", body: { name } }), "Category added", () => { setName(""); q.refetch(); })}>Add</Button></div>
      {!q.data ? <Skeleton className="h-40" /> : <Table head={["Category", "Slug", "Status", ""]} rows={q.data.map((c) => [c.name, c.slug, c.isActive ? "Active" : "Hidden",
        <Button key="t" size="sm" variant="ghost" loading={busy === c.id} onClick={() => run(c.id, () => api(`/admin/categories/${c.id}`, { method: "PATCH", body: { isActive: !c.isActive } }), "Updated", () => q.refetch())}>{c.isActive ? "Hide" : "Show"}</Button>])} />}
    </>
  );
}

type BillingData = { paymentsEnabled: boolean; revenue: Record<string, number>; subscriptions: Record<string, number> | null; conversionRate: number; monthly: { month: string; revenue_minor: number }[];
  popularPlans: { name: string; n: number }[]; promotions: { id: string; plan: string; subject: string | null; startsAt: string; endsAt: string; revokedAt: string | null; reason: string | null }[];
  plans: { code: string; name: string; audience: string; priceMinor: number; isActive: boolean }[] };

function Billing() {
  const { busy, run } = useRun();
  const q = useQuery({ queryKey: ["admin-billing"], queryFn: () => api<BillingData>("/admin/billing") });
  const [promo, setPromo] = useState({ username: "", planCode: "attendee_premium_monthly", days: "30", reason: "", organizationId: "" });
  if (!q.data) return <Skeleton className="h-60" />;
  const d = q.data;
  const isOrgPlan = d.plans.find((p) => p.code === promo.planCode)?.audience === "organization";
  return (
    <div className="space-y-5">
      {!d.paymentsEnabled && <p className="card p-4 text-sm text-text-2">Payments are not configured (Razorpay test keys pending, D-01). Revenue figures will populate from verified webhooks once enabled.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Total revenue (net)", inr(d.revenue.revenue_minor!)], ["MRR", inr(d.revenue.mrrMinor!)], ["ARR", inr(d.revenue.arrMinor!)], ["Failed payments", d.revenue.failed_payments],
          ["Active subscriptions", d.subscriptions?.active ?? 0], ["Cancelled", d.subscriptions?.cancelled ?? 0], ["Premium attendees", d.subscriptions?.premium_attendees ?? 0], ["Conversion", `${d.conversionRate}%`]]
          .map(([l, v]) => <div key={l as string} className="card p-4"><p className="text-xs text-text-2">{l}</p><p className="mt-1 font-display text-2xl font-bold">{v}</p></div>)}
      </div>
      <section className="card p-5">
        <h2 className="font-display font-semibold">Grant promotional access</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Select className="h-12" value={promo.planCode} onChange={(e) => setPromo({ ...promo, planCode: e.target.value })}>{d.plans.filter((p) => p.priceMinor > 0).map((p) => <option key={p.code} value={p.code}>{p.name} ({p.audience})</option>)}</Select>
          {isOrgPlan ? <Input placeholder="Organization ID" value={promo.organizationId} onChange={(e) => setPromo({ ...promo, organizationId: e.target.value })} />
            : <Input placeholder="@username" value={promo.username} onChange={(e) => setPromo({ ...promo, username: e.target.value })} />}
          <Input placeholder="Days" inputMode="numeric" value={promo.days} onChange={(e) => setPromo({ ...promo, days: e.target.value })} />
          <Button loading={busy === "promo"} onClick={() => run("promo", () => api("/admin/promotional-access", { method: "POST", body: { ...promo, days: Number(promo.days) } }), "Access granted", () => q.refetch())}>Grant</Button>
        </div>
        {d.promotions.length > 0 && <ul className="mt-4 divide-y divide-line text-sm">{d.promotions.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2"><span>{p.subject} · {p.plan} · until {formatDateTime(p.endsAt)}{p.revokedAt ? " · revoked" : ""}</span>
            {!p.revokedAt && <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => run(p.id, () => api(`/admin/promotional-access/${p.id}/revoke`, { method: "POST" }), "Revoked", () => q.refetch())}>Revoke</Button>}</li>))}</ul>}
      </section>
      <section className="card p-5 text-sm">
        <h2 className="font-display font-semibold">Monthly revenue</h2>
        {d.monthly.length ? d.monthly.map((m) => <p key={m.month} className="flex justify-between border-b border-line py-1.5"><span>{m.month}</span><span>{inr(m.revenue_minor)}</span></p>) : <p className="mt-2 text-text-2">No verified payments yet.</p>}
      </section>
    </div>
  );
}

function Audit() {
  const [action, setAction] = useState("");
  const da = useDebounced(action);
  const q = useQuery({ queryKey: ["admin-audit", da], queryFn: () => api<{ id: number; occurredAt: string; actorType: string; action: string; targetType: string | null }[]>(`/admin/audit-logs?action=${encodeURIComponent(da)}`) });
  return (
    <>
      <SearchBox value={action} onChange={setAction} placeholder="Filter by action, e.g. qr. or admin." />
      {!q.data ? <Skeleton className="h-40" /> : <Table head={["When", "Actor", "Action", "Target"]} rows={q.data.map((a) => [formatDateTime(a.occurredAt), a.actorType, a.action, a.targetType ?? "—"])} />}
    </>
  );
}

function AdminConsole() {
  const { me } = useOrg();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>((params.get("tab") as Tab) ?? "overview");
  const setTab = (t: Tab) => { setTabState(t); router.replace(`/admin?tab=${t}`, { scroll: false }); };
  if (!me.user?.isAdmin) return <div className="card"><EmptyState icon={<ShieldAlert className="size-7" />} title="Administrators only">Your account doesn&apos;t have platform admin access.</EmptyState></div>;
  if (!me.user.mfaVerified) return <AdminMfaGate enrolled={me.user.mfaEnrolled} />;
  return (
    <>
      <PageHeader title="Platform admin" subtitle="Moderation, taxonomy, system health and revenue. Private messages are never visible here unless attached to a report." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "overview", label: "Overview" }, { value: "reports", label: "Reports" }, { value: "users", label: "Attendees" }, { value: "orgs", label: "Organizations" },
        { value: "events", label: "Events" }, { value: "taxonomy", label: "Interests & skills" }, { value: "categories", label: "Categories" }, { value: "billing", label: "Revenue" }, { value: "audit", label: "Audit log" }]} />
      <div className="mt-6">
        {tab === "overview" && <Overview />}{tab === "reports" && <Reports />}{tab === "users" && <Users />}{tab === "orgs" && <Orgs />}{tab === "events" && <Events />}
        {tab === "taxonomy" && <Taxonomy />}{tab === "categories" && <Categories />}{tab === "billing" && <Billing />}{tab === "audit" && <Audit />}
      </div>
    </>
  );
}

export default function AdminPage() {
  return <Suspense><AdminConsole /></Suspense>;
}
