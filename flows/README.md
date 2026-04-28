# WhatsApp Flows + Templates — operational reference

This folder holds the **source-of-truth JSON** for our WhatsApp Flows. The deploy
to Meta is **manual** (one-time per Flow) — Meta does not yet support pushing
Flow JSON via webhook; you upload via Meta Business Manager → WhatsApp Manager
→ Flows → Create / Update.

## Flows

| File | Flow name | Used by |
|---|---|---|
| `mc_scheduling_v1.json` | `mc_scheduling_v1` | Talk to expert · Talk to human · Off-hours fallback (universal scheduler) |

### How to register a Flow

1. Open Meta Business Manager → WhatsApp Manager → your WABA → **Flows**
2. **Create flow** → name = file basename (e.g. `mc_scheduling_v1`) → category `OTHER` (or `APPOINTMENT_BOOKING`)
3. Paste the JSON from this folder
4. **Save & test** in the preview panel
5. **Publish** when ready
6. Note the resulting **Flow ID** — you'll need it when sending the Flow trigger message

The webhook (`/api/whatsapp-webhook`) detects scheduling-flow completions by the
presence of `mode + date + time` in the response payload — so the Flow ID isn't
hard-coded server-side.

## Templates to register with Meta (for the scheduler)

| Name | Category | Body | Variables |
|---|---|---|---|
| `schedule_confirmed` | UTILITY | Hi {{1}}, your {{2}} is booked for {{3}}. We'll send a reminder 15 min before. | name, mode, datetime |
| `schedule_reminder`  | UTILITY | Hi {{1}}, just a heads-up — our chat is in 15 minutes ({{2}}). Talk soon! | name, datetime |

Submit these via Meta Business Manager → WhatsApp Manager → Message Templates.
Once both are approved, the scheduler is fully wired.

## Required env vars (set on Fly.io)

| Var | Purpose |
|---|---|
| `WA_ACCESS_TOKEN` | Meta WA API access token (existing) |
| `WA_PHONE_NUMBER_ID` | WA Business phone number ID (existing) |
| `WA_VERIFY_TOKEN` | Webhook verification handshake (existing) |
| `OPS_EMAIL_TO` | Email to receive new-schedule alerts (default: `mycarat.in@gmail.com`) |
| `RESEND_API_KEY` | Resend API key for ops email — optional, scheduler skips email if absent |
| `ADMIN_SECRET` | Shared secret for `GET/POST /api/admin/schedules*` (X-Admin-Secret header) |
| `CRON_SECRET` | Shared secret for `POST /api/cron/send-reminders` external triggers |

## Admin endpoints quick reference

```
GET  /api/admin/schedules?status=pending&limit=50
       Header: X-Admin-Secret: <ADMIN_SECRET>

POST /api/admin/schedules/:id
       Header: X-Admin-Secret: <ADMIN_SECRET>
       Body:   { "status": "completed", "notes": "called via Zoom" }
```
