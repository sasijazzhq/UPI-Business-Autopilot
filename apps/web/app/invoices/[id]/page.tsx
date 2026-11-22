"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ManualReceipt, PaymentRow, ProposeRequest, RequestRow } from "@/components/payments";
import { useMe } from "@/components/shell";
import { AuditList, Badge, Card, Empty, ErrorBox, PageHeader, SimNote, SimTag, Skeleton } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtDay, inr, methodLabel, useApi } from "@/lib/api";
import type { Audit, Invoice, Payment, PaymentRequest, PromiseRow } from "@/lib/types";

interface Detail extends Invoice {
  draft_id: string | null;
  lines: { description: string; quantity: string; unit_price_paise: number; line_total_paise: number }[];
  allocations: { id: string; payment_id: string; amount_paise: number; kind: string; created_at: string }[];
  payments: Payment[];
  payment_requests: PaymentRequest[];
  promises: PromiseRow[];
  promised_open_paise: number;
  audit: Audit[];
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { data: inv, error, loading, reload } = useApi<Detail>(`/v1/invoices/${id}`);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !inv) return <Skeleton rows={4} />;
  if (!inv) return null;
  const canWrite = me.role !== "viewer";
  const pct = Math.round((inv.allocated_paise / Math.max(inv.total_paise, 1)) * 100);
  let running = inv.total_paise;

  return (
    <>
      <PageHeader title={inv.customer_name} back={{ href: "/invoices", label: "Invoices" }} subtitle={<>{inv.number} · {fmtDate(inv.invoice_date)}</>} action={<Badge status={inv.status} />} />
      <div className="space-y-3">
        <section className="rounded-3xl bg-brand p-4 text-white shadow-lg shadow-emerald-900/20">
          <p className="text-[13px] font-semibold text-white/80">{inv.due_paise > 0 ? "Still to collect" : "Fully paid"}</p>
          <p className="tabular mt-0.5 text-[40px] font-bold leading-none tracking-tight">{inr(inv.due_paise)}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs font-semibold text-white/85">
            <span className="tabular">{inr(inv.allocated_paise)} received</span>
            <span className="tabular">Bill {inr(inv.total_paise)}</span>
          </div>
          {inv.promised_open_paise > 0 && <p className="mt-2 rounded-xl bg-white/12 px-3 py-1.5 text-xs">{inr(inv.promised_open_paise)} promised by the customer. Not received yet, so not deducted.</p>}
        </section>

        <Card title="Payment story">
          <ol className="relative space-y-3 border-l-2 border-line pl-4 text-sm">
            <Step color="bg-stone-400" title="Bill raised" right={inr(inv.total_paise)} />
            {inv.allocations.map((a) => {
              running -= a.amount_paise;
              const pay = inv.payments.find((p) => p.id === a.payment_id);
              const back = a.kind === "reversal";
              return (
                <Step
                  key={a.id}
                  color={back ? "bg-rose-500" : "bg-emerald-600"}
                  title={back ? "Payment taken back" : "Payment received"}
                  right={`${back ? "+" : "−"}${inr(Math.abs(a.amount_paise))}`}
                  sub={<>{fmtDateTime(pay?.received_at ?? a.created_at)} · balance {inr(running)} <SimTag show={pay?.mode === "simulated"} /></>}
                />
              );
            })}
            <Step color={inv.due_paise > 0 ? "bg-amber-500" : "bg-emerald-600"} title={inv.due_paise > 0 ? "Remaining due" : "Closed"} right={inr(inv.due_paise)} bold />
          </ol>
          <p className="mt-3 text-xs leading-snug text-muted">Only verified money appears here. Entries are never edited or deleted.</p>
          <SimNote />
        </Card>

        <Card title="Send UPI request">
          {inv.payment_requests.length > 0 && <ul className="-mt-1 mb-2 divide-y divide-line">{inv.payment_requests.map((r) => <RequestRow key={r.id} r={r} onChange={reload} />)}</ul>}
          {canWrite && inv.due_paise > 0 && <ProposeRequest invoiceId={inv.id} duePaise={inv.due_paise} onChange={reload} />}
          {inv.due_paise === 0 && <p className="text-xs text-muted">This bill is fully paid. No more requests are needed.</p>}
          {inv.payment_requests.length === 0 && !canWrite && <Empty>No requests yet.</Empty>}
        </Card>

        <Card title="Receipts">
          {inv.payments.length === 0 ? <Empty>No money recorded against this bill yet.</Empty> : <ul className="-my-1 divide-y divide-line">{inv.payments.map((p) => <PaymentRow key={p.id} p={p} onChange={reload} />)}</ul>}
          {canWrite && inv.due_paise > 0 && <div className="mt-2"><ManualReceipt invoiceId={inv.id} customerId={inv.customer_id} onChange={reload} /></div>}
        </Card>

        <Card title="Customer promises" action={<Link href={`/conversations?customer=${inv.customer_id}`} className="-my-2 flex min-h-11 items-center px-2 text-sm font-semibold text-brand">Add</Link>}>
          {inv.promises.length === 0 ? <Empty>The customer has not said when they will pay.</Empty> : (
            <ul className="-my-1 divide-y divide-line">
              {inv.promises.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-1.5"><Badge status={p.status} /> {fmtDay(p.promised_date, me.today)} · {methodLabel(p.method)} <SimTag show={p.simulated} /></span>
                  <span className="tabular font-bold">{inr(p.amount_paise)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Items on the bill">
          <ul className="-my-1 divide-y divide-line text-sm">
            {inv.lines.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{l.description}</span>
                  <span className="tabular text-xs text-muted">{l.quantity} × {inr(l.unit_price_paise)}</span>
                </span>
                <span className="tabular font-semibold">{inr(l.line_total_paise)}</span>
              </li>
            ))}
            {inv.tax_paise > 0 && <li className="flex justify-between py-2 text-muted"><span>Tax</span><span className="tabular">{inr(inv.tax_paise)}</span></li>}
            <li className="flex justify-between py-2 font-bold"><span>Total</span><span className="tabular">{inr(inv.total_paise)}</span></li>
          </ul>
          {inv.draft_id && <Link href={`/bills/${inv.draft_id}`} className="mt-1 flex min-h-11 items-center text-[13px] font-semibold text-brand">See the original bill photo</Link>}
        </Card>

        <Card title="History"><AuditList items={inv.audit} /></Card>
        <Link href={`/customers/${inv.customer_id}`} className="flex min-h-11 items-center justify-center text-sm font-semibold text-brand">Open {inv.customer_name}</Link>
      </div>
    </>
  );
}

function Step({ color, title, right, sub, bold }: { color: string; title: string; right: string; sub?: React.ReactNode; bold?: boolean }) {
  return (
    <li className="relative">
      <span className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white ${color}`} />
      <div className={`flex items-baseline justify-between gap-3 ${bold ? "text-base font-bold" : "font-semibold"}`}>
        <span>{title}</span>
        <span className="tabular">{right}</span>
      </div>
      {sub && <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">{sub}</p>}
    </li>
  );
}
