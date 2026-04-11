-- ── product_type_style_tags ──────────────────────────────────────────────────
-- Source of truth for style tags per jewellery type.
-- Auto-updated via Shopify products/create + products/update webhooks.
-- Used by: explore section (product page), navigation overlay, any future menus.

CREATE TABLE IF NOT EXISTS product_type_style_tags (
  id            SERIAL PRIMARY KEY,
  product_type  TEXT NOT NULL,      -- lowercase, matches Shopify product_type e.g. "rings"
  tag_value     TEXT NOT NULL,      -- e.g. "halo", "half-eternity"
  display_label TEXT NOT NULL,      -- e.g. "Halo", "Half Eternity"
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_type, tag_value)
);

-- Seed with current known tags (derived from nav-overlay.liquid schema)
INSERT INTO product_type_style_tags (product_type, tag_value, display_label) VALUES
-- Rings
('rings', 'solitaire',     'Solitaire'),
('rings', 'halo',          'Halo'),
('rings', 'eternity',      'Eternity'),
('rings', 'half-eternity', 'Half Eternity'),
('rings', 'cluster',       'Cluster'),
('rings', 'band',          'Band'),
('rings', 'cocktail',      'Cocktail'),
('rings', 'statement',     'Statement'),
('rings', 'engagement',    'Engagement'),
('rings', 'promise',       'Promise'),
('rings', 'couple',        'Couple'),
('rings', 'stackable',     'Stackable'),
('rings', 'floral',        'Floral'),
('rings', 'heart',         'Heart'),
('rings', 'geometric',     'Geometric'),
-- Earrings
('earrings', 'stud',      'Stud'),
('earrings', 'drop',      'Drop'),
('earrings', 'hoop',      'Hoop'),
('earrings', 'dangler',   'Dangler'),
('earrings', 'huggie',    'Huggie'),
('earrings', 'cluster',   'Cluster'),
('earrings', 'solitaire', 'Solitaire'),
('earrings', 'floral',    'Floral'),
-- Pendants
('pendants', 'solitaire', 'Solitaire'),
('pendants', 'halo',      'Halo')
ON CONFLICT (product_type, tag_value) DO NOTHING;
