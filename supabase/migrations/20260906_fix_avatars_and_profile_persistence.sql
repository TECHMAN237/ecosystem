-- ==============================================================================
-- RAYDAR CHILD SAFETY PLATFORM — MIGRATION: AVATARS STORAGE & PROFILE PERSISTENCE
-- Project: ifpbdythbhlgqymsaxtz (https://ifpbdythbhlgqymsaxtz.supabase.co)
-- ==============================================================================

-- 1. Ensure onboarding_completed column exists in public.profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- 2. Index user_id for high-performance lookups
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- 3. Ensure avatars bucket exists in Supabase Storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars', 
    'avatars', 
    true, 
    5242880, -- 5MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET 
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- 4. Storage RLS Policies for avatars bucket
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
CREATE POLICY "Avatars are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
CREATE POLICY "Authenticated users can upload avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can update their avatars" ON storage.objects;
CREATE POLICY "Users can update their avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can delete their avatars" ON storage.objects;
CREATE POLICY "Users can delete their avatars"
ON storage.objects FOR DELETE
USING (bucket_id = 'avatars');

-- 5. Helper RPC function to get or create user profile atomically
CREATE OR REPLACE FUNCTION public.rpc_get_or_create_profile(
    p_user_id UUID,
    p_email TEXT DEFAULT NULL,
    p_full_name TEXT DEFAULT NULL,
    p_role TEXT DEFAULT 'Guardian'
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_profile public.profiles;
BEGIN
    SELECT * INTO v_profile FROM public.profiles WHERE user_id = p_user_id;
    
    IF v_profile.id IS NULL THEN
        INSERT INTO public.profiles (
            user_id,
            email,
            full_name,
            username,
            role,
            onboarding_completed
        ) VALUES (
            p_user_id,
            COALESCE(p_email, ''),
            COALESCE(p_full_name, 'Gardien de la Sécurité'),
            '@user_' || substr(p_user_id::text, 1, 8),
            COALESCE(p_role, 'Guardian'),
            false
        )
        RETURNING * INTO v_profile;
    END IF;
    
    RETURN v_profile;
END;
$$;
