"use client";
import { useEffect, useRef, useState } from "react";
import { api, post } from "@/lib/api";
import { ErrorBox } from "./ui";

const SUGGESTIONS = ["Who agreed to pay today?", "How much did Murugan Stores pay?", "What is my confirmed cash in?"];

interface Answer {
  answer: string;
  tool: string | null;
  routed_by: string;
  evidence: Record<string, unknown>;
}

interface Turn {
  question: string;
  answer?: Answer;
}

interface VoiceSession {
  signed_url: string | null;
}

/** Read-only merchant assistant as a chat: type, speak (browser speech), or an ElevenLabs agent when configured. */
export function Assistant() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [voice, setVoice] = useState<VoiceSession | null>(null);
  const [live, setLive] = useState<{ status: string; lines: string[] } | null>(null);
  const liveRef = useRef<{ endSession: () => Promise<void> } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [canListen, setCanListen] = useState(false);

  useEffect(() => {
    setCanListen("webkitSpeechRecognition" in window || "SpeechRecognition" in window);
    api<VoiceSession>("/v1/voice/session").then(setVoice).catch(() => setVoice(null));
    return () => {
      liveRef.current?.endSession().catch(() => {});
      window.speechSynthesis?.cancel();
    };
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, live]);

  async function ask(q: string, readAloud = speak) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    setTurns((t) => [...t, { question: q }]);
    try {
      const a = await post<Answer>("/v1/assistant/ask", { question: q });
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer: a } : turn)));
      if (readAloud && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(a.answer.replaceAll("₹", "rupees "));
        u.lang = "en-IN";
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
    } catch (e) {
      setTurns((t) => t.slice(0, -1));
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function listen() {
    const w = window as unknown as Record<string, any>;
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Rec) return;
    const rec = new Rec();
    rec.lang = "en-IN";
    rec.onresult = (e: any) => {
      setSpeak(true);
      ask(e.results[0][0].transcript as string, true);
    };
    rec.onerror = () => setError("Could not hear that. Check microphone permission, or type your question.");
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  async function toggleLive() {
    if (liveRef.current) {
      await liveRef.current.endSession().catch(() => {});
      liveRef.current = null;
      return setLive(null);
    }
    if (!voice?.signed_url) return;
    setLive({ status: "Connecting", lines: [] });
    try {
      const { Conversation } = await import("@elevenlabs/client");
      liveRef.current = await Conversation.startSession({
        signedUrl: voice.signed_url,
        onMessage: (m: { message: string; source?: string }) =>
          setLive((l) => l && { ...l, lines: [...l.lines.slice(-5), `${m.source === "user" ? "You" : "Agent"}: ${m.message}`] }),
        onError: (message: string) => setError(`Voice agent: ${message}`),
        onDisconnect: () => ((liveRef.current = null), setLive(null)),
      });
      setLive((l) => l && { ...l, status: "Listening" });
    } catch (e) {
      setLive(null);
      setError(`Could not start the voice agent: ${(e as Error).message}`);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto mb-3 rounded-lg bg-amber-100/90 px-3 py-1.5 text-center text-xs leading-snug text-amber-950 shadow-sm">
        Read-only helper. It reads your ledger and cannot change anything. Every number comes from recorded entries.
      </div>

      <div className="flex-1 space-y-2">
        <Bubble side="in">Ask me about pending money, today&apos;s promises or what has really come in.</Bubble>
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <Bubble side="out">{t.question}</Bubble>
            {t.answer ? (
              <Bubble side="in">
                {t.answer.answer}
                <details className="mt-1.5 text-xs text-muted">
                  <summary className="flex min-h-9 cursor-pointer items-center font-semibold text-brand">Show proof</summary>
                  <p className="mt-1">{t.answer.tool ? `Ledger tool: ${t.answer.tool}` : "No ledger tool matched"} · routed by {t.answer.routed_by}</p>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-stone-50 p-2 text-xs leading-snug text-ink">{JSON.stringify(t.answer.evidence, null, 2)}</pre>
                </details>
              </Bubble>
            ) : (
              <Bubble side="in"><span className="text-muted">Checking the ledger…</span></Bubble>
            )}
          </div>
        ))}
        {live?.lines.map((l, i) => <Bubble key={`l${i}`} side={l.startsWith("You") ? "out" : "in"}>{l}</Bubble>)}
        {error && <ErrorBox message={error} />}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 -mx-4 -mb-6 mt-3 space-y-1.5 border-t border-line/70 bg-[#efe8da]/95 px-3 pb-2 pt-2 backdrop-blur">
        <div className="scroll-area flex gap-1.5 overflow-x-auto">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="min-h-11 shrink-0 rounded-full border border-brand/25 bg-white px-3.5 text-[13px] font-semibold text-brand active:bg-brand-soft">
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <input className="min-h-11 min-w-0 flex-1 rounded-full border border-line px-4 text-base outline-none focus:border-brand" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask in plain words" aria-label="Question" maxLength={500} />
          {question.trim() || !canListen ? (
            <RoundButton label="Send" disabled={busy || !question.trim()} d="M4 12l16-8-6 16-2.5-6.5L4 12z" />
          ) : (
            <RoundButton label={listening ? "Listening" : "Speak your question"} type="button" onClick={listen} pulse={listening} d="M12 4a3 3 0 013 3v4a3 3 0 01-6 0V7a3 3 0 013-3zm-6 7a6 6 0 0012 0M12 17v3" />
          )}
        </form>
        <div className="flex flex-wrap items-center justify-between gap-x-3 px-1 text-xs text-muted">
          <label className="flex min-h-9 items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-[#0a6b4d]" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Read answers aloud
          </label>
          {voice?.signed_url ? (
            <button className="font-semibold text-brand underline" onClick={toggleLive}>
              {live ? `End voice agent (${live.status})` : "Talk to ElevenLabs voice agent"}
            </button>
          ) : (
            <span>Voice uses this phone&apos;s own speech</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: "in" | "out"; children: React.ReactNode }) {
  return (
    <div className={`flex ${side === "out" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[86%] px-3 py-2 text-[14px] leading-snug shadow-sm ${side === "out" ? "rounded-2xl rounded-tr-md bg-bubble" : "rounded-2xl rounded-tl-md bg-white"}`}>{children}</div>
    </div>
  );
}

function RoundButton({ label, d, pulse, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; d: string; pulse?: boolean }) {
  return (
    <button {...rest} aria-label={label} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-45 ${pulse ? "animate-pulse" : ""}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
    </button>
  );
}
