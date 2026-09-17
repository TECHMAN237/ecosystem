-- Migration: 20260911_update_found_reports_schema_and_policies.sql
-- Synchronizes found_reports schema, storage policies, and RLS with the proven missing_reports architecture

-- 1. Ensure required columns on found_reports table
ALTER TABLE public.found_reports
    ADD COLUMN IF NOT EXISTS child_full_name TEXT DEFAULT 'Enfant trouvé',
    ADD COLUMN IF NOT EXISTS child_gender TEXT,
    ADD COLUMN IF NOT EXISTS estimated_age INTEGER,
    ADD COLUMN IF NOT EXISTS found_location TEXT,
    ADD COLUMN IF NOT EXISTS found_date DATE DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS found_time TIME DEFAULT CURRENT_TIME,
    ADD COLUMN IF NOT EXISTS physical_description TEXT,
    ADD COLUMN IF NOT EXISTS clothing_description TEXT,
    ADD COLUMN IF NOT EXISTS current_safe_location TEXT,
    ADD COLUMN IF NOT EXISTS current_location_of_child TEXT,
    ADD COLUMN IF NOT EXISTS circumstances_description TEXT,
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS child_photo_url TEXT,
    ADD COLUMN IF NOT EXISTS additional_photos JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS admin_notes TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Published',
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Ensure Storage bucket 'found-reports' is configured for public read and report uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'found-reports',
    'found-reports',
    true,
    10485760, -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

-- 3. Storage Object RLS Policies for found-reports
DROP POLICY IF EXISTS "Public and authenticated found-reports read" ON storage.objects;
CREATE POLICY "Public and authenticated found-reports read"
ON storage.objects FOR SELECT
USING (bucket_id = 'found-reports');

DROP POLICY IF EXISTS "Allow uploads to found-reports" ON storage.objects;
CREATE POLICY "Allow uploads to found-reports"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'found-reports');

DROP POLICY IF EXISTS "Allow updates to found-reports" ON storage.objects;
CREATE POLICY "Allow updates to found-reports"
ON storage.objects FOR UPDATE
USING (bucket_id = 'found-reports');

-- 4. Ensure found_reports RLS allows global visibility and inserts (matching missing_reports)
ALTER TABLE public.found_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Found reports viewable by everyone" ON public.found_reports;
CREATE POLICY "Found reports viewable by everyone"
ON public.found_reports FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Found reports insertable by all" ON public.found_reports;
CREATE POLICY "Found reports insertable by all"
ON public.found_reports FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Found reports updatable by reporter" ON public.found_reports;
CREATE POLICY "Found reports updatable by reporter"
ON public.found_reports FOR UPDATE
USING (
    auth.uid() = reporter_id 
    OR reporter_id IS NULL 
    OR reporter_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);

-- 5. Indexes for fast sorting and querying
CREATE INDEX IF NOT EXISTS idx_found_reports_created_desc ON public.found_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_found_reports_public_created ON public.found_reports(is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_found_reports_location ON public.found_reports(found_location);
