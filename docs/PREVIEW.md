# Sharing a demo link safely

Nothing here has been deployed. These are the steps to run a shareable demo yourself. They were
written against the code in this branch; the tunnel/hosting commands themselves were not run.

## What must be true before you share a link

| Setting | Value | Why |
|---|---|---|
| `DEMO_MODE` | `true` | Enables the demo sign-in, simulator and reset. |
| `DEMO_ACCESS_CODE` | a code you choose | Demo sign-in has no passwords. Without a code, anyone with the link can sign in as the owner and reset the sample data. With it, sign-in is refused unless the code is typed. |
| `DEMO_WEBHOOK_SECRET` | a long random string | The default is public in this repo; anyone who knows it could post simulated payments. |
| Real keys (`RAZORPAY_*`, `WHATSAPP_*`, `ELEVENLABS_*`) | leave empty | A shared demo should not be able to reach real accounts. `GEMINI_API_KEY` is optional: without it bill reading is simulated and labelled so. |
| `OUTBOUND_POLICY_APPROVED` | `false` | Keeps customer messaging off. |
| Data | sample data only | The demo database is not for real customer data. |

Who can reset: only a signed-in **owner**, and only while `DEMO_MODE=true` (staff and view-only get
403; signed-out gets 401; with `DEMO_MODE=false` the endpoint does not exist). Reset restores the
seeded data and keeps everyone signed in.

## Option A: from your laptop with a tunnel (quickest)

Only the web app is exposed. The API listens on `127.0.0.1` and is reached through the web app's
`/api/*` proxy, so it is never directly on the internet.

```bash
cd services/api
export DEMO_MODE=true DEMO_ACCESS_CODE='choose-a-code' DEMO_WEBHOOK_SECRET="$(openssl rand -hex 32)"
python -m app.seed
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```bash
cd apps/web
npm run build
npm run start -- -p 3000
```

Then expose port 3000 with a tunnel you trust (for example Cloudflare Tunnel or ngrok) and share
that HTTPS URL plus the access code. Stop the tunnel when the session ends.

## Option B: one small server

Run the same two processes on one VM behind an HTTPS reverse proxy (Caddy or nginx) that forwards
everything to the web app on port 3000. Keep port 8000 closed to the internet. Set the same
environment variables as above. For PostgreSQL use `infra/docker-compose.yml` and `DATABASE_URL`.

If the web app and API must run on different hosts, set `API_URL` for the web app at build and
start time, and restrict the API host to accept traffic only from the web host.

## Before each judging session

1. Sign in as the owner and tap **More → Reset sample data only** (or start the guided demo, which resets first).
2. Check Home shows ₹25,900 owed.

## Known limits of a shared demo

- All visitors share one dataset; two people running the guide at once will see each other's changes.
- Uploaded files are stored unencrypted on the server's disk. There is no rate limiting.
- `/api/v1/webhooks/*` is reachable through the proxy; it accepts only correctly signed messages.
