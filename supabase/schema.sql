-- ─────────────────────────────────────────────────────────────────────────────
-- MyCarat — Supabase Schema
-- Last updated: 2026-04-11
--
-- Run this file on a fresh Supabase project to recreate the full schema.
-- Never edit this file directly — add a new migration file in migrations/
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Price override tables ─────────────────────────────────────────────────────

create table if not exists gold_prices (
  id          uuid primary key default gen_random_uuid(),
  karat       text not null,           -- e.g. '18k', '22k'
  price_per_gram numeric(10,2) not null,
  updated_at  timestamptz default now()
);

create table if not exists product_specs (
  id                  uuid primary key default gen_random_uuid(),
  shopify_product_id  text not null unique,
  product_handle      text,
  product_type        text,
  gold_weight_grams   numeric(8,3),
  gold_karat          text,
  diamond_weight_ct   numeric(8,3),
  making_charges      numeric(10,2),
  other_charges       numeric(10,2),
  last_synced_at      timestamptz,
  created_at          timestamptz default now()
);

create table if not exists price_cache (
  id                  uuid primary key default gen_random_uuid(),
  shopify_product_id  text not null unique,
  calculated_price    numeric(10,2),
  gold_price_used     numeric(10,2),
  calculated_at       timestamptz default now()
);

create table if not exists recalc_jobs (
  id          uuid primary key default gen_random_uuid(),
  status      text default 'pending',  -- pending | processing | done | failed
  triggered_by text,
  created_at  timestamptz default now(),
  completed_at timestamptz
);


-- ── WhatsApp tables ───────────────────────────────────────────────────────────

create table if not exists wa_conversations (
  id              uuid primary key default gen_random_uuid(),
  wa_number       text not null unique,
  display_name    text,
  last_message_at timestamptz,
  created_at      timestamptz default now()
);

create table if not exists wa_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references wa_conversations(id) on delete cascade,
  wa_message_id   text unique,
  direction       text check (direction in ('inbound', 'outbound')),
  message_type    text,
  body            text,
  metadata        jsonb,
  created_at      timestamptz default now()
);

create table if not exists wa_leads (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references wa_conversations(id) on delete cascade,
  wa_number       text not null,
  flow_id         text,
  category        text,
  occasions       text,
  budget          text,
  diamond_style   text,
  free_text       text,
  lead_score      integer default 0,
  agent_followup  boolean default false,
  raw_payload     jsonb,
  created_at      timestamptz default now()
);
