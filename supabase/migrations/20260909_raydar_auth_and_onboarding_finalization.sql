-- ==============================================================================
-- RAYDAR CHILD SAFETY PLATFORM — MIGRATION: AUTH & ONBOARDING FINALIZATION
-- Project: ifpbdythbhlgqymsaxtz (https://ifpbdythbhlgqymsaxtz.supabase.co)
-- Date: 2026-09-09
-- Purpose: 
--   1. Ensure onboarding_completed and email_verified_at exist in public.profiles.
--   2. Ensure is_verified defaults to false for new users.
--   3. Create public.email_verifications table for authoritative code validation.
--   4. Provide hardened, idempotent RPC functions with strict auth.uid() identity enforcement.
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
CREATE INDEX IF NOT EXISTS idx_email_verifications_lookup ON public.email_verifications(email, code) WHERE verified_at IS NULL;

-- Enable RLS on email_verifications
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

-- ZERO DIRECT CLIENT ACCESS ON email_verifications TABLE:
-- Verification codes are sensitive authentication tokens generated exclusively by the trusted backend (Edge Function / service_role).
-- Direct PostgREST SELECT, INSERT, UPDATE, DELETE from browsers (authenticated or anon) is strictly revoked and denied.
REVOKE ALL ON TABLE public.email_verifications FROM PUBLIC, anon, authenticated;

-- Ensure service_role has full management privileges
GRANT ALL ON TABLE public.email_verifications TO service_role;

DROP POLICY IF EXISTS "Users can view their own email verifications" ON public.email_verifications;
DROP POLICY IF EXISTS "Authenticated users can insert verification records" ON public.email_verifications;
DROP POLICY IF EXISTS "Users can update their own verification records" ON public.email_verifications;
DROP POLICY IF EXISTS "Deny direct client access to email verifications" ON public.email_verifications;

-- Explicit restrictive policies: All direct PostgREST client operations are blocked.
CREATE POLICY "Deny direct client access to email verifications"
ON public.email_verifications
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

-- 3. Atomic Profile Creation / Update RPC Function
-- SECURITY DEFINER with strict search_path and mandatory identity check.
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile public.profiles;
    v_caller_id UUID;
BEGIN
    v_caller_id := auth.uid();

    -- Strict Identity Verification:
    -- Authenticated caller MUST match p_user_id. Anonymous callers are strictly forbidden.
    IF v_caller_id IS NULL OR v_caller_id <> p_user_id THEN
        RAISE EXCEPTION 'Non autorisé: vous ne pouvez créer ou modifier que votre propre profil (caller: %, target: %).', v_caller_id, p_user_id;
    END IF;

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
-- SECURITY DEFINER with strict search_path, exclusive row lock (FOR UPDATE), attempt ceiling, expiration, and user binding.
CREATE OR REPLACE FUNCTION public.rpc_verify_email_code(
    p_email TEXT,
    p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_verification RECORD;
    v_caller_id UUID;
    v_clean_email TEXT;
    v_clean_code TEXT;
BEGIN
    v_caller_id := auth.uid();
    v_clean_email := LOWER(TRIM(p_email));
    v_clean_code := TRIM(p_code);

    -- Strict Authentication Requirement: Anonymous verification is rejected
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Non autorisé: authentification requise pour valider un code.');
    END IF;

    IF v_clean_email IS NULL OR v_clean_email = '' OR v_clean_code IS NULL OR v_clean_code = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Paramètres d''e-mail ou de code manquants.');
    END IF;

    -- Strict Account Isolation: Ensure the authenticated user can ONLY verify their own email address
    IF NOT EXISTS (
        SELECT 1 FROM auth.users 
        WHERE id = v_caller_id 
          AND LOWER(email) = v_clean_email
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Non autorisé: cette adresse e-mail ne correspond pas à la session connectée.');
    END IF;

    -- Atomic Row Lock: Use FOR UPDATE to serialize concurrent verification attempts and prevent race conditions on the 5-attempt limit
    SELECT * INTO v_verification 
    FROM public.email_verifications
    WHERE LOWER(email) = v_clean_email
      AND (user_id IS NULL OR user_id = v_caller_id)
      AND verified_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_verification.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Aucun code de vérification actif trouvé pour cet e-mail.');
    END IF;

    -- Check attempt limit (max 5 attempts per code)
    IF v_verification.attempts >= 5 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nombre maximal de tentatives de validation atteint. Veuillez demander un nouveau code.');
    END IF;

    -- Check expiration
    IF v_verification.expires_at < now() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Le code de vérification a expiré. Veuillez en demander un nouveau.');
    END IF;

    -- Code mismatch: atomically increment attempts within locked transaction
    IF v_verification.code <> v_clean_code THEN
        UPDATE public.email_verifications
        SET attempts = attempts + 1
        WHERE id = v_verification.id;
          
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Code de vérification incorrect.', 
            'attempts_left', GREATEST(0, 4 - v_verification.attempts)
        );
    END IF;

    -- Mark code as verified atomically
    UPDATE public.email_verifications
    SET verified_at = now(),
        user_id = v_caller_id
    WHERE id = v_verification.id;

    -- Mark profile as verified for the authenticated user
    UPDATE public.profiles
    SET is_verified = true,
        email_verified_at = now(),
        updated_at = now()
    WHERE user_id = v_caller_id;

    RETURN jsonb_build_object('success', true, 'verified', true, 'message', 'Email vérifié avec succès dans RAYDAR.');
END;
$$;

-- 5. Revoke and Grant Permissions (Strict Principle of Least Privilege)
-- Revoke all default public access first
REVOKE ALL ON FUNCTION public.rpc_create_or_update_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_verify_email_code(TEXT, TEXT) FROM PUBLIC, anon;

-- Only authenticated users can invoke profile creation (must match auth.uid())
GRANT EXECUTE ON FUNCTION public.rpc_create_or_update_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- Code verification is granted EXCLUSIVELY to authenticated users
GRANT EXECUTE ON FUNCTION public.rpc_verify_email_code(TEXT, TEXT) TO authenticated;

