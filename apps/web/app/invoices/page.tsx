"use client";
import Link from "next/link";
import { Avatar, Badge, Empty, ErrorBox, Loading, PageHeader, Segmented } from "@/components/ui";
import { fmtDate, inr, useApi } from "@/lib/api";
import type { Invoice } from "@/lib/types";

export default function InvoicesPage() {
  const { data, error, loading, reload } = useApi<Invoice[]>("/v1/invoices");
  return (
    <>
      <PageHeader title="Invoices" subtitle="Balance moves only when money is confirmed." />
      <Segmented value="invoices" options={[{ value: "bills", label: "Bill photos", href: "/bills" }, { value: "invoices", label: "Invoices", href: "/invoices" }]} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.length === 0 && <Empty>No invoices yet. Approve a bill to create the first one.</Empty>}
      <ul className="space-y-2">
        {data?.map((i) => (
          <li key={i.id}>
            <Link href={`/invoices/${i.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3 active:bg-brand-soft">
              <Avatar name={i.customer_name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{i.customer_name}</span>
                <span className="block text-xs text-muted">{i.number} · {fmtDate(i.invoice_date)}</span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-stone-100">
                  <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${(i.allocated_paise / Math.max(i.total_paise, 1)) * 100}%` }} />
                </span>
              </span>
              <span className="text-right">
                <span className="tabular block text-base font-bold">{inr(i.due_paise)}</span>
                <span className="block text-xs text-muted">due of {inr(i.total_paise)}</span>
                <Badge status={i.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
