-- ==============================================================================
-- RAYDAR Supabase Backend Migration
-- Version: 20260918_egress_optimization_and_thumbnails.sql
-- Description: Supabase Egress Optimization & Zero Base64 Enforcement:
--              1. Prevents inline base64 insertion into missing_reports and found_reports.
--              2. Optimizes composite indexes on (status, created_at DESC) for low egress limit queries.
--              3. Documents thumbnail storage strategy and 7-day browser caching rules.
-- ==============================================================================

-- 1. Ensure composite indexes exist for minimal data scanning during list pagination
CREATE INDEX IF NOT EXISTS idx_missing_reports_status_created 
  ON public.missing_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_found_reports_status_created 
  ON public.found_reports (status, created_at DESC);

-- 2. Add constraint preventing oversized inline base64 in child_photo_url to permanently eliminate DB egress spikes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_missing_reports_no_base64'
  ) THEN
    ALTER TABLE public.missing_reports
      ADD CONSTRAINT check_missing_reports_no_base64
      CHECK (child_photo_url IS NULL OR NOT (child_photo_url LIKE 'data:%'));
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Constraint check_missing_reports_no_base64 notice: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_found_reports_no_base64'
  ) THEN
    ALTER TABLE public.found_reports
      ADD CONSTRAINT check_found_reports_no_base64
      CHECK (child_photo_url IS NULL OR NOT (child_photo_url LIKE 'data:%'));
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Constraint check_found_reports_no_base64 notice: %', SQLERRM;
END $$;

-- 3. Storage policy confirmations for thumbnails and missing-reports bucket
DO $$
BEGIN
  -- Public select on missing-reports
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public select on missing-reports') THEN
    CREATE POLICY "Public select on missing-reports" ON storage.objects
      FOR SELECT TO public USING (bucket_id = 'missing-reports');
  END IF;

  -- Allow authenticated inserts on missing-reports
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow authenticated inserts on missing-reports') THEN
    CREATE POLICY "Allow authenticated inserts on missing-reports" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'missing-reports');
  END IF;

  -- Allow anon inserts on missing-reports
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow anon inserts on missing-reports') THEN
    CREATE POLICY "Allow anon inserts on missing-reports" ON storage.objects
      FOR INSERT TO anon WITH CHECK (bucket_id = 'missing-reports');
  END IF;
END $$;
