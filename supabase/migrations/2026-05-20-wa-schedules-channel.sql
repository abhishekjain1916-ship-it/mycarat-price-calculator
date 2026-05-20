-- ────────────────────────────────────────────────────────────────────────────
-- Add `channel` to wa_schedules so we can distinguish WhatsApp-Flow bookings
-- from website-form bookings. Existing rows default to 'whatsapp'.
--
-- customer_id already exists on wa_schedules (added in 2026-04-28 migration).
-- Website API will set it directly from the Supabase auth session when
-- the user is logged in; WhatsApp path keeps using phone-lookup.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE wa_schedules
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'web'));

CREATE INDEX IF NOT EXISTS wa_schedules_channel_idx ON wa_schedules (channel);
