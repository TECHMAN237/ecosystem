// RAYDAR Authentication & Role-Based Access Control Service
// Enforces strict separation between Supabase Auth and RAYDAR Profile State
import { supabase } from "./supabaseClient.js";

export const AuthState = {
  LOADING: 'LOADING',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  AUTHENTICATED_NO_PROFILE: 'AUTHENTICATED_NO_PROFILE',
  AUTHENTICATED_USER_ONBOARDING_REQUIRED: 'AUTHENTICATED_USER_ONBOARDING_REQUIRED',
  AUTHENTICATED_USER: 'AUTHENTICATED_USER',
  AUTHENTICATED_ADMIN: 'AUTHENTICATED_ADMIN',
};

// Valid database enum values for profiles.role
export const DB_ROLES = {
  MOTHER: "Mother",
  FATHER: "Father",
  GUARDIAN: "Guardian",
  COMMUNITY_MEMBER: "Community Member",
  VOLUNTEER_HELPER: "Volunteer Helper",
};

/**
 * Checks if a user has completed the first-login onboarding sequence.
 * Checks both localStorage and Supabase Auth user_metadata.
 */
export function isOnboardingCompleted(user) {
  if (!user || !user.id) return false;
  
  // 1. LocalStorage check (synchronous & instant)
  const localVal = localStorage.getItem(`raydar_onboarding_completed_${user.id}`);
  if (localVal === 'true') return true;

  // 2. Supabase Auth user_metadata check
  if (user.user_metadata && user.user_metadata.onboarding_completed === true) {
    try {
      localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  return false;
}

/**
 * Marks onboarding as completed for a user.
 * Persists to both localStorage and Supabase Auth user_metadata.
 */
export async function setOnboardingCompleted(user) {
  if (!user || !user.id) {
    // If no user object passed, attempt to get active user
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        user = session.user;
      }
    } catch (e) {}
  }
  if (!user || !user.id) return;

  try {
    localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
  } catch (e) {}

  try {
    await supabase.auth.updateUser({
      data: { onboarding_completed: true }
    });
    console.log("[Auth] Onboarding completed flag saved to Supabase user metadata.");
  } catch (err) {
    console.warn("[Auth] Notice updating onboarding status in Supabase:", err);
  }
}

/**
 * Maps French or UI selected role strings to database enum values.
 * Default role is always 'Guardian' (normal user, never admin).
 */
export function mapAccountTypeToDbRole(selectedRole) {
  if (!selectedRole) return DB_ROLES.GUARDIAN;
  const lower = String(selectedRole).toLowerCase().trim();
  if (lower.includes('mère') || lower.includes('mere') || lower.includes('mother')) return DB_ROLES.MOTHER;
  if (lower.includes('père') || lower.includes('pere') || lower.includes('father')) return DB_ROLES.FATHER;
  if (lower.includes('tuteur') || lower.includes('guardian')) return DB_ROLES.GUARDIAN;
  if (lower.includes('membre') || lower.includes('community')) return DB_ROLES.COMMUNITY_MEMBER;
  if (lower.includes('bénévole') || lower.includes('benevole') || lower.includes('volunteer') || lower.includes('secouriste')) return DB_ROLES.VOLUNTEER_HELPER;
  return DB_ROLES.GUARDIAN;
}

/**
 * Resolves current authentication state and RAYDAR profile from Supabase.
 * Waits until both Supabase auth state and profile state are known.
 */
export async function getAuthAndProfileState() {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.user) {
      return {
        state: AuthState.UNAUTHENTICATED,
        session: null,
        user: null,
        profile: null,
      };
    }

    const user = session.user;

    // Fetch RAYDAR profile for this authenticated user
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.warn("Notice querying profile in Supabase:", profileError.message || profileError);
      // Handle PGRST303 (JWT issue/expired session)
      if (profileError.code === 'PGRST303' || profileError.message?.includes('JWT')) {
        await supabase.auth.signOut().catch(() => {});
        return {
          state: AuthState.UNAUTHENTICATED,
          session: null,
          user: null,
          profile: null,
        };
      }
    }

    // Determine if profile exists and has required identity information
    const hasProfile = profile && (profile.full_name || profile.username);

    if (!hasProfile) {
      return {
        state: AuthState.AUTHENTICATED_NO_PROFILE,
        session,
        user,
        profile: null,
      };
    }

    // Role check: Admin MUST be explicitly set in the database
    // Newly created accounts are NEVER admins
    const isAdmin = profile.is_admin === true || 
                    String(profile.role).toLowerCase() === 'admin' ||
                    String(profile.role).toLowerCase() === 'administrator';

    if (isAdmin) {
      return {
        state: AuthState.AUTHENTICATED_ADMIN,
        session,
        user,
        profile,
      };
    }

    // Normal User: Check if first-login onboarding has been completed
    const onboardingDone = isOnboardingCompleted(user);
    if (!onboardingDone) {
      return {
        state: AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED,
        session,
        user,
        profile,
      };
    }

    return {
      state: AuthState.AUTHENTICATED_USER,
      session,
      user,
      profile,
    };
  } catch (err) {
    console.error("Error in getAuthAndProfileState:", err);
    return {
      state: AuthState.UNAUTHENTICATED,
      session: null,
      user: null,
      profile: null,
    };
  }
}

/**
 * Initiates Google OAuth with account selection prompt.
 * Ensures the Google account selection screen is always shown.
 */
export async function signInWithGoogle() {
  localStorage.removeItem('is_guest');
  sessionStorage.removeItem('signup_in_progress');

  const redirectTo = `${window.location.origin}/`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo,
      queryParams: {
        prompt: 'select_account',
        access_type: 'offline'
      }
    }
  });

  if (error) {
    console.error("Google OAuth error:", error);
    throw error;
  }
  return data;
}

/**
 * Performs complete sign out, clearing Supabase session, local storage and cache.
 */
export async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn("Supabase signOut notice:", e);
  }
  localStorage.removeItem('is_guest');
  localStorage.removeItem('user_profile');
  localStorage.removeItem('guardians_local_user_id');
  sessionStorage.clear();
  window.location.href = './login_child_safety.html';
}

/**
 * Creates or completes a RAYDAR profile for a user.
 * Guarantees that newly created users ALWAYS receive a normal user role and is_admin: false.
 * Strictly binds profiles.id and profiles.user_id to the verified Supabase Auth session auth.uid().
 */
export async function createRaydarProfile({
  userId,
  email,
  fullName,
  username,
  phoneCountryCode,
  phoneNumber,
  city,
  role = 'Guardian',
  photo = ''
}) {
  // Ensure we have a valid, active Supabase Auth session
  let verifiedUserId = userId;
  let sessionUser = null;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user && session.user.id) {
      sessionUser = session.user;
      verifiedUserId = session.user.id;
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.id) {
        sessionUser = user;
        verifiedUserId = user.id;
      }
    }
  } catch (e) {
    console.warn("Session verification check in createRaydarProfile:", e);
  }

  if (!verifiedUserId) {
    throw new Error("Impossible de créer le profil RAYDAR : utilisateur non authentifié dans Supabase Auth.");
  }

  const validRole = mapAccountTypeToDbRole(role);
  const formattedUsername = username 
    ? (username.startsWith('@') ? username : `@${username}`) 
    : `@user_${Date.now()}`;

  const resolvedEmail = email || sessionUser?.email || '';
  const resolvedFullName = fullName || sessionUser?.user_metadata?.full_name || sessionUser?.user_metadata?.name || '';
  const resolvedPhoto = photo || sessionUser?.user_metadata?.avatar_url || sessionUser?.user_metadata?.picture || '';

  const payload = {
    id: verifiedUserId,
    user_id: verifiedUserId,
    email: resolvedEmail,
    full_name: resolvedFullName,
    username: formattedUsername,
    phone_country_code: phoneCountryCode || '+237',
    phone_number: phoneNumber || '',
    city: city || '',
    role: validRole,
    is_admin: false, // Critical: Never assign admin to new registrations!
    terms_accepted: true,
    profile_photo_url: resolvedPhoto
  };

  console.log("Writing verified profile to Supabase profiles table for user_id:", verifiedUserId);

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .maybeSingle();

  if (error) {
    console.error("Error creating RAYDAR profile in Supabase:", error);
    throw error;
  }

  // Update local reportService cache so profile displays across all pages
  if (typeof window !== 'undefined' && window.reportService && window.reportService.saveProfile) {
    try {
      await window.reportService.saveProfile({
        full_name: resolvedFullName,
        username: formattedUsername,
        phone_country_code: phoneCountryCode || '+237',
        phone_number: phoneNumber || '',
        city: city || '',
        role: validRole,
        photo: resolvedPhoto || undefined,
        is_admin: false
      });
    } catch (e) {
      console.warn("Notice saving profile locally:", e);
    }
  }

  return data;
}

/**
 * Guard utility for pages.
 * Handles page protection and routing without flickering or race conditions.
 * 
 * @param {'public' | 'login' | 'signup_step_1' | 'registration_step' | 'profile_completion' | 'onboarding' | 'user' | 'admin'} routeType 
 */
export async function protectRoute(routeType) {
  // Check guest mode bypass for normal user pages
  if (routeType === 'user' && localStorage.getItem('is_guest') === 'true') {
    console.log("Guest mode active: allowing access to user page.");
    return { state: AuthState.UNAUTHENTICATED, isGuest: true };
  }

  const authInfo = await getAuthAndProfileState();
  const { state, profile } = authInfo;

  console.log(`[RAYDAR Route Guard] Route Type: ${routeType}, State: ${state}`);

  switch (routeType) {
    case 'public':
    case 'login': // login_child_safety.html
      if (state === AuthState.AUTHENTICATED_ADMIN) {
        window.location.replace('./admin_dashboard.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER) {
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED) {
        window.location.replace('./onboarding_community_protection_step_1.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_NO_PROFILE) {
        // Authenticated with Google or Supabase Auth but no RAYDAR profile yet -> Go to Registration Step 1
        window.location.replace('./sign_up_child_safety.html');
        return authInfo;
      }
      break;

    case 'signup_step_1': // sign_up_child_safety.html
      if (state === AuthState.AUTHENTICATED_ADMIN) {
        window.location.replace('./admin_dashboard.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER) {
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED) {
        window.location.replace('./onboarding_community_protection_step_1.html');
        return authInfo;
      }
      // If AUTHENTICATED_NO_PROFILE or UNAUTHENTICATED: stay on Step 1 to complete or review info
      break;

    case 'registration_step': // account_type_selection_updated_flow.html
      if (state === AuthState.AUTHENTICATED_ADMIN) {
        window.location.replace('./admin_dashboard.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER) {
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED) {
        window.location.replace('./onboarding_community_protection_step_1.html');
        return authInfo;
      }
      // If AUTHENTICATED_NO_PROFILE or UNAUTHENTICATED: stay in registration flow
      break;

    case 'profile_completion': // basic_information.html
      if (state === AuthState.AUTHENTICATED_ADMIN) {
        window.location.replace('./admin_dashboard.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER) {
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED) {
        window.location.replace('./onboarding_community_protection_step_1.html');
        return authInfo;
      }
      // If AUTHENTICATED_NO_PROFILE or UNAUTHENTICATED: stay on basic_information to complete profile!
      break;

    case 'onboarding': // onboarding_community_protection_step_1, onboarding_reporter, onboarding_alerte
      if (state === AuthState.UNAUTHENTICATED) {
        window.location.replace('./login_child_safety.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_NO_PROFILE) {
        window.location.replace('./sign_up_child_safety.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_ADMIN) {
        window.location.replace('./admin_dashboard.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER) {
        // User already completed onboarding previously! Direct them straight to the app.
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      // If AUTHENTICATED_USER_ONBOARDING_REQUIRED: allow access to complete onboarding!
      break;

    case 'user': // home_child_safety_v1, reports, alerts, etc.
      if (state === AuthState.UNAUTHENTICATED) {
        window.location.replace('./login_child_safety.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_NO_PROFILE) {
        window.location.replace('./sign_up_child_safety.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED) {
        window.location.replace('./onboarding_community_protection_step_1.html');
        return authInfo;
      }
      // If AUTHENTICATED_USER or AUTHENTICATED_ADMIN: allow access
      break;

    case 'admin': // admin_dashboard.html
      if (state === AuthState.UNAUTHENTICATED) {
        window.location.replace('./login_child_safety.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_NO_PROFILE) {
        window.location.replace('./sign_up_child_safety.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER || state === AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED) {
        // Access Denied! Normal user attempted direct access to Admin
        console.warn("Security Alert: Normal user attempted access to admin route. Redirecting to normal app.");
        sessionStorage.setItem('access_denied_message', 'Accès réservé aux administrateurs.');
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      // If AUTHENTICATED_ADMIN: allow access!
      break;
  }

  return authInfo;
}

// Expose on window for vanilla script compatibility
if (typeof window !== 'undefined') {
  window.authService = {
    AuthState,
    DB_ROLES,
    mapAccountTypeToDbRole,
    isOnboardingCompleted,
    setOnboardingCompleted,
    getAuthAndProfileState,
    signInWithGoogle,
    signOut,
    createRaydarProfile,
    protectRoute
  };
  window.handleLogout = signOut;
}
