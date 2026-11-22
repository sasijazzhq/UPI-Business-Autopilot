"use client";
import { useState } from "react";
import { fmtDateTime, inr, methodLabel, parseRupees, post } from "@/lib/api";
import { emitDemo } from "@/lib/demo";
import type { Payment, PaymentRequest } from "@/lib/types";
import { useMe } from "./shell";
import { Badge, Button, ErrorBox, Field, SimTag, TextAction, inputCls, useAction } from "./ui";

const EVIDENCE: Record<string, string> = { cash_in_hand: "Cash in hand", screenshot: "Screenshot", bank_sms: "Bank SMS", verbal: "Verbal claim" };

/** One receipt with the actions its state allows. Balances change only through confirmed states. */
export function PaymentRow({ p, onChange, showCustomer = false }: { p: Payment; onChange: () => void; showCustomer?: boolean }) {
  const me = useMe();
  const act = useAction();
  const [mode, setMode] = useState<null | "confirm" | "dispute" | "uphold" | "reject">(null);
  const [note, setNote] = useState("");
  const owner = me.role === "owner";
  const canWrite = me.role !== "viewer";

  const submit = () =>
    act.run(mode!, async () => {
      if (mode === "confirm") await post(`/v1/payments/${p.id}/confirm`, { note });
      if (mode === "dispute") await post(`/v1/payments/${p.id}/dispute`, { note });
      if (mode === "uphold" || mode === "reject") await post(`/v1/payments/${p.id}/resolve-dispute`, { note, outcome: mode === "uphold" ? "upheld" : "rejected" });
      setMode(null);
      setNote("");
      onChange();
    });

  return (
    <li className="py-2.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <Badge status={p.state} />
            <SimTag show={p.mode === "simulated"} />
            {p.mode === "test" && <Badge label="Test mode" tone="blue" />}
            {showCustomer && <span className="font-medium">{p.customer_name ?? "Unmatched payer"}</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {fmtDateTime(p.received_at)} · {p.provider === "manual" ? `Entered by hand · ${EVIDENCE[p.evidence_type ?? ""] ?? methodLabel(p.method)}` : `${methodLabel(p.method)} · signed by ${p.provider === "demo" ? "payment provider" : "Razorpay"}`}
          </p>
          {p.note && <p className="mt-0.5 text-xs text-muted">“{p.note}”</p>}
          {p.unallocated_paise > 0 && <p className="mt-0.5 text-xs font-medium text-amber-800">{inr(p.unallocated_paise)} not applied to any invoice</p>}
        </div>
        <span className={`tabular shrink-0 font-semibold ${["disputed", "reversed", "failed"].includes(p.state) ? "text-muted line-through" : ""}`}>{inr(p.amount_paise)}</span>
      </div>
      {canWrite && !mode && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          {p.state === "manual_unverified" && owner && <Button variant="secondary" onClick={() => setMode("confirm")}>Confirm after checking</Button>}
          {["manual_unverified", "provider_verified", "merchant_confirmed"].includes(p.state) && <TextAction tone="muted" onClick={() => setMode("dispute")}>Something wrong? Dispute</TextAction>}
          {p.state === "disputed" && owner && (
            <>
              <Button variant="secondary" onClick={() => setMode("uphold")}>Receipt is valid</Button>
              <Button variant="danger" onClick={() => setMode("reject")}>Receipt is not valid</Button>
            </>
          )}
          {p.state === "manual_unverified" && !owner && <span className="text-xs text-muted">Only an owner can confirm a manual receipt.</span>}
        </div>
      )}
      {mode && (
        <div className="mt-2 space-y-2 rounded-lg bg-stone-50 p-2">
          <Field label={mode === "confirm" ? "How did you verify this money? (kept in the audit log)" : "Reason (kept in the audit log)"}>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "confirm" ? "e.g. Counted cash and deposited; seen in bank statement" : "e.g. No credit in bank statement"} />
          </Field>
          {act.error && <ErrorBox message={act.error} />}
          <div className="flex gap-2">
            <Button busy={!!act.busy} disabled={note.trim().length < 3} onClick={submit}>Save</Button>
            <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** A payment request: proposal -> owner approval -> (demo) simulated customer payment. */
export function RequestRow({ r, onChange, showInvoice = false }: { r: PaymentRequest; onChange: () => void; showInvoice?: boolean }) {
  const me = useMe();
  const act = useAction();
  const [copied, setCopied] = useState(false);
  return (
    <li className="py-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-1.5">
          <Badge status={r.status === "approved" ? undefined : r.status} label={r.status === "approved" ? "Approved, awaiting payment" : undefined} tone="blue" />
          <SimTag show={r.mode === "simulated"} />
          {r.mode === "test" && <Badge label="Razorpay test mode" tone="blue" />}
          {showInvoice && <span className="text-muted">{r.customer_name} · {r.invoice_number}</span>}
        </p>
        <span className="tabular font-semibold">{inr(r.amount_paise)}</span>
      </div>
      {r.status === "proposed" && <p className="mt-0.5 text-xs text-muted">Nothing has been created or sent. An owner must approve first.</p>}
      {r.status === "approved" && <p className="mt-0.5 text-xs text-muted">Ready. This app has not sent it to the customer; share the link yourself.</p>}
      {act.error && <div className="mt-2"><ErrorBox message={act.error} /></div>}
      {me.role !== "viewer" && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {r.status === "proposed" && me.role === "owner" && (
            <Button busy={act.busy === "approve"} onClick={() => act.run("approve", async () => (await post(`/v1/payment-intents/${r.id}/approve`, { provider: "demo" }), onChange()))}>
              Approve request
            </Button>
          )}
          {r.status === "proposed" && me.role !== "owner" && <span className="text-xs text-muted">Waiting for an owner to approve.</span>}
          {r.status === "approved" && r.mode === "simulated" && (
            <Button busy={act.busy === "pay"} onClick={() => act.run("pay", async () => {
              const res = await post("/v1/demo/simulate-payment-event", { payment_request_id: r.id });
              if (res.payment?.state === "provider_verified") emitDemo("payment-verified");
              onChange();
            })}>
              Customer pays (demo)
            </Button>
          )}
          {r.status === "approved" && r.link_url && (
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(r.link_url!).then(() => setCopied(true))}>{copied ? "Link copied" : "Copy link"}</Button>
          )}
          {["proposed", "approved"].includes(r.status) && (
            <TextAction tone="muted" disabled={act.busy === "cancel"} onClick={() => act.run("cancel", async () => (await post(`/v1/payment-intents/${r.id}/cancel`), onChange()))}>Cancel request</TextAction>
          )}
        </div>
      )}
    </li>
  );
}

export function ProposeRequest({ invoiceId, duePaise, onChange }: { invoiceId: string; duePaise: number; onChange: () => void }) {
  const [text, setText] = useState("");
  const act = useAction();
  const amount = parseRupees(text);
  const invalid = text !== "" && (amount === null || amount <= 0 || amount > duePaise);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        act.run("propose", async () => (await post("/v1/payment-intents", { invoice_id: invoiceId, amount_paise: amount }), setText(""), onChange()));
      }}
    >
      <div className="min-w-0 flex-1">
        <Field label="Amount to request (₹)" error={invalid ? `Enter up to ${inr(duePaise)}` : undefined}>
          <input className={`${inputCls} tabular`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={String(Math.floor(duePaise / 100))} />
        </Field>
      </div>
      <Button type="submit" variant="secondary" busy={!!act.busy} disabled={amount === null || invalid}>Prepare request</Button>
      {act.error && <div className="w-full"><ErrorBox message={act.error} /></div>}
    </form>
  );
}

export function ManualReceipt({ invoiceId, customerId, onChange }: { invoiceId: string; customerId: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState("cash_in_hand");
  const [note, setNote] = useState("");
  const act = useAction();
  const amount = parseRupees(text);
  if (!open) return <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>Customer says they paid? Note it</Button>;
  return (
    <form
      className="space-y-2 rounded-lg bg-stone-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        act.run("manual", async () => {
          await post("/v1/payments/manual", { customer_id: customerId, invoice_id: invoiceId, amount_paise: amount, evidence_type: evidence, method: evidence === "cash_in_hand" ? "cash" : evidence === "verbal" ? "cash" : "upi_claim", note });
          setOpen(false);
          setText("");
          setNote("");
          onChange();
        });
      }}
    >
      <div className="grid gap-2">
        <Field label="Amount (₹)">
          <input className={`${inputCls} tabular`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="What do you have?">
          <select className={inputCls} value={evidence} onChange={(e) => setEvidence(e.target.value)}>
            {Object.entries(EVIDENCE).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Note">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Collected at the shop by Ravi" />
      </Field>
      <p className="text-xs text-muted">This is saved as an unverified claim. A screenshot, SMS or verbal claim is not proof of receipt; the balance changes only after an owner confirms it.</p>
      {act.error && <ErrorBox message={act.error} />}
      <div className="flex gap-2">
        <Button type="submit" busy={!!act.busy} disabled={!amount || note.trim().length < 3}>Save as unverified</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
