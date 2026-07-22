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
  const dbVersion = "v5_african_portraits_only_perfect";
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

  createMissingReport(reportData) {
    initLocalStorage();
    try {
      const reports = this.getMissingReports();
      const newReport = {
        id: "m-" + Date.now(),
        status: "Published", // moderation bypass per prototype requirements
        urgency: "Nouveau",
        createdAt: new Date().toISOString(),
        type: "missing",
        ...reportData
      };
      reports.unshift(newReport);
      localStorage.setItem("missing_reports", JSON.stringify(reports));
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

  createFoundReport(reportData) {
    initLocalStorage();
    try {
      const reports = this.getFoundReports();
      const newReport = {
        id: "f-" + Date.now(),
        status: "Published", // moderation bypass per prototype requirements
        urgency: "Recherche Famille",
        createdAt: new Date().toISOString(),
        type: "found",
        ...reportData
      };
      reports.unshift(newReport);
      localStorage.setItem("found_reports", JSON.stringify(reports));
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
  },

  getProfile() {
    if (typeof window === "undefined") return {};
    try {
      const defaultProfile = {
        full_name: "Elena Rodriguez",
        role: "Membre Élite des Gardiens",
        username: "elena_rod",
        phone_country_code: "+237",
        phone_number: "677123456",
        city: "Yaoundé",
        photo: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&q=80&w=400"
      };
      const stored = localStorage.getItem("user_profile");
      if (!stored) {
        localStorage.setItem("user_profile", JSON.stringify(defaultProfile));
        return defaultProfile;
      }
      return { ...defaultProfile, ...JSON.parse(stored) };
    } catch (e) {
      console.error("Error getting user profile:", e);
      return {};
    }
  },

  saveProfile(profileData) {
    if (typeof window === "undefined") return null;
    try {
      const current = this.getProfile();
      const updated = { ...current, ...profileData };
      localStorage.setItem("user_profile", JSON.stringify(updated));

      // Asynchronously update profile in Supabase if not in guest mode
      if (localStorage.getItem('is_guest') !== 'true') {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session && session.user) {
            const payload = {
              full_name: updated.full_name,
              username: updated.username,
              phone_country_code: updated.phone_country_code || "",
              phone_number: updated.phone_number || "",
              city: updated.city || "",
              role: updated.role || "Membre Élite des Gardiens",
              photo: updated.photo || ""
            };
            supabase
              .from('profiles')
              .update(payload)
              .eq('id', session.user.id)
              .then(({ error }) => {
                if (error) {
                  console.error("Error updating profile in Supabase:", error);
                } else {
                  console.log("Profile synchronized with Supabase successfully!");
                }
              });
          }
        }).catch(err => {
          console.error("Error retrieving session for database profile update:", err);
        });
      }

      return updated;
    } catch (e) {
      console.error("Error saving user profile:", e);
      return null;
    }
  },

  async syncProfileWithSupabase() {
    if (typeof window === "undefined") return null;
    if (localStorage.getItem('is_guest') === 'true') {
      return this.getProfile();
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        const { data: profileData, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        if (profileData && !error) {
          const current = this.getProfile();
          const updated = { ...current, ...profileData };
          localStorage.setItem("user_profile", JSON.stringify(updated));
          return updated;
        }
      }
    } catch (e) {
      console.error("Error syncing profile with Supabase:", e);
    }
    return this.getProfile();
  }
};

// Expose globally for pages loaded in iframe context
if (typeof window !== "undefined") {
  window.reportService = reportService;
  // Auto init immediately
  initLocalStorage();
}
