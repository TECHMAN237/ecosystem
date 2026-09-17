-- ==============================================================================
-- RAYDAR Supabase Backend Migration
-- Version: 20260912_fix_found_reports_constraints.sql
-- Description: Align public.found_reports constraints and ensure default values
-- ==============================================================================

-- 1. Ensure columns exist with safe defaults on public.found_reports
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'circumstances_description') THEN
    ALTER TABLE public.found_reports ADD COLUMN circumstances_description TEXT DEFAULT 'Enfant trouvé en attente d''identification';
  ELSE
    ALTER TABLE public.found_reports ALTER COLUMN circumstances_description SET DEFAULT 'Enfant trouvé en attente d''identification';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'current_location_of_child') THEN
    ALTER TABLE public.found_reports ADD COLUMN current_location_of_child TEXT DEFAULT 'Poste de police / Centre de protection';
  ELSE
    ALTER TABLE public.found_reports ALTER COLUMN current_location_of_child SET DEFAULT 'Poste de police / Centre de protection';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_reports' AND column_name = 'additional_photos') THEN
    ALTER TABLE public.found_reports ADD COLUMN additional_photos JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- 2. Ensure RLS policies on found_reports allow authenticated insertions and public views
ALTER TABLE public.found_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Insert policy for authenticated users
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'found_reports' AND policyname = 'Authenticated users can insert found reports') THEN
    CREATE POLICY "Authenticated users can insert found reports"
      ON public.found_reports FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;

  -- Select policy for public/anon users
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'found_reports' AND policyname = 'Public can view published found reports') THEN
    CREATE POLICY "Public can view published found reports"
      ON public.found_reports FOR SELECT
      TO public
      USING (is_public = true OR status = 'Published');
  END IF;

  -- Service role full access
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'found_reports' AND policyname = 'Service role full access on found_reports') THEN
    CREATE POLICY "Service role full access on found_reports"
      ON public.found_reports FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
