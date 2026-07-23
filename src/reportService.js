// Modular report service for Child Safety Prototype
// Designed to be easily migratable to Supabase Auth & Firestore in the future
import { supabase } from "./supabaseClient.js";

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
    photo: "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&q=80&w=500",
    physicalDescription: "Teint noir, cheveux crépus coupés courts, petite cicatrice près de l'œil droit.",
    clothingDescription: "Portait un t-shirt bleu marine, un short en jean blanc et des baskets noires.",
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
    photo: "https://images.unsplash.com/photo-1509099836639-18ba1795216d?auto=format&fit=crop&q=80&w=500",
    physicalDescription: "Teint marron clair, deux fossettes lorsqu'elle sourit, cheveux tressés avec des perles colorées.",
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
    photo: "https://images.unsplash.com/photo-1512413313790-681d134e5985?auto=format&fit=crop&q=80&w=500",
    physicalDescription: "Teint noir foncé, athlétique, cheveux crépus courts.",
    clothingDescription: "Maillot de football vert du Cameroun et short de sport noir.",
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
    photo: "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&q=80&w=500",
    physicalDescription: "Petite de taille, grands yeux noirs brillants, cheveux coupés courts.",
    clothingDescription: "Robe en pagne jaune et sandales en plastique marron.",
    relationship: "mere",
    notes: "Disparue près du marché de Nkongsamba alors que nous faisions des courses.",
    type: "missing",
    createdAt: "2024-05-09T12:00:00Z"
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
    photo: "https://images.unsplash.com/photo-1540331547168-8b63109225b7?auto=format&fit=crop&q=80&w=500",
    physicalDescription: "Teint noir, s'exprime en français, dit s'appeler Marc mais ne connaît pas son nom de famille. Très bavard.",
    clothingDescription: "T-shirt orange un peu usé et pantalon de sport bleu.",
    currentSafeLocation: "Poste de Police du 1er Arrondissement",
    gps: "3.8666° N, 11.5167° E",
    type: "found",
    createdAt: "2024-05-14T10:15:00Z"
  },
  {
    id: "f-2",
    name: "Enfant trouvée (Fillette)",
    age: 4,
    gender: "fille",
    height: "Env. 95cm",
    location: "Douala, Marché Central",
    date: "2024-05-13",
    time: "15:40",
    status: "Published",
    urgency: "Recherche Famille",
    photo: "https://images.unsplash.com/photo-1565181993144-8846c4f034e3?auto=format&fit=crop&q=80&w=500",
    physicalDescription: "Teint marron clair, cheveux tressés simplement, timide et ne parle pas beaucoup. S'exprime doucement.",
    clothingDescription: "Robe en coton rouge, pas de chaussures à notre rencontre.",
    currentSafeLocation: "Orphelinat Saint-Jean de Douala",
    gps: "4.0500° N, 9.7000° E",
    type: "found",
    createdAt: "2024-05-13T15:40:00Z"
  },
  {
    id: "f-3",
    name: "Enfant trouvé (Garçon)",
    age: 9,
    gender: "garcon",
    height: "Env. 1m30",
    location: "Bafoussam, Kouekong",
    date: "2024-05-12",
    time: "08:30",
    status: "Published",
    urgency: "Sécurisé",
    photo: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=500",
    physicalDescription: "Teint noir, cheveux crépus courts, s'exprime très bien. Dit avoir perdu son chemin après un match de football.",
    clothingDescription: "T-shirt jaune et short vert avec des sandales de marche noires.",
    currentSafeLocation: "Centre de Protection de l'Enfance de Bafoussam",
    gps: "5.4778° N, 10.4167° E",
    type: "found",
    createdAt: "2024-05-12T08:30:00Z"
  }
];

function initLocalStorage() {
  if (typeof window === "undefined") return;
  const dbVersion = "v6_african_portraits_verified_clean";
  const currentVer = localStorage.getItem("reports_db_version");
  if (currentVer !== dbVersion || !localStorage.getItem("missing_reports") || !localStorage.getItem("found_reports")) {
    localStorage.setItem("missing_reports", JSON.stringify(DEMO_MISSING_REPORTS));
    localStorage.setItem("found_reports", JSON.stringify(DEMO_FOUND_REPORTS));
    localStorage.setItem("reports_db_version", dbVersion);
  }
}

export const reportService = {
  getMissingReports() {
    initLocalStorage();
    try {
      return JSON.parse(localStorage.getItem("missing_reports") || "[]");
    } catch (e) {
      console.error("Error reading missing reports from localStorage:", e);
      return DEMO_MISSING_REPORTS;
    }
  },

  async createMissingReport(reportData) {
    initLocalStorage();
    try {
      let photoUrl = reportData.photo;
      if (photoUrl && photoUrl.startsWith("data:")) {
        const uploadedUrl = await this.uploadFileToSupabaseStorage(photoUrl, "reports");
        if (uploadedUrl) {
          photoUrl = uploadedUrl;
        }
      }

      const reports = this.getMissingReports();
      const newReport = {
        id: "m-" + Date.now(),
        status: "Published", // moderation bypass per prototype requirements
        urgency: "Nouveau",
        createdAt: new Date().toISOString(),
        type: "missing",
        ...reportData,
        photo: photoUrl
      };
      reports.unshift(newReport);
      localStorage.setItem("missing_reports", JSON.stringify(reports));

      // Sync with Supabase DB
      try {
        if (localStorage.getItem('is_guest') !== 'true') {
          const { data: { session } } = await supabase.auth.getSession();
          if (session && session.user) {
            await supabase.from('missing_reports').insert([{
              id: newReport.id,
              user_id: session.user.id,
              name: newReport.name,
              age: newReport.age,
              gender: newReport.gender,
              height: newReport.height,
              location: newReport.location,
              date: newReport.date,
              time: newReport.time,
              physical_description: newReport.physicalDescription,
              clothing_description: newReport.clothingDescription,
              relationship: newReport.relationship,
              notes: newReport.notes,
              status: newReport.status,
              urgency: newReport.urgency,
              photo_url: newReport.photo
            }]).catch(err => console.warn("Supabase table insert notice:", err));
          }
        }
      } catch (dbErr) {
        console.warn("Supabase DB save notice:", dbErr);
      }

      return newReport;
    } catch (e) {
      console.error("Error saving missing report to localStorage:", e);
      return null;
    }
  },

  getFoundReports() {
    initLocalStorage();
    try {
      return JSON.parse(localStorage.getItem("found_reports") || "[]");
    } catch (e) {
      console.error("Error reading found reports from localStorage:", e);
      return DEMO_FOUND_REPORTS;
    }
  },

  async createFoundReport(reportData) {
    initLocalStorage();
    try {
      let photoUrl = reportData.photo;
      if (photoUrl && photoUrl.startsWith("data:")) {
        const uploadedUrl = await this.uploadFileToSupabaseStorage(photoUrl, "reports");
        if (uploadedUrl) {
          photoUrl = uploadedUrl;
        }
      }

      const reports = this.getFoundReports();
      const newReport = {
        id: "f-" + Date.now(),
        status: "Published", // moderation bypass per prototype requirements
        urgency: "Recherche Famille",
        createdAt: new Date().toISOString(),
        type: "found",
        ...reportData,
        photo: photoUrl
      };
      reports.unshift(newReport);
      localStorage.setItem("found_reports", JSON.stringify(reports));

      // Sync with Supabase DB
      try {
        if (localStorage.getItem('is_guest') !== 'true') {
          const { data: { session } } = await supabase.auth.getSession();
          if (session && session.user) {
            await supabase.from('found_reports').insert([{
              id: newReport.id,
              user_id: session.user.id,
              name: newReport.name,
              age: newReport.age,
              gender: newReport.gender,
              height: newReport.height,
              location: newReport.location,
              date: newReport.date,
              time: newReport.time,
              physical_description: newReport.physicalDescription,
              clothing_description: newReport.clothingDescription,
              current_safe_location: newReport.currentSafeLocation,
              gps: newReport.gps,
              status: newReport.status,
              urgency: newReport.urgency,
              photo_url: newReport.photo
            }]).catch(err => console.warn("Supabase table insert notice:", err));
          }
        }
      } catch (dbErr) {
        console.warn("Supabase DB save notice:", dbErr);
      }

      return newReport;
    } catch (e) {
      console.error("Error saving found report to localStorage:", e);
      return null;
    }
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
      let reports = this.getMissingReports();
      reports = reports.filter(r => r.id !== id);
      localStorage.setItem("missing_reports", JSON.stringify(reports));
      return true;
    } catch (e) {
      console.error("Error deleting missing report:", e);
      return false;
    }
  },

  deleteFoundReport(id) {
    initLocalStorage();
    try {
      let reports = this.getFoundReports();
      reports = reports.filter(r => r.id !== id);
      localStorage.setItem("found_reports", JSON.stringify(reports));
      return true;
    } catch (e) {
      console.error("Error deleting found report:", e);
      return false;
    }
  }
};

export const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='60' fill='%23ECE8FF'/%3E%3Cpath d='M60 28c11.045 0 20 8.955 20 20s-8.955 20-20 20-20-8.955-20-20 8.955-20 20-20zm0 48c18.336 0 34 9.168 34 22v4H26v-4c0-12.832 15.664-22 34-22z' fill='%23532CE6'/%3E%3C/svg%3E";

reportService.DEFAULT_AVATAR = DEFAULT_AVATAR;

reportService.uploadFileToSupabaseStorage = async function(fileOrBase64, bucketName = "reports") {
  try {
    let blob;
    let fileExt = "jpg";

    if (typeof fileOrBase64 === "string" && fileOrBase64.startsWith("data:")) {
      const mimeMatch = fileOrBase64.match(/data:(.*?);base64,/);
      if (mimeMatch && mimeMatch[1]) {
        const mime = mimeMatch[1];
        if (mime.includes("png")) fileExt = "png";
        else if (mime.includes("pdf")) fileExt = "pdf";
        else if (mime.includes("jpeg") || mime.includes("jpg")) fileExt = "jpg";
      }
      const res = await fetch(fileOrBase64);
      blob = await res.blob();
    } else if (fileOrBase64 instanceof File || fileOrBase64 instanceof Blob) {
      blob = fileOrBase64;
      if (fileOrBase64.name) {
        const parts = fileOrBase64.name.split(".");
        if (parts.length > 1) fileExt = parts.pop();
      }
    }

    if (blob) {
      const filePath = `report_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(filePath, blob, { upsert: true });

      if (!error) {
        const { data: publicData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);
        if (publicData && publicData.publicUrl) {
          return publicData.publicUrl;
        }
      } else {
        // Fallback if bucket doesn't exist, try avatars bucket
        const { data: altData, error: altErr } = await supabase.storage
          .from("avatars")
          .upload(`reports/${filePath}`, blob, { upsert: true });
        if (!altErr) {
          const { data: publicData } = supabase.storage
            .from("avatars")
            .getPublicUrl(`reports/${filePath}`);
          if (publicData && publicData.publicUrl) {
            return publicData.publicUrl;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Supabase storage upload error:", err);
  }
  return null;
};

reportService.updateDOMProfile = function(profile) {
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
};

reportService.getProfile = function() {
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
    console.error("Error getting user profile:", e);
    return {};
  }
};

reportService.uploadAvatarToSupabaseStorage = async function(fileOrBase64) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) return null;

    let blob;
    if (typeof fileOrBase64 === "string" && fileOrBase64.startsWith("data:")) {
      const res = await fetch(fileOrBase64);
      blob = await res.blob();
    } else if (fileOrBase64 instanceof File || fileOrBase64 instanceof Blob) {
      blob = fileOrBase64;
    }

    if (blob) {
      const fileExt = blob.type === "image/png" ? "png" : "jpg";
      const filePath = `avatars/user_${session.user.id}_${Date.now()}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from("avatars")
        .upload(filePath, blob, { upsert: true });

      if (!error) {
        const { data: publicData } = supabase.storage
          .from("avatars")
          .getPublicUrl(filePath);
        if (publicData && publicData.publicUrl) {
          return publicData.publicUrl;
        }
      } else {
        console.warn("Supabase storage upload notice:", error.message);
      }
    }
  } catch (err) {
    console.warn("Supabase storage upload fallback:", err);
  }
  return null;
};

reportService.saveProfile = async function(profileData) {
  if (typeof window === "undefined") return null;
  try {
    const current = this.getProfile();
    let photoUrl = profileData.photo || current.photo || DEFAULT_AVATAR;

    // Upload to Supabase Storage if data URI provided
    if (profileData.photo && profileData.photo.startsWith("data:")) {
      const storageUrl = await this.uploadAvatarToSupabaseStorage(profileData.photo);
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

    // Update Supabase profiles table
    if (localStorage.getItem('is_guest') !== 'true') {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        const payload = {
          full_name: updated.full_name,
          username: updated.username,
          phone_country_code: updated.phone_country_code || "",
          phone_number: updated.phone_number || "",
          city: updated.city || "",
          role: updated.role || "Membre Élite des Gardiens",
          photo: updated.photo || DEFAULT_AVATAR
        };

        const { error } = await supabase
          .from('profiles')
          .update(payload)
          .eq('id', session.user.id);

        if (error) {
          console.error("Error updating profile in Supabase:", error);
        } else {
          console.log("Profile synchronized with Supabase successfully!");
        }
      }
    }

    this.updateDOMProfile(updated);
    return updated;
  } catch (e) {
    console.error("Error saving user profile:", e);
    return null;
  }
};

reportService.syncProfileWithSupabase = async function() {
  if (typeof window === "undefined") return this.getProfile();
  if (localStorage.getItem('is_guest') === 'true') {
    const profile = this.getProfile();
    this.updateDOMProfile(profile);
    return profile;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user) {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      const current = this.getProfile();
      let updated = { ...current };

      if (profileData && !error && Object.keys(profileData).length > 0) {
        updated = { ...updated, ...profileData };
      }

      if (!updated.full_name || updated.full_name === "Elena Rodriguez") {
        if (session.user.user_metadata?.full_name) {
          updated.full_name = session.user.user_metadata.full_name;
        } else if (session.user.email) {
          updated.full_name = session.user.email.split('@')[0];
        } else {
          updated.full_name = "Gardien de la Sécurité";
        }
      }

      if (!updated.photo || updated.photo.includes('unsplash.com')) {
        updated.photo = DEFAULT_AVATAR;
      }

      localStorage.setItem("user_profile", JSON.stringify(updated));
      this.updateDOMProfile(updated);
      return updated;
    }
  } catch (e) {
    console.error("Error syncing profile with Supabase:", e);
  }

  const fallback = this.getProfile();
  this.updateDOMProfile(fallback);
  return fallback;
};

// Expose globally for pages loaded in iframe context
if (typeof window !== "undefined") {
  window.reportService = reportService;
  // Auto init immediately
  initLocalStorage();
}
