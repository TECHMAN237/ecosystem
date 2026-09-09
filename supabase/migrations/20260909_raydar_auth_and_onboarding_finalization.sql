-- ==============================================================================
-- RAYDAR CHILD SAFETY PLATFORM — MIGRATION: AUTH & ONBOARDING FINALIZATION
-- Project: ifpbdythbhlgqymsaxtz (https://ifpbdythbhlgqymsaxtz.supabase.co)
-- Date: 2026-09-09
-- Purpose: 
--   1. Ensure onboarding_completed and email_verified_at exist in public.profiles.
--   2. Ensure is_verified defaults to false for new users.
--   3. Create public.email_verifications table for authoritative code validation.
--   4. Provide idempotent RPC functions for atomic profile creation and email verification.
-- ==============================================================================

-- 1. Ensure required columns exist in public.profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.profiles 
ALTER COLUMN is_verified SET DEFAULT false;

-- Create indexes on profiles
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_is_verified ON public.profiles(is_verified);

-- 2. Create authoritative email_verifications table
CREATE TABLE IF NOT EXISTS public.email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER DEFAULT 0,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON public.email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON public.email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_code ON public.email_verifications(code);

-- Enable RLS on email_verifications
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own email verifications" ON public.email_verifications;
CREATE POLICY "Users can view their own email verifications"
ON public.email_verifications FOR SELECT
USING (auth.uid() = user_id OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can insert verification records" ON public.email_verifications;
CREATE POLICY "Authenticated users can insert verification records"
ON public.email_verifications FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can update their own verification records" ON public.email_verifications;
CREATE POLICY "Users can update their own verification records"
ON public.email_verifications FOR UPDATE
USING (auth.uid() = user_id);

-- 3. Atomic Profile Creation / Update RPC Function
CREATE OR REPLACE FUNCTION public.rpc_create_or_update_profile(
    p_user_id UUID,
    p_email TEXT,
    p_full_name TEXT,
    p_username TEXT DEFAULT NULL,
    p_phone_country_code TEXT DEFAULT '+237',
    p_phone_number TEXT DEFAULT NULL,
    p_city TEXT DEFAULT NULL,
    p_role TEXT DEFAULT 'Guardian',
    p_profile_photo_url TEXT DEFAULT NULL,
    p_is_verified BOOLEAN DEFAULT false,
    p_onboarding_completed BOOLEAN DEFAULT false
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_profile public.profiles;
BEGIN
    INSERT INTO public.profiles (
        user_id,
        email,
        full_name,
        username,
        phone_country_code,
        phone_number,
        city,
        role,
        profile_photo_url,
        is_verified,
        onboarding_completed
    ) VALUES (
        p_user_id,
        p_email,
        COALESCE(p_full_name, 'Gardien RAYDAR'),
        COALESCE(p_username, '@user_' || substr(p_user_id::text, 1, 8)),
        p_phone_country_code,
        p_phone_number,
        p_city,
        COALESCE(p_role, 'Guardian'),
        p_profile_photo_url,
        COALESCE(p_is_verified, false),
        COALESCE(p_onboarding_completed, false)
    )
    ON CONFLICT (user_id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, public.profiles.email),
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        username = COALESCE(EXCLUDED.username, public.profiles.username),
        phone_country_code = COALESCE(EXCLUDED.phone_country_code, public.profiles.phone_country_code),
        phone_number = COALESCE(EXCLUDED.phone_number, public.profiles.phone_number),
        city = COALESCE(EXCLUDED.city, public.profiles.city),
        role = COALESCE(EXCLUDED.role, public.profiles.role),
        profile_photo_url = COALESCE(EXCLUDED.profile_photo_url, public.profiles.profile_photo_url),
        is_verified = CASE WHEN EXCLUDED.is_verified = true THEN true ELSE public.profiles.is_verified END,
        onboarding_completed = CASE WHEN EXCLUDED.onboarding_completed = true THEN true ELSE public.profiles.onboarding_completed END,
        updated_at = now()
    RETURNING * INTO v_profile;

    RETURN v_profile;
END;
$$;

-- 4. Atomic Code Verification RPC Function
CREATE OR REPLACE FUNCTION public.rpc_verify_email_code(
    p_email TEXT,
    p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_verification RECORD;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    -- Find latest active code for email or current user
    SELECT * INTO v_verification 
    FROM public.email_verifications
    WHERE (email = p_email OR user_id = v_user_id)
      AND code = p_code
      AND expires_at > now()
      AND verified_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_verification.id IS NULL THEN
        -- Record attempt if record exists
        UPDATE public.email_verifications
        SET attempts = attempts + 1
        WHERE (email = p_email OR user_id = v_user_id)
          AND expires_at > now();
          
        RETURN jsonb_build_object('success', false, 'error', 'Code invalide ou expiré.');
    END IF;

    -- Mark verified
    UPDATE public.email_verifications
    SET verified_at = now()
    WHERE id = v_verification.id;

    -- If profile exists, mark is_verified = true and set email_verified_at
    IF v_user_id IS NOT NULL THEN
        UPDATE public.profiles
        SET is_verified = true,
            email_verified_at = now(),
            updated_at = now()
        WHERE user_id = v_user_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'verified', true);
END;
$$;
