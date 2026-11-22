"use client";
import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/shell";
import { Avatar, Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, inputCls, useAction } from "@/components/ui";
import { inr, post, useApi } from "@/lib/api";
import type { Customer } from "@/lib/types";

export default function CustomersPage() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<Customer[]>("/v1/customers");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const act = useAction();
  return (
    <>
      <PageHeader back={{ href: "/more", label: "More" }} title="Customers" subtitle="What each shop owes, and what they have said they will pay." action={me.role !== "viewer" && !adding ? <Button onClick={() => setAdding(true)}>Add customer</Button> : undefined} />
      <div className="space-y-4">
        {adding && (
          <Card title="New customer">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                act.run("add", async () => (await post("/v1/customers", { name, phone: phone || null }), setAdding(false), setName(""), setPhone(""), reload()));
              }}
            >
              <Field label="Shop name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
              <Field label="Phone (optional)"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
              <div className="flex gap-2">
                <Button type="submit" busy={!!act.busy} disabled={!name.trim()}>Save</Button>
                <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
              {act.error && <div className=""><ErrorBox message={act.error} /></div>}
            </form>
          </Card>
        )}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data && <Loading />}
        {data?.length === 0 && <Empty>No customers yet.</Empty>}
        <ul className="overflow-hidden rounded-2xl border border-line bg-white">
          {data?.map((c) => (
            <li key={c.id} className="border-b border-line last:border-0">
              <Link href={`/customers/${c.id}`} className="flex items-center gap-3 px-3 py-3 active:bg-brand-soft">
                <Avatar name={c.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{c.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {c.promised_open_paise > 0 ? `Promised ${inr(c.promised_open_paise)}` : "No promise yet"} · {c.preferred_method ? `prefers ${c.preferred_method.toUpperCase()}` : "preference not stated"}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block text-base font-bold">{inr(c.outstanding_paise)}</span>
                  <span className="block text-xs text-muted">to collect</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
