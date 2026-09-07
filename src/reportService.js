// Modular report service for RAYDAR Child Safety Platform
// Connected to Supabase Backend (PostgreSQL, Supabase Storage, Supabase Edge Functions & Auth)
import { supabase } from "./supabaseClient.js";

// In-memory caching and promise deduplication for high-performance data fetching
let cachedCurrentUserId = null;
let pendingReportsSyncPromise = null;
let lastReportsSyncTime = 0;
let pendingProfileSyncPromise = null;
let lastProfileSyncTime = 0;

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

export function getDefaultChildPortrait(gender = "", index = 0, isFound = false) {
  const pool = isFound ? AFRICAN_CHILD_PORTRAITS.found : AFRICAN_CHILD_PORTRAITS.missing;
  const isFemale = /fille|f|female/i.test(gender);
  if (isFemale) {
    const femaleList = pool.filter((_, i) => (isFound ? [1, 3, 5] : [1, 3, 4, 7]).includes(i));
    if (femaleList.length > 0) return femaleList[index % femaleList.length];
  }
  return pool[index % pool.length] || pool[0];
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
    name: "Enfant trouvé (Garçon)",
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
    name: "Enfant trouvée (Fillette)",
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
    name: "Enfant trouvé (Garçon)",
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
    name: "Enfant trouvée (Jeune fille)",
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
    name: "Enfant trouvé (Garçon)",
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
    name: "Enfant trouvée (Fillette)",
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

function safeSetLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`LocalStorage note for ${key}:`, e);
  }
}

function initLocalStorage() {
  if (typeof window === "undefined") return;
  const dbVersion = "v11_african_children_portraits_system";
  const currentVer = localStorage.getItem("reports_db_version");
  
  let missing = [];
  let found = [];
  try {
    missing = JSON.parse(localStorage.getItem("missing_reports") || "[]");
    found = JSON.parse(localStorage.getItem("found_reports") || "[]");
  } catch (e) {}

  const hasUnsplash = (list) => list.some(r => r && r.photo && r.photo.includes("unsplash.com"));

  if (currentVer !== dbVersion || !localStorage.getItem("missing_reports") || !localStorage.getItem("found_reports") || hasUnsplash(missing) || hasUnsplash(found)) {
    // Preserve any real user-created reports (those with custom photos or IDs not starting with 'm-' or 'f-')
    const userMissing = missing.filter(r => r && !r.id.startsWith("m-") && (!r.photo || !r.photo.includes("unsplash.com")));
    const userFound = found.filter(r => r && !r.id.startsWith("f-") && (!r.photo || !r.photo.includes("unsplash.com")));

    safeSetLocalStorage("missing_reports", [...DEMO_MISSING_REPORTS, ...userMissing]);
    safeSetLocalStorage("found_reports", [...DEMO_FOUND_REPORTS, ...userFound]);
    try { localStorage.setItem("reports_db_version", dbVersion); } catch (e) {}
  }
  setTimeout(() => {
    if (reportService && typeof reportService.syncReportsFromSupabase === 'function') {
      reportService.syncReportsFromSupabase();
    }
  }, 100);
}

function mergeReports(localList, remoteList) {
  const map = new Map();
  remoteList.forEach(r => map.set(r.id, r));
  localList.forEach(r => {
    if (!map.has(r.id)) {
      map.set(r.id, r);
    }
  });
  return Array.from(map.values());
}

export const reportService = {
  DEFAULT_AVATAR,

  getMissingReports() {
    initLocalStorage();
    try {
      return JSON.parse(localStorage.getItem("missing_reports") || "[]");
    } catch (e) {
      return DEMO_MISSING_REPORTS;
    }
  },

  getFoundReports() {
    initLocalStorage();
    try {
      return JSON.parse(localStorage.getItem("found_reports") || "[]");
    } catch (e) {
      return DEMO_FOUND_REPORTS;
    }
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
    let guestId = localStorage.getItem('guardians_local_user_id');
    if (!guestId) {
      guestId = 'user_' + Math.random().toString(36).substring(2, 9);
      try { localStorage.setItem('guardians_local_user_id', guestId); } catch (e) {}
    }
    return guestId;
  },

  async getSupabaseReporterUuid() {
    if (cachedCurrentUserId) return cachedCurrentUserId;
    try {
      const { data: { session } } = await withTimeout(supabase.auth.getSession(), 3000, { data: { session: null } });
      if (session && session.user && session.user.id) {
        cachedCurrentUserId = session.user.id;
        return session.user.id;
      }
    } catch (e) {}
    return null;
  },

  // Upload file or image directly to Supabase Storage with fast compression and timeout protection
  async uploadFileToSupabaseStorage(fileOrBase64, bucketName = "avatars") {
    if (!fileOrBase64) return DEFAULT_AVATAR;
    console.log("[Supabase Storage] Optimizing & uploading file...");
    try {
      // 1. Client-side downscaling & compression to prevent multi-megabyte hanging uploads
      const optimized = await compressImage(fileOrBase64, 1200, 0.82);

      let blob;
      let fileExt = "jpg";
      let contentType = "image/jpeg";

      if (typeof optimized === "string" && optimized.startsWith("data:")) {
        const mimeMatch = optimized.match(/data:(.*?);base64,/);
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
        const currentUid = await this.getCurrentUserId();
        const folder = currentUid || 'public_reports';
        const filePath = `${folder}/report_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

        // 6-second timeout so storage errors never hang user operations
        const uploadResult = await withTimeout(
          supabase.storage
            .from("avatars")
            .upload(filePath, blob, { contentType, upsert: true }),
          6000,
          { error: { message: "Storage upload timeout" }, data: null }
        );

        if (uploadResult && !uploadResult.error && uploadResult.data) {
          const { data: publicData } = supabase.storage
            .from("avatars")
            .getPublicUrl(filePath);
          if (publicData && publicData.publicUrl) {
            console.log("[Supabase Storage] Upload successful:", publicData.publicUrl);
            return publicData.publicUrl;
          }
        } else {
          console.warn("[Supabase Storage] Notice uploading to bucket:", uploadResult?.error?.message);
        }
      }

      // If storage upload fails or times out, return optimized compressed string safely
      return typeof optimized === "string" ? optimized : DEFAULT_AVATAR;
    } catch (err) {
      console.warn("[Supabase Storage] Upload exception:", err);
      return typeof fileOrBase64 === "string" ? fileOrBase64 : DEFAULT_AVATAR;
    }
  },

  async syncReportsFromSupabase(force = false) {
    if (typeof window === "undefined") return;
    const now = Date.now();
    if (!force && pendingReportsSyncPromise) return pendingReportsSyncPromise;
    if (!force && now - lastReportsSyncTime < 15000) {
      return; // Cache fresh within 15 seconds
    }

    pendingReportsSyncPromise = (async () => {
      try {
        const { data: rows, error } = await withTimeout(
          supabase
            .from('missing_reports')
            .select('*')
            .order('created_at', { ascending: false }),
          5000,
          { data: null, error: null }
        );

        if (!error && rows) {
          lastReportsSyncTime = Date.now();
          const missingLocal = JSON.parse(localStorage.getItem("missing_reports") || "[]");
          const foundLocal = JSON.parse(localStorage.getItem("found_reports") || "[]");

          const supabaseMissing = [];
          const supabaseFound = [];

          rows.forEach((row, idx) => {
            const isFound = row.status === 'Trouvé' || (row.physical_description && row.physical_description.includes('[TROUVÉ]'));
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
              photo: row.child_photo_url || getDefaultChildPortrait(row.child_gender, idx, isFound),
              status: row.status || (isFound ? 'Trouvé' : 'Published'),
              urgency: isFound ? 'Recherche Famille' : 'Nouveau',
              currentSafeLocation: currentSafeLocation,
              gps: gps,
              isPublic: row.is_public !== false,
              createdAt: row.created_at || new Date().toISOString(),
              type: isFound ? 'found' : 'missing'
            };

            if (isFound) {
              supabaseFound.push(report);
            } else {
              supabaseMissing.push(report);
            }
          });

          const mergedMissing = mergeReports(missingLocal, supabaseMissing);
          const mergedFound = mergeReports(foundLocal, supabaseFound);

          safeSetLocalStorage("missing_reports", mergedMissing);
          safeSetLocalStorage("found_reports", mergedFound);
        }
      } catch (e) {
        console.warn("Supabase fetch notice:", e?.message || e);
      } finally {
        pendingReportsSyncPromise = null;
      }
    })();

    return pendingReportsSyncPromise;
  },

  async createMissingReport(reportData) {
    initLocalStorage();
    try {
      let photoUrl = reportData.photo || reportData.childPhoto;
      if (photoUrl && (photoUrl.startsWith("data:") || photoUrl instanceof File || photoUrl instanceof Blob)) {
        photoUrl = await this.uploadFileToSupabaseStorage(photoUrl, "avatars");
      }
      if (!photoUrl) {
        photoUrl = getDefaultChildPortrait(reportData.gender, 0, false);
      }

      // Fast PARALLEL upload of supporting documents with timeout protection
      let docUrlsText = "";
      const docKeys = ['birthCertificate', 'guardianshipDoc', 'schoolDoc', 'familyPhoto', 'hospitalRecord'];
      const uploadTasks = docKeys
        .filter(dk => reportData[dk])
        .map(async (dk) => {
          const docItem = reportData[dk];
          const docData = typeof docItem === 'object' && docItem.dataUrl ? docItem.dataUrl : docItem;
          if (typeof docData === 'string' && (docData.startsWith("data:") || docData.startsWith("http"))) {
            const upUrl = await this.uploadFileToSupabaseStorage(docData, "avatars");
            if (upUrl) return ` [${dk}: ${upUrl}]`;
          }
          return '';
        });

      if (uploadTasks.length > 0) {
        const uploadResults = await Promise.allSettled(uploadTasks);
        docUrlsText = uploadResults
          .filter(r => r.status === 'fulfilled' && r.value)
          .map(r => r.value)
          .join('');
      }

      const dbId = generateUUID();
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
        photo: photoUrl
      };

      // 1. Invoke Supabase Edge Function with fast non-blocking timeout
      try {
        await withTimeout(
          supabase.functions.invoke('create-missing-report', {
            body: {
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
              isPublic: true
            }
          }),
          2000,
          null
        );
      } catch (fErr) {
        console.log("[Supabase Edge Function] Notice invoking Edge Function:", fErr);
      }

      // 2. Direct PostgreSQL persistence with timeout protection
      const incidentDesc = (reportData.notes || reportData.physicalDescription || "Signalement de disparition de l'enfant") + docUrlsText;
      const { error: insertErr } = await withTimeout(
        supabase.from('missing_reports').insert([{
          id: dbId,
          reporter_id: supabaseReporterId,
          child_full_name: newReport.name,
          child_age: newReport.age ? Number(newReport.age) : null,
          child_gender: newReport.gender,
          last_seen_location: newReport.location,
          last_seen_date: newReport.date || new Date().toISOString().split('T')[0],
          last_seen_time: newReport.time || new Date().toTimeString().split(' ')[0],
          physical_description: newReport.physicalDescription,
          clothing_description: newReport.clothingDescription,
          incident_description: incidentDesc,
          emergency_contact_name: newReport.relationship || "Parent / Gardien",
          emergency_contact_phone: "677000000",
          child_photo_url: newReport.photo,
          status: "Published",
          is_public: true
        }]),
        5000,
        { error: null }
      );

      if (insertErr) {
        console.warn("Notice inserting missing report in Supabase:", insertErr.message || insertErr);
      }

      const reports = this.getMissingReports();
      reports.unshift(newReport);
      safeSetLocalStorage("missing_reports", reports);

      return newReport;
    } catch (e) {
      console.error("Error creating missing report:", e);
      return null;
    }
  },

  async createFoundReport(reportData) {
    initLocalStorage();
    try {
      let photoUrl = reportData.photo || reportData.childPhoto;
      if (photoUrl && (photoUrl.startsWith("data:") || photoUrl instanceof File || photoUrl instanceof Blob)) {
        photoUrl = await this.uploadFileToSupabaseStorage(photoUrl, "avatars");
      }
      if (!photoUrl) {
        photoUrl = getDefaultChildPortrait(reportData.gender, 0, true);
      }

      const dbId = generateUUID();
      const currentId = await this.getCurrentUserId();
      const supabaseReporterId = await this.getSupabaseReporterUuid();

      const newReport = {
        id: dbId,
        reporterId: supabaseReporterId || currentId,
        status: "Published",
        urgency: "Recherche Famille",
        createdAt: new Date().toISOString(),
        type: "found",
        ...reportData,
        photo: photoUrl
      };

      // 1. Invoke Supabase Edge Function with fast non-blocking timeout
      try {
        await withTimeout(
          supabase.functions.invoke('create-found-report', {
            body: {
              name: newReport.name,
              gender: newReport.gender,
              location: newReport.location,
              date: newReport.date,
              time: newReport.time,
              physicalDescription: newReport.physicalDescription,
              clothingDescription: newReport.clothingDescription,
              currentSafeLocation: newReport.currentSafeLocation,
              gps: newReport.gps,
              photoUrl: photoUrl,
              isPublic: true
            }
          }),
          2000,
          null
        );
      } catch (fErr) {
        console.log("[Supabase Edge Function] Notice invoking Edge Function:", fErr);
      }

      // 2. Direct PostgreSQL persistence with timeout protection
      const physicalDescWithFound = `[TROUVÉ] ${newReport.physicalDescription || ''} | Lieu sûr: ${newReport.currentSafeLocation || ''} | GPS: ${newReport.gps || ''}`;
      const { error: insertErr } = await withTimeout(
        supabase.from('found_reports').insert([{
          id: dbId,
          reporter_id: supabaseReporterId,
          child_full_name: newReport.name || "Enfant trouvé",
          child_gender: newReport.gender,
          found_location: newReport.location,
          found_date: newReport.date || new Date().toISOString().split('T')[0],
          found_time: newReport.time || new Date().toTimeString().split(' ')[0],
          physical_description: physicalDescWithFound,
          clothing_description: newReport.clothingDescription,
          child_photo_url: newReport.photo,
          status: "Published",
          is_public: true
        }]),
        5000,
        { error: null }
      );

      if (insertErr) {
        console.warn("Notice inserting found report in Supabase:", insertErr.message || insertErr);
      }

      const reports = this.getFoundReports();
      reports.unshift(newReport);
      safeSetLocalStorage("found_reports", reports);

      return newReport;
    } catch (e) {
      console.error("Error creating found report:", e);
      return null;
    }
  },

  async getMyMissingReports() {
    initLocalStorage();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        const { data: remoteRows } = await supabase
          .from('missing_reports')
          .select('*')
          .eq('reporter_id', session.user.id)
          .neq('status', 'Trouvé')
          .order('created_at', { ascending: false });

        if (remoteRows && remoteRows.length > 0) {
          return remoteRows.map((r, idx) => ({
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
            photo: r.child_photo_url || getDefaultChildPortrait(r.child_gender, idx, false),
            status: r.status,
            urgency: 'Nouveau',
            type: 'missing',
            createdAt: r.created_at
          }));
        }
      }
    } catch (e) {}

    const all = this.getMissingReports();
    const currentId = await this.getCurrentUserId();
    return all.filter(r => r.reporterId === currentId);
  },

  async getMyFoundReports() {
    initLocalStorage();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        const { data: remoteRows } = await supabase
          .from('found_reports')
          .select('*')
          .eq('reporter_id', session.user.id)
          .order('created_at', { ascending: false });

        if (remoteRows && remoteRows.length > 0) {
          return remoteRows.map((r, idx) => ({
            id: r.id,
            reporterId: r.reporter_id,
            name: r.child_full_name,
            gender: r.child_gender,
            location: r.found_location,
            date: r.found_date,
            time: r.found_time,
            physicalDescription: r.physical_description,
            clothingDescription: r.clothing_description,
            photo: r.child_photo_url || getDefaultChildPortrait(r.child_gender, idx, true),
            status: r.status,
            urgency: 'Recherche Famille',
            type: 'found',
            createdAt: r.created_at
          }));
        }
      }
    } catch (e) {}

    const all = this.getFoundReports();
    const currentId = await this.getCurrentUserId();
    return all.filter(r => r.reporterId === currentId);
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
        const { data: { session } } = await withTimeout(supabase.auth.getSession(), 2500, { data: { session: null } });
        if (session && session.user) {
          const payload = {
            full_name: updated.full_name,
            username: updated.username,
            phone_country_code: updated.phone_country_code || "",
            phone_number: updated.phone_number || "",
            city: updated.city || "",
            role: updated.role || "Membre Élite des Gardiens",
            profile_photo_url: updated.photo || updated.profile_photo_url || DEFAULT_AVATAR,
            updated_at: new Date().toISOString()
          };

          withTimeout(
            supabase.from('profiles').update(payload).eq('user_id', session.user.id),
            4000,
            null
          ).catch(() => {});
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
  }
};

if (typeof window !== "undefined") {
  window.reportService = reportService;
  initLocalStorage();
}
