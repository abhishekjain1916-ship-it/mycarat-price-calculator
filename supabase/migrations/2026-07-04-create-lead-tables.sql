-- ────────────────────────────────────────────────────────────────────────────
-- Split website lead-gen flows out of wa_schedules into their own tables.
--
-- wa_schedules keeps ONLY "Talk to Experts" (real appointment booking with a
-- user-picked time slot, reminders, confirmation template). The other three
-- website flows never had a real time slot — the server was synthesizing one
-- just to satisfy wa_schedules' scheduled_at NOT NULL + unique constraint —
-- so they get dedicated lead tables with no scheduled_at at all:
--
--   • boutique_visit_leads — "Visit Boutique" (mycarat-services.liquid)
--   • exchange_leads       — "Initiate Exchange" (mycarat-services.liquid +
--                             mycarat-goldback-featured.liquid) AND
--                             "Upload Design" (mycarat-services.liquid),
--                             distinguished by the `topic` column. Both are
--                             file-upload leads against the lead-uploads
--                             storage bucket.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boutique_visit_leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID,                                -- nullable; linked via wa_phone if known
  wa_phone          TEXT NOT NULL,                        -- E.164, e.g. +917987557543
  wa_name           TEXT,
  email             TEXT,
  visit_window      TEXT,                                 -- "Flexible — any time" / "This week" / "Next week" / "Weekend only"
  notes             TEXT,
  trigger_context   JSONB,                                 -- {page, menu_option, ...}

  channel           TEXT NOT NULL DEFAULT 'web'
    CHECK (channel IN ('whatsapp', 'web')),

  status            TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'completed', 'cancelled')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boutique_visit_leads_phone_idx      ON boutique_visit_leads (wa_phone);
CREATE INDEX IF NOT EXISTS boutique_visit_leads_status_idx     ON boutique_visit_leads (status);
CREATE INDEX IF NOT EXISTS boutique_visit_leads_created_at_idx ON boutique_visit_leads (created_at);
CREATE INDEX IF NOT EXISTS boutique_visit_leads_customer_idx   ON boutique_visit_leads (customer_id);

CREATE OR REPLACE FUNCTION boutique_visit_leads_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname  = 'boutique_visit_leads_updated_at_trg'
      AND tgrelid = 'boutique_visit_leads'::regclass
  ) THEN
    CREATE TRIGGER boutique_visit_leads_updated_at_trg
      BEFORE UPDATE ON boutique_visit_leads
      FOR EACH ROW
      EXECUTE FUNCTION boutique_visit_leads_set_updated_at();
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exchange_leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID,
  wa_phone          TEXT NOT NULL,
  wa_name           TEXT,
  email             TEXT,

  topic             TEXT NOT NULL
    CHECK (topic IN ('Initiate Exchange', 'Upload Design')),

  notes             TEXT,                                  -- free-text description of the piece/design
  file_url          TEXT,                                   -- public Supabase Storage URL (lead-uploads bucket)
  trigger_context   JSONB,

  channel           TEXT NOT NULL DEFAULT 'web'
    CHECK (channel IN ('whatsapp', 'web')),

  status            TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'completed', 'cancelled')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exchange_leads_phone_idx      ON exchange_leads (wa_phone);
CREATE INDEX IF NOT EXISTS exchange_leads_topic_idx      ON exchange_leads (topic);
CREATE INDEX IF NOT EXISTS exchange_leads_status_idx     ON exchange_leads (status);
CREATE INDEX IF NOT EXISTS exchange_leads_created_at_idx ON exchange_leads (created_at);
CREATE INDEX IF NOT EXISTS exchange_leads_customer_idx   ON exchange_leads (customer_id);

CREATE OR REPLACE FUNCTION exchange_leads_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname  = 'exchange_leads_updated_at_trg'
      AND tgrelid = 'exchange_leads'::regclass
  ) THEN
    CREATE TRIGGER exchange_leads_updated_at_trg
      BEFORE UPDATE ON exchange_leads
      FOR EACH ROW
      EXECUTE FUNCTION exchange_leads_set_updated_at();
  END IF;
END $$;
