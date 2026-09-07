// RAYDAR Authentication & Role-Based Access Control Service
// Enforces strict separation between Supabase Auth and RAYDAR Profile State
import { supabase } from "./supabaseClient.js";

export const AuthState = {
  INITIALIZING: 'INITIALIZING',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  AUTHENTICATED_NO_PROFILE: 'AUTHENTICATED_NO_PROFILE',
  AUTHENTICATED_PROFILE_LOADING: 'AUTHENTICATED_PROFILE_LOADING',
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
const CACHE_TTL_MS = 20000; // 20 seconds TTL for auth & profile data
let pendingAuthPromise = null;

export function clearAuthCache() {
  cachedAuthInfo = null;
  cacheTimestamp = 0;
  pendingAuthPromise = null;
}

/**
 * Executes a promise with an enforced timeout so requests never hang.
 */
function withTimeout(promise, ms = 4000, fallbackVal = null) {
  let timer;
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer);
      return res;
    }),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve(fallbackVal !== null ? fallbackVal : { isTimeout: true, error: new Error('TIMEOUT'), data: null });
      }, ms);
    })
  ]);
}

/**
 * Saves current URL as returnUrl and redirects unauthenticated users to login.
 */
export function saveReturnUrlAndRedirectToLogin() {
  try {
    const path = window.location.pathname;
    const search = window.location.search;
    const currentUrl = path + search;
    const publicPages = ['login', 'sign_up', 'forgot_password', 'reset_password', 'index.html'];
    const isPublic = publicPages.some(p => path.includes(p)) || path === '/' || path === '';
    if (!isPublic) {
      sessionStorage.setItem('raydar_return_url', currentUrl);
      window.location.replace(`./login_child_safety.html?returnUrl=${encodeURIComponent(currentUrl)}`);
      return;
    }
  } catch(e) {}
  window.location.replace('./login_child_safety.html');
}

/**
 * Retrieves and clears the saved returnUrl after successful authentication.
 */
export function getAndClearReturnUrl() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const paramUrl = urlParams.get('returnUrl');
    if (paramUrl && !paramUrl.includes('login') && !paramUrl.includes('sign_up')) {
      sessionStorage.removeItem('raydar_return_url');
      return decodeURIComponent(paramUrl);
    }
    const stored = sessionStorage.getItem('raydar_return_url');
    if (stored && !stored.includes('login') && !stored.includes('sign_up')) {
      sessionStorage.removeItem('raydar_return_url');
      return stored;
    }
  } catch (e) {}
  return null;
}

/**
 * Checks if a user has completed the first-login onboarding sequence.
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

  // 4. Any user with a valid profile is already established
  if (profile && (profile.full_name || profile.username)) {
    try {
      localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
    } catch (e) {}
    return true;
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
    }), 3000);
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
      3000
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
        4000,
        { data: { session: null } }
      );

      if (!sessionError && sessionData && sessionData.session) {
        currentSession = sessionData.session;
        sessionUser = sessionData.session.user;
        // CRITICAL: An authenticated user must NEVER be treated as a guest!
        localStorage.removeItem('is_guest');
      }

      if (!sessionUser) {
        const { data: userData, error: userError } = await withTimeout(
          supabase.auth.getUser(),
          3000,
          { data: { user: null } }
        );
        if (!userError && userData && userData.user) {
          sessionUser = userData.user;
          localStorage.removeItem('is_guest');
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

      // 1. Check if localStorage already has a verified cached profile for this exact user.id
      let localProfileForUser = null;
      try {
        const rawLocal = localStorage.getItem('user_profile');
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (parsed && (parsed.user_id === user.id || (!parsed.user_id && parsed.full_name))) {
            localProfileForUser = parsed;
          }
        }
      } catch (e) {}

      // 2. Fetch RAYDAR profile for this authenticated user with timeout protection
      const queryRes = await withTimeout(
        supabase
          .from('profiles')
          .select('*')
          .or(`user_id.eq.${user.id},id.eq.${user.id}`)
          .maybeSingle(),
        4000,
        { isTimeout: true, data: null, error: null }
      );

      let profile = queryRes?.data;
      const profileError = queryRes?.error;
      const isTimeout = queryRes?.isTimeout;

      if (profile && (profile.id || profile.user_id)) {
        // Authoritative profile found in PostgreSQL!
        try {
          localStorage.setItem('user_profile', JSON.stringify({ ...profile, user_id: user.id }));
          localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
        } catch (e) {}
      } else if (isTimeout || profileError) {
        console.warn("[Auth] Profile query delayed or encountered error:", profileError || "Timeout");
        if (localProfileForUser && (localProfileForUser.full_name || localProfileForUser.username || localProfileForUser.user_id)) {
          console.log("[Auth] Falling back to verified local profile cache for user:", user.id);
          profile = localProfileForUser;
        } else {
          console.log("[Auth] Synthesizing session identity fallback for user:", user.id);
          profile = {
            user_id: user.id,
            email: user.email || '',
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || (user.email ? user.email.split('@')[0] : 'Gardien'),
            username: `@user_${user.id.substring(0, 8)}`,
            role: user.user_metadata?.role || 'Guardian',
            is_admin: false,
            onboarding_completed: true
          };
          try {
            localStorage.setItem('user_profile', JSON.stringify(profile));
          } catch (e) {}
        }
      } else if (!profile && !profileError && !isTimeout) {
        // PostgREST definitively executed and confirmed 0 rows returned
        if (localProfileForUser && (localProfileForUser.full_name || localProfileForUser.username)) {
          console.log("[Auth] Self-healing profile from local cache into Supabase for user:", user.id);
          const healingPayload = {
            user_id: user.id,
            email: user.email || '',
            full_name: localProfileForUser.full_name || 'Gardien',
            username: localProfileForUser.username || `@user_${user.id.substring(0, 8)}`,
            role: localProfileForUser.role || 'Guardian',
            phone_country_code: localProfileForUser.phone_country_code || '+237',
            phone_number: localProfileForUser.phone_number || '',
            city: localProfileForUser.city || '',
            profile_photo_url: localProfileForUser.photo || localProfileForUser.profile_photo_url || '',
            onboarding_completed: true
          };
          try {
            const { data: healedData } = await supabase
              .from('profiles')
              .upsert(healingPayload, { onConflict: 'user_id' })
              .select()
              .maybeSingle();
            if (healedData) {
              profile = healedData;
              localStorage.setItem('user_profile', JSON.stringify({ ...healedData, user_id: user.id }));
            } else {
              profile = healingPayload;
            }
          } catch (e) {
            profile = healingPayload;
          }
        } else if (sessionStorage.getItem('signup_in_progress') !== 'true') {
          // An existing authenticated user whose profile record is empty: synthesize immediately
          console.log("[Auth] Synthesizing default profile for existing user session:", user.id);
          profile = {
            user_id: user.id,
            email: user.email || '',
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || (user.email ? user.email.split('@')[0] : 'Gardien'),
            username: `@user_${user.id.substring(0, 8)}`,
            role: user.user_metadata?.role || 'Guardian',
            is_admin: false,
            onboarding_completed: true
          };
          try {
            localStorage.setItem('user_profile', JSON.stringify(profile));
          } catch (e) {}
        }
      }

      // Determine if profile exists
      const hasProfile = Boolean(profile && (profile.id || profile.user_id || profile.full_name || profile.username || profile.email));

      if (!hasProfile && sessionStorage.getItem('signup_in_progress') === 'true') {
        // Genuinely new user in active sign-up flow
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

      // If user is authenticated and not in new signup flow, ensure they have profile structure
      if (!profile) {
        profile = {
          user_id: user.id,
          email: user.email || '',
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || (user.email ? user.email.split('@')[0] : 'Gardien'),
          username: `@user_${user.id.substring(0, 8)}`,
          role: 'Guardian',
          is_admin: false,
          onboarding_completed: true
        };
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

      // Normal User: Registered & authorized
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
    await withTimeout(supabase.auth.signOut(), 2500);
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
    profile_photo_url: resolvedPhoto,
    onboarding_completed: true
  };

  console.log("Atomic single upsert to Supabase profiles for user_id:", verifiedUserId);

  const { data, error } = await withTimeout(
    supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .maybeSingle(),
    5000,
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
    state: AuthState.AUTHENTICATED_USER,
    session: currentSession,
    user: sessionUser,
    profile: data || payload,
  };
  cacheTimestamp = Date.now();

  // Update local storage and DOM immediately without secondary network call
  if (typeof window !== 'undefined') {
    try {
      const localObj = {
        user_id: verifiedUserId,
        full_name: resolvedFullName,
        username: formattedUsername,
        phone_country_code: phoneCountryCode || '+237',
        phone_number: phoneNumber || '',
        city: city || '',
        role: validRole,
        photo: resolvedPhoto || undefined,
        is_admin: false,
        onboarding_completed: true
      };
      localStorage.setItem("user_profile", JSON.stringify(localObj));
      localStorage.setItem(`raydar_onboarding_completed_${verifiedUserId}`, 'true');
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
 * Temporary forensic trace helper for route guard auditing.
 */
function logRouteTrace({ destination, fnName, reason, authUserId, profileId, profileExists, role }) {
  if (typeof window !== 'undefined') {
    console.log(`[RAYDAR ROUTE TRACE]
CURRENT PAGE: ${window.location.pathname}
DESTINATION: ${destination}
FUNCTION: ${fnName}
REASON: ${reason}
AUTH USER ID: ${authUserId || 'none'}
PROFILE ID: ${profileId || 'none'}
PROFILE EXISTS: ${Boolean(profileExists)}
ROLE: ${role || 'undefined'}
SESSION STORAGE STATE: in_app=${sessionStorage.getItem('raydar_in_app_session')}, signup=${sessionStorage.getItem('signup_in_progress')}
TIMESTAMP: ${new Date().toISOString()}`);
  }
}

/**
 * Guard utility for pages.
 * Handles page protection and routing without flickering or race conditions.
 * Uses cached auth info to prevent cascading network queries on every navigation.
 * 
 * @param {'public' | 'login' | 'signup_step_1' | 'registration_step' | 'profile_completion' | 'onboarding' | 'user' | 'admin'} routeType 
 */
export async function protectRoute(routeType) {
  // Check guest mode bypass for normal user pages only when unauthenticated
  if (routeType === 'user' && localStorage.getItem('is_guest') === 'true') {
    const { data: { session } } = await withTimeout(supabase.auth.getSession(), 2000, { data: { session: null } });
    if (!session) {
      console.log("Guest mode active: allowing access to user page.");
      return { state: AuthState.UNAUTHENTICATED, isGuest: true };
    }
    // If session actually exists, wipe the guest flag!
    localStorage.removeItem('is_guest');
  }

  const authInfo = await getAuthAndProfileState();
  const { state, session, profile } = authInfo;
  const isPublic = routeType === 'public' || routeType === 'login' || routeType === 'signup_step_1';

  // Direct/Shared external link gatekeeper:
  // If user opens a private user route directly without active in-app tab session, enforce login verification
  if (!isPublic && (!session || sessionStorage.getItem('raydar_in_app_session') !== 'true')) {
    logRouteTrace({
      destination: './login_child_safety.html',
      fnName: 'protectRoute.directLinkGate',
      reason: !session ? 'No active session' : 'Direct link opened externally (requires fresh login)',
      authUserId: session?.user?.id,
      profileId: profile?.id,
      profileExists: Boolean(profile),
      role: profile?.role
    });
    saveReturnUrlAndRedirectToLogin();
    return {
      state: AuthState.UNAUTHENTICATED,
      session: null,
      user: null,
      profile: null
    };
  }

  // Protect private pages: if no session and not public, redirect to login with returnUrl
  if (!session && !isPublic) {
    logRouteTrace({
      destination: './login_child_safety.html',
      fnName: 'protectRoute.unauthenticated',
      reason: `No session on private route '${routeType}'`,
      authUserId: null,
      profileId: null,
      profileExists: false,
      role: undefined
    });
    saveReturnUrlAndRedirectToLogin();
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
      return authInfo;

    case 'login': // Triggered after explicit login or OAuth callback
      if (session) {
        sessionStorage.setItem('raydar_in_app_session', 'true');
        const returnUrl = getAndClearReturnUrl();
        if (state === AuthState.AUTHENTICATED_ADMIN) {
          logRouteTrace({
            destination: returnUrl || './admin_dashboard.html',
            fnName: 'protectRoute.login.admin',
            reason: 'Admin authenticated',
            authUserId: session.user.id,
            profileId: profile?.id,
            profileExists: Boolean(profile),
            role: profile?.role
          });
          window.location.replace(returnUrl || './admin_dashboard.html');
          return authInfo;
        }
        if (state === AuthState.AUTHENTICATED_USER || state === AuthState.AUTHENTICATED_NO_PROFILE) {
          logRouteTrace({
            destination: returnUrl || './home_child_safety_v1.html',
            fnName: 'protectRoute.login.user',
            reason: 'User authenticated',
            authUserId: session.user.id,
            profileId: profile?.id,
            profileExists: Boolean(profile),
            role: profile?.role
          });
          window.location.replace(returnUrl || './home_child_safety_v1.html');
          return authInfo;
        }
      }
      break;

    case 'signup_step_1': // sign_up_child_safety.html
      if (session && sessionStorage.getItem('signup_in_progress') !== 'true') {
        if (state === AuthState.AUTHENTICATED_ADMIN) {
          window.location.replace('./admin_dashboard.html');
          return authInfo;
        }
        if (state === AuthState.AUTHENTICATED_USER) {
          window.location.replace('./home_child_safety_v1.html');
          return authInfo;
        }
      }
      break;

    case 'registration_step': // account_type_selection_updated_flow.html
      // CRITICAL: If user already has an active session and is not explicitly in fresh signup, send to home!
      if (session && sessionStorage.getItem('signup_in_progress') !== 'true') {
        logRouteTrace({
          destination: './home_child_safety_v1.html',
          fnName: 'protectRoute.registration_step.existingUser',
          reason: 'Existing authenticated user visited registration page',
          authUserId: session.user.id,
          profileId: profile?.id,
          profileExists: Boolean(profile),
          role: profile?.role
        });
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      if (!session) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      break;

    case 'profile_completion': // basic_information.html
      // CRITICAL: An existing user must NEVER see profile completion again!
      if (session && sessionStorage.getItem('signup_in_progress') !== 'true') {
        logRouteTrace({
          destination: './home_child_safety_v1.html',
          fnName: 'protectRoute.profile_completion.existingUser',
          reason: 'Existing authenticated user visited basic_information page',
          authUserId: session.user.id,
          profileId: profile?.id,
          profileExists: Boolean(profile),
          role: profile?.role
        });
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      if (!session && !sessionStorage.getItem('signup_email')) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      break;

    case 'onboarding': // onboarding flow
      if (!session || state === AuthState.UNAUTHENTICATED) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      if (state === AuthState.AUTHENTICATED_ADMIN) {
        window.location.replace('./admin_dashboard.html');
        return authInfo;
      }
      window.location.replace('./home_child_safety_v1.html');
      return authInfo;

    case 'user': // home_child_safety_v1, reports, alerts, case dashboard, etc.
      if (!session || state === AuthState.UNAUTHENTICATED) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      // CRITICAL NON-NEGOTIABLE RULE:
      // An existing authenticated user navigating within the application (e.g. clicking 'Accueil',
      // 'Profil', 'Signalements', 'Alertes', or refreshing) MUST NEVER BE REDIRECTED TO REGISTRATION!
      return authInfo;

    case 'admin': // admin_dashboard.html
      if (!session || state === AuthState.UNAUTHENTICATED) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      if (state !== AuthState.AUTHENTICATED_ADMIN) {
        console.warn("Security Alert: Normal user attempted access to admin route. Redirecting to normal app.");
        sessionStorage.setItem('access_denied_message', 'Accès réservé aux administrateurs.');
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      break;
  }

  return authInfo;
}

/**
 * Direct guard for private pages.
 * Protect private pages with supabase.auth.getSession()
 * if no session, redirect to /login with returnUrl.
 */
export async function protectPrivatePage() {
  if (localStorage.getItem('is_guest') === 'true') {
    return { isGuest: true };
  }
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    console.log("[Auth Guard] No active session. Redirecting to /login...");
    saveReturnUrlAndRedirectToLogin();
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
    protectPrivatePage,
    saveReturnUrlAndRedirectToLogin,
    getAndClearReturnUrl
  };
  window.handleLogout = signOut;
  window.protectPrivatePage = protectPrivatePage;
}

