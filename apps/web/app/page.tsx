"use client";
import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/shell";
import { Avatar, Badge, Button, Card, Empty, ErrorBox, SimNote, Skeleton } from "@/components/ui";
import { fmtDate, fmtDay, inr, useApi } from "@/lib/api";
import { resetDemo, useGuide } from "@/lib/demo";

interface PromiseRow {
  id: string;
  customer_id: string;
  customer_name: string;
  amount_paise: number;
  method: string;
  pickup_window: string | null;
  promised_date: string;
}

interface Contact {
  count: number;
  simulated_count: number;
}

interface Report {
  movement: { opening_outstanding_paise: number; new_invoice_count: number; new_invoices_paise: number; verified_applied_paise: number; closing_outstanding_paise: number };
  outstanding_paise: number;
  open_invoice_count: number;
  expected_today_paise: number;
  received: {
    provider_verified_paise: number;
    merchant_confirmed_paise: number;
    confirmed_total_paise: number;
    unverified_claims_paise: number;
  };
  promises_due_today: PromiseRow[];
  promises_made_today: PromiseRow[];
  cash_pickups: PromiseRow[];
  contacted: Contact;
  replied: Contact;
  disputes: { id: string }[];
  open_mismatches: { id: string; kind: string }[];
  definitions: Record<string, string>;
}

const ACTIONS = [
  { href: "/bills", label: "Add bill", icon: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM12 8v6m-3-3h6" },
  { href: "/invoices", label: "Ask by UPI", icon: "M4 12h13m-5-5l5 5-5 5M20 5v14" },
  { href: "/conversations", label: "Note promise", icon: "M4 5h16v11H10l-5 4v-4H4V5zm4.5 5.5l2.5 2.5 4.5-5" },
  { href: "/assistant", label: "Ask", icon: "M12 4a4 4 0 014 4v3a4 4 0 01-8 0V8a4 4 0 014-4zm-7 7a7 7 0 0014 0M12 18v3" },
];

export default function HomePage() {
  const me = useMe();
  const guide = useGuide();
  const [date, setDate] = useState(me.today);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const { data: r, error, loading, reload } = useApi<Report>(`/v1/reports/today?date=${date}`);
  const isToday = date === me.today;
  const first = me.name.split(/[\s(]/)[0];
  const dayWord = isToday ? "today" : "that day";
  const issues = r ? r.disputes.length + r.open_mismatches.filter((m) => m.kind !== "dispute_open").length : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">Vanakkam, {first}</p>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">{isToday ? "Today" : fmtDay(date, me.today)}</h1>
        </div>
        <label className="relative flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-[13px] font-semibold text-brand focus-within:ring-2 focus-within:ring-brand/30">
          {fmtDate(date)}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
          <input type="date" aria-label="Show another day" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={date} max={me.today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>

      {me.demo_mode && me.role === "owner" && !guide.active && isToday && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-amber-950">See it in 2 minutes</p>
            <p className="text-xs leading-snug text-amber-900">Paper bill to verified payment. Starts from fresh sample data.</p>
            {startError && <p className="mt-1 text-xs font-semibold text-rose-700">{startError}</p>}
          </div>
          <Button busy={starting} onClick={() => (setStarting(true), resetDemo(true).catch((e) => (setStartError(e.message), setStarting(false))))}>Try the demo</Button>
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !r && <Skeleton />}
      {r && (
        <>
          <section className="rounded-3xl bg-brand p-4 text-white shadow-lg shadow-emerald-900/20" aria-label="Customers still owe">
            <p className="text-sm font-semibold text-white/85">Customers still owe you</p>
            <p className="tabular mt-0.5 text-[40px] font-bold leading-none tracking-tight">{inr(r.outstanding_paise)}</p>
            <p className="mt-1.5 text-[13px] text-white/85">
              across {r.open_invoice_count} unpaid bill{r.open_invoice_count === 1 ? "" : "s"}, as of now
            </p>
            <dl className="tabular mt-3 space-y-1 rounded-2xl bg-white/12 px-3 py-2.5 text-[13px]" aria-label={`How it moved ${dayWord}`}>
              <Move label={isToday ? "Owed this morning" : "Owed at start of that day"} value={inr(r.movement.opening_outstanding_paise)} />
              <Move label={`New bills ${dayWord}${r.movement.new_invoice_count ? ` (${r.movement.new_invoice_count})` : ""}`} value={`+ ${inr(r.movement.new_invoices_paise)}`} />
              <Move label="Verified payments" value={`− ${inr(r.movement.verified_applied_paise)}`} />
              <div className="flex justify-between gap-3 border-t border-white/25 pt-1 font-bold">
                <dt>{isToday ? "Still owed now" : "Owed at end of that day"}</dt>
                <dd>{inr(r.movement.closing_outstanding_paise)}</dd>
              </div>
            </dl>
            <p className="mt-1.5 text-xs text-white/80">A new bill adds to this. Only a verified payment brings it down. Promises change nothing.</p>
          </section>

          <section className="grid grid-cols-2 gap-2" aria-label={`Money ${dayWord}`}>
            <div className="rounded-2xl border-2 border-emerald-600 bg-white p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800">
                <Tick /> Received
              </p>
              <p className="tabular mt-1 text-2xl font-bold leading-tight text-emerald-700">{inr(r.received.confirmed_total_paise)}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted">Verified {dayWord}. Counted in your books.</p>
            </div>
            <div className="rounded-2xl border-2 border-dashed border-amber-500 bg-amber-50/70 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">
                <Clock /> Promised
              </p>
              <p className="tabular mt-1 text-2xl font-bold leading-tight text-amber-800">{inr(r.expected_today_paise)}</p>
              <p className="mt-0.5 text-xs leading-snug text-amber-900">Said for {dayWord}. Not money yet.</p>
            </div>
          </section>

          {r.received.unverified_claims_paise > 0 && (
            <Link href="/payments" className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2 text-[13px] text-orange-950">
              <span><strong className="tabular">{inr(r.received.unverified_claims_paise)}</strong> claimed as paid, not verified yet. Not counted.</span>
              <span className="shrink-0 font-semibold underline">Check</span>
            </Link>
          )}

          <Card title={isToday ? "Ready to collect today" : "Was ready to collect"}>
            {r.promises_due_today.length === 0 ? (
              <Empty>No customer has promised to pay {dayWord}. Note a promise when a customer tells you a date.</Empty>
            ) : (
              <ul className="-my-1 divide-y divide-line">
                {r.promises_due_today.map((p) => (
                  <li key={p.id}>
                    <Link href={`/customers/${p.customer_id}`} className="flex min-h-14 items-center gap-3 py-2.5">
                      <Avatar name={p.customer_name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{p.customer_name}</span>
                        <span className="mt-0.5 block">
                          {p.method === "cash" ? (
                            p.pickup_window ? <Badge label={`Cash pickup confirmed · ${p.pickup_window}`} tone="green" /> : <Badge label="Cash · pickup time not confirmed" tone="amber" />
                          ) : p.method === "upi" ? (
                            <Badge label="Will pay by UPI" tone="blue" />
                          ) : (
                            <Badge label="Other method" tone="gray" />
                          )}
                        </span>
                      </span>
                      <span className="tabular text-base font-bold text-amber-800">{inr(p.amount_paise)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs leading-snug text-muted">In the customers&apos; own words. A promise is not a payment until it is verified.</p>
          </Card>

          <nav className="grid grid-cols-4 gap-2" aria-label="Quick actions">
            {ACTIONS.map((a) => (
              <Link key={a.href} href={a.href} className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-white px-1 py-3 text-center text-xs font-semibold leading-tight active:bg-brand-soft">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={a.icon} /></svg>
                </span>
                {a.label}
              </Link>
            ))}
          </nav>

          {issues > 0 && (
            <Link href="/payments" className="block rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
              <p className="font-bold">Needs your attention</p>
              <p className="mt-0.5 text-[13px]">{issues} payment issue{issues === 1 ? "" : "s"} to check. Tap to open Payments.</p>
            </Link>
          )}

          {r.cash_pickups.some((p) => p.promised_date !== date) && (
            <Card title="Cash pickups coming up">
              <ul className="-my-1 divide-y divide-line">
                {r.cash_pickups.filter((p) => p.promised_date !== date).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.customer_name}</span>
                      <span className="text-xs text-muted">{fmtDay(p.promised_date, me.today)} · {p.pickup_window}</span>
                    </span>
                    <span className="tabular font-bold">{inr(p.amount_paise)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Talking to customers">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Activity label="Messaged" c={r.contacted} />
              <Activity label="Replied" c={r.replied} />
              <div>
                <dd className="tabular text-xl font-bold">{r.promises_made_today.length}</dd>
                <dt className="text-xs font-semibold text-muted">New promises</dt>
              </div>
            </dl>
            <SimNote>Sample inbox messages are counted separately, never as real contact.</SimNote>
          </Card>

          <details className="rounded-2xl border border-line bg-white px-4 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">How these numbers are counted</summary>
            <dl className="space-y-1.5 pb-3 text-xs leading-snug text-muted">
              {Object.entries(r.definitions).map(([k, v]) => (
                <div key={k}>
                  <dt className="inline font-semibold capitalize text-ink">{k.replaceAll("_", " ")}: </dt>
                  <dd className="inline">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
    </div>
  );
}

function Move({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-white/85">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function Tick() {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </span>
  );
}

function Clock() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-700" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
  );
}

function Activity({ label, c }: { label: string; c: Contact }) {
  return (
    <div>
      <dd className="tabular text-xl font-bold">{c.count}</dd>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      {c.simulated_count > 0 && <dd className="text-xs font-semibold text-violet-700">+{c.simulated_count} sample</dd>}
    </div>
  );
}
