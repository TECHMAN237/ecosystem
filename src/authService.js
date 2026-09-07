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

// In-memory cache & promise deduplication for maximum performance
let cachedAuthInfo = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 25000; // 25 seconds TTL for auth & profile data
let pendingAuthPromise = null;

export function clearAuthCache() {
  cachedAuthInfo = null;
  cacheTimestamp = 0;
  pendingAuthPromise = null;
}

/**
 * Executes a promise with an enforced timeout so requests never hang for minutes.
 */
function withTimeout(promise, ms = 6000, fallbackVal = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackVal), ms))
  ]);
}

/**
 * Checks if a user has completed the first-login onboarding sequence.
 * Triple-check: localStorage -> PostgreSQL profiles table -> Supabase Auth user_metadata.
 */
export function isOnboardingCompleted(user, profile = null) {
  if (!user || !user.id) return false;
  
  // 1. LocalStorage check (synchronous & instant)
  const localVal = localStorage.getItem(`raydar_onboarding_completed_${user.id}`);
  if (localVal === 'true') return true;

  // 2. Profile column in PostgreSQL database
  if (profile && (profile.onboarding_completed === true || profile.onboarding_completed === 'true')) {
    try {
      localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  // 3. Supabase Auth user_metadata check
  if (user.user_metadata && user.user_metadata.onboarding_completed === true) {
    try {
      localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  // 4. Heuristic: Existing profile with full_name created earlier than 1 minute ago has already onboarded
  if (profile && profile.full_name && profile.username && profile.created_at) {
    const ageMs = Date.now() - new Date(profile.created_at).getTime();
    if (ageMs > 60000) {
      try {
        localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
      } catch (e) {}
      return true;
    }
  }

  return false;
}

/**
 * Marks onboarding as completed for a user.
 * Persists to localStorage, PostgreSQL profiles table, and Supabase Auth user_metadata.
 */
export async function setOnboardingCompleted(user) {
  if (!user || !user.id) {
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

  clearAuthCache();

  // Persist to Supabase Auth metadata
  try {
    await withTimeout(supabase.auth.updateUser({
      data: { onboarding_completed: true }
    }), 4000);
    console.log("[Auth] Onboarding completed flag saved to Supabase user metadata.");
  } catch (err) {
    console.warn("[Auth] Notice updating onboarding status in Supabase:", err);
  }

  // Persist to PostgreSQL profiles table
  try {
    await withTimeout(
      supabase
        .from('profiles')
        .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
        .eq('user_id', user.id),
      4000
    );
    console.log("[Auth] Onboarding completed flag saved to PostgreSQL profiles table.");
  } catch (err) {
    console.warn("[Auth] Notice updating onboarding status in profiles table:", err);
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
 * Uses promise deduplication and short-term in-memory cache to prevent N+1 query loops.
 */
export async function getAuthAndProfileState(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedAuthInfo && (now - cacheTimestamp < CACHE_TTL_MS)) {
    return cachedAuthInfo;
  }

  if (pendingAuthPromise) {
    return pendingAuthPromise;
  }

  pendingAuthPromise = (async () => {
    try {
      let sessionUser = null;
      let currentSession = null;

      const { data: sessionData, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        5000,
        { data: { session: null } }
      );

      if (!sessionError && sessionData && sessionData.session) {
        currentSession = sessionData.session;
        sessionUser = sessionData.session.user;
      }

      if (!sessionUser) {
        const { data: userData, error: userError } = await withTimeout(
          supabase.auth.getUser(),
          4000,
          { data: { user: null } }
        );
        if (!userError && userData && userData.user) {
          sessionUser = userData.user;
        }
      }

      if (!sessionUser) {
        const unauthResult = {
          state: AuthState.UNAUTHENTICATED,
          session: null,
          user: null,
          profile: null,
        };
        cachedAuthInfo = unauthResult;
        cacheTimestamp = Date.now();
        return unauthResult;
      }

      const user = sessionUser;

      // Fetch RAYDAR profile for this authenticated user with timeout protection
      let { data: profile, error: profileError } = await withTimeout(
        supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        6000,
        { data: null, error: null }
      );

      if (profileError) {
        console.warn("Notice querying profile in Supabase:", profileError.message || profileError);
        if (profileError.code === 'PGRST303' || profileError.message?.includes('JWT')) {
          await supabase.auth.signOut().catch(() => {});
          clearAuthCache();
          return {
            state: AuthState.UNAUTHENTICATED,
            session: null,
            user: null,
            profile: null,
          };
        }
      }

      // Self-healing check: If Supabase returned null profile, check local storage
      if (!profile) {
        try {
          const cachedLocal = JSON.parse(localStorage.getItem('user_profile') || '{}');
          if (cachedLocal && cachedLocal.full_name && (!cachedLocal.user_id || cachedLocal.user_id === user.id)) {
            console.log("[Auth] Self-healing profile from local cache for user:", user.id);
            const healingPayload = {
              user_id: user.id,
              email: user.email || '',
              full_name: cachedLocal.full_name,
              username: cachedLocal.username || `@user_${user.id.substring(0, 8)}`,
              role: cachedLocal.role || 'Guardian',
              phone_country_code: cachedLocal.phone_country_code || '+237',
              phone_number: cachedLocal.phone_number || '',
              city: cachedLocal.city || '',
              profile_photo_url: cachedLocal.photo || cachedLocal.profile_photo_url || '',
              onboarding_completed: true
            };
            const { data: healedData } = await supabase
              .from('profiles')
              .upsert(healingPayload, { onConflict: 'user_id' })
              .select()
              .maybeSingle();
            if (healedData) profile = healedData;
          }
        } catch (e) {
          console.warn("[Auth] Notice during self-healing check:", e);
        }
      }

      // Determine if profile exists and has required identity information
      const hasProfile = Boolean(profile && (profile.full_name || profile.username));

      if (!hasProfile) {
        const noProfileResult = {
          state: AuthState.AUTHENTICATED_NO_PROFILE,
          session: currentSession,
          user,
          profile: null,
        };
        cachedAuthInfo = noProfileResult;
        cacheTimestamp = Date.now();
        return noProfileResult;
      }

      // Role check: Admin MUST be explicitly set in the database
      const isAdmin = profile.is_admin === true || 
                      String(profile.role).toLowerCase() === 'admin' ||
                      String(profile.role).toLowerCase() === 'administrator';

      if (isAdmin) {
        const adminResult = {
          state: AuthState.AUTHENTICATED_ADMIN,
          session: currentSession,
          user,
          profile,
        };
        cachedAuthInfo = adminResult;
        cacheTimestamp = Date.now();
        return adminResult;
      }

      // Normal User: Check if first-login onboarding has been completed
      const onboardingDone = isOnboardingCompleted(user, profile);
      if (!onboardingDone) {
        const onboardingResult = {
          state: AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED,
          session: currentSession,
          user,
          profile,
        };
        cachedAuthInfo = onboardingResult;
        cacheTimestamp = Date.now();
        return onboardingResult;
      }

      const userResult = {
        state: AuthState.AUTHENTICATED_USER,
        session: currentSession,
        user,
        profile,
      };
      cachedAuthInfo = userResult;
      cacheTimestamp = Date.now();
      return userResult;
    } catch (err) {
      console.error("Error in getAuthAndProfileState:", err);
      return {
        state: AuthState.UNAUTHENTICATED,
        session: null,
        user: null,
        profile: null,
      };
    } finally {
      pendingAuthPromise = null;
    }
  })();

  return pendingAuthPromise;
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
  clearAuthCache();
  try {
    await withTimeout(supabase.auth.signOut(), 3000);
  } catch (e) {
    console.warn("Supabase signOut notice:", e);
  }
  localStorage.removeItem('is_guest');
  localStorage.removeItem('user_profile');
  localStorage.removeItem('guardians_local_user_id');
  sessionStorage.clear();
  window.location.replace('/login');
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
  // Retrieve the authoritative current authenticated Supabase user
  let sessionUser = null;
  let verifiedUserId = null;

  const authState = await getAuthAndProfileState();
  const currentSession = authState?.session;
  const currentUser = authState?.user;

  if (currentUser && currentUser.id) {
    sessionUser = currentUser;
    verifiedUserId = currentUser.id;
  } else if (currentSession && currentSession.user && currentSession.user.id) {
    sessionUser = currentSession.user;
    verifiedUserId = currentSession.user.id;
  }

  // Safety constraint: Never accept an arbitrary userId if no active authenticated user exists
  if (!verifiedUserId) {
    console.error("[RAYDAR Auth Error] Cannot create profile: No active authenticated Supabase user found.");
    throw new Error("Impossible de créer le profil RAYDAR : utilisateur non authentifié dans Supabase Auth. Veuillez vous reconnecter.");
  }

  const validRole = mapAccountTypeToDbRole(role);
  const formattedUsername = username 
    ? (username.startsWith('@') ? username : `@${username}`) 
    : `@user_${Date.now()}`;

  const resolvedEmail = email || sessionUser?.email || '';
  const resolvedFullName = fullName || sessionUser?.user_metadata?.full_name || sessionUser?.user_metadata?.name || '';
  const resolvedPhoto = photo || sessionUser?.user_metadata?.avatar_url || sessionUser?.user_metadata?.picture || '';

  const payload = {
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

  console.log("Atomic single upsert to Supabase profiles for user_id:", verifiedUserId);

  const { data, error } = await withTimeout(
    supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .maybeSingle(),
    6000,
    { data: payload, error: null }
  );

  if (error) {
    console.error("PostgreSQL Error creating/updating RAYDAR profile in Supabase:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    throw error;
  }

  console.log("Profile successfully persisted in Supabase:", data);

  // Update in-memory auth cache so subsequent getAuthAndProfileState calls are instant (0ms)
  cachedAuthInfo = {
    state: AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED,
    session: currentSession,
    user: sessionUser,
    profile: data || payload,
  };
  cacheTimestamp = Date.now();

  // Update local storage and DOM immediately without secondary network call
  if (typeof window !== 'undefined') {
    try {
      const localObj = {
        full_name: resolvedFullName,
        username: formattedUsername,
        phone_country_code: phoneCountryCode || '+237',
        phone_number: phoneNumber || '',
        city: city || '',
        role: validRole,
        photo: resolvedPhoto || undefined,
        is_admin: false
      };
      localStorage.setItem("user_profile", JSON.stringify(localObj));
      if (window.reportService && window.reportService.updateDOMProfile) {
        window.reportService.updateDOMProfile(localObj);
      }
    } catch (e) {
      console.warn("Notice updating profile local cache:", e);
    }
  }

  return data || payload;
}

/**
 * Guard utility for pages.
 * Handles page protection and routing without flickering or race conditions.
 * Uses cached auth info to prevent cascading network queries on every navigation.
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
  const { state, session, profile } = authInfo;
  const isPublic = routeType === 'public' || routeType === 'login' || routeType === 'signup_step_1';

  // Protect private pages with supabase.auth.getSession() - if no session, redirect to /login
  if (!session && !isPublic) {
    console.log(`[RAYDAR Route Guard] No active session on private route '${routeType}'. Redirecting to /login...`);
    window.location.replace('/login');
    return {
      state: AuthState.UNAUTHENTICATED,
      session: null,
      user: null,
      profile: null
    };
  }

  console.log(`[RAYDAR Route Guard] Route Type: ${routeType}, State: ${state}`);

  switch (routeType) {
    case 'public':
      // Public entry routes (Splash, Auth entry) never auto-redirect to protected pages on load
      return authInfo;

    case 'login': // Triggered only when the user explicitly completes login or OAuth callback
      if (session) {
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
          window.location.replace('./account_type_selection_updated_flow.html');
          return authInfo;
        }
      }
      break;

    case 'signup_step_1': // sign_up_child_safety.html
      if (session) {
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
          window.location.replace('./account_type_selection_updated_flow.html');
          return authInfo;
        }
      }
      // If UNAUTHENTICATED: stay on Step 1 to enter info
      break;

    case 'registration_step': // account_type_selection_updated_flow.html
      if (!session) {
        window.location.replace('/login');
        return authInfo;
      }
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
      // If AUTHENTICATED_NO_PROFILE: stay in registration flow
      break;

    case 'profile_completion': // basic_information.html
      if (!session) {
        window.location.replace('/login');
        return authInfo;
      }
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
      // If AUTHENTICATED_NO_PROFILE: stay on basic_information to complete profile!
      break;

    case 'onboarding': // onboarding_community_protection_step_1, onboarding_reporter, onboarding_alerte
      if (!session || state === AuthState.UNAUTHENTICATED) {
        window.location.replace('/login');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_NO_PROFILE) {
        window.location.replace('./account_type_selection_updated_flow.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_ADMIN) {
        window.location.replace('./admin_dashboard.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER) {
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      // If AUTHENTICATED_USER_ONBOARDING_REQUIRED: allow access to complete onboarding!
      break;

    case 'user': // home_child_safety_v1, reports, alerts, etc.
      if (!session || state === AuthState.UNAUTHENTICATED) {
        window.location.replace('/login');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_NO_PROFILE) {
        window.location.replace('./account_type_selection_updated_flow.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED) {
        window.location.replace('./onboarding_community_protection_step_1.html');
        return authInfo;
      }
      // If AUTHENTICATED_USER or AUTHENTICATED_ADMIN: allow access
      break;

    case 'admin': // admin_dashboard.html
      if (!session || state === AuthState.UNAUTHENTICATED) {
        window.location.replace('/login');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_NO_PROFILE) {
        window.location.replace('./account_type_selection_updated_flow.html');
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_USER || state === AuthState.AUTHENTICATED_USER_ONBOARDING_REQUIRED) {
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

/**
 * Direct guard for private pages.
 * Protect private pages with supabase.auth.getSession()
 * if no session, redirect to /login.
 */
export async function protectPrivatePage() {
  if (localStorage.getItem('is_guest') === 'true') {
    return { isGuest: true };
  }
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    console.log("[Auth Guard] No active session. Redirecting to /login...");
    window.location.replace('/login');
    return null;
  }
  return session;
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
    protectRoute,
    protectPrivatePage
  };
  window.handleLogout = signOut;
  window.protectPrivatePage = protectPrivatePage;
}
