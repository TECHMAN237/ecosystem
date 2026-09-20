-- ==============================================================================
-- RAYDAR PROFILE PREFERENCES, SETTINGS AND ACCOUNT LIFECYCLE MIGRATION
-- Supports: Google Play Account Deletion, Emergency Preferences, Privacy & Notification persistence
-- ==============================================================================

-- 1. Ensure preferences JSONB column exists on public.profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;

-- 2. Allow authenticated users to delete their own profile under RLS (Google Play Compliance)
DROP POLICY IF EXISTS "Users can delete their own profile" ON public.profiles;
CREATE POLICY "Users can delete their own profile"
ON public.profiles FOR DELETE
USING (auth.uid() = user_id);

-- 3. Account Deletion RPC function for Google Play compliant account removal
CREATE OR REPLACE FUNCTION public.rpc_delete_own_account()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_profile_id UUID;
    v_deleted_missing INT := 0;
    v_deleted_found INT := 0;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Utilisateur non authentifié';
    END IF;

    -- Resolve profile id
    SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = v_user_id;

    IF v_profile_id IS NOT NULL THEN
        -- Delete or disassociate user's created reports
        DELETE FROM public.missing_reports WHERE reporter_id = v_profile_id;
        GET DIAGNOSTICS v_deleted_missing = ROW_COUNT;

        DELETE FROM public.found_reports WHERE reporter_id = v_profile_id;
        GET DIAGNOSTICS v_deleted_found = ROW_COUNT;

        -- Delete public profile
        DELETE FROM public.profiles WHERE id = v_profile_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'deleted_missing_reports', v_deleted_missing,
        'deleted_found_reports', v_deleted_found,
        'message', 'Compte et données personnelles supprimés avec succès.'
    );
END;
$$;

-- 4. RPC to safely update user preferences (Notification, Emergency, Privacy)
CREATE OR REPLACE FUNCTION public.rpc_update_user_preferences(
    p_preferences JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_current_prefs JSONB;
    v_merged_prefs JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Utilisateur non authentifié';
    END IF;

    SELECT COALESCE(preferences, '{}'::jsonb) INTO v_current_prefs 
    FROM public.profiles 
    WHERE user_id = v_user_id;

    v_merged_prefs := v_current_prefs || p_preferences;

    UPDATE public.profiles
    SET preferences = v_merged_prefs,
        updated_at = NOW()
    WHERE user_id = v_user_id;

    RETURN v_merged_prefs;
END;
$$;
