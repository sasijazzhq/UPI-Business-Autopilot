# UPI Business Autopilot

Sales-to-payment coordination for Indian wholesalers and distributors: photograph a paper bill,
approve the invoice, track part payments and customer promises, and see what cash is **actually
confirmed** versus merely expected. Not lending, not debt recovery.

> **Demo mode is the default.** With no API keys, payments come from a simulated provider, bill
> extraction returns a labelled sample draft, and customer messages stay in a local inbox simulator.
> No real money moves and nothing is sent to anyone. The UI labels all of it "Simulated".

## Run it locally

Needs Python 3.11+ and Node 20+.

```bash
# 1. API (http://localhost:8000, docs at /docs)
cd services/api
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m app.seed              # applies migrations, loads demo data
uvicorn app.main:app --reload --port 8000
```

```bash
# 2. Web (http://localhost:3000)
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000 and pick a demo user (owner, staff, view-only, or the owner of a second
merchant to see tenant isolation). `python -m app.seed --reset` or Settings → Reset demo data
restores the sample data.

Optional: `cp .env.example .env` and fill in keys; `pip install -r requirements-integrations.txt`
for the Gemini / Razorpay / ElevenLabs SDKs. For PostgreSQL, start `infra/docker-compose.yml` and
set `DATABASE_URL`.

## One mobile app, everywhere

There is a single mobile layout. On a phone it runs full screen. On a laptop the same running app
sits in a centred, phone-sized viewport on a chat-wallpaper stage, so a projected demo still looks
like a phone app. No desktop layout, sidebar or data tables exist. Tabs: Home, Bills, Promises,
Payments, More (Customers, Invoices, Assistant, Settings).

## Tests

```bash
cd services/api && pytest
```

30 tests cover: the ₹20,000 → ₹5,000 → ₹10,000 → ₹5,000-remaining → closed scenario, duplicate and
out-of-order webhooks, forged/tampered signatures, overpayment, over-allocation, unverified
receipts, disputes and refunds, multi-tenant isolation, role checks, upload → review → approve,
the day-movement breakdown, reset access and session survival, the demo access code, promise parsing ("₹3,000 on Friday, ₹2,000 on Monday" → two promises, zero receipts), the daily
report, the assistant, outbound gating, the WhatsApp webhook and migration/model parity.
To run them on PostgreSQL: `TEST_DATABASE_URL=postgresql+psycopg://... pytest` (after
`alembic upgrade head` against that database).

## Guided demo for judges

On the sign-in screen tap **Try the guided demo** (or Home → **Try the demo**, or More → Guided demo).
A compact bar shows the current step and one action; "Why" opens a short explanation. Eight steps,
all in the real app:

Home → sample handwritten bill → draft review → approved invoice → part payments → a customer promise →
verified payment → updated Home.

- The guide only points and waits. Every step is completed by the real action and all the usual
  checks apply (a bill cannot be approved until its numbers add up and warnings are ticked; only
  an owner can approve a UPI request; only a signed provider message changes a balance).
- Without a Gemini key the bill draft is a fixed sample, **not read from the photo**. The app says
  so on the Bills screen, on the draft and in the guide.
- Hide, Skip or End at any time; the tabs keep working while it is open.
- Starting or restarting restores the seeded sample data and keeps you signed in. More →
  **Reset sample data only** does the same without the guide. Owner role and `DEMO_MODE=true` required.

### Why "owed" goes up during the demo

Home shows how the number moved, so the rise is expected, not a bug:

| | Start of guide | End of guide |
|---|---|---|
| Owed this morning | ₹35,900 | ₹35,900 |
| + New bills today | ₹0 | ₹5,300 (the sample bill you approved) |
| − Verified payments | ₹10,000 | ₹15,000 (adds the ₹5,000 UPI payment) |
| = Still owed now | **₹25,900** | **₹26,200** |

The ₹2,500 promise recorded in step 6 changes none of these.

Sharing a demo link: see [`docs/PREVIEW.md`](docs/PREVIEW.md). Screenshots: `docs/screenshots/`.

## What is live, test mode or simulated

| Integration | Without keys | With keys | Verified in this build |
|---|---|---|---|
| Payments | Demo provider, **simulated**, signed webhooks | Razorpay **test mode** (`rzp_test_` only) | Demo: yes. Razorpay: code path only, never run against an account |
| Bill extraction | **Simulated** fixed sample (does not read your file) | Gemini via `google-genai` | Simulated: yes. Gemini: not run |
| Assistant | Rule-based routing over read-only tools | Gemini chooses the tool; numbers still come from the ledger | Rules: yes. Gemini: not run |
| Voice | Browser speech over the text assistant | ElevenLabs agent via signed URL + `/v1/voice-tools/*` | Browser: yes. ElevenLabs: not run |
| WhatsApp inbound | Inbox simulator | Meta Cloud API webhook (signature-checked) | Webhook parsing tested with signed fixtures; media download not run |
| WhatsApp outbound / AI calls | **Not built** | **Not built** | Gate tested; no send code exists |

## Rules the code enforces

- Money is integer paise. Invoice due is always `total − Σ allocations`; there is no stored balance.
- Allocations and audit events are immutable; refunds and disputes are compensating entries.
- Only a signed provider event, or an owner's confirmation of a manual receipt, changes a balance.
  Provider-verified, merchant-confirmed, unverified, disputed and promised amounts are never summed together.
- Webhooks: raw-body HMAC (constant-time), `unique(provider, event_id)`, account → merchant
  ownership, INR only, amount checks, row locks, no state regression on late events.
- AI never posts to the ledger: extraction yields a draft, the assistant is read-only.
- Outbound customer messages need merchant approval and a recorded opt-in; overdue/collection
  reminders are refused on every channel.

## Layout

```
apps/web/              Next.js + Tailwind frontend (proxies /api/* to the API)
services/api/app/      FastAPI routes, auth, tenancy, models, seed
services/api/domain/   ledger, reconciliation, extraction review, reports, assistant, policy
services/api/adapters/ demo + real provider adapters (payments, Gemini, WhatsApp, voice)
services/api/workers/  extraction and WhatsApp media jobs
services/api/migrations/  Alembic
docs/                  architecture and research notes
fixtures/              fictional sample bill
```

## Known gaps

- `AGENTS.md`, `docs/PRODUCT_SPEC.md`, `INTEGRATIONS_AND_COMPLIANCE.md`, `MVP_ROADMAP.md`,
  `TEST_PLAN.md` and `schemas/core.sql` were referenced by the brief but not supplied; this build
  follows `SKILL.md`, `BUILD_PROMPT.md`, `docs/ARCHITECTURE.md` and `docs/RESEARCH_GITHUB.md`.
- Auth is demo-only passwordless login (disabled when `DEMO_MODE=false`); there is no production sign-in.
- Uploads are stored unencrypted on local disk. No rate limiting, PII encryption or retention jobs yet.
- `google-adk` is not used; the assistant is a deterministic tool router. Voice-note intake is not built.
- Razorpay correlation relies on the payment carrying the link's `notes.payment_request_id`;
  confirm this in a test account before relying on it. Partial refunds are flagged, not auto-posted.
