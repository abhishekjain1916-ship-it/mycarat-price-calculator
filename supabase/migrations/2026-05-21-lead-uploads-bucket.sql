-- Lead uploads bucket — used by Initiate Exchange + Upload Design website workflows.
-- Public-read so the admin can view URLs straight from wa_schedules.notes;
-- anon-insert so the storefront form (which doesn't have a session) can upload.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lead-uploads',
  'lead-uploads',
  true,
  10485760,  -- 10 MB
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Insert: anon + authenticated can upload to this bucket only.
CREATE POLICY "lead_uploads_insert_anon"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'lead-uploads');

-- Select: public read, so the URL is shareable to the rep.
CREATE POLICY "lead_uploads_select_public"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'lead-uploads');
