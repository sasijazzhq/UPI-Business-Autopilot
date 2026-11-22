"use client";
import { useState } from "react";
import { PaymentRow, RequestRow } from "@/components/payments";
import { useMe } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, PageHeader, Segmented, Sheet, SimNote, Skeleton, TextAction, inputCls, useAction } from "@/components/ui";
import { fmtDateTime, inr, parseRupees, post, useApi } from "@/lib/api";
import type { Payment, PaymentRequest } from "@/lib/types";

interface Mismatch {
  id: string;
  kind: string;
  detail: string;
  status: string;
}

interface WebhookEvent {
  id: string;
  provider: string;
  event_type: string | null;
  signature_valid: boolean;
  status: string;
  detail: string | null;
  duplicate_deliveries: number;
  received_at: string;
}

const EVENTS: Record<string, string> = {
  "payment.captured": "Payment received",
  "payment.authorized": "Authorised only, not captured",
  "payment.failed": "Payment failed",
  "refund.processed": "Refund of an earlier payment",
  "payment.dispute.created": "Dispute on an earlier payment",
};

const KIND: Record<string, string> = {
  unknown_reference: "Money without a matching request",
  unallocated_funds: "Extra money not applied",
  amount_mismatch: "Amount differs from request",
  amount_changed: "Provider changed the amount",
  currency_mismatch: "Wrong currency",
  partial_refund: "Partial refund",
  reference_not_owned: "Request belongs elsewhere",
  adjustment_for_unknown_payment: "Refund or dispute for unknown payment",
};

export default function PaymentsPage() {
  const me = useMe();
  const payments = useApi<Payment[]>("/v1/payments");
  const requests = useApi<PaymentRequest[]>("/v1/payment-intents");
  const mismatches = useApi<Mismatch[]>("/v1/mismatches");
  const events = useApi<WebhookEvent[]>("/v1/webhook-events");
  const reloadAll = () => (payments.reload(), requests.reload(), mismatches.reload(), events.reload());

  const [tab, setTab] = useState("money");
  const [sim, setSim] = useState(false);
  const [eventType, setEventType] = useState("payment.captured");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [twice, setTwice] = useState(false);
  const [tamper, setTamper] = useState(false);
  const [result, setResult] = useState<{ deliveries: { http_status: number; status: string; detail: string }[] } | null>(null);
  const act = useAction();

  const needsPayment = eventType === "refund.processed" || eventType === "payment.dispute.created";
  const approved = requests.data?.filter((r) => r.status === "approved" && r.mode === "simulated") ?? [];
  const demoPayments = payments.data?.filter((p) => p.provider === "demo") ?? [];
  const open = mismatches.data?.filter((m) => m.status === "open" && m.kind !== "dispute_open") ?? [];
  const pending = requests.data?.filter((r) => ["proposed", "approved"].includes(r.status)) ?? [];
  const claims = payments.data?.filter((p) => ["manual_unverified", "disputed"].includes(p.state)) ?? [];
  const settled = payments.data?.filter((p) => !["manual_unverified", "disputed"].includes(p.state)) ?? [];
  const error = payments.error ?? requests.error ?? mismatches.error ?? events.error;

  const simulate = () =>
    act.run("sim", async () => {
      const body: Record<string, unknown> = { event_type: eventType, deliver_twice: twice, tamper_signature: tamper };
      if (needsPayment) body.payment_id = target;
      else if (target) body.payment_request_id = target;
      const paise = parseRupees(amount);
      if (paise) body.amount_paise = paise;
      setResult(await post("/v1/demo/simulate-payment-event", body));
      reloadAll();
    });

  return (
    <>
      <PageHeader title="Payments" subtitle="Only verified money changes a balance." />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "money", label: "Received" },
          { value: "requests", label: "Requests", count: pending.length },
          { value: "check", label: "To check", count: open.length + claims.length },
          { value: "log", label: "Log" },
        ]}
      />
      {error && <div className="mb-3"><ErrorBox message={error} onRetry={reloadAll} /></div>}
      {!payments.data && payments.loading && <Skeleton rows={3} />}

      {tab === "money" && payments.data && (
        <Card title="Verified and confirmed">
          {settled.length === 0 ? <Empty>No verified payments yet. They appear here the moment the payment provider confirms them.</Empty> : <ul className="-my-1 divide-y divide-line">{settled.map((p) => <PaymentRow key={p.id} p={p} onChange={reloadAll} showCustomer />)}</ul>}
          <SimNote />
        </Card>
      )}

      {tab === "requests" && (
        <Card title="UPI requests in progress">
          {pending.length === 0 ? <Empty>No open requests. Open an invoice and tap “Prepare request”.</Empty> : <ul className="-my-1 divide-y divide-line">{pending.map((r) => <RequestRow key={r.id} r={r} onChange={reloadAll} showInvoice />)}</ul>}
        </Card>
      )}

      {tab === "check" && (
        <div className="space-y-3">
          <Card title="Claims and disputes">
            {claims.length === 0 ? <Empty>No unverified claims or disputes.</Empty> : <ul className="-my-1 divide-y divide-line">{claims.map((p) => <PaymentRow key={p.id} p={p} onChange={reloadAll} showCustomer />)}</ul>}
          </Card>
          <Card title="Mismatches">
            {open.length === 0 ? <Empty>Nothing to sort out.</Empty> : <ul className="-my-1 divide-y divide-line">{open.map((m) => <MismatchRow key={m.id} m={m} onChange={reloadAll} owner={me.role === "owner"} />)}</ul>}
          </Card>
          <Notice tone="blue">A bank SMS, a screenshot or a customer saying “paid” is kept as a claim. It is not counted until an owner checks and confirms it.</Notice>
        </div>
      )}

      {tab === "log" && (
        <Card title="Messages from the payment provider">
          {events.data?.length === 0 && <Empty>Nothing received from the provider yet.</Empty>}
          <ul className="-my-1 divide-y divide-line">
            {events.data?.map((e) => (
              <li key={e.id} className="py-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{EVENTS[e.event_type ?? ""] ?? e.event_type ?? "Unknown event"}</span>
                  <Badge status={e.status} />
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {fmtDateTime(e.received_at)} · {e.provider} {e.signature_valid ? <Badge label="Signature valid" tone="green" /> : <Badge label="Signature invalid" tone="red" />}
                  {e.duplicate_deliveries > 0 && <Badge label={`${e.duplicate_deliveries} repeat ignored`} tone="gray" />}
                </p>
                {e.detail && <p className="mt-0.5 text-xs text-muted">{e.detail}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">A message with a forged signature is thrown away before it is linked to any merchant, so it never shows here.</p>
        </Card>
      )}

      {me.demo_mode && me.role !== "viewer" && (
        <Button variant="secondary" className="mt-3 w-full border-violet-300 text-violet-800" onClick={() => (setSim(true), setResult(null))}>
          Test it: act as the payment provider
        </Button>
      )}

      <Sheet open={sim} title="Demo payment provider" onClose={() => setSim(false)}>
        <div className="space-y-3">
          <Notice>Simulated money only. This sends a signed message through the same path a real provider uses.</Notice>
          <Field label="What happened">
            <select className={inputCls} value={eventType} onChange={(e) => (setEventType(e.target.value), setTarget(""))}>
              {Object.entries(EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label={needsPayment ? "Which payment" : "For which request"}>
            <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{needsPayment ? "Choose a payment" : "No request (unmatched money)"}</option>
              {needsPayment
                ? demoPayments.map((p) => <option key={p.id} value={p.id}>{p.customer_name ?? "Unmatched"} · {inr(p.amount_paise)} · {p.state.replaceAll("_", " ")}</option>)
                : approved.map((r) => <option key={r.id} value={r.id}>{r.customer_name} · {r.invoice_number} · {inr(r.amount_paise)}</option>)}
            </select>
          </Field>
          {!needsPayment && (
            <Field label="Amount paid (₹)" hint={target ? "Leave empty to pay the requested amount." : "Needed when there is no request."}>
              <input className={`${inputCls} tabular`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          )}
          <label className="flex min-h-11 items-center gap-2.5 text-sm"><input type="checkbox" className="h-5 w-5 accent-[#0a6b4d]" checked={twice} onChange={(e) => setTwice(e.target.checked)} /> Deliver the same message twice</label>
          <label className="flex min-h-11 items-center gap-2.5 text-sm"><input type="checkbox" className="h-5 w-5 accent-[#0a6b4d]" checked={tamper} onChange={(e) => setTamper(e.target.checked)} /> Send with a forged signature</label>
          {act.error && <ErrorBox message={act.error} />}
          <Button className="w-full" busy={act.busy === "sim"} disabled={needsPayment ? !target : !target && !parseRupees(amount)} onClick={simulate}>Send signed message</Button>
          {result && (
            <ul className="space-y-1.5 text-sm" aria-live="polite">
              {result.deliveries.map((d, i) => (
                <li key={i}>
                  <span className="flex items-center gap-1.5"><span className="font-semibold">Delivery {i + 1}</span> <Badge status={d.status} /></span>
                  <span className="text-xs text-muted">{d.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </>
  );
}

function MismatchRow({ m, onChange, owner }: { m: Mismatch; onChange: () => void; owner: boolean }) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const act = useAction();
  return (
    <li className="py-2.5 text-sm">
      <p className="font-semibold">{KIND[m.kind] ?? m.kind.replaceAll("_", " ")}</p>
      <p className="mt-0.5 break-words text-xs text-muted">{m.detail}</p>
      {owner && !open && <TextAction className="-ml-2" onClick={() => setOpen(true)}>Mark as sorted</TextAction>}
      {open && (
        <div className="mt-2 space-y-2">
          <input aria-label="Resolution note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do about it?" />
          <Button variant="secondary" busy={!!act.busy} disabled={note.trim().length < 3} onClick={() => act.run("r", async () => (await post(`/v1/mismatches/${m.id}/resolve`, { note }), onChange()))}>Save</Button>
          {act.error && <ErrorBox message={act.error} />}
        </div>
      )}
    </li>
  );
}
