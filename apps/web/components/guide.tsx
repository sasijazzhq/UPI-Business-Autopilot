"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import { GuideState, resetDemo, useGuide, writeGuide } from "@/lib/demo";
import { useMe } from "./shell";
import { Button, TextAction } from "./ui";

interface Step {
  /** One short line that is always visible: what to do now. */
  title: string;
  /** Optional explanation, shown only when the judge opens "Why". */
  more: string;
  href: (g: GuideState) => string;
  /** The real action the step waits for; absent = an explain-only step with a Next button. */
  waitFor?: string;
  fill?: boolean;
}

const INV = "/invoices/inv_demo_0001";

function steps(simulatedReading: boolean): Step[] {
  return [
    { title: "Home: what is owed, received and promised", more: "Lakshmi sells to nearby shops on credit. Green is money that has really come in. Amber is only promised. The lines under the big number show how it moved today.", href: () => "/" },
    { title: "Tap “Try a sample WhatsApp bill”", more: "A made-up handwritten bill arrives, the way a merchant would forward a photo.", href: () => "/bills", waitFor: "draft-created" },
    simulatedReading
      ? { title: "Fix the sample draft, tick the box, approve", more: "No Gemini key is set, so this draft is a fixed sample and was not read from the photo. Two lines are wrong on purpose. Fix them yourself or use “Fill corrections”, then scroll down, tick the box and approve.", href: (g) => (g.draftId ? `/bills/${g.draftId}` : "/bills"), waitFor: "invoice-approved", fill: true }
      : { title: "Check the draft, tick the box, approve", more: "Gemini read the photo into a draft. The app re-adds every line; fix anything it flags (or use “Fill corrections”), then scroll down, tick the box and approve.", href: (g) => (g.draftId ? `/bills/${g.draftId}` : "/bills"), waitFor: "invoice-approved", fill: true },
    { title: "The bill is now an invoice: ₹5,300 due", more: "Nothing was posted until you approved. This new bill adds ₹5,300 to what customers owe.", href: (g) => (g.invoiceId ? `/invoices/${g.invoiceId}` : "/invoices") },
    { title: "Part payments: ₹20,000 bill, ₹5,000 left", more: "Murugan Stores paid ₹5,000 and then ₹10,000. Each verified payment is one line in the payment story.", href: () => INV },
    { title: "Tap “Receive”, tick the box, save", more: "A customer says they will pay ₹2,500 tomorrow. It is saved as a promise only; the amount to collect does not change.", href: () => "/conversations?customer=cus_anbu&say=Will%20pay%20%E2%82%B92%2C500%20by%20UPI%20tomorrow", waitFor: "promise-saved" },
    { title: "Type 5000 → Prepare → Approve → Customer pays", more: "Under “Send UPI request”. The owner approves the request, then a signed (simulated) provider payment closes the bill exactly once.", href: () => INV, waitFor: "payment-verified" },
    { title: "Home: ₹25,900 + ₹5,300 − ₹5,000 = ₹26,200", more: "Owed went up because a new ₹5,300 bill was added, and down by the ₹5,000 verified payment. Received today is now ₹15,000. The ₹2,500 promise changed nothing.", href: () => "/" },
  ];
}

const pathOf = (href: string) => href.split("?")[0];

/** Optional walkthrough for judges. It only points at the real screens and waits for the real,
 *  validated actions; it never performs a financial action itself. */
export function GuideBar() {
  const me = useMe();
  const guide = useGuide();
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(false);
  const integrations = useApi<{ items: { key: string; label: string }[] }>(guide.active ? "/v1/integrations" : null);
  const simulated = integrations.data?.items.find((i) => i.key === "extraction")?.label !== "live";
  const STEPS = steps(simulated);

  useEffect(() => setWhy(false), [guide.step]);
  useEffect(() => {
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent).detail as { name: string; draftId?: string; invoiceId?: string };
      const step = STEPS[guide.step];
      if (!guide.active || !step || step.waitFor !== d.name) return;
      writeGuide({ step: guide.step + 1, collapsed: false, ...(d.draftId ? { draftId: d.draftId } : {}), ...(d.invoiceId ? { invoiceId: d.invoiceId } : {}) });
    };
    window.addEventListener("demo-event", onEvent);
    return () => window.removeEventListener("demo-event", onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide]);

  if (!guide.active || !me.demo_mode) return null;
  const total = STEPS.length;
  const index = Math.min(guide.step, total - 1);
  const last = index === total - 1;
  const step = STEPS[index];
  const href = step.href(guide);
  const here = pathname === pathOf(href);
  const label = `Demo guide, step ${index + 1} of ${total}`;
  const restart = () => {
    setBusy(true);
    resetDemo(true).catch(() => setBusy(false));
  };

  if (guide.collapsed)
    return (
      <button onClick={() => writeGuide({ collapsed: false })} aria-label={`${label}. Show the guide`} className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-amber-300 bg-amber-50 px-4 text-left text-[13px] font-semibold text-amber-950">
        <span className="truncate">Guide {index + 1}/{total} · {step.title}</span>
        <span className="shrink-0 underline" aria-hidden>Show</span>
      </button>
    );

  return (
    <section aria-label={label} className="guide-in border-t border-amber-300 bg-amber-50 px-4 pb-1.5 pt-2 text-amber-950 shadow-[0_-6px_16px_-10px_rgb(27_36_32/0.35)]">
      <p className="flex items-center gap-2 text-xs font-bold text-amber-800">
        Step {index + 1} of {total}
        <span className="flex items-center gap-0.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full ${i < index ? "w-2 bg-brand" : i === index ? "w-4 bg-amber-600" : "w-2 bg-amber-200"}`} />
          ))}
        </span>
      </p>
      <h2 className="text-[15px] font-bold leading-snug" aria-live="polite">{step.title}</h2>
      {why && <p id="guide-why" className="mt-0.5 text-[13px] leading-snug">{step.more}</p>}
      <div className="mt-1 flex items-center">
        {!here ? (
          <Button className="!min-h-10" onClick={() => router.push(href)}>Take me there</Button>
        ) : last ? (
          <Button className="!min-h-10" busy={busy} onClick={restart}>Reset and run again</Button>
        ) : step.fill ? (
          <Button className="!min-h-10" onClick={() => window.dispatchEvent(new Event("demo-fill-review"))}>Fill corrections</Button>
        ) : step.waitFor ? (
          <span className="flex min-h-10 items-center gap-1.5 text-[13px] font-semibold text-amber-800">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-600" aria-hidden />
            Do it on this screen
          </span>
        ) : (
          <Button className="!min-h-10" onClick={() => writeGuide({ step: index + 1 })}>Next</Button>
        )}
        <span className="ml-auto flex">
          <TextAction tone="muted" className="!min-h-10" aria-expanded={why} aria-controls="guide-why" onClick={() => setWhy((w) => !w)}>{why ? "Less" : "Why"}</TextAction>
          {!last && (step.waitFor || !here) && <TextAction tone="muted" className="!min-h-10" onClick={() => writeGuide({ step: index + 1 })}>Skip</TextAction>}
          <TextAction tone="muted" className="!min-h-10" onClick={() => writeGuide({ collapsed: true })}>Hide</TextAction>
          <TextAction tone="muted" className="!min-h-10" onClick={() => writeGuide({ active: false })}>End</TextAction>
        </span>
      </div>
    </section>
  );
}
