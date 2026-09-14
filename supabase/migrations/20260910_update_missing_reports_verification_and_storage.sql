-- Migration: 20260910_update_missing_reports_verification_and_storage.sql
-- Updates missing_reports columns for verification documents and storage rules

-- 1. Ensure verification document columns exist on missing_reports
ALTER TABLE public.missing_reports
    ADD COLUMN IF NOT EXISTS birth_certificate_url TEXT,
    ADD COLUMN IF NOT EXISTS family_photo_url TEXT,
    ADD COLUMN IF NOT EXISTS health_record_url TEXT,
    ADD COLUMN IF NOT EXISTS other_document_url TEXT;

-- 2. Ensure Storage bucket 'avatars' is configured for public read and report uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    true,
    10485760, -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf'];

-- 3. Storage Object RLS Policies
DROP POLICY IF EXISTS "Public and authenticated avatars read" ON storage.objects;
CREATE POLICY "Public and authenticated avatars read"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Allow uploads to avatars" ON storage.objects;
CREATE POLICY "Allow uploads to avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Allow updates to avatars" ON storage.objects;
CREATE POLICY "Allow updates to avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars');

-- 4. Ensure missing_reports RLS allows global visibility and inserts
ALTER TABLE public.missing_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Missing reports viewable by everyone" ON public.missing_reports;
CREATE POLICY "Missing reports viewable by everyone"
ON public.missing_reports FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Missing reports insertable by all" ON public.missing_reports;
CREATE POLICY "Missing reports insertable by all"
ON public.missing_reports FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Missing reports updatable by reporter" ON public.missing_reports;
CREATE POLICY "Missing reports updatable by reporter"
ON public.missing_reports FOR UPDATE
USING (auth.uid() = reporter_id OR reporter_id IS NULL);

-- 5. Indexes for fast sorting and querying
CREATE INDEX IF NOT EXISTS idx_missing_reports_created_desc ON public.missing_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_missing_reports_public_created ON public.missing_reports(is_public, created_at DESC);
