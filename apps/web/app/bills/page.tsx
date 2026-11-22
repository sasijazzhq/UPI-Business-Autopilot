"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useMe } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Notice, PageHeader, Segmented, useAction } from "@/components/ui";
import { api, fmtDateTime, inr, post, useApi } from "@/lib/api";
import { emitDemo } from "@/lib/demo";

interface Draft {
  id: string;
  status: string;
  extraction_source: string;
  payload: { customer_name: string | null; total_paise: number | null };
  issues: { severity: string }[];
  upload: { filename: string; source: string };
  created_at: string;
  invoice_id: string | null;
}

export default function BillsPage() {
  const me = useMe();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, error, loading, reload } = useApi<Draft[]>("/v1/invoice-drafts");
  const act = useAction();
  const integrations = useApi<{ items: { key: string; label: string }[] }>("/v1/integrations");
  const liveReading = integrations.data?.items.find((i) => i.key === "extraction")?.label === "live";
  const canWrite = me.role !== "viewer";

  async function ingest(file: File, source: "web" | "whatsapp_demo") {
    const form = new FormData();
    form.append("file", file);
    form.append("source", source);
    const up = await api("/v1/uploads", { method: "POST", body: form });
    const draft = await post("/v1/invoice-drafts/extract", { upload_id: up.id });
    emitDemo("draft-created", { draftId: draft.id });
    router.push(`/bills/${draft.id}`);
  }

  async function sample() {
    const blob = await (await fetch("/fixtures/sample-handwritten-bill.png")).blob();
    await ingest(new File([blob], "whatsapp-bill-photo.png", { type: "image/png" }), "whatsapp_demo");
  }

  return (
    <>
      <PageHeader title="Bills" subtitle="Click a photo of the paper bill. You check it before it becomes an invoice." />
      <Segmented value="bills" options={[{ value: "bills", label: "Bill photos", href: "/bills" }, { value: "invoices", label: "Invoices", href: "/invoices" }]} />
      <div className="space-y-4">
        <Card title="Add a bill">
          {!canWrite ? (
            <Empty>View-only users cannot add bills.</Empty>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                aria-label="Bill photo or PDF"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) act.run("upload", () => ingest(f, "web"));
                  e.target.value = "";
                }}
              />
              <div className="grid gap-2">
                <Button busy={act.busy === "upload"} onClick={() => fileRef.current?.click()}>
                  Take photo or upload bill
                </Button>
                <Button variant="secondary" busy={act.busy === "sample"} onClick={() => act.run("sample", sample)}>
                  Try a sample WhatsApp bill
                </Button>
              </div>
              <p className="mt-2 text-xs leading-snug text-muted">Photo or PDF, up to 10 MB. The sample is a made-up handwritten bill, delivered like a WhatsApp photo.</p>
              {act.busy && <Loading label={liveReading ? "Gemini is reading the bill. This takes a moment" : "Preparing the sample draft"} />}
              {act.error && (
                <div className="mt-3">
                  <ErrorBox message={act.error} />
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Drafts and reviewed bills">
          {error && <ErrorBox message={error} onRetry={reload} />}
          {loading && !data && <Loading />}
          {data?.length === 0 && <Empty>No bills yet. Upload one to see the review step.</Empty>}
          <ul className="divide-y divide-line">
            {data?.map((d) => {
              const blocking = d.issues.filter((i) => i.severity === "blocking").length;
              return (
                <li key={d.id}>
                  <Link href={d.status === "approved" && d.invoice_id ? `/invoices/${d.invoice_id}` : `/bills/${d.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2.5 text-sm active:bg-brand-soft">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold">{d.payload.customer_name ?? "Buyer name not read"}</p>
                      <p className="text-xs text-muted">
                        {fmtDateTime(d.created_at)} · {d.upload.source === "web" ? "Uploaded" : "From WhatsApp"} · {d.extraction_source === "gemini" ? "read by Gemini" : d.extraction_source === "simulated" ? "sample draft" : "typed by hand"}
                        {d.status === "needs_review" && blocking > 0 && <span className="font-semibold text-rose-700"> · {blocking} to fix</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tabular text-base font-bold">{inr(d.payload.total_paise)}</span>
                      <Badge status={d.status} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
        {integrations.data && !liveReading ? (
          <Notice>
            <strong>Bill reading is simulated here.</strong> No Gemini key is set, so any photo you add gets the same fixed sample draft. The photo is stored but not read. You still check and approve before it becomes an invoice.
          </Notice>
        ) : (
          <Notice tone="blue">Gemini only prepares a draft. The app re-adds every line itself, and you fix anything missing before it becomes an invoice.</Notice>
        )}
      </div>
    </>
  );
}
