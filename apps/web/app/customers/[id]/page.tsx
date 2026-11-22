"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PaymentRow } from "@/components/payments";
import { useMe } from "@/components/shell";
import { AuditList, Badge, Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, SimTag, inputCls, useAction } from "@/components/ui";
import { api, fmtDate, fmtDateTime, fmtDay, inr, methodLabel, post, useApi } from "@/lib/api";
import type { Audit, Customer, Invoice, Payment, PromiseRow } from "@/lib/types";

interface Ledger {
  customer: Customer;
  totals: Record<string, number>;
  invoices: Invoice[];
  payments: Payment[];
  promises: PromiseRow[];
  consent_history: { channel: string; status: string; evidence: string; recorded_at: string }[];
  audit: Audit[];
}

const CHANNELS: Record<string, string> = { demo_inbox: "Demo inbox", whatsapp: "WhatsApp", voice_call: "Voice call" };

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { data, error, loading, reload } = useApi<Ledger>(`/v1/customers/${id}/ledger`);
  const [method, setMethod] = useState("");
  const [prefNote, setPrefNote] = useState("");
  const [channel, setChannel] = useState("demo_inbox");
  const [evidence, setEvidence] = useState("");
  const act = useAction();
  useEffect(() => {
    if (data) {
      setMethod(data.customer.preferred_method ?? "");
      setPrefNote(data.customer.preference_note ?? "");
    }
  }, [data]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Loading label="Loading customer" />;
  if (!data) return null;
  const { customer: c, totals: t } = data;
  const canWrite = me.role !== "viewer";
  const consent = (status: "opt_in" | "opt_out") =>
    act.run(status, async () => (await post(`/v1/customers/${id}/consents`, { channel, status, evidence }), setEvidence(""), reload()));

  return (
    <>
      <PageHeader title={c.name} back={{ href: "/customers", label: "Customers" }} subtitle={c.phone ?? "No phone recorded"} action={<Link href={`/conversations?customer=${c.id}`} className="rounded-full border border-line bg-white px-3 py-2 text-sm font-semibold text-brand">Chat</Link>} />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            ["Invoiced", t.invoiced_paise, ""],
            ["Provider verified", t.provider_verified_paise, "text-emerald-700"],
            ["Merchant confirmed", t.merchant_confirmed_paise, "text-emerald-700"],
            ["Owes now", t.outstanding_paise, ""],
            ["Promised", t.promised_open_paise, "text-amber-700"],
          ].map(([label, v, cls]) => (
            <div key={label as string} className="rounded-xl border border-line bg-white p-3">
              <p className="text-xs font-medium text-muted">{label}</p>
              <p className={`tabular mt-1 text-lg font-semibold ${cls}`}>{inr(v as number)}</p>
            </div>
          ))}
        </div>
        {(t.unverified_claims_paise > 0 || t.disputed_paise > 0) && (
          <p className="text-sm text-amber-800">
            {t.unverified_claims_paise > 0 && <>{inr(t.unverified_claims_paise)} claimed but unverified. </>}
            {t.disputed_paise > 0 && <>{inr(t.disputed_paise)} disputed. </>}
            Neither reduces what this customer owes.
          </p>
        )}

        <div className="grid gap-4">
          <Card title="Invoices">
            {data.invoices.length === 0 ? <Empty>No invoices for this customer.</Empty> : (
              <ul className="divide-y divide-line">
                {data.invoices.map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm active:bg-brand-soft">
                      <span><span className="font-medium text-brand">{i.number}</span> <span className="text-xs text-muted">{fmtDate(i.invoice_date)}</span></span>
                      <span className="flex items-center gap-2"><span className="tabular">{inr(i.due_paise)} due of {inr(i.total_paise)}</span><Badge status={i.status} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Receipts">
            {data.payments.length === 0 ? <Empty>No receipts recorded.</Empty> : <ul className="divide-y divide-line">{data.payments.map((p) => <PaymentRow key={p.id} p={p} onChange={reload} />)}</ul>}
          </Card>
        </div>

        <Card title="Promises to pay" action={<Link href={`/conversations?customer=${c.id}`} className="text-sm text-brand hover:underline">Record a promise</Link>}>
          {data.promises.length === 0 ? <Empty>This customer has not stated when they will pay.</Empty> : (
            <ul className="divide-y divide-line">
              {data.promises.map((p) => (
                <li key={p.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex flex-wrap items-center gap-1.5"><Badge status={p.status} /> {fmtDay(p.promised_date, me.today)} · {methodLabel(p.method)}{p.pickup_window && ` · pickup ${p.pickup_window}`} <SimTag show={p.simulated} /></span>
                    <span className="tabular font-medium">{inr(p.amount_paise)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">“{p.evidence_text}”</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-4">
          <Card title="Stated preferences">
            <fieldset disabled={!canWrite} className="space-y-3">
              <Field label="Preferred way to pay" hint="Record only what the customer has told you.">
                <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="">Not stated</option>
                  <option value="upi">UPI</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="In their words"><input className={inputCls} value={prefNote} onChange={(e) => setPrefNote(e.target.value)} placeholder="e.g. Cash on pickup, evenings" /></Field>
              {canWrite && (
                <Button variant="secondary" busy={act.busy === "pref"} onClick={() => act.run("pref", async () => (await api(`/v1/customers/${id}`, { method: "PATCH", json: { name: c.name, phone: c.phone, preferred_method: method || null, preference_note: prefNote || null } }), reload()))}>Save preferences</Button>
              )}
            </fieldset>
          </Card>
          <Card title="Messaging consent">
            <ul className="space-y-1 text-sm">
              {Object.entries(CHANNELS).map(([k, label]) => (
                <li key={k} className="flex items-center justify-between">
                  <span>{label}</span>
                  {c.consents[k] === "opt_in" ? <Badge label="Opted in" tone="green" /> : c.consents[k] === "opt_out" ? <Badge label="Opted out" tone="red" /> : <Badge label="No consent recorded" tone="gray" />}
                </li>
              ))}
            </ul>
            {canWrite && (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                <div className="grid gap-2">
                  <select aria-label="Channel" className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>
                    {Object.entries(CHANNELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  <input aria-label="Evidence" className={inputCls} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="How and when did they tell you?" />
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={evidence.trim().length < 3} busy={act.busy === "opt_in"} onClick={() => consent("opt_in")}>Record opt-in</Button>
                  <Button variant="danger" disabled={evidence.trim().length < 3} busy={act.busy === "opt_out"} onClick={() => consent("opt_out")}>Record opt-out</Button>
                </div>
              </div>
            )}
            {data.consent_history.length > 0 && (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer">Consent evidence ({data.consent_history.length})</summary>
                <ul className="mt-1 space-y-1">
                  {data.consent_history.map((h, i) => <li key={i}>{fmtDateTime(h.recorded_at)} · {CHANNELS[h.channel]} · {h.status.replace("_", " ")} — “{h.evidence}”</li>)}
                </ul>
              </details>
            )}
          </Card>
        </div>
        {act.error && <ErrorBox message={act.error} />}
        <Card title="History"><AuditList items={data.audit} /></Card>
      </div>
    </>
  );
}
