-- ────────────────────────────────────────────────────────────────────────────
-- WhatsApp scheduler — captures user-requested call/chat slots from the
-- mc_scheduling_v1 Flow, plus reminder dispatch state.
--
-- Decisions captured in project_whatsapp_brainstorm.md:
--   • 30-min slots within 11am–9pm IST
--   • All 7 days
--   • Min 1h lead, max 15 days lead
--   • Auto-shift off-hours bookings to next 11:00 IST window
--   • Reminder fires 15 min before scheduled_at
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wa_schedules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID,                                -- nullable; linked via wa_phone if known
  wa_phone              TEXT NOT NULL,                       -- E.164, e.g. +917987557543
  wa_name               TEXT,
  trigger_context       JSONB,                               -- {page, menu_option, product_id, ...}

  preferred_mode        TEXT NOT NULL
    CHECK (preferred_mode IN ('text','call','zoom','facetime','wa_video')),

  scheduled_at          TIMESTAMPTZ NOT NULL,                -- absolute UTC
  notes                 TEXT,

  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','completed','no_show','cancelled')),

  reminder_sent_at      TIMESTAMPTZ,                         -- set when 15-min reminder fires
  confirmation_sent_at  TIMESTAMPTZ,                         -- set when initial confirmation sent

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_schedules_phone_idx        ON wa_schedules (wa_phone);
CREATE INDEX IF NOT EXISTS wa_schedules_scheduled_at_idx ON wa_schedules (scheduled_at);
CREATE INDEX IF NOT EXISTS wa_schedules_status_idx       ON wa_schedules (status);
CREATE INDEX IF NOT EXISTS wa_schedules_customer_idx     ON wa_schedules (customer_id);

-- Prevent duplicate active bookings at the same time for the same phone
CREATE UNIQUE INDEX IF NOT EXISTS wa_schedules_no_dup_active_idx
  ON wa_schedules (wa_phone, scheduled_at)
  WHERE status IN ('pending','confirmed');

-- updated_at maintenance trigger
-- Function uses a uniquely-scoped name so we own it; CREATE OR REPLACE is safe.
CREATE OR REPLACE FUNCTION wa_schedules_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotent trigger creation — additive only, no DROP.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname  = 'wa_schedules_updated_at_trg'
      AND tgrelid = 'wa_schedules'::regclass
  ) THEN
    CREATE TRIGGER wa_schedules_updated_at_trg
      BEFORE UPDATE ON wa_schedules
      FOR EACH ROW
      EXECUTE FUNCTION wa_schedules_set_updated_at();
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- pg_cron-based reminder scheduler (optional — enable manually in Supabase
-- Dashboard → SQL Editor if pg_cron + pg_net extensions are available).
--
-- The reminder dispatch endpoint is /api/cron/send-reminders on the price-calc
-- Fly app. Calling it every minute is sufficient.
--
-- Example setup (run once, replace SECRET):
--
--   SELECT cron.schedule(
--     'wa-reminders-every-minute',
--     '* * * * *',
--     $$ SELECT net.http_post(
--          url     := 'https://mycarat-price-calc.fly.dev/api/cron/send-reminders',
--          headers := '{"X-Cron-Secret": "SECRET", "Content-Type": "application/json"}'::jsonb,
--          body    := '{}'::jsonb
--        );
--     $$
--   );
--
-- Alternative: any external cron service (cron-job.org, GitHub Actions, etc.)
-- hitting the same endpoint at 1-min cadence with the same X-Cron-Secret header.
-- ────────────────────────────────────────────────────────────────────────────
