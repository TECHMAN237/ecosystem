-- ==============================================================================
-- RAYDAR CHILD SAFETY PLATFORM — SUPABASE BACKEND SCHEMA & RLS POLICIES
-- Project: ifpbdythbhlgqymsaxtz (https://ifpbdythbhlgqymsaxtz.supabase.co)
-- ==============================================================================

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    username TEXT UNIQUE,
    email TEXT,
    phone_country_code TEXT DEFAULT '+237',
    phone_number TEXT,
    city TEXT,
    role TEXT DEFAULT 'Guardian',
    community_mode TEXT DEFAULT 'PASSIVE',
    profile_photo_url TEXT,
    terms_accepted BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    is_admin BOOLEAN DEFAULT false,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. MISSING REPORTS TABLE
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

-- 3. FOUND REPORTS TABLE
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

-- 4. ALERTS TABLE
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'EMERGENCY',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    radius_km INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missing_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.found_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone"
ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Missing Reports Policies
DROP POLICY IF EXISTS "Missing reports are viewable by everyone" ON public.missing_reports;
CREATE POLICY "Missing reports are viewable by everyone"
ON public.missing_reports FOR SELECT USING (is_public = true OR auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Authenticated users can insert missing reports" ON public.missing_reports;
CREATE POLICY "Authenticated users can insert missing reports"
ON public.missing_reports FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR is_public = true);

DROP POLICY IF EXISTS "Reporters can update their own missing reports" ON public.missing_reports;
CREATE POLICY "Reporters can update their own missing reports"
ON public.missing_reports FOR UPDATE USING (auth.uid() = reporter_id);

-- Found Reports Policies
DROP POLICY IF EXISTS "Found reports are viewable by everyone" ON public.found_reports;
CREATE POLICY "Found reports are viewable by everyone"
ON public.found_reports FOR SELECT USING (is_public = true OR auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Authenticated users can insert found reports" ON public.found_reports;
CREATE POLICY "Authenticated users can insert found reports"
ON public.found_reports FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR is_public = true);

-- Alerts Policies
DROP POLICY IF EXISTS "Alerts are viewable by everyone" ON public.alerts;
CREATE POLICY "Alerts are viewable by everyone"
ON public.alerts FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users or functions can insert alerts" ON public.alerts;
CREATE POLICY "Authenticated users or functions can insert alerts"
ON public.alerts FOR INSERT WITH CHECK (true);

-- ==============================================================================
-- DATABASE FUNCTIONS / RPC
-- ==============================================================================

-- Search reports function
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
