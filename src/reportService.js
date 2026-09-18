// Modular report service for RAYDAR Child Safety Platform
// Connected to Supabase Backend (PostgreSQL, Supabase Storage, Supabase Edge Functions & Auth)
import { supabase } from "./supabaseClient.js";

// In-memory caching and promise deduplication for high-performance data fetching
let cachedCurrentUserId = null;
let pendingReportsSyncPromise = null;
let lastReportsSyncTime = 0;
let pendingProfileSyncPromise = null;
let lastProfileSyncTime = 0;

export const getApiBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return '';
  }
  return 'http://localhost:3000';
};

// ==============================================================================
// TEMPORARY DEVELOPMENT RETENTION: MAXIMUM 4 MISSING + 4 FOUND
// ==============================================================================
export const MAX_RETAINED_MISSING_REPORTS = 4;
export const MAX_RETAINED_FOUND_REPORTS = 4;

export async function enforceDevelopmentRetention(type = 'missing') {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/reports/enforce-retention`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    return await res.json();
  } catch (e) {
    console.warn('[RETENTION] Notice calling enforce-retention:', e);
    return null;
  }
}

/**
 * Fast client-side image downscaling and compression.
 * Reduces 5MB-15MB smartphone/camera photos to ~150KB JPEG (98% reduction),
 * drastically cutting upload times from minutes to sub-second.
 */
export async function compressImage(fileOrDataUrl, maxWidth = 1200, quality = 0.82) {
  if (typeof window === 'undefined' || !fileOrDataUrl) return fileOrDataUrl;

  // Already a static asset path or remote URL
  if (typeof fileOrDataUrl === 'string' && !fileOrDataUrl.startsWith('data:')) {
    return fileOrDataUrl;
  }

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxWidth) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      };
      img.onerror = () => resolve(fileOrDataUrl);

      if (typeof fileOrDataUrl === 'string') {
        img.src = fileOrDataUrl;
      } else if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
        const reader = new FileReader();
        reader.onload = (e) => { img.src = e.target.result; };
        reader.onerror = () => resolve(fileOrDataUrl);
        reader.readAsDataURL(fileOrDataUrl);
      } else {
        resolve(fileOrDataUrl);
      }
    } catch (e) {
      resolve(fileOrDataUrl);
    }
  });
}

/**
 * Resolves a lightweight thumbnail URL for list views.
 * - If given a Supabase storage URL (e.g. .../missing-reports/uuid/child_123.jpg),
 *   it maps to .../missing-reports/uuid/thumb_child_123.jpg.
 * - If given an already local asset or SVG placeholder, returns as-is.
 * - If given a huge base64 string (>50KB), returns null/placeholder to prevent massive egress and DOM freeze.
 */
export function getThumbnailUrl(photoUrl) {
  if (!photoUrl || typeof photoUrl !== 'string') return null;
  if (photoUrl.startsWith('/assets/') || photoUrl.startsWith('data:image/svg')) {
    return photoUrl;
  }
  if (photoUrl.startsWith('data:')) {
    if (photoUrl.length > 50000) {
      return NEUTRAL_CHILD_PHOTO_PLACEHOLDER;
    }
    return photoUrl;
  }
  if (photoUrl.includes('/storage/v1/object/public/')) {
    if (photoUrl.includes('/thumb_')) return photoUrl;
    const lastSlash = photoUrl.lastIndexOf('/');
    if (lastSlash !== -1) {
      return photoUrl.substring(0, lastSlash + 1) + 'thumb_' + photoUrl.substring(lastSlash + 1);
    }
  }
  return photoUrl;
}

/**
 * Fast client-side thumbnail generator (max 240px, quality 0.72, ~10-20KB).
 */
export async function generateThumbnail(fileOrDataUrl, maxWidth = 240, quality = 0.72) {
  return compressImage(fileOrDataUrl, maxWidth, quality);
}

function withTimeout(promise, ms = 7000, fallbackVal = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackVal), ms))
  ]);
}
export const AFRICAN_CHILD_PORTRAITS = {
  missing: [
    "/assets/children/child-01.webp", // Garçon ~8 ans, teint noir, cheveux courts, regard face direct (Kevin Martin)
    "/assets/children/child-02.webp", // Fillette ~6 ans, teint marron chaud, tresses fines avec perles (Amina K.)
    "/assets/children/child-03.webp", // Garçon ~10 ans, teint noir profond, boucles courtes, t-shirt vert (Daniel T.)
    "/assets/children/child-04.webp", // Fillette ~5 ans, teint ébène, pompons frisés naturels (Fatima)
    "/assets/children/child-06.webp", // Fillette ~9 ans, teint marron, chignons tressés, port serein (Binta S.)
    "/assets/children/child-07.webp", // Garçon ~11 ans, teint foncé, coupe soignée, regard attentif (Emmanuel T.)
    "/assets/children/child-13.webp", // Garçon ~10 ans, teint chaud, t-shirt bleu cobalt
    "/assets/children/child-14.webp"  // Fillette ~6 ans, teint ébène, boucles naturelles
  ],
  found: [
    "/assets/children/child-05.webp", // Garçon ~7 ans, teint noir chaud, dégradé soigné, polo marine (Marc / Enfant trouvé)
    "/assets/children/child-08.webp", // Fillette ~7 ans, teint brun lumineux, afro puff, profil doux (Fillette trouvée)
    "/assets/children/child-09.webp", // Garçon ~5 ans, teint ébène, t-shirt rouge, regard innocent (Enfant trouvé)
    "/assets/children/child-10.webp", // Jeune fille ~11 ans, teint marron, micro-tresses élégantes (Enfant trouvée)
    "/assets/children/child-11.webp", // Garçon ~9 ans, teint châtain foncé, afro texturé (Enfant trouvé)
    "/assets/children/child-12.webp"  // Fillette ~8 ans, teint foncé, tresses régulières, t-shirt mauve (Enfant trouvée)
  ]
};

export const NEUTRAL_CHILD_PHOTO_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 240'%3E%3Crect width='200' height='240' fill='%23F1F5F9'/%3E%3Cg fill='%2394A3B8'%3E%3Ccircle cx='100' cy='85' r='36' fill='%23CBD5E1'/%3E%3Cpath d='M40 210c0-33.137 26.863-60 60-60s60 26.863 60 60z' fill='%23CBD5E1'/%3E%3Ctext x='100' y='225' font-family='system-ui, -apple-system, sans-serif' font-size='12' font-weight='600' text-anchor='middle' fill='%2364748B'%3EPhoto non fournie%3C/text%3E%3C/g%3E%3C/svg%3E";

export function getDefaultChildPortrait(gender = "", index = 0, isFound = false) {
  if (isFound) {
    const list = AFRICAN_CHILD_PORTRAITS.found;
    return list[Math.abs(index) % list.length];
  }
  const list = AFRICAN_CHILD_PORTRAITS.missing;
  return list[Math.abs(index) % list.length];
}

const DEMO_MISSING_REPORTS = [
  {
    id: "m-1",
    name: "Kevin Martin",
    age: 8,
    gender: "garcon",
    height: "1m20",
    location: "Yaoundé, Centre",
    date: "2024-05-12",
    time: "14:30",
    status: "Published",
    urgency: "Urgent",
    photo: "/assets/children/child-01.webp",
    physicalDescription: "Teint noir, cheveux crépus coupés courts, regard calme et attentif.",
    clothingDescription: "Portait un t-shirt bleu marine, un short en jean et des baskets noires.",
    relationship: "mere",
    notes: "Kevin s'est éloigné de notre stand au marché de Mvog-Mbi et n'est pas revenu.",
    type: "missing",
    createdAt: "2024-05-12T14:30:00Z"
  },
  {
    id: "m-2",
    name: "Amina K.",
    age: 6,
    gender: "fille",
    height: "1m10",
    location: "Douala, Bonanjo",
    date: "2024-05-11",
    time: "09:15",
    status: "Published",
    urgency: "Nouveau",
    photo: "/assets/children/child-02.webp",
    physicalDescription: "Teint marron chaud, tresses soignées avec petites perles, doux sourire amical.",
    clothingDescription: "Robe rose à fleurs et petites sandales blanches.",
    relationship: "pere",
    notes: "A été aperçue pour la dernière fois près de l'école primaire de Bonanjo.",
    type: "missing",
    createdAt: "2024-05-11T09:15:00Z"
  },
  {
    id: "m-3",
    name: "Daniel T.",
    age: 10,
    gender: "garcon",
    height: "1m35",
    location: "Bafoussam, Kouekong",
    date: "2024-05-10",
    time: "18:45",
    status: "Published",
    urgency: "Nouveau",
    photo: "/assets/children/child-03.webp",
    physicalDescription: "Teint noir foncé, boucles courtes naturelles, allure attentive.",
    clothingDescription: "T-shirt en coton vert forêt et short de sport sombre.",
    relationship: "tuteur",
    notes: "S'est perdu après un entraînement au stade annexe de Kouekong.",
    type: "missing",
    createdAt: "2024-05-10T18:45:00Z"
  },
  {
    id: "m-4",
    name: "Fatima",
    age: 5,
    gender: "fille",
    height: "1m00",
    location: "Nkongsamba",
    date: "2024-05-09",
    time: "12:00",
    status: "Published",
    urgency: "Recherche",
    photo: "/assets/children/child-04.webp",
    physicalDescription: "Teint ébène, petits pompons frisés naturels, grands yeux expressifs et calmes.",
    clothingDescription: "Haut jaune à motif et sandales confortables.",
    relationship: "mere",
    notes: "Disparue près du marché de Nkongsamba alors que nous faisions des courses.",
    type: "missing",
    createdAt: "2024-05-09T12:00:00Z"
  },
  {
    id: "m-5",
    name: "Emmanuel T.",
    age: 11,
    gender: "garcon",
    height: "1m40",
    location: "Yaoundé, Mokolo",
    date: "2024-05-08",
    time: "16:20",
    status: "Published",
    urgency: "Urgent",
    photo: "/assets/children/child-07.webp",
    physicalDescription: "Teint foncé, cheveux coupés très court, regard direct et posé.",
    clothingDescription: "Pull gris chiné et pantalon en toile beige.",
    relationship: "pere",
    notes: "Aperçu pour la dernière fois près de l'avenue principale de Mokolo.",
    type: "missing",
    createdAt: "2024-05-08T16:20:00Z"
  },
  {
    id: "m-6",
    name: "Binta S.",
    age: 9,
    gender: "fille",
    height: "1m25",
    location: "Garoua",
    date: "2024-05-07",
    time: "11:00",
    status: "Published",
    urgency: "Nouveau",
    photo: "/assets/children/child-06.webp",
    physicalDescription: "Teint brun riche, tresses soignées relevées en deux petits chignons, port serein.",
    clothingDescription: "Robe en pagne imprimé bleu et blanc.",
    relationship: "mere",
    notes: "Disparue lors de la sortie des classes à Garoua.",
    type: "missing",
    createdAt: "2024-05-07T11:00:00Z"
  }
];

const DEMO_FOUND_REPORTS = [
  {
    id: "f-1",
    name: "Marc N.",
    age: 7,
    gender: "garcon",
    height: "Env. 1m15",
    location: "Yaoundé, Avenue Kennedy",
    date: "2024-05-14",
    time: "10:15",
    status: "Published",
    urgency: "Sécurisé",
    photo: "/assets/children/child-05.webp",
    physicalDescription: "Teint noir chaud, coupe soignée avec dégradé, très calme et poli. Dit s'appeler Marc.",
    clothingDescription: "Polo bleu marine propre et pantalon de sport.",
    currentSafeLocation: "Poste de Police du 1er Arrondissement",
    gps: "3.8666° N, 11.5167° E",
    type: "found",
    createdAt: "2024-05-14T10:15:00Z"
  },
  {
    id: "f-2",
    name: "Sandra M.",
    age: 7,
    gender: "fille",
    height: "Env. 1m15",
    location: "Douala, Marché Central",
    date: "2024-05-13",
    time: "15:40",
    status: "Published",
    urgency: "Recherche Famille",
    photo: "/assets/children/child-08.webp",
    physicalDescription: "Teint brun lumineux, pompon afro naturel attaché avec soin, expression douce et rassurée.",
    clothingDescription: "T-shirt en coton pastel et jupe plissée.",
    currentSafeLocation: "Orphelinat Saint-Jean de Douala",
    gps: "4.0500° N, 9.7000° E",
    type: "found",
    createdAt: "2024-05-13T15:40:00Z"
  },
  {
    id: "f-3",
    name: "Paul K.",
    age: 5,
    gender: "garcon",
    height: "Env. 1m05",
    location: "Bafoussam, Centre-ville",
    date: "2024-05-12",
    time: "08:30",
    status: "Published",
    urgency: "Sécurisé",
    photo: "/assets/children/child-09.webp",
    physicalDescription: "Teint ébène profond, joues douces, boucles naturelles courtes, regard innocent.",
    clothingDescription: "T-shirt rouge en coton et short bleu nuit.",
    currentSafeLocation: "Centre de Protection de l'Enfance de Bafoussam",
    gps: "5.4778° N, 10.4167° E",
    type: "found",
    createdAt: "2024-05-12T08:30:00Z"
  },
  {
    id: "f-4",
    name: "Aïcha B.",
    age: 11,
    gender: "fille",
    height: "Env. 1m38",
    location: "Yaoundé, Bastos",
    date: "2024-05-11",
    time: "17:00",
    status: "Published",
    urgency: "Recherche Famille",
    photo: "/assets/children/child-10.webp",
    physicalDescription: "Teint marron clair, micro-tresses soignées tombant sur les épaules, expression posée.",
    clothingDescription: "Haut en lin beige crème et pantalon sombre.",
    currentSafeLocation: "Foyer d'Accueil de l'Espoir, Yaoundé",
    gps: "3.8820° N, 11.5120° E",
    type: "found",
    createdAt: "2024-05-11T17:00:00Z"
  },
  {
    id: "f-5",
    name: "David M.",
    age: 9,
    gender: "garcon",
    height: "Env. 1m28",
    location: "Douala, Akwa",
    date: "2024-05-10",
    time: "14:10",
    status: "Published",
    urgency: "Sécurisé",
    photo: "/assets/children/child-11.webp",
    physicalDescription: "Teint châtain foncé, cheveux afro texturés courts, regard vif.",
    clothingDescription: "T-shirt de sport blanc et vert, baskets grises.",
    currentSafeLocation: "Commissariat du 2e Arrondissement Douala",
    gps: "4.0530° N, 9.7050° E",
    type: "found",
    createdAt: "2024-05-10T14:10:00Z"
  },
  {
    id: "f-6",
    name: "Grace T.",
    age: 8,
    gender: "fille",
    height: "Env. 1m20",
    location: "Kribi, Centre",
    date: "2024-05-09",
    time: "16:45",
    status: "Published",
    urgency: "Recherche Famille",
    photo: "/assets/children/child-12.webp",
    physicalDescription: "Teint sombre uniforme, tresses régulières propres, regard clair et serein.",
    clothingDescription: "T-shirt mauve et pantacourt noir.",
    currentSafeLocation: "Mission Catholique de Kribi",
    gps: "2.9370° N, 9.9070° E",
    type: "found",
    createdAt: "2024-05-09T16:45:00Z"
  }
];

export const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='60' fill='%23ECE8FF'/%3E%3Cpath d='M60 28c11.045 0 20 8.955 20 20s-8.955 20-20 20-20-8.955-20-20 8.955-20 20-20zm0 48c18.336 0 34 9.168 34 22v4H26v-4c0-12.832 15.664-22 34-22z' fill='%23532CE6'/%3E%3C/svg%3E";

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

let _inMemoryMissing = null;
let _inMemoryFound = null;

function safeSetLocalStorage(key, value) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`LocalStorage note for ${key}:`, e);
    // If saving failed due to size quota (e.g. large base64 image strings),
    // save an optimized version without breaking while in-memory cache holds full image
    try {
      if (Array.isArray(value)) {
        const lean = value.map(item => {
          if (!item) return item;
          let p = item.photo;
          if (p && typeof p === 'string' && p.startsWith('data:') && p.length > 50000) {
            p = NEUTRAL_CHILD_PHOTO_PLACEHOLDER;
          }
          return { ...item, photo: p };
        });
        localStorage.setItem(key, JSON.stringify(lean));
      }
    } catch (e2) {
      console.warn(`Failed to store fallback lean version for ${key}:`, e2);
    }
  }
}

function initLocalStorage() {
  if (typeof window === "undefined") return;
  const dbVersion = "v12_raydar_reports_engine_newest_first";
  const currentVer = localStorage.getItem("reports_db_version");
  
  let missing = [];
  let found = [];
  try {
    missing = JSON.parse(localStorage.getItem("missing_reports") || "[]");
    found = JSON.parse(localStorage.getItem("found_reports") || "[]");
  } catch (e) {}

  const hasUnsplash = (list) => list.some(r => r && r.photo && r.photo.includes("unsplash.com"));

  if (currentVer !== dbVersion || !localStorage.getItem("missing_reports") || !localStorage.getItem("found_reports") || hasUnsplash(missing) || hasUnsplash(found)) {
    // Preserve any real user-created reports
    const userMissing = missing.filter(r => r && !r.id.startsWith("m-") && (!r.photo || !r.photo.includes("unsplash.com")));
    const userFound = found.filter(r => r && !r.id.startsWith("f-") && (!r.photo || !r.photo.includes("unsplash.com")));

    const initialMissing = mergeReports(userMissing, DEMO_MISSING_REPORTS);
    const initialFound = mergeReports(userFound, DEMO_FOUND_REPORTS);

    safeSetLocalStorage("missing_reports", initialMissing);
    safeSetLocalStorage("found_reports", initialFound);
    try { localStorage.setItem("reports_db_version", dbVersion); } catch (e) {}
  }
  setTimeout(() => {
    if (reportService && typeof reportService.syncReportsFromSupabase === 'function') {
      reportService.syncReportsFromSupabase();
    }
  }, 100);
}

export function isDemoPhoto(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('/assets/children/') || url.includes('/assets/avatars/') || url === DEFAULT_AVATAR;
}

function mergeReports(localList, remoteList, maxLimit = 4) {
  const map = new Map();
  // 1. Add local reports (demo fallback, cached items)
  (localList || []).forEach(r => {
    if (r && r.id) map.set(r.id, r);
  });
  // 2. Authoritative remote reports from Supabase PostgreSQL (Source of Truth)
  (remoteList || []).forEach(r => {
    if (r && r.id) {
      if (!map.has(r.id)) {
        map.set(r.id, r);
      } else {
        const local = map.get(r.id);
        const photo = (r.photo && !isDemoPhoto(r.photo)) ? r.photo : (local.photo || r.photo);
        map.set(r.id, {
          ...local,
          ...r,
          photo
        });
      }
    }
  });
  const merged = Array.from(map.values());
  // Sort ALL reports strictly newest-first (descending createdAt)
  merged.sort((a, b) => {
    const timeA = new Date(a.createdAt || a.created_at || (a.date ? a.date : 0)).getTime() || 0;
    const timeB = new Date(b.createdAt || b.created_at || (b.date ? b.date : 0)).getTime() || 0;
    return timeB - timeA;
  });
  return merged.slice(0, maxLimit);
}

export const reportService = {
  DEFAULT_AVATAR,
  NEUTRAL_CHILD_PHOTO_PLACEHOLDER,
  AFRICAN_CHILD_PORTRAITS,
  getDefaultChildPortrait,

  // Fast synchronous accessor for instant UI rendering with 0ms delay
  getCachedRecentReports(limit = 4) {
    try {
      const missing = this.getMissingReports() || [];
      const found = this.getFoundReports() || [];
      const combined = [...missing, ...found];
      
      // Deduplicate by ID
      const map = new Map();
      combined.forEach(r => {
        if (r && r.id && !map.has(r.id)) {
          map.set(r.id, r);
        }
      });
      const list = Array.from(map.values());
      
      // Sort strictly newest-first (descending created_at / createdAt)
      list.sort((a, b) => {
        const timeA = new Date(a.created_at || a.createdAt || (a.date ? a.date : 0)).getTime() || 0;
        const timeB = new Date(b.created_at || b.createdAt || (b.date ? b.date : 0)).getTime() || 0;
        return timeB - timeA;
      });

      return list.slice(0, limit);
    } catch (e) {
      console.warn("[REPORT TRACE] getCachedRecentReports error:", e);
      return [...DEMO_MISSING_REPORTS, ...DEMO_FOUND_REPORTS].slice(0, limit);
    }
  },

  async getRecentRealReports(limit = 4) {
    try {
      const missingColumns = 'id, child_full_name, child_age, child_gender, last_seen_location, last_seen_date, last_seen_time, physical_description, clothing_description, child_photo_url, status, created_at';
      const foundColumns = 'id, child_full_name, estimated_age, child_gender, found_location, found_date, found_time, physical_description, clothing_description, current_location_of_child, child_photo_url, status, created_at';

      const [missingRes, foundRes] = await Promise.allSettled([
        withTimeout(supabase.from('missing_reports').select(missingColumns).order('created_at', { ascending: false }).limit(limit), 6000, { data: [] }),
        withTimeout(supabase.from('found_reports').select(foundColumns).order('created_at', { ascending: false }).limit(limit), 6000, { data: [] })
      ]);

      const realReports = [];

      if (missingRes.status === 'fulfilled' && Array.isArray(missingRes.value?.data)) {
        missingRes.value.data.forEach(row => {
          const isFound = row.status === 'Trouvé' || (row.physical_description && row.physical_description.includes('[TROUVÉ]'));
          const rawPhoto = row.child_photo_url || null;
          // Protect from oversized legacy base64 strings
          const cleanPhoto = (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.startsWith('data:') && rawPhoto.length > 50000) ? null : rawPhoto;
          realReports.push({
            id: row.id,
            name: row.child_full_name || (isFound ? 'Enfant trouvé' : 'Enfant disparu'),
            age: row.child_age,
            gender: row.child_gender,
            location: row.last_seen_location,
            date: row.last_seen_date,
            time: row.last_seen_time,
            physicalDescription: row.physical_description,
            clothingDescription: row.clothing_description,
            photo: cleanPhoto,
            thumbnail: getThumbnailUrl(cleanPhoto),
            status: row.status || (isFound ? 'Trouvé' : 'Published'),
            urgency: isFound ? 'Trouvé' : (row.status === 'Urgent' ? 'Urgent' : 'Nouveau'),
            created_at: row.created_at,
            createdAt: row.created_at,
            type: isFound ? 'found' : 'missing'
          });
        });
      }

      if (foundRes.status === 'fulfilled' && Array.isArray(foundRes.value?.data)) {
        foundRes.value.data.forEach(row => {
          if (!realReports.some(r => r.id === row.id)) {
            const rawPhoto = row.child_photo_url || null;
            const cleanPhoto = (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.startsWith('data:') && rawPhoto.length > 50000) ? null : rawPhoto;
            realReports.push({
              id: row.id,
              name: row.child_full_name || 'Enfant trouvé',
              age: row.estimated_age || null,
              gender: row.child_gender,
              location: row.found_location,
              date: row.found_date,
              time: row.found_time,
              physicalDescription: row.physical_description,
              clothingDescription: row.clothing_description,
              photo: cleanPhoto,
              thumbnail: getThumbnailUrl(cleanPhoto),
              status: row.status || 'Trouvé',
              urgency: 'Trouvé',
              created_at: row.created_at,
              createdAt: row.created_at,
              type: 'found'
            });
          }
        });
      }

      // Merge with in-memory and local user reports
      const localMissing = (this.getMissingReports() || []).filter(r => r && r.id && !r.id.startsWith('m-'));
      const localFound = (this.getFoundReports() || []).filter(r => r && r.id && !r.id.startsWith('f-'));
      
      [...localMissing, ...localFound].forEach(localR => {
        const existingIdx = realReports.findIndex(r => r.id === localR.id);
        if (existingIdx === -1) {
          realReports.push(localR);
        } else {
          if (localR.photo && !realReports[existingIdx].photo) {
            realReports[existingIdx].photo = localR.photo;
          }
          if (localR.name && realReports[existingIdx].name === 'Enfant trouvé') {
            realReports[existingIdx].name = localR.name;
          }
        }
      });

      // If we have fewer real reports than requested limit, fill the rest with demo reports
      const allDemo = [...DEMO_MISSING_REPORTS, ...DEMO_FOUND_REPORTS];
      allDemo.forEach(demo => {
        if (realReports.length < limit && !realReports.some(r => r.id === demo.id)) {
          realReports.push(demo);
        }
      });

      // Sort strictly newest-first (descending created_at)
      realReports.sort((a, b) => {
        const timeA = new Date(a.created_at || a.createdAt || (a.date ? a.date : 0)).getTime() || 0;
        const timeB = new Date(b.created_at || b.createdAt || (b.date ? b.date : 0)).getTime() || 0;
        return timeB - timeA;
      });

      return realReports.slice(0, limit);
    } catch (e) {
      console.warn("[REPORT TRACE] Error getting recent real reports:", e);
      return this.getCachedRecentReports(limit);
    }
  },

  async getReportByIdRemote(id) {
    if (!id) return null;
    try {
      const [missingRes, foundRes] = await Promise.allSettled([
        withTimeout(supabase.from('missing_reports').select('*').eq('id', id).maybeSingle(), 6000, { data: null }),
        withTimeout(supabase.from('found_reports').select('*').eq('id', id).maybeSingle(), 6000, { data: null })
      ]);

      if (missingRes.status === 'fulfilled' && missingRes.value?.data) {
        const row = missingRes.value.data;
        const isFound = row.status === 'Trouvé' || (row.physical_description && row.physical_description.includes('[TROUVÉ]'));
        return {
          id: row.id,
          reporterId: row.reporter_id,
          name: row.child_full_name,
          age: row.child_age,
          gender: row.child_gender,
          location: row.last_seen_location,
          date: row.last_seen_date,
          time: row.last_seen_time,
          physicalDescription: row.physical_description,
          clothingDescription: row.clothing_description,
          notes: row.incident_description,
          contactPhone: row.emergency_contact_phone,
          photo: row.child_photo_url || null,
          status: row.status || (isFound ? 'Trouvé' : 'Published'),
          urgency: isFound ? 'Recherche Famille' : (row.status === 'Urgent' ? 'Urgent' : 'Nouveau'),
          type: isFound ? 'found' : 'missing',
          createdAt: row.created_at
        };
      }

      if (foundRes.status === 'fulfilled' && foundRes.value?.data) {
        const row = foundRes.value.data;
        return {
          id: row.id,
          reporterId: row.reporter_id,
          name: row.child_full_name || 'Enfant trouvé',
          age: null,
          gender: row.child_gender,
          location: row.found_location,
          date: row.found_date,
          time: row.found_time,
          physicalDescription: row.physical_description,
          clothingDescription: row.clothing_description,
          photo: row.child_photo_url || null,
          status: row.status || 'Trouvé',
          urgency: 'Recherche Famille',
          type: 'found',
          createdAt: row.created_at
        };
      }
    } catch (e) {
      console.warn("[REPORT TRACE] getReportByIdRemote error:", e);
    }
    return this.getReportById(id);
  },

  getMissingReports() {
    if (_inMemoryMissing && _inMemoryMissing.length > 0) {
      return [..._inMemoryMissing].sort((a, b) => {
        const timeA = new Date(a.createdAt || a.created_at || (a.date ? a.date : 0)).getTime() || 0;
        const timeB = new Date(b.createdAt || b.created_at || (b.date ? b.date : 0)).getTime() || 0;
        return timeB - timeA;
      }).slice(0, MAX_RETAINED_MISSING_REPORTS);
    }
    initLocalStorage();
    try {
      const reports = JSON.parse(localStorage.getItem("missing_reports") || "[]");
      const list = reports.length > 0 ? reports : DEMO_MISSING_REPORTS;
      _inMemoryMissing = list;
      return list.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.created_at || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || b.created_at || 0).getTime() || 0;
        return timeB - timeA;
      }).slice(0, MAX_RETAINED_MISSING_REPORTS);
    } catch (e) {
      return DEMO_MISSING_REPORTS.slice(0, MAX_RETAINED_MISSING_REPORTS);
    }
  },

  getFoundReports() {
    if (_inMemoryFound && _inMemoryFound.length > 0) {
      return [..._inMemoryFound].sort((a, b) => {
        const timeA = new Date(a.createdAt || a.created_at || (a.date ? a.date : 0)).getTime() || 0;
        const timeB = new Date(b.createdAt || b.created_at || (b.date ? b.date : 0)).getTime() || 0;
        return timeB - timeA;
      }).slice(0, MAX_RETAINED_FOUND_REPORTS);
    }
    initLocalStorage();
    try {
      const reports = JSON.parse(localStorage.getItem("found_reports") || "[]");
      const list = reports.length > 0 ? reports : DEMO_FOUND_REPORTS;
      _inMemoryFound = list;
      return list.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.created_at || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || b.created_at || 0).getTime() || 0;
        return timeB - timeA;
      }).slice(0, MAX_RETAINED_FOUND_REPORTS);
    } catch (e) {
      return DEMO_FOUND_REPORTS.slice(0, MAX_RETAINED_FOUND_REPORTS);
    }
  },

  async fetchMissingReports(force = true) {
    await this.syncReportsFromSupabase(force);
    return this.getMissingReports();
  },

  async fetchFoundReports(force = true) {
    await this.syncReportsFromSupabase(force);
    return this.getFoundReports();
  },

  async getCurrentUserId() {
    if (cachedCurrentUserId) return cachedCurrentUserId;
    try {
      const { data: { session } } = await withTimeout(supabase.auth.getSession(), 3000, { data: { session: null } });
      if (session && session.user) {
        cachedCurrentUserId = session.user.id;
        return session.user.id;
      }
    } catch (e) {}
    let guestId = typeof localStorage !== 'undefined' ? localStorage.getItem('guardians_local_user_id') : null;
    if (!guestId) {
      guestId = 'user_' + Math.random().toString(36).substring(2, 9);
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('guardians_local_user_id', guestId); } catch (e) {}
      }
    }
    return guestId;
  },

  // Authoritative resolver for reporter_id mapping:
  // auth.uid() -> profiles.user_id -> profiles.id -> reports.reporter_id
  async getSupabaseReporterUuid() {
    try {
      // 1. Try public.current_profile_id() RPC (fastest, guaranteed match)
      const { data: rpcId } = await withTimeout(
        supabase.rpc('current_profile_id'),
        2000,
        { data: null }
      );
      if (rpcId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rpcId)) {
        return rpcId;
      }

      // 2. Fetch authenticated user session
      const { data: { session } } = await withTimeout(supabase.auth.getSession(), 2000, { data: { session: null } });
      let authUid = session?.user?.id;
      if (!authUid) {
        const { data: { user } } = await withTimeout(supabase.auth.getUser(), 2000, { data: { user: null } });
        authUid = user?.id;
      }

      if (authUid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUid)) {
        // Query profiles by user_id to get profiles.id
        const { data: profile } = await withTimeout(
          supabase.from('profiles').select('id').eq('user_id', authUid).maybeSingle(),
          2000,
          { data: null }
        );
        if (profile?.id) {
          return profile.id;
        }

        // If profile doesn't exist yet, upsert minimal profile and return its id
        const userEmail = session?.user?.email || '';
        const userMetaName = session?.user?.user_metadata?.full_name || 'Gardien RAYDAR';
        const { data: newProf } = await withTimeout(
          supabase.from('profiles').upsert({
            user_id: authUid,
            email: userEmail,
            full_name: userMetaName,
            username: 'user_' + authUid.substring(0, 8),
            role: 'Guardian'
          }, { onConflict: 'user_id' }).select('id').maybeSingle(),
          2500,
          { data: null }
        );
        if (newProf?.id) {
          return newProf.id;
        }
      }

      // Query any existing profile as fallback
      const { data: fallbackProf } = await withTimeout(
        supabase.from('profiles').select('id').limit(1).maybeSingle(),
        1500,
        { data: null }
      );
      if (fallbackProf?.id) {
        return fallbackProf.id;
      }
    } catch (e) {
      console.warn('[REPORT TRACE] getSupabaseReporterUuid notice:', e);
    }
    return null;
  },

  // Authoritative resolver for current authenticated user's UUID matching auth.uid()
  async getAuthenticatedUserId() {
    try {
      const { data: { session } } = await withTimeout(supabase.auth.getSession(), 3000, { data: { session: null } });
      if (session?.user?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.user.id)) {
        return session.user.id;
      }
      const { data: { user } } = await withTimeout(supabase.auth.getUser(), 2000, { data: { user: null } });
      if (user?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) {
        return user.id;
      }
    } catch (e) {}

    // Check localStorage fallback for active session user
    if (typeof localStorage !== 'undefined') {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.includes('auth-token') || key.includes('raydar_auth'))) {
            const raw = localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              const uid = parsed?.user?.id || parsed?.id;
              if (uid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
                return uid;
              }
            }
          }
        }
      } catch (e) {}
    }

    return null;
  },

  // Authoritative Missing Report child photo upload:
  // - Target bucket: 'missing-reports'
  // - Storage path begins with {auth.uid()}/filename
  // - Uploads actual binary Blob file (image/jpeg, image/png, image/webp)
  // - ZERO base64 fallback in database
  // - Returns Supabase Storage public URL
  async uploadMissingReportPhoto(fileOrBase64, customFilename = null) {
    if (!fileOrBase64) return null;

    // If it's already a valid Supabase Storage public URL for missing-reports, return as-is
    if (typeof fileOrBase64 === 'string' && fileOrBase64.includes('/storage/v1/object/public/missing-reports/')) {
      return fileOrBase64;
    }

    console.log('[STORAGE] Starting Missing Report photo upload to bucket "missing-reports"...');
    try {
      // 1. Get authenticated user UUID required for {auth.uid()}/ path in RLS
      const authUid = await this.getAuthenticatedUserId();

      // 2. Client-side compression if image data
      let optimized = fileOrBase64;
      if (typeof window !== 'undefined') {
        try {
          optimized = await compressImage(fileOrBase64, 1200, 0.85);
        } catch (compErr) {
          console.warn('[STORAGE] Notice during image compression:', compErr);
          optimized = fileOrBase64;
        }
      }

      // If user is unauthenticated or in guest mode, use server storage upload endpoint
      if (!authUid) {
        console.log('[STORAGE] Unauthenticated / guest session detected: proxying upload to /api/storage/upload');
        let dataUriToSend = optimized;
        if (optimized instanceof File || optimized instanceof Blob) {
          dataUriToSend = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(optimized);
          });
        }
        if (typeof dataUriToSend === 'string' && dataUriToSend.startsWith('data:')) {
          try {
            const srvRes = await fetch(`${getApiBaseUrl()}/api/storage/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileData: dataUriToSend, bucket: 'missing-reports', prefix: customFilename || 'child' })
            });
            if (srvRes.ok) {
              const srvJson = await srvRes.json();
              if (srvJson?.success && srvJson.url) {
                console.log('[STORAGE] Server-side storage upload succeeded:', srvJson.url);
                return srvJson.url;
              }
            }
          } catch (srvErr) {
            console.warn('[STORAGE] Server proxy upload notice:', srvErr);
          }
          return dataUriToSend;
        }
        return null;
      }

      // 3. Convert input to actual binary Blob with valid image content-type
      let blob = null;
      let fileExt = 'jpg';
      let contentType = 'image/jpeg';

      if (typeof optimized === 'string' && optimized.startsWith('data:')) {
        const mimeMatch = optimized.match(/^data:([^;]+);base64,/);
        if (mimeMatch && mimeMatch[1]) {
          const rawMime = mimeMatch[1].toLowerCase();
          if (rawMime.includes('png')) {
            contentType = 'image/png';
            fileExt = 'png';
          } else if (rawMime.includes('webp')) {
            contentType = 'image/webp';
            fileExt = 'webp';
          } else {
            contentType = 'image/jpeg';
            fileExt = 'jpg';
          }
        }
        const res = await fetch(optimized);
        blob = await res.blob();
      } else if (optimized instanceof File || optimized instanceof Blob) {
        blob = optimized;
        const rawType = (optimized.type || '').toLowerCase();
        if (rawType.includes('png')) {
          contentType = 'image/png';
          fileExt = 'png';
        } else if (rawType.includes('webp')) {
          contentType = 'image/webp';
          fileExt = 'webp';
        } else {
          contentType = 'image/jpeg';
          fileExt = 'jpg';
        }
      }

      if (!blob) {
        console.warn('[STORAGE] Failed to create binary blob for child photo');
        return null;
      }

      // 4. Construct storage path strictly beginning with {auth.uid()}/filename
      const filename = customFilename 
        ? `${customFilename.replace(/[^a-zA-Z0-9_-]/g, '_')}.${fileExt}`
        : `child_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `${authUid}/${filename}`;
      console.log(`[STORAGE] Uploading binary file to missing-reports at path: ${filePath}`);

      // Prepare lightweight thumbnail client-side
      let thumbDataUri = null;
      try {
        thumbDataUri = await generateThumbnail(fileOrBase64, 240, 0.72);
      } catch (tErr) {
        console.warn('[STORAGE] Non-blocking thumbnail generation notice:', tErr);
      }

      // 5. Upload real binary file to Supabase Storage bucket 'missing-reports'
      const { data: uploadData, error: uploadErr } = await withTimeout(
        supabase.storage
          .from('missing-reports')
          .upload(filePath, blob, {
            contentType,
            cacheControl: '604800',
            upsert: true
          }),
        4000,
        { data: null, error: { message: 'Storage upload timeout after 4s' } }
      );

      if (uploadErr) {
        console.warn('[STORAGE] Client-side upload to missing-reports failed/timed out, invoking server storage upload:', uploadErr.message || uploadErr);
        let dataUriToSend = null;
        if (typeof optimized === 'string' && optimized.startsWith('data:')) {
          dataUriToSend = optimized;
        } else if (blob) {
          dataUriToSend = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        }

        if (dataUriToSend) {
          try {
            const srvRes = await withTimeout(
              fetch(`${getApiBaseUrl()}/api/storage/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fileData: dataUriToSend,
                  thumbnailData: thumbDataUri,
                  bucket: 'missing-reports',
                  prefix: customFilename || 'missing',
                  userId: authUid
                })
              }),
              12000,
              null
            );
            if (srvRes && srvRes.ok) {
              const srvJson = await srvRes.json();
              if (srvJson?.success && srvJson.url) {
                console.log('[STORAGE] Server-side missing photo upload succeeded:', srvJson.url);
                return srvJson.url;
              }
            }
          } catch (srvErr) {
            console.warn('[STORAGE] Server-side storage fallback error:', srvErr);
          }
          return dataUriToSend;
        }
        return null;
      }

      // Concurrently upload thumbnail to storage if available
      if (thumbDataUri && typeof thumbDataUri === 'string' && thumbDataUri.startsWith('data:')) {
        try {
          const thumbRes = await fetch(thumbDataUri);
          const thumbBlob = await thumbRes.blob();
          const thumbPath = `${authUid}/thumb_${filename}`;
          supabase.storage
            .from('missing-reports')
            .upload(thumbPath, thumbBlob, {
              contentType: 'image/jpeg',
              cacheControl: '604800',
              upsert: true
            })
            .then(() => console.log('[STORAGE] Missing report thumbnail saved:', thumbPath))
            .catch(err => console.warn('[STORAGE] Thumbnail upload notice:', err));
        } catch (tUploadErr) {
          console.warn('[STORAGE] Non-blocking thumbnail upload notice:', tUploadErr);
        }
      }

      // 6. Retrieve public storage URL
      const { data: publicUrlData } = supabase.storage
        .from('missing-reports')
        .getPublicUrl(filePath);

      const storageUrl = publicUrlData?.publicUrl || null;
      console.log('[STORAGE] Missing report photo successfully uploaded. Supabase Storage URL:', storageUrl);
      return storageUrl;
    } catch (err) {
      console.error('[STORAGE] Error in uploadMissingReportPhoto:', err);
      if (typeof fileOrBase64 === 'string' && fileOrBase64.startsWith('data:')) return fileOrBase64;
      return null;
    }
  },

  // Authoritative Found Report photo upload:
  // - Target bucket: 'found-reports' (fallback to 'avatars')
  // - Storage path begins with {auth.uid()}/filename
  // - Uploads actual binary Blob file (image/jpeg, image/png, image/webp)
  // - ZERO base64 in database
  // - Returns Supabase Storage public URL
  async uploadFoundReportPhoto(fileOrBase64, customFilename = null) {
    if (!fileOrBase64) return null;

    // If it's already a valid Supabase Storage public URL, return as-is
    if (typeof fileOrBase64 === 'string' && (
      fileOrBase64.includes('/storage/v1/object/public/found-reports/') ||
      fileOrBase64.includes('/storage/v1/object/public/avatars/') ||
      fileOrBase64.includes('/storage/v1/object/public/missing-reports/')
    )) {
      return fileOrBase64;
    }

    console.log('[STORAGE] Starting Found Report photo upload to bucket "found-reports"...');
    try {
      // 1. Get authenticated user UUID required for {auth.uid()}/ path in RLS
      const authUid = await this.getAuthenticatedUserId();

      // 2. Client-side compression if image data
      let optimized = fileOrBase64;
      if (typeof window !== 'undefined') {
        try {
          optimized = await compressImage(fileOrBase64, 1200, 0.85);
        } catch (compErr) {
          console.warn('[STORAGE] Notice during image compression:', compErr);
          optimized = fileOrBase64;
        }
      }

      // If user is unauthenticated or in guest mode, use server storage upload endpoint
      if (!authUid) {
        console.log('[STORAGE] Unauthenticated / guest session detected: proxying found report photo upload to /api/storage/upload');
        let dataUriToSend = optimized;
        if (optimized instanceof File || optimized instanceof Blob) {
          dataUriToSend = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(optimized);
          });
        }
        if (typeof dataUriToSend === 'string' && dataUriToSend.startsWith('data:')) {
          try {
            const srvRes = await fetch(`${getApiBaseUrl()}/api/storage/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileData: dataUriToSend, bucket: 'found-reports', prefix: customFilename || 'found' })
            });
            if (srvRes.ok) {
              const srvJson = await srvRes.json();
              if (srvJson?.success && srvJson.url) {
                console.log('[STORAGE] Server-side found photo upload succeeded:', srvJson.url);
                return srvJson.url;
              }
            }
          } catch (srvErr) {
            console.warn('[STORAGE] Server proxy upload notice:', srvErr);
          }
          return dataUriToSend;
        }
        return null;
      }

      // 3. Convert input to actual binary Blob with valid image content-type
      let blob = null;
      let fileExt = 'jpg';
      let contentType = 'image/jpeg';

      if (typeof optimized === 'string' && optimized.startsWith('data:')) {
        const mimeMatch = optimized.match(/^data:([^;]+);base64,/);
        if (mimeMatch && mimeMatch[1]) {
          const rawMime = mimeMatch[1].toLowerCase();
          if (rawMime.includes('png')) {
            contentType = 'image/png';
            fileExt = 'png';
          } else if (rawMime.includes('webp')) {
            contentType = 'image/webp';
            fileExt = 'webp';
          } else {
            contentType = 'image/jpeg';
            fileExt = 'jpg';
          }
        }
        const res = await fetch(optimized);
        blob = await res.blob();
      } else if (optimized instanceof File || optimized instanceof Blob) {
        blob = optimized;
        const rawType = (optimized.type || '').toLowerCase();
        if (rawType.includes('png')) {
          contentType = 'image/png';
          fileExt = 'png';
        } else if (rawType.includes('webp')) {
          contentType = 'image/webp';
          fileExt = 'webp';
        } else {
          contentType = 'image/jpeg';
          fileExt = 'jpg';
        }
      }

      if (!blob) {
        console.warn('[STORAGE] Failed to create binary blob for found child photo');
        if (typeof optimized === 'string' && optimized.startsWith('data:')) return optimized;
        return null;
      }

      // 4. Construct storage path strictly beginning with {auth.uid()}/filename
      const filename = customFilename 
        ? `${customFilename.replace(/[^a-zA-Z0-9_-]/g, '_')}.${fileExt}`
        : `found_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `${authUid}/${filename}`;
      console.log(`[STORAGE] Uploading binary file to found-reports at path: ${filePath}`);

      // Prepare lightweight thumbnail client-side
      let thumbDataUri = null;
      try {
        thumbDataUri = await generateThumbnail(fileOrBase64, 240, 0.72);
      } catch (tErr) {
        console.warn('[STORAGE] Non-blocking found thumbnail generation notice:', tErr);
      }

      // 5. Upload real binary file to Supabase Storage bucket 'found-reports'
      let uploadBucket = 'found-reports';
      let { data: uploadData, error: uploadErr } = await withTimeout(
        supabase.storage
          .from(uploadBucket)
          .upload(filePath, blob, {
            contentType,
            cacheControl: '604800',
            upsert: true
          }),
        4000,
        { data: null, error: { message: 'Storage upload timeout after 4s' } }
      );

      // If direct browser upload failed or timed out, proxy to authoritative server endpoint
      if (uploadErr) {
        console.warn('[STORAGE] Browser upload to found-reports notice:', uploadErr.message || uploadErr, '- invoking authoritative /api/storage/upload');
        let dataUriToSend = null;
        if (typeof optimized === 'string' && optimized.startsWith('data:')) {
          dataUriToSend = optimized;
        } else if (blob) {
          dataUriToSend = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        }

        if (dataUriToSend) {
          try {
            const srvRes = await withTimeout(
              fetch(`${getApiBaseUrl()}/api/storage/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fileData: dataUriToSend,
                  thumbnailData: thumbDataUri,
                  bucket: 'found-reports',
                  prefix: customFilename || 'found',
                  userId: authUid
                })
              }),
              12000,
              null
            );

            if (srvRes && srvRes.ok) {
              const srvJson = await srvRes.json();
              if (srvJson?.success && srvJson.url) {
                console.log('[STORAGE] Server-side storage upload succeeded:', srvJson.url);
                return srvJson.url;
              }
            }
          } catch (srvErr) {
            console.warn('[STORAGE] Server proxy upload error:', srvErr);
          }

          // Return dataUri so the authoritative create-found-report endpoint can upload it using service role
          console.log('[STORAGE] Passing image dataUri to create-found-report for server-side persistence');
          return dataUriToSend;
        }

        return null;
      }

      // Concurrently upload thumbnail to storage if available
      if (thumbDataUri && typeof thumbDataUri === 'string' && thumbDataUri.startsWith('data:')) {
        try {
          const thumbRes = await fetch(thumbDataUri);
          const thumbBlob = await thumbRes.blob();
          const thumbPath = `${authUid}/thumb_${filename}`;
          supabase.storage
            .from(uploadBucket)
            .upload(thumbPath, thumbBlob, {
              contentType: 'image/jpeg',
              cacheControl: '604800',
              upsert: true
            })
            .then(() => console.log('[STORAGE] Found report thumbnail saved:', thumbPath))
            .catch(err => console.warn('[STORAGE] Thumbnail upload notice:', err));
        } catch (tUploadErr) {
          console.warn('[STORAGE] Non-blocking found thumbnail upload notice:', tUploadErr);
        }
      }

      // 6. Retrieve public storage URL
      const { data: publicUrlData } = supabase.storage
        .from(uploadBucket)
        .getPublicUrl(filePath);

      const storageUrl = publicUrlData?.publicUrl || null;
      console.log('[STORAGE] Found report photo successfully uploaded. Supabase Storage URL:', storageUrl);
      return storageUrl;
    } catch (err) {
      console.error('[STORAGE] Error in uploadFoundReportPhoto:', err);
      if (typeof fileOrBase64 === 'string' && fileOrBase64.startsWith('data:')) return fileOrBase64;
      return null;
    }
  },

  // Authoritative Report Evidence upload:
  // - Target bucket: 'report-evidence'
  // - Storage path begins with {auth.uid()}/filename
  // - Uploads actual binary Blob file (application/pdf, image/jpeg, image/png, image/webp)
  // - Returns Supabase Storage URL reference
  async uploadReportEvidence(docItem, originalName = null, docType = 'doc') {
    if (!docItem) return null;

    // If already a Supabase Storage URL reference to report-evidence, return as-is
    if (typeof docItem === 'string' && 
        (docItem.includes('/storage/v1/object/public/report-evidence/') || 
         docItem.includes('/storage/v1/object/authenticated/report-evidence/'))) {
      return docItem;
    }

    console.log(`[STORAGE] Starting evidence document upload (${docType}) to bucket "report-evidence"...`);
    try {
      const authUid = await this.getAuthenticatedUserId();
      if (!authUid) {
        console.warn('[STORAGE] Cannot upload to report-evidence: User is not authenticated (auth.uid() required)');
        return null;
      }

      let dataToConvert = docItem;
      if (typeof docItem === 'object' && docItem.dataUrl) {
        dataToConvert = docItem.dataUrl;
        if (!originalName && docItem.name) originalName = docItem.name;
      }

      let blob = null;
      let fileExt = 'pdf';
      let contentType = 'application/pdf';

      if (typeof dataToConvert === 'string' && dataToConvert.startsWith('data:')) {
        const mimeMatch = dataToConvert.match(/^data:([^;]+);base64,/);
        if (mimeMatch && mimeMatch[1]) {
          const rawMime = mimeMatch[1].toLowerCase();
          if (rawMime.includes('pdf')) {
            contentType = 'application/pdf';
            fileExt = 'pdf';
          } else if (rawMime.includes('png')) {
            contentType = 'image/png';
            fileExt = 'png';
          } else if (rawMime.includes('webp')) {
            contentType = 'image/webp';
            fileExt = 'webp';
          } else {
            contentType = 'image/jpeg';
            fileExt = 'jpg';
          }
        }
        const res = await fetch(dataToConvert);
        blob = await res.blob();
      } else if (dataToConvert instanceof File || dataToConvert instanceof Blob) {
        blob = dataToConvert;
        const rawType = (dataToConvert.type || '').toLowerCase();
        if (rawType.includes('pdf')) {
          contentType = 'application/pdf';
          fileExt = 'pdf';
        } else if (rawType.includes('png')) {
          contentType = 'image/png';
          fileExt = 'png';
        } else if (rawType.includes('webp')) {
          contentType = 'image/webp';
          fileExt = 'webp';
        } else {
          contentType = 'image/jpeg';
          fileExt = 'jpg';
        }
      }

      if (!blob) {
        console.warn('[STORAGE] Failed to create binary blob for evidence document');
        return null;
      }

      const safeName = originalName 
        ? originalName.replace(/[^a-zA-Z0-9._-]/g, '_')
        : `${docType}_${Date.now()}.${fileExt}`;
      const filename = `${docType}_${Date.now()}_${safeName}`;
      const filePath = `${authUid}/${filename}`;
      console.log(`[STORAGE] Uploading evidence file to report-evidence at path: ${filePath}`);

      const { data: uploadData, error: uploadErr } = await withTimeout(
        supabase.storage
          .from('report-evidence')
          .upload(filePath, blob, {
            contentType,
            cacheControl: '3600',
            upsert: true
          }),
        10000,
        { data: null, error: { message: 'Storage evidence upload timeout after 10s' } }
      );

      if (uploadErr) {
        console.error('[STORAGE] Upload to report-evidence failed:', uploadErr.message || uploadErr);
        return null;
      }

      const { data: publicUrlData } = supabase.storage
        .from('report-evidence')
        .getPublicUrl(filePath);

      const storageUrl = publicUrlData?.publicUrl || filePath;
      console.log('[STORAGE] Evidence document uploaded. Storage reference:', storageUrl);
      return storageUrl;
    } catch (err) {
      console.error('[STORAGE] Error in uploadReportEvidence:', err);
      return null;
    }
  },

  // General upload dispatcher for compatibility across features
  async uploadFileToSupabaseStorage(fileOrBase64, bucketName = "avatars", reportType = "reports", reportId = null) {
    if (!fileOrBase64) return null;

    if (bucketName === "missing-reports") {
      return await this.uploadMissingReportPhoto(fileOrBase64);
    }
    if (bucketName === "found-reports") {
      return await this.uploadFoundReportPhoto(fileOrBase64);
    }
    if (bucketName === "report-evidence") {
      return await this.uploadReportEvidence(fileOrBase64, null, reportType);
    }

    console.log(`[STORAGE] uploadFileToSupabaseStorage starting for bucket: ${bucketName}, reportType: ${reportType}...`);
    try {
      const authUid = await this.getAuthenticatedUserId();
      const folder = authUid || 'public';
      
      const optimized = await compressImage(fileOrBase64, 1000, 0.82);
      let blob;
      let fileExt = "jpg";
      let contentType = "image/jpeg";

      if (typeof optimized === "string" && optimized.startsWith("data:")) {
        const mimeMatch = optimized.match(/^data:([^;]+);base64,/);
        if (mimeMatch && mimeMatch[1]) {
          contentType = mimeMatch[1];
          if (contentType.includes("png")) fileExt = "png";
          else if (contentType.includes("webp")) fileExt = "webp";
          else fileExt = "jpg";
        }
        const res = await fetch(optimized);
        blob = await res.blob();
      } else if (optimized instanceof File || optimized instanceof Blob) {
        blob = optimized;
        contentType = optimized.type || "image/jpeg";
        if (optimized.name) {
          const parts = optimized.name.split(".");
          if (parts.length > 1) fileExt = parts.pop();
        }
      }

      if (blob) {
        const rId = reportId || generateUUID();
        const filePath = `${folder}/${rId}_${Date.now()}.${fileExt}`;
        console.log(`[STORAGE] Target storage path in ${bucketName}: ${filePath}`);

        const uploadResult = await withTimeout(
          supabase.storage
            .from(bucketName)
            .upload(filePath, blob, { contentType, upsert: true }),
          8000,
          { error: { message: "Storage upload timeout" }, data: null }
        );

        if (uploadResult && !uploadResult.error && uploadResult.data) {
          const { data: publicData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);
          if (publicData?.publicUrl) {
            console.log(`[STORAGE] Storage public URL verified in ${bucketName}:`, publicData.publicUrl);
            return publicData.publicUrl;
          }
        } else {
          console.warn(`[STORAGE] Notice uploading to ${bucketName}:`, uploadResult?.error?.message);
        }
      }

      return null;
    } catch (err) {
      console.warn(`[STORAGE] Storage upload exception in ${bucketName}:`, err);
      return null;
    }
  },

  async syncReportsFromSupabase(force = false) {
    if (typeof window === "undefined") return;
    const now = Date.now();
    if (!force && pendingReportsSyncPromise) return pendingReportsSyncPromise;
    if (!force && now - lastReportsSyncTime < 10000) {
      return; // Cache fresh within 10 seconds
    }

    pendingReportsSyncPromise = (async () => {
      console.log('[REPORT TRACE] syncReportsFromSupabase: Querying remote Supabase tables...');
      try {
        const listColsMissing = 'id, reporter_id, child_full_name, child_age, child_gender, last_seen_location, last_seen_date, last_seen_time, physical_description, clothing_description, child_photo_url, status, is_public, created_at';
        const listColsFound = 'id, reporter_id, child_full_name, estimated_age, child_gender, found_location, found_date, found_time, physical_description, clothing_description, current_location_of_child, child_photo_url, status, is_public, created_at';

        const [missingRes, foundRes] = await Promise.allSettled([
          withTimeout(
            supabase.from('missing_reports').select(listColsMissing).order('created_at', { ascending: false }).limit(MAX_RETAINED_MISSING_REPORTS),
            6000,
            { data: null, error: null }
          ),
          withTimeout(
            supabase.from('found_reports').select(listColsFound).order('created_at', { ascending: false }).limit(MAX_RETAINED_FOUND_REPORTS),
            6000,
            { data: null, error: null }
          )
        ]);

        const missingRows = (missingRes.status === 'fulfilled' && missingRes.value?.data) ? missingRes.value.data : [];
        const foundRows = (foundRes.status === 'fulfilled' && foundRes.value?.data) ? foundRes.value.data : [];

        lastReportsSyncTime = Date.now();
        const missingLocal = JSON.parse(localStorage.getItem("missing_reports") || "[]");
        const foundLocal = JSON.parse(localStorage.getItem("found_reports") || "[]");

        const supabaseMissing = [];
        const supabaseFound = [];

        (missingRows || []).forEach((row, idx) => {
          const isFound = row.status === 'Trouvé' || 
            (row.physical_description && row.physical_description.includes('[TROUVÉ]')) ||
            (row.incident_description && row.incident_description.includes('[TROUVÉ]'));
          let cleanPhysical = row.physical_description || '';
          let currentSafeLocation = '';
          let gps = '';
          if (isFound) {
            cleanPhysical = cleanPhysical.replace('[TROUVÉ]', '').trim();
            if (cleanPhysical.includes('Lieu sûr:')) {
              const parts = cleanPhysical.split('|');
              cleanPhysical = parts[0].trim();
              parts.forEach(p => {
                if (p.includes('Lieu sûr:')) currentSafeLocation = p.replace('Lieu sûr:', '').trim();
                if (p.includes('GPS:')) gps = p.replace('GPS:', '').trim();
              });
            }
          }

          const rawPhoto = row.child_photo_url || null;
          const cleanPhoto = (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.startsWith('data:') && rawPhoto.length > 50000) ? null : rawPhoto;

          const report = {
            id: row.id,
            reporterId: row.reporter_id,
            name: row.child_full_name,
            age: row.child_age,
            gender: row.child_gender,
            location: row.last_seen_location,
            date: row.last_seen_date,
            time: row.last_seen_time,
            physicalDescription: cleanPhysical,
            clothingDescription: row.clothing_description,
            photo: cleanPhoto,
            thumbnail: getThumbnailUrl(cleanPhoto),
            status: row.status || (isFound ? 'Trouvé' : 'Published'),
            urgency: isFound ? 'Recherche Famille' : (row.status === 'Urgent' ? 'Urgent' : 'Nouveau'),
            currentSafeLocation: currentSafeLocation,
            gps: gps,
            isPublic: row.is_public !== false,
            created_at: row.created_at || new Date().toISOString(),
            createdAt: row.created_at || new Date().toISOString(),
            type: isFound ? 'found' : 'missing'
          };

          if (isFound) {
            supabaseFound.push(report);
          } else {
            supabaseMissing.push(report);
          }
        });

        (foundRows || []).forEach((row, idx) => {
          let cleanPhysical = row.physical_description || '';
          let currentSafeLocation = '';
          let gps = '';
          cleanPhysical = cleanPhysical.replace('[TROUVÉ]', '').trim();
          if (cleanPhysical.includes('Lieu sûr:')) {
            const parts = cleanPhysical.split('|');
            cleanPhysical = parts[0].trim();
            parts.forEach(p => {
              if (p.includes('Lieu sûr:')) currentSafeLocation = p.replace('Lieu sûr:', '').trim();
              if (p.includes('GPS:')) gps = p.replace('GPS:', '').trim();
            });
          }

          const rawPhoto = row.child_photo_url || null;
          const cleanPhoto = (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.startsWith('data:') && rawPhoto.length > 50000) ? null : rawPhoto;

          const report = {
            id: row.id,
            reporterId: row.reporter_id,
            name: row.child_full_name || "Enfant trouvé",
            age: row.estimated_age || null,
            gender: row.child_gender,
            location: row.found_location,
            date: row.found_date,
            time: row.found_time,
            physicalDescription: cleanPhysical,
            clothingDescription: row.clothing_description,
            photo: cleanPhoto,
            thumbnail: getThumbnailUrl(cleanPhoto),
            status: row.status || 'Trouvé',
            urgency: 'Recherche Famille',
            currentSafeLocation: row.current_location_of_child || currentSafeLocation,
            gps: gps,
            isPublic: row.is_public !== false,
            created_at: row.created_at || new Date().toISOString(),
            createdAt: row.created_at || new Date().toISOString(),
            type: 'found'
          };
          supabaseFound.push(report);
        });

        const mergedMissing = mergeReports(missingLocal, supabaseMissing);
        const mergedFound = mergeReports(foundLocal, supabaseFound);

        _inMemoryMissing = mergedMissing;
        _inMemoryFound = mergedFound;

        safeSetLocalStorage("missing_reports", mergedMissing);
        safeSetLocalStorage("found_reports", mergedFound);

        console.log(`[REPORT TRACE] Sync complete. Total Missing: ${mergedMissing.length}, Total Found: ${mergedFound.length}`);

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('raydar:reports-synced', { detail: { missing: mergedMissing, found: mergedFound } }));
        }
      } catch (e) {
        console.warn("[REPORT TRACE] syncReportsFromSupabase exception:", e?.message || e);
      } finally {
        pendingReportsSyncPromise = null;
      }
    })();

    return pendingReportsSyncPromise;
  },

  async createMissingReport(reportData) {
    initLocalStorage();
    const dbId = generateUUID();
    console.log('[REPORT TRACE] createMissingReport started with ID:', dbId, 'Name:', reportData.name);
    try {
      // 1. Upload child photo to missing-reports bucket (Storage path: {auth.uid()}/filename)
      let photoUrl = reportData.photo || reportData.childPhoto || reportData.child_photo_url;
      if (photoUrl) {
        if (typeof photoUrl === 'string' && photoUrl.includes('/storage/v1/object/public/missing-reports/')) {
          console.log('[STORAGE] Photo is already an uploaded Supabase Storage URL:', photoUrl);
        } else if (typeof photoUrl === 'string' && photoUrl.startsWith('http') && !photoUrl.startsWith('blob:') && !photoUrl.startsWith('data:')) {
          console.log('[STORAGE] Photo is a remote URL:', photoUrl);
        } else {
          // Real binary file upload to missing-reports bucket
          photoUrl = await this.uploadMissingReportPhoto(photoUrl, `child_${dbId}`);
        }
      }

      // CRITICAL: Strict requirement - ZERO remaining base64 fallback in database for child_photo_url
      if (typeof photoUrl === 'string' && photoUrl.startsWith('data:')) {
        console.warn('[STORAGE] Disallowed base64 detected for child_photo_url. Zero base64 rule applied.');
        photoUrl = null;
      }
      console.log('[REPORT TRACE] Verified child_photo_url for missing report:', photoUrl ? photoUrl.substring(0, 70) + '...' : 'NONE');

      // 2. Upload verification documents/evidence to report-evidence bucket (Storage path: {auth.uid()}/filename)
      let birthCertUrl = null;
      let familyPhotoUrl = null;
      let healthRecordUrl = null;
      let otherDocUrl = null;

      const uploadDocItem = async (docItem, docType) => {
        if (!docItem) return null;
        const originalName = typeof docItem === 'object' && docItem.name ? docItem.name : null;
        return await this.uploadReportEvidence(docItem, originalName, docType);
      };

      const [bcResult, famResult, hospResult, othResult] = await Promise.allSettled([
        uploadDocItem(reportData.birthCertificate, 'birth_certificate'),
        uploadDocItem(reportData.familyPhoto, 'family_photo'),
        uploadDocItem(reportData.hospitalRecord, 'health_record'),
        uploadDocItem(reportData.otherDoc, 'other_document')
      ]);

      if (bcResult.status === 'fulfilled' && bcResult.value) birthCertUrl = bcResult.value;
      if (famResult.status === 'fulfilled' && famResult.value) familyPhotoUrl = famResult.value;
      if (hospResult.status === 'fulfilled' && hospResult.value) healthRecordUrl = hospResult.value;
      if (othResult.status === 'fulfilled' && othResult.value) otherDocUrl = othResult.value;

      let docUrlsText = "";
      if (birthCertUrl) docUrlsText += ` [Acte de naissance: ${birthCertUrl}]`;
      if (familyPhotoUrl) docUrlsText += ` [Photo famille: ${familyPhotoUrl}]`;
      if (healthRecordUrl) docUrlsText += ` [Carnet santé: ${healthRecordUrl}]`;
      if (otherDocUrl) docUrlsText += ` [Autre doc: ${otherDocUrl}]`;

      const currentId = await this.getCurrentUserId();
      const supabaseReporterId = await this.getSupabaseReporterUuid();

      const newReport = {
        id: dbId,
        reporterId: supabaseReporterId || currentId,
        status: "Published",
        urgency: "Nouveau",
        createdAt: new Date().toISOString(),
        type: "missing",
        ...reportData,
        photo: photoUrl,
        child_photo_url: photoUrl,
        birthCertificateUrl: birthCertUrl,
        familyPhotoUrl: familyPhotoUrl,
        healthRecordUrl: healthRecordUrl,
        otherDocumentUrl: otherDocUrl
      };

      // 1. Invoke Supabase Edge Function with fast non-blocking timeout
      try {
        await withTimeout(
          supabase.functions.invoke('create-missing-report', {
            body: {
              id: dbId,
              name: newReport.name,
              age: newReport.age,
              gender: newReport.gender,
              location: newReport.location,
              date: newReport.date,
              time: newReport.time,
              physicalDescription: newReport.physicalDescription,
              clothingDescription: newReport.clothingDescription,
              notes: (newReport.notes || '') + docUrlsText,
              relationship: newReport.relationship,
              photoUrl: photoUrl,
              birthCertificateUrl: birthCertUrl,
              familyPhotoUrl: familyPhotoUrl,
              healthRecordUrl: healthRecordUrl,
              otherDocumentUrl: otherDocUrl,
              isPublic: true
            }
          }),
          3500,
          null
        );
      } catch (fErr) {
        console.log("[REPORT TRACE] Edge Function notice:", fErr);
      }

      // 2. Server-authoritative Supabase PostgreSQL persistence (Service role bypasses RLS and guarantees write)
      try {
        const { data: sessData } = await supabase.auth.getSession();
        const authToken = sessData?.session?.access_token;
        const srvRes = await fetch(`${getApiBaseUrl()}/api/reports/create-missing-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify({
            id: dbId,
            reporterId: supabaseReporterId,
            userId: currentId,
            name: newReport.name,
            age: newReport.age,
            gender: newReport.gender,
            location: newReport.location,
            date: newReport.date,
            time: newReport.time,
            physicalDescription: newReport.physicalDescription,
            clothingDescription: newReport.clothingDescription,
            incidentDescription: (reportData.notes || reportData.physicalDescription || "Signalement de disparition de l'enfant") + docUrlsText,
            relationship: newReport.relationship,
            photoUrl: photoUrl,
            birthCertificateUrl: birthCertUrl,
            familyPhotoUrl: familyPhotoUrl,
            healthRecordUrl: healthRecordUrl,
            otherDocumentUrl: otherDocUrl,
            status: "Published",
            is_public: true
          })
        });
        const srvJson = await srvRes.json();
        if (srvJson?.success) {
          console.log('[REPORT TRACE] Server endpoint successfully persisted missing report into Supabase PostgreSQL:', dbId);
          if (srvJson.data?.child_photo_url) {
            photoUrl = srvJson.data.child_photo_url;
            newReport.photo = photoUrl;
            newReport.child_photo_url = photoUrl;
          }
        } else {
          console.warn('[REPORT TRACE] Server endpoint notice:', srvJson?.error);
        }
      } catch (sErr) {
        console.warn('[REPORT TRACE] Notice during server endpoint invocation:', sErr);
      }

      // 3. Direct PostgreSQL persistence with timeout protection (upsert by id)
      const incidentDesc = (reportData.notes || reportData.physicalDescription || "Signalement de disparition de l'enfant") + docUrlsText;
      let safeDate = newReport.date || new Date().toISOString().split('T')[0];
      if (/^\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{4}$/.test(safeDate)) {
        const parts = safeDate.split(/[\/\.-]/);
        safeDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
      let safeTime = newReport.time || '12:00:00';
      if (/^\d{1,2}:\d{2}$/.test(safeTime)) safeTime = `${safeTime}:00`;

      const { error: insertErr } = await withTimeout(
        supabase.from('missing_reports').upsert([{
          id: dbId,
          reporter_id: supabaseReporterId,
          child_full_name: newReport.name,
          child_age: newReport.age ? Number(newReport.age) : null,
          child_gender: newReport.gender || 'non_specifie',
          last_seen_location: newReport.location,
          last_seen_date: safeDate,
          last_seen_time: safeTime,
          physical_description: newReport.physicalDescription,
          clothing_description: newReport.clothingDescription,
          incident_description: incidentDesc,
          emergency_contact_name: newReport.relationship || "Parent / Gardien",
          emergency_contact_phone: "677000000",
          child_photo_url: photoUrl,
          birth_certificate_url: birthCertUrl,
          family_photo_url: familyPhotoUrl,
          health_record_url: healthRecordUrl,
          other_document_url: otherDocUrl,
          status: "Published",
          is_public: true
        }], { onConflict: 'id' }),
        6000,
        { error: null }
      );

      if (insertErr) {
        console.warn("[REPORT TRACE] Notice inserting missing report in Supabase:", insertErr.message || insertErr);
      } else {
        console.log("[REPORT TRACE] Successfully inserted missing report into Supabase PostgreSQL missing_reports");
      }

      // 3. Local list immediate update - place at front
      const reports = this.getMissingReports();
      const updatedList = [newReport, ...reports.filter(r => r.id !== dbId)];
      updatedList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      _inMemoryMissing = updatedList;
      safeSetLocalStorage("missing_reports", updatedList);

      // 4. Notify all views across tabs/windows
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('raydar:reports-synced', { detail: { report: newReport, type: 'missing' } }));
        window.dispatchEvent(new Event('storage'));
      }

      // 5. Trigger background sync and development retention enforcement
      setTimeout(() => {
        this.syncReportsFromSupabase(true);
        enforceDevelopmentRetention('missing');
      }, 500);

      return newReport;
    } catch (e) {
      console.error("[REPORT TRACE] Error creating missing report:", e);
      return null;
    }
  },

  async createFoundReport(reportData) {
    initLocalStorage();
    const dbId = generateUUID();
    console.log('[REPORT TRACE] createFoundReport started with ID:', dbId, 'Name:', reportData.name || reportData.childName);
    try {
      // 1. Authoritative photo uploads to Supabase Storage bucket 'found-reports'
      let photoUrl = reportData.photo || reportData.childPhoto;
      if (photoUrl && (photoUrl.startsWith("data:") || photoUrl.startsWith("blob:") || photoUrl instanceof File || photoUrl instanceof Blob)) {
        photoUrl = await this.uploadFoundReportPhoto(photoUrl, `child_${dbId.substring(0, 8)}`);
      } else if (photoUrl && (photoUrl.includes('/storage/v1/object/public/') || photoUrl.startsWith('http'))) {
        // Keep existing valid URL
      }

      let envPhotoUrl = reportData.envPhoto;
      if (envPhotoUrl && (envPhotoUrl.startsWith("data:") || envPhotoUrl.startsWith("blob:") || envPhotoUrl instanceof File || envPhotoUrl instanceof Blob)) {
        envPhotoUrl = await this.uploadFoundReportPhoto(envPhotoUrl, `env_${dbId.substring(0, 8)}`);
      } else if (envPhotoUrl && (envPhotoUrl.includes('/storage/v1/object/public/') || envPhotoUrl.startsWith('http'))) {
        // Keep existing valid URL
      }

      // Fallback photoUrl from envPhotoUrl if child photo was not provided
      if (!photoUrl && envPhotoUrl) {
        photoUrl = envPhotoUrl;
      }

      console.log('[REPORT TRACE] Uploaded found report photos. Child Photo:', photoUrl ? (photoUrl.startsWith('data:') ? 'base64 (proxying to server)' : photoUrl) : 'NONE', 'Env Photo:', envPhotoUrl ? (envPhotoUrl.startsWith('data:') ? 'base64 (proxying to server)' : envPhotoUrl) : 'NONE');

      // 2. Authoritative reporter ID mapping: auth.uid() -> profiles.id
      const currentId = await this.getCurrentUserId();
      const supabaseReporterId = await this.getSupabaseReporterUuid();
      const finalReporterId = supabaseReporterId || currentId;

      const cleanName = (reportData.name || reportData.childName || "Enfant trouvé").trim();
      const safeLocation = reportData.currentSafeLocation || 'Poste de police / Centre de protection';
      const physicalDescWithFound = `[TROUVÉ] ${reportData.physicalDescription || ''} | Lieu sûr: ${safeLocation} | GPS: ${reportData.gps || ''}`;
      const additionalPhotosList = envPhotoUrl ? [envPhotoUrl] : [];

      const newReport = {
        id: dbId,
        reporterId: finalReporterId,
        reporter_id: supabaseReporterId,
        status: "Published",
        urgency: "Recherche Famille",
        createdAt: new Date().toISOString(),
        created_at: new Date().toISOString(),
        type: "found",
        ...reportData,
        name: cleanName,
        child_full_name: cleanName,
        childName: cleanName,
        photo: photoUrl,
        child_photo_url: photoUrl,
        envPhoto: envPhotoUrl,
        additional_photos: additionalPhotosList,
        currentSafeLocation: safeLocation,
        physicalDescription: reportData.physicalDescription || '',
        clothingDescription: reportData.clothingDescription || '',
        location: reportData.location || 'Localisation non précisée'
      };

      // 3. Prepare found_reports row with exact PostgreSQL schema alignment
      const defaultPlaceholderPhoto = "https://ifpbdythbhlgqymsaxtz.supabase.co/storage/v1/object/public/found-reports/community/default_child_placeholder.png";
      const finalChildPhoto = photoUrl || defaultPlaceholderPhoto;
      const circumstances = (reportData.circumstancesDescription || reportData.circumstances || reportData.physicalDescription || `Enfant trouvé à ${newReport.location || 'lieu non précisé'}`).trim() || "Enfant trouvé en attente d'identification";
      const safeLocationVal = (reportData.currentSafeLocation || reportData.current_location_of_child || 'Poste de police / Centre de protection').trim() || 'Poste de police / Centre de protection';
      const validDate = (newReport.date || new Date().toISOString().split('T')[0]).trim() || new Date().toISOString().split('T')[0];
      const rawTime = (newReport.time || new Date().toTimeString().split(' ')[0].substring(0, 5)).trim() || "12:00";
      const validTime = rawTime.length === 5 ? `${rawTime}:00` : rawTime;

      const foundRow = {
        id: dbId,
        reporter_id: supabaseReporterId || finalReporterId,
        child_full_name: cleanName,
        child_gender: newReport.gender || 'non_specifie',
        estimated_age: newReport.age ? Number(newReport.age) : null,
        found_location: (newReport.location || 'Localisation non précisée').trim() || 'Localisation non précisée',
        found_date: validDate,
        found_time: validTime,
        physical_description: physicalDescWithFound,
        clothing_description: (newReport.clothingDescription || '').trim(),
        current_location_of_child: safeLocationVal,
        circumstances_description: circumstances,
        child_photo_url: finalChildPhoto,
        additional_photos: additionalPhotosList,
        status: "Published",
        is_public: true
      };

      // 4. Server-Authoritative persistence via service role endpoint (guarantees write & FK validation)
      let persistSuccess = false;
      try {
        const { data: sessData } = await supabase.auth.getSession();
        const authToken = sessData?.session?.access_token;
        const apiRes = await withTimeout(
          fetch(`${getApiBaseUrl()}/api/reports/create-found-report`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
            },
            body: JSON.stringify({
              ...foundRow,
              reporterId: finalReporterId,
              reporter_id: supabaseReporterId,
              userId: currentId,
              photo: photoUrl,
              photoUrl: photoUrl,
              child_photo_url: finalChildPhoto,
              envPhoto: envPhotoUrl,
              envPhotoUrl: envPhotoUrl,
              currentSafeLocation: safeLocationVal,
              current_location_of_child: safeLocationVal,
              circumstances_description: circumstances
            })
          }),
          25000,
          null
        );

        if (apiRes) {
          let resJson = null;
          let rawText = "";
          try {
            rawText = await apiRes.text();
            resJson = JSON.parse(rawText);
          } catch (parseErr) {
            console.warn("[REPORT TRACE] Server response was non-JSON text:", rawText.substring(0, 200));
          }

          if (apiRes.ok && resJson?.success && resJson.data?.id) {
            console.log("[REPORT TRACE] Authoritative server route persisted to public.found_reports successfully:", resJson.data.id);
            persistSuccess = true;
          } else {
            const errDetail = resJson?.error || (apiRes.status ? `HTTP ${apiRes.status}: ${rawText.substring(0, 150)}` : apiRes.statusText);
            console.error("[REPORT TRACE] Server endpoint returned error:", errDetail);
          }
        } else {
          console.warn("[REPORT TRACE] Server API endpoint request timed out after 25s");
        }
      } catch (apiErr) {
        console.warn("[REPORT TRACE] Server API endpoint notice:", apiErr);
      }

      // 5. Fallback/Direct Supabase client insert into found_reports
      if (!persistSuccess && supabaseReporterId) {
        try {
          const { data: directData, error: insertErr } = await withTimeout(
            supabase.from('found_reports').upsert([foundRow], { onConflict: 'id' }).select(),
            5000,
            { data: null, error: { message: 'Timeout' } }
          );

          if (!insertErr && directData && directData.length > 0) {
            console.log("[REPORT TRACE] Successfully persisted directly to Supabase table found_reports:", directData[0].id);
            persistSuccess = true;
          } else if (insertErr) {
            console.warn("[REPORT TRACE] Direct upsert notice:", insertErr.message || insertErr);
          }
        } catch (e) {
          console.warn("[REPORT TRACE] Direct upsert exception:", e?.message || e);
        }
      }

      // Strict failure check: Do not pretend success if database persistence failed
      if (!persistSuccess) {
        console.error("[REPORT TRACE] CRITICAL: Failed to persist found report to public.found_reports!");
        return { success: false, error: "Échec de l'enregistrement dans la table found_reports." };
      }

      // 6. Local list immediate update - place at front
      const reports = this.getFoundReports();
      const updatedList = [newReport, ...reports.filter(r => r.id !== dbId)];
      updatedList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      _inMemoryFound = updatedList;
      safeSetLocalStorage("found_reports", updatedList);

      // 7. Notify all views across tabs/windows
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('raydar:reports-synced', { detail: { report: newReport, type: 'found' } }));
        window.dispatchEvent(new Event('storage'));
      }

      // 8. Trigger background refresh and development retention enforcement
      setTimeout(() => {
        this.syncReportsFromSupabase(true);
        enforceDevelopmentRetention('found');
      }, 500);

      return { success: true, ...newReport };
    } catch (e) {
      console.error("[REPORT TRACE] Error creating found report:", e);
      return null;
    }
  },

  async getMyMissingReports() {
    initLocalStorage();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        const reporterId = await this.getSupabaseReporterUuid();
        const idsToMatch = [session.user.id];
        if (reporterId && !idsToMatch.includes(reporterId)) idsToMatch.push(reporterId);

        const { data: remoteRows } = await supabase
          .from('missing_reports')
          .select('id, reporter_id, child_full_name, child_age, child_gender, last_seen_location, last_seen_date, last_seen_time, physical_description, clothing_description, child_photo_url, status, created_at')
          .in('reporter_id', idsToMatch)
          .neq('status', 'Trouvé')
          .order('created_at', { ascending: false })
          .limit(MAX_RETAINED_MISSING_REPORTS);

        if (remoteRows && remoteRows.length > 0) {
          return remoteRows.map((r, idx) => {
            const rawPhoto = r.child_photo_url || null;
            const cleanPhoto = (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.startsWith('data:') && rawPhoto.length > 50000) ? null : rawPhoto;
            const photoSrc = cleanPhoto || getDefaultChildPortrait(r.child_gender, idx, false);
            return {
              id: r.id,
              reporterId: r.reporter_id,
              name: r.child_full_name,
              age: r.child_age,
              gender: r.child_gender,
              location: r.last_seen_location,
              date: r.last_seen_date,
              time: r.last_seen_time,
              physicalDescription: r.physical_description,
              clothingDescription: r.clothing_description,
              photo: photoSrc,
              thumbnail: getThumbnailUrl(photoSrc),
              status: r.status,
              urgency: 'Nouveau',
              type: 'missing',
              createdAt: r.created_at
            };
          });
        }
      }
    } catch (e) {}

    const all = this.getMissingReports();
    const currentId = await this.getCurrentUserId();
    const reporterId = await this.getSupabaseReporterUuid();
    return all.filter(r => r.reporterId === currentId || (reporterId && r.reporterId === reporterId));
  },

  async getMyFoundReports() {
    initLocalStorage();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        const reporterId = await this.getSupabaseReporterUuid();
        const idsToMatch = [session.user.id];
        if (reporterId && !idsToMatch.includes(reporterId)) idsToMatch.push(reporterId);

        const { data: remoteRows } = await supabase
          .from('found_reports')
          .select('id, reporter_id, child_full_name, estimated_age, child_gender, found_location, found_date, found_time, physical_description, clothing_description, current_location_of_child, child_photo_url, status, created_at')
          .in('reporter_id', idsToMatch)
          .order('created_at', { ascending: false })
          .limit(MAX_RETAINED_FOUND_REPORTS);

        if (remoteRows && remoteRows.length > 0) {
          return remoteRows.map((r, idx) => {
            const rawPhoto = r.child_photo_url || null;
            const cleanPhoto = (rawPhoto && typeof rawPhoto === 'string' && rawPhoto.startsWith('data:') && rawPhoto.length > 50000) ? null : rawPhoto;
            const photoSrc = cleanPhoto || getDefaultChildPortrait(r.child_gender, idx, true);
            return {
              id: r.id,
              reporterId: r.reporter_id,
              name: r.child_full_name,
              age: r.estimated_age,
              gender: r.child_gender,
              location: r.found_location,
              date: r.found_date,
              time: r.found_time,
              physicalDescription: r.physical_description,
              clothingDescription: r.clothing_description,
              photo: photoSrc,
              thumbnail: getThumbnailUrl(photoSrc),
              status: r.status,
              urgency: 'Trouvé',
              type: 'found',
              createdAt: r.created_at
            };
          });
        }
      }
    } catch (e) {}

    const all = this.getFoundReports();
    const currentId = await this.getCurrentUserId();
    const reporterId = await this.getSupabaseReporterUuid();
    return all.filter(r => r.reporterId === currentId || (reporterId && r.reporterId === reporterId));
  },

  getReportById(id) {
    initLocalStorage();
    const missing = this.getMissingReports();
    const found = this.getFoundReports();
    return missing.find(r => r.id === id) || found.find(r => r.id === id) || null;
  },

  searchReports(query = "", isFound = false) {
    initLocalStorage();
    const reports = isFound ? this.getFoundReports() : this.getMissingReports();
    const q = query.toLowerCase().trim();
    if (!q) return reports;

    return reports.filter(r => {
      const name = (r.name || "").toLowerCase();
      const location = (r.location || "").toLowerCase();
      const physical = (r.physicalDescription || "").toLowerCase();
      const clothing = (r.clothingDescription || "").toLowerCase();
      const age = String(r.age || "");
      const gender = (r.gender || "").toLowerCase();

      return name.includes(q) || 
             location.includes(q) || 
             physical.includes(q) || 
             clothing.includes(q) ||
             age === q ||
             gender.includes(q);
    });
  },

  deleteMissingReport(id) {
    initLocalStorage();
    try {
      supabase.from('missing_reports').delete().eq('id', id).then(() => {});
      let reports = this.getMissingReports();
      reports = reports.filter(r => r.id !== id);
      safeSetLocalStorage("missing_reports", reports);
      return true;
    } catch (e) {
      console.error("Error deleting missing report:", e);
      return false;
    }
  },

  deleteFoundReport(id) {
    initLocalStorage();
    try {
      supabase.from('found_reports').delete().eq('id', id).then(() => {});
      supabase.from('missing_reports').delete().eq('id', id).then(() => {});
      let reports = this.getFoundReports();
      reports = reports.filter(r => r.id !== id);
      safeSetLocalStorage("found_reports", reports);
      return true;
    } catch (e) {
      console.error("Error deleting found report:", e);
      return false;
    }
  },

  updateDOMProfile(profile) {
    if (typeof document === "undefined" || !profile) return;
    const avatarUrl = profile.photo || DEFAULT_AVATAR;
    const fullName = profile.full_name || "Gardien de la Sécurité";
    const role = profile.role || "Membre Élite des Gardiens";

    const avatarElements = document.querySelectorAll('#homeUserAvatar, #profileAvatar, #modalAvatarPreview, [data-user-avatar], .user-avatar-img');
    avatarElements.forEach(el => {
      if (el && el.tagName === 'IMG') {
        el.src = avatarUrl;
      }
    });

    const nameElements = document.querySelectorAll('#homeUserName, #profileName, [data-user-name], .user-name-text');
    nameElements.forEach(el => {
      if (el) {
        el.textContent = fullName;
      }
    });

    const roleElements = document.querySelectorAll('#homeUserRole, #profileRole, [data-user-role]');
    roleElements.forEach(el => {
      if (el) {
        el.textContent = role;
      }
    });
  },

  getProfile() {
    if (typeof window === "undefined") return {};
    try {
      const defaultProfile = {
        full_name: "Gardien de la Sécurité",
        role: "Membre Élite des Gardiens",
        username: "gardien_securite",
        phone_country_code: "+237",
        phone_number: "677123456",
        city: "Yaoundé",
        photo: DEFAULT_AVATAR
      };
      const stored = localStorage.getItem("user_profile");
      if (!stored) {
        localStorage.setItem("user_profile", JSON.stringify(defaultProfile));
        return defaultProfile;
      }
      const parsed = JSON.parse(stored);
      if (!parsed.photo || parsed.photo.includes('unsplash.com')) {
        parsed.photo = DEFAULT_AVATAR;
      }
      return { ...defaultProfile, ...parsed };
    } catch (e) {
      return {};
    }
  },

  async saveProfile(profileData) {
    if (typeof window === "undefined") return null;
    try {
      const current = this.getProfile();
      let photoUrl = profileData.photo || current.photo || DEFAULT_AVATAR;

      if (profileData.photo && profileData.photo.startsWith("data:")) {
        const storageUrl = await this.uploadFileToSupabaseStorage(profileData.photo, "avatars");
        if (storageUrl) {
          photoUrl = storageUrl;
        }
      }

      const updated = {
        ...current,
        ...profileData,
        photo: photoUrl
      };

      localStorage.setItem("user_profile", JSON.stringify(updated));
      this.updateDOMProfile(updated);

      // Non-blocking update to Supabase profiles table
      try {
        const { data: { session } } = await withTimeout(supabase.auth.getSession(), 3000, { data: { session: null } });
        if (session && session.user) {
          const payload = {
            user_id: session.user.id,
            email: session.user.email || '',
            full_name: updated.full_name,
            username: updated.username,
            phone_country_code: updated.phone_country_code || "+237",
            phone_number: updated.phone_number || "",
            city: updated.city || "",
            role: updated.role || "Guardian",
            profile_photo_url: updated.photo || updated.profile_photo_url || DEFAULT_AVATAR,
            updated_at: new Date().toISOString()
          };

          withTimeout(
            supabase.from('profiles').upsert(payload, { onConflict: 'user_id' }),
            5000,
            null
          ).catch((e) => console.warn("Notice saving profile to Supabase:", e));
        }
      } catch (e) {}

      return updated;
    } catch (e) {
      return null;
    }
  },

  async syncProfileWithSupabase(force = false) {
    if (typeof window === "undefined") return this.getProfile();
    const now = Date.now();
    if (!force && pendingProfileSyncPromise) return pendingProfileSyncPromise;
    if (!force && now - lastProfileSyncTime < 20000) {
      return this.getProfile();
    }

    pendingProfileSyncPromise = (async () => {
      try {
        const { data: { session } } = await withTimeout(supabase.auth.getSession(), 2500, { data: { session: null } });
        if (session && session.user) {
          const { data: profileData } = await withTimeout(
            supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
            4000,
            { data: null }
          );

          lastProfileSyncTime = Date.now();
          const current = this.getProfile();
          let updated = { ...current };

          if (profileData && Object.keys(profileData).length > 0) {
            updated = { ...updated, ...profileData, photo: profileData.profile_photo_url || current.photo };
          }

          if (!updated.full_name || updated.full_name === "Elena Rodriguez") {
            if (session.user.user_metadata?.full_name) {
              updated.full_name = session.user.user_metadata.full_name;
            } else if (session.user.email) {
              updated.full_name = session.user.email.split('@')[0];
            }
          }

          localStorage.setItem("user_profile", JSON.stringify(updated));
          this.updateDOMProfile(updated);
          return updated;
        }
      } catch (e) {
      } finally {
        pendingProfileSyncPromise = null;
      }

      const fallback = this.getProfile();
      this.updateDOMProfile(fallback);
      return fallback;
    })();

    return pendingProfileSyncPromise;
  },

  getThumbnailUrl(url) {
    return getThumbnailUrl(url);
  },

  generateThumbnail(fileOrBase64, maxWidth = 240, quality = 0.72) {
    return generateThumbnail(fileOrBase64, maxWidth, quality);
  }
};

if (typeof window !== "undefined") {
  window.reportService = reportService;
  initLocalStorage();
}
