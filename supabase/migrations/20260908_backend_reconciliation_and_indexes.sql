-- ==============================================================================
-- RAYDAR CHILD SAFETY PLATFORM — MIGRATION: RECONCILIATION, INDEXES & TRIGGERS
-- Project: ifpbdythbhlgqymsaxtz (https://ifpbdythbhlgqymsaxtz.supabase.co)
-- Date: 2026-09-08
-- Purpose: Complete backend schema definition, performance indexing, automatic 
--          timestamp triggers, and storage reconciliation without data loss.
-- ==============================================================================

-- 1. AUTOMATIC TIMESTAMP TRIGGER FUNCTION
-- Automatically updates updated_at column on row modification
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Attach trigger to profiles
DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- Attach trigger to missing_reports
DROP TRIGGER IF EXISTS trigger_missing_reports_updated_at ON public.missing_reports;
CREATE TRIGGER trigger_missing_reports_updated_at
    BEFORE UPDATE ON public.missing_reports
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- Attach trigger to found_reports
DROP TRIGGER IF EXISTS trigger_found_reports_updated_at ON public.found_reports;
CREATE TRIGGER trigger_found_reports_updated_at
    BEFORE UPDATE ON public.found_reports
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- 2. QUERY PERFORMANCE INDEXES
-- Index profiles email for user lookup during auth recovery
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Index missing_reports reporter_id for "My Reports" dashboard
CREATE INDEX IF NOT EXISTS idx_missing_reports_reporter_id ON public.missing_reports(reporter_id);

-- Index found_reports reporter_id for "My Reports" dashboard
CREATE INDEX IF NOT EXISTS idx_found_reports_reporter_id ON public.found_reports(reporter_id);

-- Index alerts table for chronological sorting and filtering
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON public.alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_category ON public.alerts(category);

-- 3. STORAGE RECONCILIATION: AVATARS BUCKET
-- Ensure avatars bucket exists with 10MB limit and all required MIME types
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

-- Re-verify Storage RLS Policies for avatars bucket
DROP POLICY IF EXISTS "Public access to avatars" ON storage.objects;
CREATE POLICY "Public access to avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Allow upload to avatars" ON storage.objects;
CREATE POLICY "Allow upload to avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Allow update to avatars" ON storage.objects;
CREATE POLICY "Allow update to avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Allow delete from avatars" ON storage.objects;
CREATE POLICY "Allow delete from avatars"
ON storage.objects FOR DELETE
USING (bucket_id = 'avatars');

-- 4. RPC SEARCH RECONCILIATION
-- Ensures rpc_search_reports is up to date and searches across both names, locations, and descriptions
CREATE OR REPLACE FUNCTION public.rpc_search_reports(query_text TEXT, is_found BOOLEAN DEFAULT false)
RETURNS SETOF public.missing_reports
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF is_found THEN
        RETURN QUERY
        SELECT * FROM public.missing_reports
        WHERE status = 'Trouvé'
          AND (
            child_full_name ILIKE '%' || query_text || '%'
            OR last_seen_location ILIKE '%' || query_text || '%'
            OR physical_description ILIKE '%' || query_text || '%'
            OR clothing_description ILIKE '%' || query_text || '%'
          )
        ORDER BY created_at DESC;
    ELSE
        RETURN QUERY
        SELECT * FROM public.missing_reports
        WHERE status <> 'Trouvé'
          AND (
            child_full_name ILIKE '%' || query_text || '%'
            OR last_seen_location ILIKE '%' || query_text || '%'
            OR physical_description ILIKE '%' || query_text || '%'
            OR clothing_description ILIKE '%' || query_text || '%'
          )
        ORDER BY created_at DESC;
    END IF;
END;
$$;
