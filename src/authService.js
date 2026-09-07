// RAYDAR Authentication & Role-Based Access Control Service
// Enforces strict separation between Supabase Auth, RAYDAR Profile State, and Onboarding State
import { supabase } from "./supabaseClient.js";

export const AuthState = {
  INITIALIZING: 'INITIALIZING',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  AUTHENTICATED_NO_PROFILE: 'AUTHENTICATED_NO_PROFILE',
  AUTHENTICATED_PROFILE_INCOMPLETE: 'AUTHENTICATED_PROFILE_INCOMPLETE',
  AUTHENTICATED_ONBOARDING_REQUIRED: 'AUTHENTICATED_ONBOARDING_REQUIRED',
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
const CACHE_TTL_MS = 15000; // 15 seconds TTL for auth & profile data
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
 * CRITICAL: Never assume onboarding is complete just because a name exists.
 */
export function isOnboardingCompleted(user, profile = null) {
  if (!user || !user.id) return false;
  
  // 1. PostgreSQL Database profiles table check (Primary authority)
  if (profile && (profile.onboarding_completed === true || profile.onboarding_completed === 'true')) {
    try {
      localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  // 2. Supabase Auth user_metadata check
  if (user.user_metadata && user.user_metadata.onboarding_completed === true) {
    try {
      localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  // 3. LocalStorage check (as verified persistence for current device)
  const localVal = localStorage.getItem(`raydar_onboarding_completed_${user.id}`);
  if (localVal === 'true') return true;

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
    sessionStorage.setItem('raydar_active_session', 'true');
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
 * Detailed Forensic Flow & State Tracer for Auth State Machine audits.
 */
export function logAuthStateTrace({
  provider = 'email',
  authEvent = 'CHECK_STATE',
  authUserId = null,
  raydarProfile = 'NONE',
  registration = 'NOT_STARTED',
  onboarding = 'NOT_STARTED',
  emailVerification = 'VERIFIED',
  currentFlow = 'APP',
  currentPage = '',
  decision = 'ALLOW',
  redirect = 'NONE',
  reason = ''
}) {
  if (typeof window !== 'undefined') {
    console.log(`[AUTH STATE TRACE]
provider: ${provider}
authEvent: ${authEvent}
authUserId: ${authUserId || 'none'}
raydarProfile: ${raydarProfile}
registration: ${registration}
onboarding: ${onboarding}
emailVerification: ${emailVerification}
currentFlow: ${currentFlow}
currentPage: ${currentPage || window.location.pathname}
decision: ${decision}
redirect: ${redirect}
reason: ${reason}`);
  }
}

export function logAuthFlowTrace(params) {
  logAuthStateTrace(params);
}

/**
 * Structured forensic trace logger for route guard decisions.
 */
export function logAuthTrace({
  currentUrl,
  destination,
  navigationType,
  internalIntent,
  intentTimestamp,
  intentValid,
  supabaseSession,
  authenticated,
  userId,
  returnUrl,
  redirectReason,
  redirectSourceFunction
}) {
  if (typeof window !== 'undefined') {
    console.log(`[AUTH TRACE]
current URL: ${currentUrl || (window.location.pathname + window.location.search)}
destination: ${destination || 'none'}
navigation type: ${navigationType || 'DIRECT'}
internal navigation intent: ${Boolean(internalIntent)}
intent timestamp: ${intentTimestamp || 'none'}
intentValid: ${Boolean(intentValid)}
Supabase session: ${Boolean(supabaseSession)}
authenticated: ${Boolean(authenticated)}
userId: ${userId || 'none'}
returnUrl: ${returnUrl || 'none'}
redirect reason: ${redirectReason || 'none'}
redirect source function: ${redirectSourceFunction || 'protectRoute'}`);
  }
}

/**
 * Authoritative central resolver of authentication, profile, and onboarding state.
 * Returns {
 *   state: AuthState,
 *   session: object | null,
 *   user: object | null,
 *   profile: object | null,
 *   raydarProfileState: 'NONE' | 'INCOMPLETE' | 'COMPLETE',
 *   registrationState: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE',
 *   onboardingState: 'NOT_STARTED' | 'COMPLETE',
 *   emailVerificationState: 'PENDING' | 'VERIFIED',
 *   provider: 'email' | 'google',
 *   nextRequiredStep: string
 * }
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
          raydarProfileState: 'NONE',
          registrationState: 'NOT_STARTED',
          onboardingState: 'NOT_STARTED',
          emailVerificationState: 'PENDING',
          provider: 'email',
          nextRequiredStep: './login_child_safety.html'
        };
        cachedAuthInfo = unauthResult;
        cacheTimestamp = Date.now();
        return unauthResult;
      }

      const user = sessionUser;
      const provider = user.app_metadata?.provider === 'google' || user.identities?.some(id => id.provider === 'google')
        ? 'google'
        : 'email';

      const emailVerified = Boolean(
        provider === 'google' || 
        user.email_confirmed_at || 
        user.confirmed_at || 
        user.user_metadata?.email_verified
      );

      // Query authoritative PostgreSQL profiles table for this exact user_id
      const queryRes = await withTimeout(
        supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        4000,
        { isTimeout: true, data: null, error: null }
      );

      let profile = queryRes?.data;
      const profileError = queryRes?.error;
      const isTimeout = queryRes?.isTimeout;

      // Fallback to local profile cache ONLY if it explicitly matches this user.id
      if (!profile && (isTimeout || profileError)) {
        try {
          const rawLocal = localStorage.getItem('user_profile');
          if (rawLocal) {
            const parsed = JSON.parse(rawLocal);
            if (parsed && parsed.user_id === user.id) {
              profile = parsed;
            }
          }
        } catch (e) {}
      }

      // Check if profile exists and is complete in RAYDAR
      const hasProfileRow = Boolean(profile && profile.user_id === user.id);
      const isProfileComplete = Boolean(
        hasProfileRow && 
        profile.full_name && 
        profile.role && 
        profile.role !== ''
      );

      let raydarProfileState = 'NONE';
      let registrationState = 'NOT_STARTED';

      if (!hasProfileRow) {
        raydarProfileState = 'NONE';
        registrationState = 'NOT_STARTED';
      } else if (!isProfileComplete) {
        raydarProfileState = 'INCOMPLETE';
        registrationState = 'IN_PROGRESS';
      } else {
        raydarProfileState = 'COMPLETE';
        registrationState = 'COMPLETE';
      }

      // Check onboarding state
      const onboardingDone = isProfileComplete && isOnboardingCompleted(user, profile);
      const onboardingState = onboardingDone ? 'COMPLETE' : 'NOT_STARTED';

      // Determine the next required step for this user
      let nextRequiredStep = './home_child_safety_v1.html';
      let resolvedState = AuthState.AUTHENTICATED_USER;

      if (!emailVerified) {
        resolvedState = AuthState.AUTHENTICATED_NO_PROFILE;
        nextRequiredStep = './login_child_safety.html';
      } else if (raydarProfileState === 'NONE') {
        resolvedState = AuthState.AUTHENTICATED_NO_PROFILE;
        nextRequiredStep = './account_type_selection_updated_flow.html';
      } else if (raydarProfileState === 'INCOMPLETE') {
        resolvedState = AuthState.AUTHENTICATED_PROFILE_INCOMPLETE;
        nextRequiredStep = './basic_information.html';
      } else if (onboardingState !== 'COMPLETE') {
        resolvedState = AuthState.AUTHENTICATED_ONBOARDING_REQUIRED;
        nextRequiredStep = './onboarding_community_protection_step_1.html';
      } else {
        const isAdmin = profile?.is_admin === true || 
                        String(profile?.role).toLowerCase() === 'admin' ||
                        String(profile?.role).toLowerCase() === 'administrator';
        resolvedState = isAdmin ? AuthState.AUTHENTICATED_ADMIN : AuthState.AUTHENTICATED_USER;
        nextRequiredStep = isAdmin ? './admin_dashboard.html' : './home_child_safety_v1.html';
      }

      const result = {
        state: resolvedState,
        session: currentSession,
        user,
        profile,
        raydarProfileState,
        registrationState,
        onboardingState,
        emailVerificationState: emailVerified ? 'VERIFIED' : 'PENDING',
        provider,
        nextRequiredStep
      };

      cachedAuthInfo = result;
      cacheTimestamp = Date.now();
      return result;
    } catch (err) {
      console.error("Error in getAuthAndProfileState:", err);
      return {
        state: AuthState.UNAUTHENTICATED,
        session: null,
        user: null,
        profile: null,
        raydarProfileState: 'NONE',
        registrationState: 'NOT_STARTED',
        onboardingState: 'NOT_STARTED',
        emailVerificationState: 'PENDING',
        provider: 'email',
        nextRequiredStep: './login_child_safety.html'
      };
    } finally {
      pendingAuthPromise = null;
    }
  })();

  return pendingAuthPromise;
}

/**
 * Resolves destination after explicit login or OAuth authentication.
 * Directs new/incomplete users into registration/onboarding and existing users to home/destination.
 */
export async function resolveAuthDestination() {
  const authInfo = await getAuthAndProfileState(true);
  const { state, session, raydarProfileState, onboardingState, provider, nextRequiredStep } = authInfo;

  if (!session || state === AuthState.UNAUTHENTICATED) {
    return './login_child_safety.html';
  }

  // Mark in-app session as active
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('raydar_active_session', 'true');
    localStorage.removeItem('is_guest');
  }

  // Check if a saved return URL exists
  const returnUrl = getAndClearReturnUrl();

  let destination = nextRequiredStep;
  let decision = 'CONTINUE_REGISTRATION';
  let reason = 'New or incomplete RAYDAR user';

  if (raydarProfileState === 'COMPLETE' && onboardingState === 'COMPLETE') {
    decision = 'GO_HOME';
    reason = 'Existing complete RAYDAR user';
    destination = returnUrl || (state === AuthState.AUTHENTICATED_ADMIN ? './admin_dashboard.html' : './home_child_safety_v1.html');
  }

  logAuthStateTrace({
    provider,
    authEvent: 'RESOLVE_DESTINATION',
    authUserId: session.user.id,
    raydarProfile: raydarProfileState,
    registration: authInfo.registrationState,
    onboarding: onboardingState,
    emailVerification: authInfo.emailVerificationState,
    currentFlow: raydarProfileState === 'COMPLETE' ? 'LOGIN' : (provider === 'google' ? 'GOOGLE_FIRST_LOGIN' : 'REGISTRATION'),
    currentPage: window.location.pathname,
    decision,
    redirect: destination,
    reason
  });

  registerInternalNavIntent(destination);
  return destination;
}

/**
 * Initiates Google OAuth with account selection prompt.
 */
export async function signInWithGoogle() {
  localStorage.removeItem('is_guest');

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
  sessionStorage.removeItem('raydar_active_session');
  sessionStorage.clear();
  window.location.replace('./login_child_safety.html');
}

/**
 * Creates or completes a RAYDAR profile for a user.
 * Initializes onboarding_completed to false so the user goes through the mandatory 3 onboarding steps.
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
    is_admin: false,
    terms_accepted: true,
    profile_photo_url: resolvedPhoto,
    onboarding_completed: false // Critical: Onboarding begins AFTER profile creation!
  };

  console.log("Upserting profile in Supabase profiles table for user_id:", verifiedUserId);

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
    console.error("PostgreSQL Error creating RAYDAR profile in Supabase:", error);
    throw error;
  }

  // Update in-memory auth cache
  cachedAuthInfo = {
    state: AuthState.AUTHENTICATED_ONBOARDING_REQUIRED,
    session: currentSession,
    user: sessionUser,
    profile: data || payload,
    raydarProfileState: 'COMPLETE',
    registrationState: 'COMPLETE',
    onboardingState: 'NOT_STARTED',
    emailVerificationState: 'VERIFIED',
    provider: authState.provider || 'email',
    nextRequiredStep: './onboarding_community_protection_step_1.html'
  };
  cacheTimestamp = Date.now();

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
        onboarding_completed: false
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

const INTENT_KEY = 'raydar_internal_nav_intent';
const RELOAD_KEY = 'raydar_reload_intent';
const INTENT_VALIDITY_WINDOW_MS = 25000; // 25 seconds window

export function registerInternalNavIntent(targetUrl = '') {
  try {
    const payload = {
      timestamp: Date.now(),
      source: window.location.pathname + window.location.search,
      target: targetUrl,
      nonce: 'nav_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now()
    };
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("Notice registering internal navigation intent:", e);
  }
}

export function consumeInternalNavIntent() {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (raw) {
      sessionStorage.removeItem(INTENT_KEY);
      const parsed = JSON.parse(raw);
      const isFresh = parsed && parsed.timestamp && (Date.now() - parsed.timestamp <= INTENT_VALIDITY_WINDOW_MS);
      if (isFresh) {
        return { isValid: true, intent: parsed, type: 'INTERNAL' };
      }
    }

    let isReload = false;
    if (typeof performance !== 'undefined') {
      const navEntries = performance.getEntriesByType('navigation');
      if (navEntries && navEntries.length > 0) {
        isReload = navEntries[0].type === 'reload';
      } else if (performance.navigation) {
        isReload = performance.navigation.type === 1;
      }
    }
    const rawReload = sessionStorage.getItem(RELOAD_KEY);
    if (rawReload) {
      sessionStorage.removeItem(RELOAD_KEY);
      const parsedReload = JSON.parse(rawReload);
      if (parsedReload && (Date.now() - parsedReload.timestamp <= 10000) && parsedReload.page === window.location.pathname) {
        isReload = true;
      }
    }
    if (isReload) {
      return { isValid: true, intent: null, type: 'RELOAD' };
    }
  } catch (e) {
    console.warn("Notice evaluating navigation intent:", e);
  }

  return { isValid: false, intent: null, type: 'DIRECT' };
}

/**
 * Guard utility for pages.
 * @param {'public' | 'login' | 'signup_step_1' | 'registration_step' | 'profile_completion' | 'onboarding' | 'user' | 'admin'} routeType 
 */
export async function protectRoute(routeType) {
  if (routeType === 'user' && localStorage.getItem('is_guest') === 'true') {
    const { data: { session } } = await withTimeout(supabase.auth.getSession(), 2000, { data: { session: null } });
    if (!session) {
      return { state: AuthState.UNAUTHENTICATED, isGuest: true };
    }
    localStorage.removeItem('is_guest');
  }

  const authInfo = await getAuthAndProfileState();
  const { state, session, profile } = authInfo;
  const isPublic = routeType === 'public' || routeType === 'login' || routeType === 'signup_step_1' || routeType === 'registration_step' || routeType === 'profile_completion';

  const hasActiveInAppSession = typeof window !== 'undefined' && sessionStorage.getItem('raydar_active_session') === 'true';
  const navCheck = consumeInternalNavIntent();
  const isInternalNavValid = navCheck.isValid || hasActiveInAppSession;
  const navigationType = hasActiveInAppSession ? 'IN_APP_ACTIVE' : navCheck.type;

  // Direct external link gatekeeper
  if (!isPublic && !isInternalNavValid) {
    logAuthTrace({
      currentUrl: window.location.pathname + window.location.search,
      destination: './login_child_safety.html',
      navigationType: 'DIRECT',
      internalIntent: Boolean(navCheck.intent),
      intentTimestamp: navCheck.intent?.timestamp,
      intentValid: false,
      supabaseSession: Boolean(session),
      authenticated: Boolean(session),
      userId: session?.user?.id,
      returnUrl: window.location.pathname + window.location.search,
      redirectReason: 'Direct URL entry detected — explicit login required',
      redirectSourceFunction: 'protectRoute.directEntryGate'
    });
    saveReturnUrlAndRedirectToLogin();
    return {
      state: AuthState.UNAUTHENTICATED,
      session: null,
      user: null,
      profile: null
    };
  }

  // Protect private pages
  if (!session && !isPublic) {
    logAuthTrace({
      currentUrl: window.location.pathname + window.location.search,
      destination: './login_child_safety.html',
      navigationType: navigationType,
      internalIntent: Boolean(navCheck.intent),
      intentTimestamp: navCheck.intent?.timestamp,
      intentValid: isInternalNavValid,
      supabaseSession: false,
      authenticated: false,
      userId: null,
      returnUrl: window.location.pathname + window.location.search,
      redirectReason: `No active session for private route '${routeType}'`,
      redirectSourceFunction: 'protectRoute.unauthenticated'
    });
    saveReturnUrlAndRedirectToLogin();
    return {
      state: AuthState.UNAUTHENTICATED,
      session: null,
      user: null,
      profile: null
    };
  }

  switch (routeType) {
    case 'public':
      return authInfo;

    case 'login': {
      if (session) {
        const dest = await resolveAuthDestination();
        window.location.replace(dest);
        return authInfo;
      }
      break;
    }

    case 'signup_step_1':
      logAuthStateTrace({
        provider: authInfo.provider,
        authEvent: 'PAGE_INIT',
        authUserId: session?.user?.id,
        raydarProfile: authInfo.raydarProfileState,
        registration: authInfo.registrationState,
        onboarding: authInfo.onboardingState,
        currentFlow: 'SIGNUP',
        currentPage: 'sign_up_child_safety.html',
        decision: 'ALLOW',
        redirect: 'NONE',
        reason: 'Signup Step 1 stays until user action'
      });
      return authInfo;

    case 'registration_step':
      logAuthStateTrace({
        provider: authInfo.provider,
        authEvent: 'PAGE_INIT',
        authUserId: session?.user?.id,
        raydarProfile: authInfo.raydarProfileState,
        registration: 'IN_PROGRESS',
        onboarding: authInfo.onboardingState,
        currentFlow: authInfo.provider === 'google' ? 'GOOGLE_FIRST_LOGIN' : 'SIGNUP',
        currentPage: 'account_type_selection_updated_flow.html',
        decision: 'ALLOW',
        redirect: 'NONE',
        reason: 'Registration Step 2 stays until user action'
      });
      return authInfo;

    case 'profile_completion':
      logAuthStateTrace({
        provider: authInfo.provider,
        authEvent: 'PAGE_INIT',
        authUserId: session?.user?.id,
        raydarProfile: authInfo.raydarProfileState,
        registration: 'IN_PROGRESS',
        onboarding: authInfo.onboardingState,
        currentFlow: authInfo.provider === 'google' ? 'GOOGLE_FIRST_LOGIN' : 'SIGNUP',
        currentPage: 'basic_information.html',
        decision: 'ALLOW',
        redirect: 'NONE',
        reason: 'Registration Step 3 stays until user action'
      });
      return authInfo;

    case 'onboarding':
      if (!session || state === AuthState.UNAUTHENTICATED) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      logAuthStateTrace({
        provider: authInfo.provider,
        authEvent: 'PAGE_INIT',
        authUserId: session.user.id,
        raydarProfile: authInfo.raydarProfileState,
        registration: 'COMPLETE',
        onboarding: 'IN_PROGRESS',
        currentFlow: 'ONBOARDING',
        currentPage: window.location.pathname,
        decision: 'ALLOW',
        redirect: 'NONE',
        reason: 'Onboarding in progress — user will proceed explicitly'
      });
      return authInfo;

    case 'user':
      if (!session || state === AuthState.UNAUTHENTICATED) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      return authInfo;

    case 'admin':
      if (!session || state === AuthState.UNAUTHENTICATED) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      if (state !== AuthState.AUTHENTICATED_ADMIN) {
        console.warn("Security Alert: Normal user attempted access to admin route.");
        sessionStorage.setItem('access_denied_message', 'Accès réservé aux administrateurs.');
        registerInternalNavIntent('./home_child_safety_v1.html');
        window.location.replace('./home_child_safety_v1.html');
        return authInfo;
      }
      break;
  }

  return authInfo;
}

export async function protectPrivatePage() {
  if (localStorage.getItem('is_guest') === 'true') {
    return { isGuest: true };
  }
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    saveReturnUrlAndRedirectToLogin();
    return null;
  }
  return session;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    try {
      const anchor = event.target.closest('a');
      if (anchor) {
        const href = anchor.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
          registerInternalNavIntent(href);
          return;
        }
      }

      const clickable = event.target.closest('button, [onclick], [data-navigate], [data-href]');
      if (clickable) {
        const onclickAttr = clickable.getAttribute('onclick') || '';
        const dataNav = clickable.getAttribute('data-navigate') || clickable.getAttribute('data-href') || '';
        if (dataNav) {
          registerInternalNavIntent(dataNav);
          return;
        }
        if (onclickAttr.includes('location') || onclickAttr.includes('.html') || onclickAttr.includes('history.')) {
          const match = onclickAttr.match(/['"](\.?\/[^'"]+\.html[^'"]*)['"]/);
          if (match && match[1]) {
            registerInternalNavIntent(match[1]);
          } else {
            registerInternalNavIntent();
          }
          return;
        }
        registerInternalNavIntent();
      }
    } catch (e) {
      console.warn("Notice capturing navigation intent:", e);
    }
  }, true);

  window.addEventListener('beforeunload', () => {
    try {
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify({
        timestamp: Date.now(),
        page: window.location.pathname
      }));
    } catch (e) {}
  });
}

if (typeof window !== 'undefined') {
  window.authService = {
    AuthState,
    DB_ROLES,
    mapAccountTypeToDbRole,
    isOnboardingCompleted,
    setOnboardingCompleted,
    getAuthAndProfileState,
    resolveAuthDestination,
    signInWithGoogle,
    signOut,
    createRaydarProfile,
    protectRoute,
    protectPrivatePage,
    saveReturnUrlAndRedirectToLogin,
    getAndClearReturnUrl,
    registerInternalNavIntent,
    consumeInternalNavIntent,
    logAuthTrace,
    logAuthStateTrace,
    logAuthFlowTrace
  };
  window.handleLogout = signOut;
  window.protectPrivatePage = protectPrivatePage;
  window.registerInternalNavIntent = registerInternalNavIntent;
}

