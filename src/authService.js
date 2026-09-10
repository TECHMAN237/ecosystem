// RAYDAR Authentication & Role-Based Access Control Service
// Enforces strict separation between Supabase Auth, RAYDAR Email Verification, RAYDAR Profile, Registration, and Onboarding State
import { supabase } from "./supabaseClient.js";

export const AuthState = {
  INITIALIZING: 'INITIALIZING',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  AUTHENTICATED_EMAIL_UNVERIFIED: 'AUTHENTICATED_EMAIL_UNVERIFIED',
  AUTHENTICATED_NO_ROLE: 'AUTHENTICATED_NO_ROLE',
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
const CACHE_TTL_MS = 10000; // 10 seconds TTL
let pendingAuthPromise = null;

export function clearAuthCache() {
  cachedAuthInfo = null;
  cacheTimestamp = 0;
  pendingAuthPromise = null;
}

/**
 * Executes a promise with an enforced timeout so requests never hang.
 */
export function withTimeout(promise, ms = 3000, fallbackVal = null) {
  let timer;
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer);
      return res;
    }).catch((err) => {
      clearTimeout(timer);
      return fallbackVal !== null ? fallbackVal : { isTimeout: false, error: err, data: null };
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
 * Checks if RAYDAR email verification has been completed for a user.
 * CRITICAL RULE:
 * 1. For a brand new Google user (first login) or unverified email signup,
 *    Google's provider or Supabase email_confirmed_at DOES NOT automatically
 *    bypass RAYDAR verification code requirement.
 * 2. HOWEVER, for an existing complete returning user (profile complete + onboarding completed),
 *    email verification has already occurred in the past and MUST NOT be requested again.
 */
export function isRaydarEmailVerified(user, profile = null) {
  if (!user || !user.id) return false;

  // 1. PostgreSQL profiles table check (Primary source of truth)
  if (profile && (profile.is_verified === true || profile.is_verified === 'true' || profile.email_verified_at != null)) {
    try {
      localStorage.setItem(`raydar_email_verified_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  // 2. Supabase Auth user_metadata raydar_verified flag
  if (user.user_metadata && (user.user_metadata.raydar_verified === true || user.user_metadata.raydar_email_verified === true)) {
    try {
      localStorage.setItem(`raydar_email_verified_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  // 3. LocalStorage cache for this user
  try {
    const localVal = localStorage.getItem(`raydar_email_verified_${user.id}`);
    if (localVal === 'true') return true;
  } catch (e) {}

  // 4. RETURNING USER RECOGNITION:
  // An established user who already has a complete profile (full_name, role) AND has completed onboarding
  // is definitively verified! They cannot be trapped in an unverified state.
  const hasOnboarded = isOnboardingCompleted(user, profile);
  const hasCompleteProfile = Boolean(
    profile && 
    profile.full_name && profile.full_name.trim() && 
    profile.role && profile.role.trim() && profile.role !== 'NONE'
  );
  if (hasOnboarded && hasCompleteProfile) {
    try {
      localStorage.setItem(`raydar_email_verified_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  return false;
}

/**
 * Persists the selected role across storage mechanisms (sessionStorage, localStorage, Supabase user_metadata)
 * so that an incomplete registration never loses the selected role upon reload or new tab.
 */
export async function saveRoleSelection(role, user = null) {
  if (!role) return;
  const validRole = mapAccountTypeToDbRole(role);

  // 1. Session Storage
  try {
    sessionStorage.setItem('childSafetyAccountType', role);
    sessionStorage.setItem('signup_role', validRole);
  } catch (e) {}

  // 2. Local Storage (keyed to user if present, or global draft)
  try {
    if (user && user.id) {
      localStorage.setItem(`raydar_selected_role_${user.id}`, role);
    }
    localStorage.setItem('raydar_draft_selected_role', role);
  } catch (e) {}

  // 3. Supabase Auth user_metadata
  if (user && user.id) {
    try {
      await withTimeout(
        supabase.auth.updateUser({
          data: { role: validRole, selected_role: role }
        }),
        2500
      );
    } catch (e) {
      console.warn("Notice updating role in user_metadata:", e);
    }
  }

  clearAuthCache();
}

/**
 * Marks RAYDAR email verification as complete.
 */
export async function setRaydarEmailVerified(user) {
  if (!user || !user.id) return;

  try {
    localStorage.setItem(`raydar_email_verified_${user.id}`, 'true');
  } catch (e) {}

  clearAuthCache();

  try {
    await withTimeout(supabase.auth.updateUser({
      data: { raydar_verified: true, raydar_email_verified: true }
    }), 2500);
  } catch (e) {}

  try {
    await withTimeout(
      supabase
        .from('profiles')
        .update({ is_verified: true, email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('user_id', user.id),
      2500
    );
  } catch (e) {}
}

/**
 * Checks if a user has completed the onboarding sequence.
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
  if (user.user_metadata && (user.user_metadata.onboarding_completed === true || user.user_metadata.onboarding_completed === 'true')) {
    try {
      localStorage.setItem(`raydar_onboarding_completed_${user.id}`, 'true');
    } catch (e) {}
    return true;
  }

  // 3. LocalStorage check
  try {
    const localVal = localStorage.getItem(`raydar_onboarding_completed_${user.id}`);
    if (localVal === 'true') return true;
  } catch (e) {}

  return false;
}

/**
 * Marks onboarding as completed for a user.
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
    }), 2500);
  } catch (err) {
    console.warn("[Auth] Notice updating onboarding status in Supabase metadata:", err);
  }

  // Persist to PostgreSQL profiles table
  try {
    await withTimeout(
      supabase
        .from('profiles')
        .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
        .eq('user_id', user.id),
      2500
    );
  } catch (err) {
    console.warn("[Auth] Notice updating onboarding status in profiles table:", err);
  }
}

/**
 * Maps French or UI selected role strings to database enum values.
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
 * Detailed Forensic Flow & State Tracer.
 */
export function logAuthStateTrace({
  provider = 'email',
  authEvent = 'CHECK_STATE',
  authUserId = null,
  raydarProfile = 'NONE',
  registration = 'NOT_STARTED',
  onboarding = 'NOT_STARTED',
  emailVerification = 'PENDING',
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
 * Authoritative central resolver of authentication, profile, registration, and onboarding state.
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

      // 1. Get Supabase Auth Session
      const { data: sessionData, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        2500,
        { data: { session: null } }
      );

      if (!sessionError && sessionData && sessionData.session) {
        currentSession = sessionData.session;
        sessionUser = sessionData.session.user;
        localStorage.removeItem('is_guest');
      }

      // Fallback: getUser() if sessionUser is not yet in getSession()
      if (!sessionUser) {
        const { data: userData, error: userError } = await withTimeout(
          supabase.auth.getUser(),
          2000,
          { data: { user: null } }
        );
        if (!userError && userData && userData.user) {
          sessionUser = userData.user;
          localStorage.removeItem('is_guest');
        }
      }

      // Case: Unauthenticated
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
          isEmailVerified: false,
          provider: 'email',
          nextRequiredStep: './login_child_safety.html'
        };
        cachedAuthInfo = unauthResult;
        cacheTimestamp = Date.now();
        return unauthResult;
      }

      const user = sessionUser;
      const provider = (user.app_metadata?.provider === 'google' || user.identities?.some(id => id.provider === 'google'))
        ? 'google'
        : 'email';

      // Fetch PostgreSQL profiles record for this exact user_id
      const queryRes = await withTimeout(
        supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        2500,
        { isTimeout: true, data: null, error: null }
      );

      let profile = queryRes?.data;

      // Secondary check by email if not found by user_id
      if (!profile && user.email) {
        try {
          const emailQueryRes = await withTimeout(
            supabase.from('profiles').select('*').eq('email', user.email).maybeSingle(),
            2000,
            { data: null }
          );
          if (emailQueryRes?.data) {
            profile = emailQueryRes.data;
          }
        } catch (e) {}
      }

      // Fallback cache check: check localStorage user_profile if offline or network delay
      if (!profile && typeof window !== 'undefined') {
        try {
          const cachedProfileStr = localStorage.getItem(`raydar_profile_${user.id}`) || localStorage.getItem('user_profile');
          if (cachedProfileStr) {
            const parsed = JSON.parse(cachedProfileStr);
            if (parsed && (parsed.user_id === user.id || parsed.email === user.email)) {
              profile = parsed;
            }
          }
        } catch (e) {}
      }

      // Check Onboarding State
      const onboardingDone = isOnboardingCompleted(user, profile);

      // Check RAYDAR Email Verification
      // Note: isRaydarEmailVerified intrinsically validates existing complete users (hasCompleteProfile && hasOnboarded)
      const emailVerified = isRaydarEmailVerified(user, profile);

      // Detect chosen role across profile, user_metadata, and persistent browser storage
      const resolvedRole = (
        (profile?.role && profile.role.trim() && profile.role !== 'NONE' ? profile.role.trim() : null) ||
        (user.user_metadata?.role && user.user_metadata.role.trim() && user.user_metadata.role !== 'NONE' ? user.user_metadata.role.trim() : null) ||
        (user.user_metadata?.selected_role && user.user_metadata.selected_role.trim() ? user.user_metadata.selected_role.trim() : null) ||
        (typeof window !== 'undefined' && sessionStorage.getItem('childSafetyAccountType') ? sessionStorage.getItem('childSafetyAccountType').trim() : null) ||
        (typeof window !== 'undefined' && localStorage.getItem(`raydar_selected_role_${user.id}`) ? localStorage.getItem(`raydar_selected_role_${user.id}`).trim() : null) ||
        (typeof window !== 'undefined' && localStorage.getItem('raydar_draft_selected_role') ? localStorage.getItem('raydar_draft_selected_role').trim() : null)
      ) || null;

      // Check RAYDAR Profile & Registration State
      let raydarProfileState = 'NONE';
      let registrationState = 'NOT_STARTED';

      if (!profile) {
        // Check if user has complete info in metadata
        const metaName = user.user_metadata?.full_name || user.user_metadata?.name;
        const metaRole = resolvedRole;
        const metaContact = Boolean(user.user_metadata?.phone_number || user.user_metadata?.city);

        if (metaName && metaRole && metaContact && onboardingDone) {
          raydarProfileState = 'COMPLETE';
          registrationState = 'COMPLETE';
        } else if (resolvedRole) {
          raydarProfileState = 'INCOMPLETE';
          registrationState = 'IN_PROGRESS';
        } else {
          raydarProfileState = 'NONE';
          registrationState = 'NOT_STARTED';
        }
      } else {
        const hasName = Boolean(profile.full_name && profile.full_name.trim());
        const hasRole = Boolean(profile.role && profile.role.trim() && profile.role !== 'NONE');
        const hasContact = Boolean((profile.phone_number && profile.phone_number.trim()) || (profile.city && profile.city.trim()));

        if (hasName && hasRole && (hasContact || onboardingDone)) {
          raydarProfileState = 'COMPLETE';
          registrationState = 'COMPLETE';
        } else if (hasRole || resolvedRole) {
          raydarProfileState = 'INCOMPLETE';
          registrationState = 'IN_PROGRESS';
        } else {
          raydarProfileState = 'NONE';
          registrationState = 'NOT_STARTED';
        }
      }

      const onboardingState = (raydarProfileState === 'COMPLETE' && onboardingDone) ? 'COMPLETE' : 'NOT_STARTED';

      // Step-by-Step Deterministic Destination Resolution
      let nextRequiredStep = './home_child_safety_v1.html';
      let resolvedState = AuthState.AUTHENTICATED_USER;

      if (!emailVerified) {
        // Step 1: Mandatory RAYDAR Email Verification
        // Applies to Google First Login and unverified email registrations.
        resolvedState = AuthState.AUTHENTICATED_EMAIL_UNVERIFIED;
        nextRequiredStep = './email_verification.html';
      } else if (raydarProfileState === 'NONE' && !resolvedRole) {
        // Step 2: Role Selection
        // Email is verified, but user has not selected their role yet.
        resolvedState = AuthState.AUTHENTICATED_NO_ROLE;
        nextRequiredStep = './account_type_selection_updated_flow.html';
      } else if (raydarProfileState !== 'COMPLETE') {
        // Step 3: Personal Information (Profile Completion Form)
        // Mandatory for Google users: email is verified, role is selected, but personal details/profile must be submitted.
        resolvedState = AuthState.AUTHENTICATED_PROFILE_INCOMPLETE;
        nextRequiredStep = './basic_information.html';
      } else if (onboardingState !== 'COMPLETE') {
        // Step 4: Community Protection Onboarding sequence
        resolvedState = AuthState.AUTHENTICATED_ONBOARDING_REQUIRED;
        nextRequiredStep = './onboarding_community_protection_step_1.html';
      } else {
        // Step 5: Fully Completed User -> Home or Admin Dashboard
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
        isEmailVerified: emailVerified,
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
        isEmailVerified: false,
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
 */
export async function resolveAuthDestination() {
  const authInfo = await getAuthAndProfileState(true);
  const { state, session, raydarProfileState, onboardingState, isEmailVerified, provider, nextRequiredStep } = authInfo;

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

  if (isEmailVerified && raydarProfileState === 'COMPLETE' && onboardingState === 'COMPLETE') {
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
    currentFlow: (raydarProfileState === 'COMPLETE' && onboardingState === 'COMPLETE') ? 'LOGIN' : 'REGISTRATION',
    currentPage: window.location.pathname,
    decision,
    redirect: destination,
    reason
  });

  registerInternalNavIntent(destination);
  return destination;
}

/**
 * Dedicated Splash Screen Auth Destination Resolver.
 * Guaranteed to execute within max 2.5s and never hang.
 * Only resolves auth routing dependencies.
 */
export async function resolveInitialAuthDestination({ maxWaitMs = 2500 } = {}) {
  try {
    const authStatePromise = getAuthAndProfileState(false);
    const authInfo = await withTimeout(authStatePromise, maxWaitMs, null);

    if (!authInfo || !authInfo.session || authInfo.state === AuthState.UNAUTHENTICATED) {
      return './login_child_safety.html';
    }

    const { state, raydarProfileState, onboardingState, isEmailVerified, nextRequiredStep } = authInfo;

    // Existing complete user -> Home
    if (isEmailVerified && raydarProfileState === 'COMPLETE' && onboardingState === 'COMPLETE') {
      const returnUrl = getAndClearReturnUrl();
      const dest = returnUrl || (state === AuthState.AUTHENTICATED_ADMIN ? './admin_dashboard.html' : './home_child_safety_v1.html');
      registerInternalNavIntent(dest);
      return dest;
    }

    // Incomplete user -> Exact missing step
    registerInternalNavIntent(nextRequiredStep);
    return nextRequiredStep;
  } catch (err) {
    console.warn("[Auth] Fallback in resolveInitialAuthDestination:", err);
    return './login_child_safety.html';
  }
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
    await withTimeout(supabase.auth.signOut(), 2000);
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
    is_verified: true, // Profile creation happens after email verification!
    onboarding_completed: false // Onboarding begins after profile creation!
  };

  console.log("Upserting profile in Supabase profiles table for user_id:", verifiedUserId);

  const { data, error } = await withTimeout(
    supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .maybeSingle(),
    4000,
    { data: payload, error: null }
  );

  if (error) {
    console.error("PostgreSQL Error creating RAYDAR profile in Supabase:", error);
    throw error;
  }

  // Also sync profile metadata to Supabase Auth user metadata
  try {
    await withTimeout(
      supabase.auth.updateUser({
        data: {
          full_name: resolvedFullName,
          username: formattedUsername,
          role: validRole,
          phone_number: phoneNumber || '',
          phone_country_code: phoneCountryCode || '+237',
          city: city || '',
          terms_accepted: true,
          raydar_verified: true
        }
      }),
      2500
    );
  } catch (mErr) {
    console.warn("Notice updating user metadata in Supabase:", mErr);
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
    isEmailVerified: true,
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
      localStorage.setItem(`raydar_profile_${verifiedUserId}`, JSON.stringify(localObj));
      localStorage.setItem(`raydar_email_verified_${verifiedUserId}`, 'true');
    } catch (e) {
      console.warn("Notice updating profile local cache:", e);
    }
  }

  return data || payload;
}

const INTENT_KEY = 'raydar_internal_nav_intent';
const RELOAD_KEY = 'raydar_reload_intent';
const INTENT_VALIDITY_WINDOW_MS = 30000; // 30 seconds window

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
      try {
        const parsedReload = JSON.parse(rawReload);
        if (parsedReload && (Date.now() - parsedReload.timestamp <= 15000) && parsedReload.page === window.location.pathname) {
          isReload = true;
        }
      } catch (e) {}
    }
    if (isReload) {
      return { isValid: true, isReload: true, intent: null, type: 'RELOAD' };
    }

    let isBackForward = false;
    if (typeof performance !== 'undefined') {
      const navEntries = performance.getEntriesByType('navigation');
      if (navEntries && navEntries.length > 0) {
        isBackForward = navEntries[0].type === 'back_forward';
      } else if (performance.navigation) {
        isBackForward = performance.navigation.type === 2;
      }
    }
    const hasActiveSession = typeof window !== 'undefined' && sessionStorage.getItem('raydar_active_session') === 'true';
    if (isBackForward && hasActiveSession) {
      return { isValid: true, isBackForward: true, intent: null, type: 'BACK_FORWARD' };
    }

    const raw = sessionStorage.getItem(INTENT_KEY);
    if (raw) {
      sessionStorage.removeItem(INTENT_KEY);
      const parsed = JSON.parse(raw);
      const isFresh = parsed && parsed.timestamp && (Date.now() - parsed.timestamp <= INTENT_VALIDITY_WINDOW_MS);
      if (isFresh) {
        return { isValid: true, isReload: false, isBackForward: false, intent: parsed, type: 'INTERNAL' };
      }
    }
  } catch (e) {
    console.warn("Notice evaluating navigation intent:", e);
  }

  return { isValid: false, isReload: false, isBackForward: false, intent: null, type: 'DIRECT' };
}

/**
 * Route guard utility for pages.
 * @param {'public' | 'login' | 'signup_step_1' | 'email_verification' | 'registration_step' | 'profile_completion' | 'onboarding' | 'user' | 'admin'} routeType 
 * @param {Object} [options]
 * @param {boolean} [options.isExplicitLogin]
 */
export async function protectRoute(routeType, options = {}) {
  if (routeType === 'user' && localStorage.getItem('is_guest') === 'true') {
    const { data: { session } } = await withTimeout(supabase.auth.getSession(), 2000, { data: { session: null } });
    if (!session) {
      return { state: AuthState.UNAUTHENTICATED, isGuest: true };
    }
    localStorage.removeItem('is_guest');
  }

  const authInfo = await getAuthAndProfileState();
  const { state, session, profile, raydarProfileState, onboardingState, isEmailVerified } = authInfo;
  const isPublic = routeType === 'public' || routeType === 'login' || routeType === 'signup_step_1';

  const navCheck = consumeInternalNavIntent();
  const isAllowedNavigation = navCheck.isReload || navCheck.isBackForward || navCheck.isValid;

  // Direct external link gatekeeper:
  // Direct/external opening of a protected RAYDAR link must first display the login page.
  if (!isPublic && !isAllowedNavigation) {
    sessionStorage.removeItem('raydar_active_session');
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

  // Protect private pages if no session exists
  if (!session && !isPublic) {
    logAuthTrace({
      currentUrl: window.location.pathname + window.location.search,
      destination: './login_child_safety.html',
      navigationType: navCheck.type,
      internalIntent: Boolean(navCheck.intent),
      intentTimestamp: navCheck.intent?.timestamp,
      intentValid: isAllowedNavigation,
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

  if (session && typeof window !== 'undefined') {
    sessionStorage.setItem('raydar_active_session', 'true');
  }

  switch (routeType) {
    case 'public':
      return authInfo;

    case 'login': {
      const isOAuthCallback = typeof window !== 'undefined' && (
        window.location.hash.includes('access_token') || 
        window.location.search.includes('code=')
      );
      const isExplicitLogin = options && options.isExplicitLogin === true;

      if (session && (isOAuthCallback || isExplicitLogin)) {
        const dest = await resolveAuthDestination();
        window.location.replace(dest);
        return authInfo;
      }
      return authInfo;
    }

    case 'signup_step_1':
      return authInfo;

    case 'email_verification':
      if (!session) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      // If already verified, advance to next required step or Home
      if (isEmailVerified) {
        const dest = (authInfo.nextRequiredStep && !authInfo.nextRequiredStep.includes('email_verification'))
          ? authInfo.nextRequiredStep
          : (state === AuthState.AUTHENTICATED_ADMIN ? './admin_dashboard.html' : './home_child_safety_v1.html');
        registerInternalNavIntent(dest);
        window.location.replace(dest);
        return authInfo;
      }
      return authInfo;

    case 'registration_step':
    case 'profile_completion':
      if (!session) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      // If email not verified, must verify first
      if (!isEmailVerified) {
        registerInternalNavIntent('./email_verification.html');
        window.location.replace('./email_verification.html');
        return authInfo;
      }
      // Existing user with complete profile & onboarding must not see registration again
      if (raydarProfileState === 'COMPLETE' && onboardingState === 'COMPLETE') {
        const dest = state === AuthState.AUTHENTICATED_ADMIN ? './admin_dashboard.html' : './home_child_safety_v1.html';
        registerInternalNavIntent(dest);
        window.location.replace(dest);
        return authInfo;
      }
      return authInfo;

    case 'onboarding':
      if (!session || state === AuthState.UNAUTHENTICATED) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      // If email not verified, must verify first
      if (!isEmailVerified) {
        registerInternalNavIntent('./email_verification.html');
        window.location.replace('./email_verification.html');
        return authInfo;
      }
      // Existing user with complete profile & onboarding must not see onboarding again
      if (raydarProfileState === 'COMPLETE' && onboardingState === 'COMPLETE') {
        const dest = state === AuthState.AUTHENTICATED_ADMIN ? './admin_dashboard.html' : './home_child_safety_v1.html';
        registerInternalNavIntent(dest);
        window.location.replace(dest);
        return authInfo;
      }
      return authInfo;

    case 'user':
      if (!session || state === AuthState.UNAUTHENTICATED) {
        saveReturnUrlAndRedirectToLogin();
        return authInfo;
      }
      // Handle incomplete users navigating to protected user routes
      if (raydarProfileState !== 'COMPLETE' || onboardingState !== 'COMPLETE' || !isEmailVerified) {
        const dest = authInfo.nextRequiredStep || './email_verification.html';
        registerInternalNavIntent(dest);
        window.location.replace(dest);
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
      return authInfo;
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
    isRaydarEmailVerified,
    setRaydarEmailVerified,
    isOnboardingCompleted,
    setOnboardingCompleted,
    getAuthAndProfileState,
    resolveAuthDestination,
    resolveInitialAuthDestination,
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


