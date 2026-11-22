"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { CANCELLED, api, getToken, post, setToken } from "@/lib/api";
import { DEMO_OWNER, resetDemo } from "@/lib/demo";
import { GuideBar } from "./guide";
import { Avatar, Badge, Button, DemoModeContext, ErrorBox, Loading } from "./ui";

export interface Me {
  user_id: string;
  name: string;
  role: "owner" | "staff" | "viewer";
  merchant_name: string;
  demo_mode: boolean;
  today: string;
}

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext) as Me;

const TABS = [
  { href: "/", label: "Home", match: ["/"], icon: "M3 11.5l9-7.5 9 7.5M5.5 10v10h13V10M10 20v-5h4v5" },
  { href: "/bills", label: "Bills", match: ["/bills", "/invoices"], icon: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3.5 5h5M9.5 12h5" },
  { href: "/conversations", label: "Promises", match: ["/conversations"], icon: "M4 5h16v11H10l-5 4v-4H4V5zm4.5 5.5l2.5 2.5 4.5-5" },
  { href: "/payments", label: "Payments", match: ["/payments"], icon: "M3 7h18v10H3V7zm0 4h18M7 15h3" },
  { href: "/more", label: "More", match: ["/more", "/customers", "/assistant", "/settings"], icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

/** Screens that sit on the chat wallpaper instead of the plain canvas. */
const CHAT_SCREENS = ["/conversations", "/assistant"];

function Login({ onDone }: { onDone: () => void }) {
  const [users, setUsers] = useState<{ user_id: string; name: string; role: string; merchant_name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    api("/v1/auth/demo-users").then(setUsers).catch((e) => setError(e.message));
  };
  useEffect(load, []);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  useEffect(() => {
    api("/v1/auth/demo-config").then((c) => setNeedsCode(!!c.access_code_required)).catch(() => {});
  }, []);
  const [starting, setStarting] = useState(false);
  const guided = async () => {
    setStarting(true);
    setError(null);
    try {
      const r = await post<{ token: string }>("/v1/auth/demo-login", { user_id: DEMO_OWNER, access_code: code || null });
      setToken(r.token, true);
      await resetDemo(true);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };
  return (
    <div className="scroll-area flex flex-1 flex-col overflow-y-auto">
      <div className="bg-brand px-6 pb-10 pt-[calc(3.5rem+env(safe-area-inset-top))] text-white">
        <p className="text-sm font-semibold text-white/80">Vanakkam</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight">UPI Business Autopilot</h1>
        <p className="mt-2 text-[15px] leading-snug text-white/85">Know who owes, who promised, and who has really paid.</p>
      </div>
      <div className="-mt-5 flex-1 rounded-t-3xl bg-canvas px-4 pt-5">
        {needsCode && (
          <label className="mb-4 block text-sm">
            <span className="mb-1 block font-semibold">Demo access code</span>
            <input className="min-h-11 w-full rounded-xl border border-line px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="none" placeholder="Shared by the presenter" />
          </label>
        )}
        {!!users?.length && (
          <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-base font-bold text-amber-950">New here? Take the 2-minute tour</p>
            <p className="mt-0.5 text-[13px] leading-snug text-amber-900">Paper bill to verified payment, step by step, in the real app. Starts from fresh sample data.</p>
            <Button className="mt-3 w-full" busy={starting} onClick={guided}>Try the guided demo</Button>
          </div>
        )}
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-muted">Or explore on your own as</h2>
        {error && <ErrorBox message={error} onRetry={load} />}
        {!users && !error && <Loading label="Loading users" />}
        {users?.length === 0 && (
          <p className="text-sm text-muted">
            No demo data yet. Run <code className="rounded bg-stone-200 px-1">python -m app.seed</code> in <code className="rounded bg-stone-200 px-1">services/api</code>, then reload.
          </p>
        )}
        <ul className="space-y-2">
          {users?.map((u) => (
            <li key={u.user_id}>
              <button
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white px-3 py-3 text-left active:bg-brand-soft"
                onClick={() =>
                  post("/v1/auth/demo-login", { user_id: u.user_id, access_code: code || null })
                    .then((r) => (setToken(r.token), onDone()))
                    .catch((e) => setError(e.message))
                }
              >
                <Avatar name={u.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{u.name}</span>
                  <span className="block truncate text-xs text-muted">{u.merchant_name}</span>
                </span>
                <Badge label={u.role} tone="gray" />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-xs leading-snug text-muted">Sign-in without a password exists only in demo mode. All payments here are simulated; no real money moves and nothing is sent to anyone.</p>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "anon" | "ready">("checking");
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  function check() {
    if (!getToken()) return setState("anon");
    api<Me>("/v1/me")
      .then((m) => (setMe(m), setError(null), setState("ready")))
      .catch((e) => e.status !== CANCELLED && (getToken() ? setError(e.message) : setState("anon")));
  }
  useEffect(() => {
    check();
    window.addEventListener("auth-changed", check);
    return () => window.removeEventListener("auth-changed", check);
  }, []);

  // Track the visual viewport so the app shrinks above the on-screen keyboard (iOS does not resize dvh).
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const phoneSized = window.innerWidth < 520;
      document.documentElement.style.setProperty("--app-h", phoneSized ? `${Math.round(vv.height)}px` : "");
      if (!phoneSized) document.documentElement.style.removeProperty("--app-h");
      setKeyboard(phoneSized && window.innerHeight - vv.height > 140);
      if (phoneSized && vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches?.("input:not([type=checkbox]):not([type=date]), textarea, select")) window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  const active = (t: (typeof TABS)[number]) => (t.href === "/" ? pathname === "/" : t.match.some((m) => pathname.startsWith(m)));
  const chat = CHAT_SCREENS.some((p) => pathname.startsWith(p));

  let body: React.ReactNode;
  if (state === "anon") body = <Login onDone={check} />;
  else if (state === "checking" || !me) body = <div className="flex-1 px-4 py-10">{error ? <ErrorBox message={error} onRetry={check} /> : <Loading />}</div>;
  else
    body = (
      <MeContext.Provider value={me}>
       <DemoModeContext.Provider value={me.demo_mode}>
        <header className="flex items-center gap-3 bg-brand px-4 pb-2.5 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-bold" aria-hidden>₹</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight">{me.merchant_name}</p>
            <p className="truncate text-xs leading-tight text-white/85">{me.demo_mode ? "Demo · simulated payments" : me.name}</p>
          </div>
          <Link href="/more" aria-label={`Signed in as ${me.name}`} className="flex min-h-9 items-center rounded-full bg-white/15 px-3 text-xs font-semibold capitalize">
            {me.role}
          </Link>
        </header>
        <main key={pathname} className={`scroll-area flex flex-1 flex-col overflow-y-auto overscroll-contain ${chat ? "wallpaper" : ""}`}>
          <div className="page-in flex flex-1 flex-col px-4 pb-6 pt-4">{children}</div>
        </main>
        {!keyboard && <GuideBar />}
        <nav className={`border-t border-line bg-white pb-[env(safe-area-inset-bottom)] ${keyboard ? "hidden" : "flex"}`} aria-label="Main">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={active(t) ? "page" : undefined} className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1.5 pt-1.5 text-xs ${active(t) ? "font-bold text-brand" : "font-medium text-muted"}`}>
              <span className={`flex h-7 w-14 items-center justify-center rounded-full ${active(t) ? "bg-brand-soft" : ""}`}>
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={active(t) ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={t.icon} />
                </svg>
              </span>
              {t.label}
            </Link>
          ))}
        </nav>
       </DemoModeContext.Provider>
      </MeContext.Provider>
    );

  return (
    <div className="stage">
      <div className="phone">{body}</div>
    </div>
  );
}
