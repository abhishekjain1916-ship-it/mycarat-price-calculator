-- ── Fix rings style tags to match actual Shopify product `style:` tags ──────────
-- Catalog scan (2026-05-26, 304 ring products):
--   • Real tags use `couple-band` and `promise-ring` (seed had `couple` / `promise`).
--   • NO ring is tagged floral / geometric / heart (seed listed them → dead chips).
-- This aligns explore-tags output with real tags so every filter chip resolves
-- to actual results. Affects the listing filter bar, product-page explore, and
-- nav overlay (all read this table).

BEGIN;

-- Remove stale (renamed) and empty ring styles
DELETE FROM product_type_style_tags
WHERE product_type = 'rings'
  AND tag_value IN ('couple', 'promise', 'floral', 'geometric', 'heart');

-- Insert corrected ring styles (idempotent; refresh label if row already exists)
INSERT INTO product_type_style_tags (product_type, tag_value, display_label) VALUES
  ('rings', 'couple-band',  'Couple'),
  ('rings', 'promise-ring', 'Promise')
ON CONFLICT (product_type, tag_value)
  DO UPDATE SET display_label = EXCLUDED.display_label;

COMMIT;
