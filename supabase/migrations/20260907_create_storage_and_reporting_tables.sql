-- ==============================================================================
-- RAYDAR CHILD SAFETY PLATFORM — MIGRATION: STORAGE BUCKET & REPORTING POLICIES
-- Project: ifpbdythbhlgqymsaxtz (https://ifpbdythbhlgqymsaxtz.supabase.co)
-- ==============================================================================

-- 1. Ensure 'avatars' bucket exists in Supabase Storage with 10MB limit and public access
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars', 
    'avatars', 
    true, 
    10485760, -- 10MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET 
    public = true,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf'];

-- 2. Storage RLS Policies for 'avatars' bucket
-- Enable public viewing of all photos and documents stored in 'avatars'
DROP POLICY IF EXISTS "Public access to avatars" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
CREATE POLICY "Public access to avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Allow report photos to be uploaded (both authenticated users and public community reporters)
DROP POLICY IF EXISTS "Allow upload to avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
CREATE POLICY "Allow upload to avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

-- Allow update and upsert of objects in 'avatars'
DROP POLICY IF EXISTS "Allow update to avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their avatars" ON storage.objects;
CREATE POLICY "Allow update to avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars');

-- Allow deletion of objects in 'avatars'
DROP POLICY IF EXISTS "Allow delete from avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their avatars" ON storage.objects;
CREATE POLICY "Allow delete from avatars"
ON storage.objects FOR DELETE
USING (bucket_id = 'avatars');

-- 3. Ensure missing_reports table has complete schema and public insert capability
CREATE TABLE IF NOT EXISTS public.missing_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    child_full_name TEXT NOT NULL,
    child_age INTEGER,
    child_gender TEXT,
    child_photo_url TEXT,
    additional_photos TEXT[] DEFAULT '{}',
    clothing_description TEXT,
    physical_description TEXT,
    last_seen_date DATE DEFAULT CURRENT_DATE,
    last_seen_time TIME DEFAULT CURRENT_TIME,
    last_seen_location TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    incident_description TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    police_case_number TEXT,
    ai_matching_enabled BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'Published',
    admin_notes TEXT,
    is_public BOOLEAN DEFAULT true,
    child_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Ensure found_reports table has complete schema and public insert capability
CREATE TABLE IF NOT EXISTS public.found_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    child_full_name TEXT DEFAULT 'Enfant trouvé',
    child_gender TEXT,
    found_location TEXT NOT NULL,
    found_date DATE DEFAULT CURRENT_DATE,
    found_time TIME DEFAULT CURRENT_TIME,
    physical_description TEXT,
    clothing_description TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    child_photo_url TEXT,
    additional_photos TEXT[] DEFAULT '{}',
    admin_notes TEXT,
    status TEXT DEFAULT 'Published',
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. RLS Policies on missing_reports and found_reports
ALTER TABLE public.missing_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.found_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Missing reports viewable by everyone" ON public.missing_reports;
CREATE POLICY "Missing reports viewable by everyone"
ON public.missing_reports FOR SELECT USING (true);

DROP POLICY IF EXISTS "Missing reports insertable by all" ON public.missing_reports;
CREATE POLICY "Missing reports insertable by all"
ON public.missing_reports FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Missing reports updatable by reporter" ON public.missing_reports;
CREATE POLICY "Missing reports updatable by reporter"
ON public.missing_reports FOR UPDATE USING (auth.uid() = reporter_id OR reporter_id IS NULL);

DROP POLICY IF EXISTS "Found reports viewable by everyone" ON public.found_reports;
CREATE POLICY "Found reports viewable by everyone"
ON public.found_reports FOR SELECT USING (true);

DROP POLICY IF EXISTS "Found reports insertable by all" ON public.found_reports;
CREATE POLICY "Found reports insertable by all"
ON public.found_reports FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Found reports updatable by reporter" ON public.found_reports;
CREATE POLICY "Found reports updatable by reporter"
ON public.found_reports FOR UPDATE USING (auth.uid() = reporter_id OR reporter_id IS NULL);

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_missing_reports_created_at ON public.missing_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_found_reports_created_at ON public.found_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_missing_reports_status ON public.missing_reports(status);
CREATE INDEX IF NOT EXISTS idx_found_reports_status ON public.found_reports(status);
