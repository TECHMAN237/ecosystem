-- ==============================================================================
-- RAYDAR Supabase Backend Migration
-- Version: 20260913_storage_policies_and_report_defaults.sql
-- Description: Align public.found_reports and public.missing_reports constraints,
--              defaults, and storage object policies for robust persistence.
-- ==============================================================================

-- 1. Ensure safe defaults and constraints on public.found_reports
DO $$
BEGIN
  -- child_photo_url default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'child_photo_url') THEN
    ALTER TABLE public.found_reports ALTER COLUMN child_photo_url SET DEFAULT 'https://ifpbdythbhlgqymsaxtz.supabase.co/storage/v1/object/public/found-reports/community/default_child_placeholder.png';
  END IF;

  -- circumstances_description default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'circumstances_description') THEN
    ALTER TABLE public.found_reports ALTER COLUMN circumstances_description SET DEFAULT 'Enfant trouvé en attente d''identification';
  END IF;

  -- current_location_of_child default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'current_location_of_child') THEN
    ALTER TABLE public.found_reports ALTER COLUMN current_location_of_child SET DEFAULT 'Poste de police / Centre de protection';
  END IF;

  -- found_location default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'found_location') THEN
    ALTER TABLE public.found_reports ALTER COLUMN found_location SET DEFAULT 'Localisation non précisée';
  END IF;

  -- status default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'status') THEN
    ALTER TABLE public.found_reports ALTER COLUMN status SET DEFAULT 'Published';
  END IF;

  -- is_public default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'is_public') THEN
    ALTER TABLE public.found_reports ALTER COLUMN is_public SET DEFAULT true;
  END IF;
END $$;

-- 2. Ensure safe defaults on public.missing_reports
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'missing_reports' AND column_name = 'status') THEN
    ALTER TABLE public.missing_reports ALTER COLUMN status SET DEFAULT 'Published';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'missing_reports' AND column_name = 'is_public') THEN
    ALTER TABLE public.missing_reports ALTER COLUMN is_public SET DEFAULT true;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'missing_reports' AND column_name = 'last_seen_date') THEN
    ALTER TABLE public.missing_reports ALTER COLUMN last_seen_date SET DEFAULT CURRENT_DATE;
  END IF;
END $$;

-- 3. Storage bucket configurations
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('found-reports', 'found-reports', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']),
  ('missing-reports', 'missing-reports', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']),
  ('report-evidence', 'report-evidence', false, 15728640, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 4. Storage Objects policies ensuring uploads and read
DO $$
BEGIN
  -- Public select on found-reports
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public select on found-reports') THEN
    CREATE POLICY "Public select on found-reports" ON storage.objects
      FOR SELECT TO public USING (bucket_id = 'found-reports');
  END IF;

  -- Allow authenticated inserts on found-reports
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow authenticated inserts on found-reports') THEN
    CREATE POLICY "Allow authenticated inserts on found-reports" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'found-reports');
  END IF;

  -- Allow anon inserts on found-reports for guest declarations
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow anon inserts on found-reports') THEN
    CREATE POLICY "Allow anon inserts on found-reports" ON storage.objects
      FOR INSERT TO anon WITH CHECK (bucket_id = 'found-reports');
  END IF;
END $$;
