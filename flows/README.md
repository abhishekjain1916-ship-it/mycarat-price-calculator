# WhatsApp Flows + Templates — operational reference

This folder holds the **source-of-truth JSON** for our WhatsApp Flows. The deploy
to Meta is **manual** (one-time per Flow) — Meta does not yet support pushing
Flow JSON via webhook; you upload via Meta Business Manager → WhatsApp Manager
→ Flows → Create / Update.

## Flows

| File | Flow name | Flow ID | Used by |
|---|---|---|---|
| `mc_scheduling_v1.json` | `mc_scheduling_v1` | `1936816750291662` | Talk to expert · Talk to human · Off-hours fallback (universal scheduler) |
| `mc_profile_v1.json`    | `mc_profile_v1`    | `1296305858545931` | First-contact lead → claim set_1 + set_2 (50 GC) inside WhatsApp |

### ⚠ Annual maintenance — date range

Both Flows use hardcoded `min-date` / `max-date` on their DatePickers (Meta
requires literal `YYYY-MM-DD`, not relative strings):

- `mc_scheduling_v1.json` — DATE screen, range `2026-04-29 → 2027-04-30`. Bump
  yearly. Actual booking-window bounds (1h min, 15d max) are enforced
  server-side in `app/utils/wa-scheduler.server.js → normalizeScheduledAt`.
- `mc_profile_v1.json` — DETAILS screen has two DatePickers:
  - `date_of_birth`: `1926-04-29 → 2011-04-29` (age 15–100 window). Bump
    `max-date` yearly to keep "today minus 15 years."
  - `anniversary`: `1950-01-01 → 2026-04-29` (today). Bump `max-date` to
    today on each annual review.

Server-side validation in `api.whatsapp-webhook.jsx → handleProfileFlowCompletion`
re-checks ages and future-date rules, so the Flow's wide ranges are safe.

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

## Templates to register with Meta

### Scheduler (already approved)

| Name | Category | Body | Variables |
|---|---|---|---|
| `schedule_confirmed` | UTILITY | Hi {{1}}, your {{2}} is booked for {{3}}. We'll send a reminder 15 min before. | name, mode, datetime |
| `schedule_reminder`  | UTILITY | Hi {{1}}, just a heads-up — our chat is in 15 minutes ({{2}}). Talk soon! | name, datetime |

### GoldBack (Phase 2 — submit these next)

#### `goldback_welcome` · UTILITY · `en`

**Body** (2 vars: name, balance):
```
Welcome to MyCarat, {{1}} 🪙

We've added {{2}} Gold Coins to your wallet — your first
reward for saying hi.

What that means:
• 1 coin = 1 mg of fine gold
• Never expires, stacks across visits
• Redeemable on any future purchase

You can earn 50 more in the next 60 seconds by completing
your profile.
```

**Buttons** (2):
1. **Flow button** — label: `Earn +50 GC` · Flow: `mc_profile_v1` · CTA action: `navigate` → screen `HOOK`
2. **URL button** — label: `Open my wallet` · URL: `https://mycarat.in/pages/goldback-wallet` (static)

**Sample values for Meta review**: `{{1}}=Asha`, `{{2}}=10`

#### `goldback_credited` · UTILITY · `en`

**Body** (4 vars: name, coins_added, reason, balance):
```
{{1}}, wallet update 🪙

+{{2}} Gold Coins credited {{3}}.
Balance: {{4}} Gold Coins.

Each coin = 1 mg of fine gold. Never expires. Use it on
any purchase.
```

**Buttons** (1):
1. **URL button** — label: `Open my wallet` · URL: `https://mycarat.in/pages/goldback-wallet` (static)

**Sample values for Meta review**: `{{1}}=Asha`, `{{2}}=50`, `{{3}}=for completing your profile`, `{{4}}=60`

### Submission order

1. Register & publish Flow `mc_profile_v1` first → copy its Flow ID
2. Submit `goldback_welcome` template with the Flow button bound to that Flow ID
3. Submit `goldback_credited` template (no Flow dependency)
4. Once both templates show "Approved", set `WA_FLOW_ID_PROFILE` on Fly.io to the Flow ID
5. Replace `mycarat.in/pages/goldback-wallet` URL on the buttons if the live page
   handle changes

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
| `WA_FLOW_ID_PROFILE` | Flow ID for `mc_profile_v1` (set after publish in Meta WhatsApp Manager). Webhook detects profile-flow completions by `payload.flow === "mc_profile_v1"`, so this env var is only used if/when we add a code-driven Flow trigger (today the Flow opens directly via the `goldback_welcome` template's Flow button). |

## Admin endpoints quick reference

```
GET  /api/admin/schedules?status=pending&limit=50
       Header: X-Admin-Secret: <ADMIN_SECRET>

POST /api/admin/schedules/:id
       Header: X-Admin-Secret: <ADMIN_SECRET>
       Body:   { "status": "completed", "notes": "called via Zoom" }
```
