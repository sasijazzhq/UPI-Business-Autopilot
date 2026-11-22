"use client";
import { useMe } from "@/components/shell";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, useAction } from "@/components/ui";
import { setToken, useApi } from "@/lib/api";
import { resetDemo } from "@/lib/demo";

interface Integration {
  key: string;
  name: string;
  label: string;
  active: boolean;
  detail: string;
}

export default function SettingsPage() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<{ items: Integration[] }>("/v1/integrations");
  const act = useAction();
  return (
    <>
      <PageHeader back={{ href: "/more", label: "More" }} title="Settings" subtitle="Every connection is labelled live, test mode or simulated." />
      <div className="space-y-4">
        <Card title="Integrations">
          {error && <ErrorBox message={error} onRetry={reload} />}
          {loading && !data && <Loading />}
          <ul className="divide-y divide-line">
            {data?.items.map((i) => (
              <li key={i.key} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className={`font-medium ${i.active ? "" : "text-muted"}`}>{i.name}</p>
                  <p className="text-xs text-muted">{i.detail}</p>
                </div>
                <Badge status={i.label} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Credentials are read from server environment variables only. See <code>.env.example</code>.</p>
        </Card>

        <Card title="Safety rules built into this app">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>This is sales payment coordination, not lending or debt recovery.</li>
            <li>No overdue or collection reminders are sent on WhatsApp. Outbound customer messaging and AI calling are off.</li>
            <li>Nothing reaches a customer without your approval and their recorded opt-in. Opt-outs are honoured.</li>
            <li>Never ask a customer for a UPI PIN, OTP or password. This app never collects them.</li>
            <li>Screenshots, bank SMS and verbal claims are not proof of payment.</li>
            <li>Bill extraction and the assistant cannot change the ledger. Only approved actions and signed provider events can.</li>
          </ul>
        </Card>

        <Card title="Account">
          <p className="text-sm"><span className="font-medium">{me.name}</span> · {me.merchant_name} · <Badge label={me.role} tone="gray" /></p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setToken(null)}>Switch user</Button>
            {me.demo_mode && me.role === "owner" && (
              <Button
                variant="danger"
                busy={act.busy === "reset"}
                onClick={() => window.confirm("Erase everything and restore the sample data for all demo merchants?") && act.run("reset", () => resetDemo(false))}
              >
                Reset sample data
              </Button>
            )}
          </div>
          {act.error && <div className="mt-3"><ErrorBox message={act.error} /></div>}
        </Card>
      </div>
    </>
  );
}
