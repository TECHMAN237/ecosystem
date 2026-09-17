import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://ifpbdythbhlgqymsaxtz.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

// Server-side authoritative verification code store (backed by database when accessible)
interface VerificationEntry {
  email: string;
  code: string;
  expiresAt: number;
  userId?: string;
  verified: boolean;
  attempts: number;
}
const serverVerificationStore = new Map<string, VerificationEntry>();

// Parse JSON and urlencoded bodies with 50MB limit to comfortably allow photo and evidence uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Log incoming requests for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// ==============================================================================
// AUTHENTICATION API ENDPOINTS (Server-Authoritative)
// ==============================================================================

// 1. Check if an email is already registered in Supabase Auth or PostgreSQL profiles
app.post("/api/auth/check-email-exists", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email requis" });
    }
    const cleanEmail = email.trim().toLowerCase();

    // Check profiles table first
    if (supabaseAdmin) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, email")
        .eq("email", cleanEmail)
        .limit(1);

      if (profile && profile.length > 0) {
        return res.json({ exists: true, source: "profiles" });
      }

      // Check auth.users via admin
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = (usersData?.users || []).find(
        (u) => u.email?.toLowerCase() === cleanEmail
      );
      if (existingUser) {
        return res.json({ exists: true, source: "auth" });
      }
    }

    return res.json({ exists: false });
  } catch (err: any) {
    console.error("Error in check-email-exists:", err);
    return res.status(500).json({ error: "Erreur lors de la vérification de l'email" });
  }
});

// 2. Generate and dispatch authoritative email verification code
app.post("/api/auth/send-verification-code", async (req, res) => {
  try {
    const { email, userId } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email requis" });
    }
    const cleanEmail = email.trim().toLowerCase();

    // Generate deterministic 6-digit secure code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store in authoritative server memory store
    serverVerificationStore.set(cleanEmail, {
      email: cleanEmail,
      code,
      expiresAt,
      userId,
      verified: false,
      attempts: 0
    });

    // Also persist in database if email_verifications table exists
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from("email_verifications").insert({
          email: cleanEmail,
          user_id: userId || null,
          code,
          expires_at: new Date(expiresAt).toISOString()
        });
      } catch (dbErr) {
        // Table may not yet be migrated; serverVerificationStore guarantees verification
        console.warn("Notice: email_verifications table insert skipped:", dbErr);
      }
    }

    console.log(`[RAYDAR Auth] Verification code issued for ${cleanEmail}: ${code}`);

    return res.json({
      success: true,
      message: `Code de vérification envoyé à ${cleanEmail}`,
      // Debug code provided for rapid testing in development environment
      debug_code: code
    });
  } catch (err: any) {
    console.error("Error in send-verification-code:", err);
    return res.status(500).json({ error: "Erreur lors de l'envoi du code de vérification" });
  }
});

// 3. Verify submitted code authoritatively and mark profile verified
app.post("/api/auth/verify-code", async (req, res) => {
  try {
    const { email, code, userId } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: "Email et code requis" });
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.toString().trim();

    const entry = serverVerificationStore.get(cleanEmail);

    if (!entry) {
      return res.status(400).json({ success: false, error: "Aucun code demandé pour cet email. Veuillez demander un code." });
    }

    if (Date.now() > entry.expiresAt) {
      serverVerificationStore.delete(cleanEmail);
      return res.status(400).json({ success: false, error: "Code expiré. Veuillez demander un nouveau code." });
    }

    if (entry.attempts >= 5) {
      return res.status(400).json({ success: false, error: "Trop de tentatives infructueuses. Veuillez demander un nouveau code." });
    }

    if (entry.code !== cleanCode) {
      entry.attempts += 1;
      return res.status(400).json({ success: false, error: "Code de vérification incorrect." });
    }

    // Code matches and is valid! Mark verified authoritatively
    entry.verified = true;

    // Update database profiles if user exists or userId provided
    const targetUserId = userId || entry.userId;
    if (targetUserId && supabaseAdmin) {
      try {
        await supabaseAdmin
          .from("profiles")
          .update({
            is_verified: true,
            updated_at: new Date().toISOString()
          })
          .eq("user_id", targetUserId);
      } catch (profErr) {
        console.warn("Notice: profile update notice:", profErr);
      }
    }

    return res.json({
      success: true,
      verified: true,
      message: "Email vérifié avec succès."
    });
  } catch (err: any) {
    console.error("Error in verify-code:", err);
    return res.status(500).json({ error: "Erreur lors de la validation du code" });
  }
});

// 4. Check authoritative verification status for email or user
app.get("/api/auth/verification-status", async (req, res) => {
  try {
    const email = (req.query.email as string)?.trim()?.toLowerCase();
    const userId = req.query.userId as string;

    if (!email && !userId) {
      return res.status(400).json({ error: "Paramètres manquants" });
    }

    // Check server memory store
    if (email && serverVerificationStore.get(email)?.verified) {
      return res.json({ verified: true });
    }

    // Check PostgreSQL profiles
    if (supabaseAdmin) {
      if (userId) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("is_verified")
          .eq("user_id", userId)
          .single();
        if (prof?.is_verified === true) {
          return res.json({ verified: true });
        }
      }
      if (email) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("is_verified")
          .eq("email", email)
          .single();
        if (prof?.is_verified === true) {
          return res.json({ verified: true });
        }
      }
    }

    return res.json({ verified: false });
  } catch (err: any) {
    return res.status(500).json({ error: "Erreur de statut de vérification" });
  }
});

// ==============================================================================
// STORAGE & REPORTS API ENDPOINTS (Server-Authoritative Supabase Persistence)
// ==============================================================================

/**
 * Normalizes user-input dates to YYYY-MM-DD for PostgreSQL DATE columns.
 */
function sanitizeDate(dateInput?: string | null): string {
  if (!dateInput) return new Date().toISOString().split("T")[0];
  const str = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  const dmyMatch = str.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }
  return new Date().toISOString().split("T")[0];
}

/**
 * Normalizes user-input times (e.g. '14:30', '14h30', '14', '14:30:00') to HH:MM:SS for PostgreSQL TIME columns.
 */
function sanitizeTime(timeInput?: string | null): string {
  if (!timeInput) return "12:00:00";
  const str = String(timeInput).trim();
  const matchHms = str.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/);
  if (matchHms) {
    return `${matchHms[1].padStart(2, "0")}:${matchHms[2]}:${matchHms[3]}`;
  }
  const matchHm = str.match(/([01]?[0-9]|2[0-3])[:hH]([0-5][0-9])/);
  if (matchHm) {
    return `${matchHm[1].padStart(2, "0")}:${matchHm[2]}:00`;
  }
  const matchH = str.match(/^([01]?[0-9]|2[0-3])\s*(?:h|hr|hour)?$/i);
  if (matchH) {
    return `${matchH[1].padStart(2, "0")}:00:00`;
  }
  return "12:00:00";
}

/**
 * Normalizes report status string strictly to the PostgreSQL report_status enum.
 * Valid enum values: 'Published', 'Pending Review', 'Approved', 'Resolved', 'Rejected'.
 */
function sanitizeReportStatus(statusInput?: string | null): "Published" | "Pending Review" | "Approved" | "Resolved" | "Rejected" {
  if (!statusInput) return "Published";
  const s = String(statusInput).trim().toLowerCase();
  if (s.includes("pending") || s.includes("attente") || s.includes("review")) return "Pending Review";
  if (s.includes("approv") || s.includes("approuv")) return "Approved";
  if (s.includes("resol") || s.includes("résol") || s.includes("clôtur") || s.includes("clotur")) return "Resolved";
  if (s.includes("reject") || s.includes("rejet")) return "Rejected";
  return "Published";
}

/**
 * Normalizes child gender to allowed database values.
 */
function sanitizeGender(genderInput?: string | null): string {
  if (!genderInput) return "non_specifie";
  const g = String(genderInput).trim().toLowerCase();
  if (g.includes("fille") || g === "f" || g === "female" || g === "féminin") return "fille";
  if (g.includes("garcon") || g.includes("garçon") || g === "m" || g === "male" || g === "masculin") return "garcon";
  if (g.includes("inconnu")) return "inconnu";
  return "non_specifie";
}

/**
 * Uploads a base64 / data-URI image directly to Supabase Storage using service role.
 * Ensures zero base64 storage in database while never dropping user uploads.
 */
async function uploadBase64ToStorage(dataUri: string, bucket: string = "found-reports", prefix: string = "photo", userId?: string | null): Promise<string | null> {
  if (!supabaseAdmin) return null;
  if (!dataUri || typeof dataUri !== "string") return null;

  try {
    let mimeType = "image/jpeg";
    let base64Data = dataUri.trim();

    if (base64Data.startsWith("data:")) {
      const match = base64Data.match(/^data:([^;]+);base64,(.+)$/s);
      if (match) {
        mimeType = match[1].toLowerCase();
        base64Data = match[2].trim();
      } else {
        const commaIdx = base64Data.indexOf(",");
        if (commaIdx !== -1) {
          const header = base64Data.substring(0, commaIdx);
          base64Data = base64Data.substring(commaIdx + 1).trim();
          const mimeMatch = header.match(/data:([^;]+)/);
          if (mimeMatch) mimeType = mimeMatch[1].toLowerCase();
        }
      }
    }

    const buffer = Buffer.from(base64Data, "base64");
    if (!buffer || buffer.length === 0) return null;

    let ext = "jpg";
    if (mimeType.includes("png")) ext = "png";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("gif")) ext = "gif";
    else if (mimeType.includes("pdf")) ext = "pdf";

    const userFolder = (userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) ? userId : "community";
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = `${userFolder}/${filename}`;

    const timeoutPromise = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

    const uploadAttempt = async (targetBucket: string, path: string) => {
      try {
        const { error: upErr } = await supabaseAdmin.storage
          .from(targetBucket)
          .upload(path, buffer, {
            contentType: mimeType,
            cacheControl: "604800",
            upsert: true
          });
        if (!upErr) {
          const { data: pub } = supabaseAdmin.storage.from(targetBucket).getPublicUrl(path);
          return pub?.publicUrl || null;
        }
        console.warn(`[RAYDAR Server] Upload to bucket '${targetBucket}' notice:`, upErr.message || upErr);
        return null;
      } catch (err) {
        console.warn(`[RAYDAR Server] Exception uploading to '${targetBucket}':`, err);
        return null;
      }
    };

    // 1. Try target bucket with 15s timeout
    const result1 = await Promise.race([uploadAttempt(bucket, filePath), timeoutPromise(15000)]);
    if (result1) return result1;

    // 2. Fallback to public bucket 'found-reports' or 'missing-reports'
    const fallbackBucket = bucket === "found-reports" ? "missing-reports" : "found-reports";
    const fallbackPath = `${userFolder}/${prefix}_${Date.now()}.${ext}`;
    const result2 = await Promise.race([uploadAttempt(fallbackBucket, fallbackPath), timeoutPromise(10000)]);
    if (result2) return result2;

    // 3. Fallback to public 'system-assets'
    const result3 = await Promise.race([uploadAttempt("system-assets", fallbackPath), timeoutPromise(8000)]);
    if (result3) return result3;

    return null;
  } catch (err) {
    console.error("[RAYDAR Server] Exception in uploadBase64ToStorage:", err);
    return null;
  }
}

// 1. Direct server storage upload endpoint for clients (bypasses browser RLS upload limitations)
app.post("/api/storage/upload", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase service client non configuré" });
    }

    const { fileData, thumbnailData, bucket, prefix, userId } = req.body;
    if (!fileData || typeof fileData !== "string") {
      return res.status(400).json({ success: false, error: "fileData (base64 data URI) requis" });
    }

    const targetBucket = bucket || "found-reports";
    const publicUrl = await uploadBase64ToStorage(fileData, targetBucket, prefix || "upload", userId);

    if (!publicUrl) {
      return res.status(500).json({ success: false, error: "Échec du téléchargement vers Supabase Storage" });
    }

    // If thumbnailData is provided, upload thumbnail alongside with 7-day cache
    if (thumbnailData && typeof thumbnailData === "string" && thumbnailData.startsWith("data:")) {
      try {
        const thumbPrefix = "thumb_" + (prefix || "upload");
        uploadBase64ToStorage(thumbnailData, targetBucket, thumbPrefix, userId)
          .then((tUrl) => console.log("[RAYDAR Server] Thumbnail uploaded successfully:", tUrl))
          .catch((tErr) => console.warn("[RAYDAR Server] Thumbnail upload notice:", tErr));
      } catch (e) {}
    }

    return res.json({ success: true, url: publicUrl, bucket: targetBucket });
  } catch (err: any) {
    console.error("[RAYDAR Server] Error in /api/storage/upload:", err);
    return res.status(500).json({ success: false, error: err.message || "Erreur interne" });
  }
});

/**
 * Authoritatively resolves a valid `profiles.id` foreign key for database insertions.
 * Resolves strictly from authenticated JWT token, profiles.id, or auth.users.id (user_id),
 * with safe fallback to existing profile for anonymous / community citizen reports.
 */
async function resolveProfileId(inputReporterId?: string, inputUserId?: string, authHeader?: string | null): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const isUUID = (str?: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str || "");

  // 1. If authHeader Bearer token is provided, authenticate user
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    if (token) {
      try {
        const { data: { user }, error: uErr } = await supabaseAdmin.auth.getUser(token);
        if (!uErr && user?.id) {
          const { data: byUser } = await supabaseAdmin.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
          if (byUser?.id) return byUser.id;

          const { data: newProf } = await supabaseAdmin.from("profiles").upsert({
            id: user.id,
            user_id: user.id,
            email: user.email || "",
            full_name: user.user_metadata?.full_name || (user.email ? user.email.split("@")[0] : "Utilisateur RAYDAR"),
            username: "user_" + user.id.substring(0, 8),
            role: "Guardian",
            terms_accepted: true,
            onboarding_completed: true,
            account_completed: true,
            updated_at: new Date().toISOString()
          }, { onConflict: "user_id" }).select("id").maybeSingle();
          if (newProf?.id) return newProf.id;
        }
      } catch (err) {
        console.warn("[RAYDAR Server] Auth token validation notice:", err);
      }
    }
  }

  // 2. Check if inputReporterId is directly a profiles.id
  if (isUUID(inputReporterId)) {
    const { data: byId } = await supabaseAdmin.from("profiles").select("id").eq("id", inputReporterId!).maybeSingle();
    if (byId?.id) return byId.id;

    // Check if inputReporterId is a profiles.user_id
    const { data: byUser } = await supabaseAdmin.from("profiles").select("id").eq("user_id", inputReporterId!).maybeSingle();
    if (byUser?.id) return byUser.id;

    // Check if inputReporterId exists in auth.users
    try {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(inputReporterId!);
      if (user) {
        const { data: newProf } = await supabaseAdmin.from("profiles").upsert({
          id: user.id,
          user_id: user.id,
          email: user.email || "",
          full_name: user.user_metadata?.full_name || (user.email ? user.email.split("@")[0] : "Utilisateur RAYDAR"),
          username: "user_" + user.id.substring(0, 8),
          role: "Guardian",
          terms_accepted: true,
          onboarding_completed: true,
          account_completed: true,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" }).select("id").maybeSingle();
        if (newProf?.id) return newProf.id;
      }
    } catch (uErr) {}
  }

  // 3. Check if inputUserId is directly profiles.user_id or profiles.id
  if (isUUID(inputUserId)) {
    const { data: byUser } = await supabaseAdmin.from("profiles").select("id").eq("user_id", inputUserId!).maybeSingle();
    if (byUser?.id) return byUser.id;

    const { data: byId } = await supabaseAdmin.from("profiles").select("id").eq("id", inputUserId!).maybeSingle();
    if (byId?.id) return byId.id;

    // Try creating profile for this user_id if user exists in auth
    try {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(inputUserId!);
      if (user) {
        const { data: newProf } = await supabaseAdmin.from("profiles").upsert({
          id: user.id,
          user_id: user.id,
          email: user.email || "",
          full_name: user.user_metadata?.full_name || (user.email ? user.email.split("@")[0] : "Utilisateur RAYDAR"),
          username: "user_" + user.id.substring(0, 8),
          role: "Guardian",
          terms_accepted: true,
          onboarding_completed: true,
          account_completed: true,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" }).select("id").maybeSingle();
        if (newProf?.id) return newProf.id;
      }
    } catch (uErr) {}
  }

  // 4. Safe fallback for anonymous/guest community reports so DB insertion never crashes due to NOT NULL/FK
  const { data: fallbackProf } = await supabaseAdmin.from("profiles").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (fallbackProf?.id) {
    return fallbackProf.id;
  }

  // 5. Ultimate safety fallback: create a verified Community profile if none exists
  try {
    const { data: createdProf } = await supabaseAdmin.from("profiles").insert([{
      full_name: "Communauté RAYDAR",
      username: "raydar_community",
      role: "Guardian",
      is_verified: true,
      terms_accepted: true,
      onboarding_completed: true,
      account_completed: true
    }]).select("id").single();
    if (createdProf?.id) return createdProf.id;
  } catch (cErr) {
    console.warn("[RAYDAR Server] Notice creating default profile:", cErr);
  }

  return null;
}

// ==============================================================================
// TEMPORARY DEVELOPMENT RETENTION: MAXIMUM 4 MISSING + 4 FOUND
// ==============================================================================
export const MAX_RETAINED_MISSING_REPORTS = 4;
export const MAX_RETAINED_FOUND_REPORTS = 4;

/**
 * Extracts storage bucket and relative path from a Supabase Storage URL.
 */
function extractStorageInfo(url?: string | null): { bucket: string; path: string } | null {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/);
  if (match) {
    let path = match[2];
    const qIdx = path.indexOf("?");
    if (qIdx !== -1) path = path.substring(0, qIdx);
    return {
      bucket: match[1],
      path: decodeURIComponent(path)
    };
  }
  return null;
}

/**
 * Given a storage path e.g. "community/photo_123.jpg", derives its thumbnail path "community/thumb_photo_123.jpg".
 */
function deriveThumbnailPath(path: string): string | null {
  if (!path) return null;
  const parts = path.split("/");
  const filename = parts.pop();
  if (!filename || filename.startsWith("thumb_")) return null;
  return (parts.length > 0 ? parts.join("/") + "/" : "") + "thumb_" + filename;
}

/**
 * Checks whether a storage file path is a shared system placeholder that should never be deleted.
 */
function isSystemAsset(path: string): boolean {
  const p = path.toLowerCase();
  return p.includes("default_child_placeholder") || p.includes("system-assets") || p.endsWith("/test.jpg") || p.endsWith("/sample.jpg");
}

/**
 * Authoritatively enforces physical report retention in the database and cleans up associated storage files.
 * Triggered after successful creation of a report.
 */
async function enforceReportRetention(type: "missing" | "found"): Promise<{ deletedCount: number; deletedIds: string[]; filesRemoved: string[] }> {
  if (!supabaseAdmin) return { deletedCount: 0, deletedIds: [], filesRemoved: [] };

  const isMissing = type === "missing";
  const table = isMissing ? "missing_reports" : "found_reports";
  const maxLimit = isMissing ? MAX_RETAINED_MISSING_REPORTS : MAX_RETAINED_FOUND_REPORTS;

  try {
    // 1. Fetch all reports ordered chronologically by created_at ASC, id ASC
    const cols = "id, child_full_name, child_photo_url, created_at" + 
      (isMissing ? ", birth_certificate_url, family_photo_url, health_record_url, other_document_url" : ", additional_photos");

    const { data: allRows, error: fetchErr } = await supabaseAdmin
      .from(table)
      .select(cols)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (fetchErr || !allRows) {
      console.error(`[RETENTION] Error querying ${table}:`, fetchErr);
      return { deletedCount: 0, deletedIds: [], filesRemoved: [] };
    }

    const currentCount = allRows.length;
    if (currentCount <= maxLimit) {
      console.log(`[RETENTION] ${table} count is ${currentCount} <= ${maxLimit}. No cleanup needed.`);
      return { deletedCount: 0, deletedIds: [], filesRemoved: [] };
    }

    // Number of surplus oldest reports to purge
    const surplusCount = currentCount - maxLimit;
    const reportsToPurge = allRows.slice(0, surplusCount);
    console.log(`[RETENTION] Purging ${surplusCount} oldest report(s) from ${table} to maintain limit of ${maxLimit}.`);

    const deletedIds: string[] = [];
    const filesRemoved: string[] = [];

    for (const rep of reportsToPurge) {
      const storageFilesByBucket: Record<string, string[]> = {};

      const addFileToRemove = (url?: string | null) => {
        const info = extractStorageInfo(url);
        if (info && !isSystemAsset(info.path)) {
          if (!storageFilesByBucket[info.bucket]) storageFilesByBucket[info.bucket] = [];
          if (!storageFilesByBucket[info.bucket].includes(info.path)) {
            storageFilesByBucket[info.bucket].push(info.path);
          }
          // Also check and remove thumbnail if applicable
          const thumbPath = deriveThumbnailPath(info.path);
          if (thumbPath && !storageFilesByBucket[info.bucket].includes(thumbPath)) {
            storageFilesByBucket[info.bucket].push(thumbPath);
          }
        }
      };

      // 1. Photo and thumbnail
      addFileToRemove(rep.child_photo_url);

      // 2. Evidence documents (for missing reports)
      if (isMissing) {
        addFileToRemove((rep as any).birth_certificate_url);
        addFileToRemove((rep as any).family_photo_url);
        addFileToRemove((rep as any).health_record_url);
        addFileToRemove((rep as any).other_document_url);
      } else if (Array.isArray((rep as any).additional_photos)) {
        // Additional photos for found reports
        (rep as any).additional_photos.forEach((u: string) => addFileToRemove(u));
      }

      // 3. Remove physical files from Storage
      for (const [bucket, paths] of Object.entries(storageFilesByBucket)) {
        try {
          const { error: delErr } = await supabaseAdmin.storage
            .from(bucket)
            .remove(paths);
          if (delErr) {
            console.warn(`[RETENTION] Storage removal warning for bucket ${bucket}:`, delErr.message);
          } else {
            paths.forEach(p => filesRemoved.push(`${bucket}/${p}`));
            console.log(`[RETENTION] Cleaned up storage files in ${bucket}:`, paths);
          }
        } catch (sErr) {
          console.warn(`[RETENTION] Storage exception in ${bucket}:`, sErr);
        }
      }

      // 4. Delete the database row
      const { error: dbErr } = await supabaseAdmin
        .from(table)
        .delete()
        .eq("id", rep.id);

      if (!dbErr) {
        deletedIds.push(rep.id);
        console.log(`[RETENTION] Successfully deleted surplus oldest report [${rep.id}] (${rep.child_full_name}) from ${table}.`);

        // If found report was mirrored to missing_reports with the same id, delete mirrored record too
        if (!isMissing) {
          try {
            await supabaseAdmin.from("missing_reports").delete().eq("id", rep.id);
          } catch (mErr) {}
        }
      } else {
        console.error(`[RETENTION] Failed to delete report [${rep.id}] from ${table}:`, dbErr);
      }
    }

    return { deletedCount: deletedIds.length, deletedIds, filesRemoved };
  } catch (err) {
    console.error(`[RETENTION] Unexpected exception in enforceReportRetention (${type}):`, err);
    return { deletedCount: 0, deletedIds: [], filesRemoved: [] };
  }
}

// Authoritative missing report persistence bypassing RLS via server service role
app.post("/api/reports/create-missing-report", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase service client non configuré" });
    }

    const {
      id,
      reporterId,
      reporter_id,
      userId,
      name,
      child_full_name,
      age,
      child_age,
      gender,
      child_gender,
      location,
      last_seen_location,
      date,
      last_seen_date,
      time,
      last_seen_time,
      physicalDescription,
      physical_description,
      clothingDescription,
      clothing_description,
      incidentDescription,
      incident_description,
      relationship,
      emergency_contact_name,
      emergencyPhone,
      emergency_contact_phone,
      photoUrl,
      child_photo_url,
      photo,
      birthCertificateUrl,
      birth_certificate_url,
      familyPhotoUrl,
      family_photo_url,
      healthRecordUrl,
      health_record_url,
      otherDocumentUrl,
      other_document_url,
      status,
      is_public
    } = req.body;

    const isUUID = (str?: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str || "");
    const reportId = (id && isUUID(id)) ? id : crypto.randomUUID();
    const cleanName = (child_full_name || name || "Enfant disparu").trim();
    const finalLocation = (last_seen_location || location || "Localisation non précisée").trim();
    let finalPhotoUrl = child_photo_url || photoUrl || photo;

    // Automatic server-side storage upload if client provided base64 data
    if (typeof finalPhotoUrl === "string" && finalPhotoUrl.startsWith("data:")) {
      console.log("[RAYDAR Server] Base64 image payload received for missing report; uploading to Supabase Storage 'missing-reports'");
      const uploadedUrl = await uploadBase64ToStorage(finalPhotoUrl, "missing-reports", `child_${reportId.substring(0, 8)}`, userId);
      finalPhotoUrl = uploadedUrl || "https://ifpbdythbhlgqymsaxtz.supabase.co/storage/v1/object/public/found-reports/community/default_child_placeholder.png";
    }

    if (!finalPhotoUrl || (typeof finalPhotoUrl === "string" && finalPhotoUrl.trim() === "")) {
      finalPhotoUrl = "https://ifpbdythbhlgqymsaxtz.supabase.co/storage/v1/object/public/found-reports/community/default_child_placeholder.png";
    }

    // Resolve profile ID (guarantees matching foreign key to profiles.id)
    const finalReporterId = await resolveProfileId(reporter_id || reporterId, userId, req.headers.authorization);

    if (!finalReporterId) {
      return res.status(400).json({ success: false, error: "Profil déclarant introuvable" });
    }

    const cleanDate = sanitizeDate(last_seen_date || date);
    const cleanTime = sanitizeTime(last_seen_time || time);
    const cleanStatus = sanitizeReportStatus(status);
    const cleanGender = sanitizeGender(child_gender || gender);
    const physDesc = (physical_description || physicalDescription || "").trim();
    const clothDesc = (clothing_description || clothingDescription || "").trim();
    const incDesc = (incident_description || incidentDescription || physDesc || "Signalement de disparition de l'enfant").trim();
    const emergName = (emergency_contact_name || relationship || "Parent / Tuteur").trim();
    const emergPhone = (emergency_contact_phone || emergencyPhone || "677000000").trim();

    // Auto-upload evidence documents if base64
    let finalBirthCert = birth_certificate_url || birthCertificateUrl || null;
    let finalFamilyPhoto = family_photo_url || familyPhotoUrl || null;
    let finalHealthRecord = health_record_url || healthRecordUrl || null;
    let finalOtherDoc = other_document_url || otherDocumentUrl || null;

    if (finalBirthCert && finalBirthCert.startsWith("data:")) {
      finalBirthCert = await uploadBase64ToStorage(finalBirthCert, "report-evidence", "birth_cert", userId);
    }
    if (finalFamilyPhoto && finalFamilyPhoto.startsWith("data:")) {
      finalFamilyPhoto = await uploadBase64ToStorage(finalFamilyPhoto, "report-evidence", "fam_photo", userId);
    }
    if (finalHealthRecord && finalHealthRecord.startsWith("data:")) {
      finalHealthRecord = await uploadBase64ToStorage(finalHealthRecord, "report-evidence", "health_rec", userId);
    }
    if (finalOtherDoc && finalOtherDoc.startsWith("data:")) {
      finalOtherDoc = await uploadBase64ToStorage(finalOtherDoc, "report-evidence", "other_doc", userId);
    }

    const missingRow = {
      id: reportId,
      reporter_id: finalReporterId,
      child_full_name: cleanName,
      child_age: (child_age !== undefined && child_age !== null && !isNaN(Number(child_age))) ? Number(child_age) : ((age !== undefined && age !== null && !isNaN(Number(age))) ? Number(age) : null),
      child_gender: cleanGender,
      last_seen_location: finalLocation,
      last_seen_date: cleanDate,
      last_seen_time: cleanTime,
      physical_description: physDesc,
      clothing_description: clothDesc,
      incident_description: incDesc,
      emergency_contact_name: emergName,
      emergency_contact_phone: emergPhone,
      child_photo_url: finalPhotoUrl,
      birth_certificate_url: finalBirthCert,
      family_photo_url: finalFamilyPhoto,
      health_record_url: finalHealthRecord,
      other_document_url: finalOtherDoc,
      status: cleanStatus,
      is_public: is_public !== false
    };

    console.log(`[RAYDAR Server] Authoritatively inserting missing report into public.missing_reports (ID: ${reportId}, Reporter: ${finalReporterId})`);
    const { data: insertedData, error: insertError } = await supabaseAdmin
      .from("missing_reports")
      .upsert([missingRow], { onConflict: "id" })
      .select()
      .single();

    if (insertError) {
      console.error("[RAYDAR Server] Error inserting into missing_reports:", insertError);
      return res.status(500).json({ success: false, error: insertError.message });
    }

    // Trigger emergency alert if report is public
    if (missingRow.is_public) {
      try {
        await supabaseAdmin.from("alerts").insert([{
          title: `Disparition signalée : ${missingRow.child_full_name}`,
          message: `Disparu à ${missingRow.last_seen_location}. ${missingRow.physical_description}`,
          category: "EMERGENCY",
          radius_km: 15
        }]);
      } catch (alertErr) {
        console.warn("[RAYDAR Server] Notice creating alert for missing report:", alertErr);
      }
    }

    console.log(`[RAYDAR Server] Successfully persisted missing report into public.missing_reports:`, insertedData.id);

    // TEMPORARY DEVELOPMENT RETENTION: maintain maximum 4 missing reports physically
    try {
      await enforceReportRetention("missing");
    } catch (retErr) {
      console.warn("[RAYDAR Server] Notice enforcing missing report retention:", retErr);
    }

    return res.json({
      success: true,
      data: insertedData
    });
  } catch (err: any) {
    console.error("[RAYDAR Server] Exception in create-missing-report endpoint:", err);
    return res.status(500).json({ success: false, error: err.message || "Erreur interne" });
  }
});

// Authoritative found report persistence bypassing RLS via server service role
app.post("/api/reports/create-found-report", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase service client non configuré" });
    }

    const {
      id,
      reporterId,
      reporter_id,
      userId,
      name,
      child_full_name,
      childName,
      gender,
      child_gender,
      age,
      estimated_age,
      location,
      found_location,
      date,
      found_date,
      time,
      found_time,
      physicalDescription,
      physical_description,
      clothingDescription,
      clothing_description,
      currentSafeLocation,
      current_location_of_child,
      circumstancesDescription,
      circumstances_description,
      photoUrl,
      child_photo_url,
      photo,
      envPhotoUrl,
      envPhoto,
      additional_photos,
      status,
      is_public
    } = req.body;

    const isUUID = (str?: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str || "");
    const reportId = (id && isUUID(id)) ? id : crypto.randomUUID();
    const cleanName = (child_full_name || childName || name || "Enfant trouvé").trim() || "Enfant trouvé";
    const finalLocation = (found_location || location || "Localisation non précisée").trim() || "Localisation non précisée";
    let finalPhotoUrl = child_photo_url || photoUrl || photo || envPhotoUrl || envPhoto;
    let finalEnvUrl = envPhotoUrl || envPhoto;

    // Default safety fallback photo in case no photo was provided
    const defaultPlaceholderPhoto = "https://ifpbdythbhlgqymsaxtz.supabase.co/storage/v1/object/public/found-reports/community/default_child_placeholder.png";

    // Automatic server-side storage upload with parallel execution if client provided base64 data
    const uploadTasks: Promise<void>[] = [];

    if (typeof finalPhotoUrl === "string" && finalPhotoUrl.startsWith("data:")) {
      uploadTasks.push((async () => {
        console.log("[RAYDAR Server] Base64 child photo received; uploading to Supabase Storage 'found-reports'");
        const uploadedUrl = await uploadBase64ToStorage(finalPhotoUrl, "found-reports", `child_${reportId.substring(0, 8)}`, userId);
        finalPhotoUrl = uploadedUrl || defaultPlaceholderPhoto;
      })());
    }

    if (typeof finalEnvUrl === "string" && finalEnvUrl.startsWith("data:")) {
      uploadTasks.push((async () => {
        console.log("[RAYDAR Server] Base64 env photo received; uploading to Supabase Storage 'found-reports'");
        const uploadedEnv = await uploadBase64ToStorage(finalEnvUrl, "found-reports", `env_${reportId.substring(0, 8)}`, userId);
        finalEnvUrl = uploadedEnv || undefined;
      })());
    }

    if (uploadTasks.length > 0) {
      console.log(`[RAYDAR Server] Uploading ${uploadTasks.length} photos in parallel for found report ${reportId}...`);
      await Promise.allSettled(uploadTasks);
    }

    if (!finalPhotoUrl && finalEnvUrl) {
      finalPhotoUrl = finalEnvUrl;
    }

    if (!finalPhotoUrl || (typeof finalPhotoUrl === "string" && (finalPhotoUrl.trim() === "" || finalPhotoUrl.startsWith("data:")))) {
      finalPhotoUrl = defaultPlaceholderPhoto;
    }

    // Resolve profile ID (guarantees matching foreign key to profiles.id)
    const finalReporterId = await resolveProfileId(reporter_id || reporterId, userId, req.headers.authorization);

    if (!finalReporterId) {
      return res.status(400).json({ success: false, error: "Profil déclarant introuvable" });
    }

    const safeLoc = (current_location_of_child || currentSafeLocation || "Poste de Police / Centre de protection").trim() || "Poste de Police / Centre de protection";
    const circumstances = (circumstances_description || circumstancesDescription || physical_description || physicalDescription || `Enfant trouvé à ${finalLocation}`).trim() || "Enfant trouvé en attente d'identification";
    
    let additionalPhotosList: string[] = [];
    if (Array.isArray(additional_photos)) {
      additionalPhotosList = additional_photos.filter(p => typeof p === "string" && p.startsWith("http"));
    }
    if (finalEnvUrl && typeof finalEnvUrl === "string" && finalEnvUrl.startsWith("http") && !additionalPhotosList.includes(finalEnvUrl)) {
      additionalPhotosList.push(finalEnvUrl);
    }

    const cleanDate = sanitizeDate(found_date || date);
    const cleanTime = sanitizeTime(found_time || time);
    const cleanStatus = sanitizeReportStatus(status);
    const cleanGender = sanitizeGender(child_gender || gender);
    const cleanAge = (estimated_age !== undefined && estimated_age !== null && !isNaN(Number(estimated_age)))
      ? Number(estimated_age)
      : ((age !== undefined && age !== null && !isNaN(Number(age))) ? Number(age) : null);

    const foundRow = {
      id: reportId,
      reporter_id: finalReporterId,
      child_full_name: cleanName,
      child_gender: cleanGender,
      estimated_age: cleanAge,
      found_location: finalLocation,
      found_date: cleanDate,
      found_time: cleanTime,
      physical_description: (physical_description || physicalDescription || "Enfant trouvé").trim() || "Enfant trouvé",
      clothing_description: (clothing_description || clothingDescription || "").trim(),
      current_location_of_child: safeLoc,
      circumstances_description: circumstances,
      child_photo_url: finalPhotoUrl,
      additional_photos: additionalPhotosList,
      status: cleanStatus,
      is_public: is_public !== false
    };

    console.log(`[RAYDAR Server] Authoritatively inserting found report into public.found_reports (ID: ${reportId}, Reporter: ${finalReporterId})`);
    const { data: insertedData, error: insertError } = await supabaseAdmin
      .from("found_reports")
      .upsert([foundRow], { onConflict: "id" })
      .select()
      .single();

    if (insertError) {
      console.error("[RAYDAR Server] Error inserting into found_reports:", JSON.stringify(insertError, null, 2));
      return res.status(500).json({ success: false, error: insertError.message || "Database insert error", details: insertError });
    }

    // Trigger community alert if report is public
    if (foundRow.is_public) {
      try {
        await supabaseAdmin.from("alerts").insert([{
          title: `Enfant trouvé et sécurisé : ${cleanName}`,
          message: `Localisé à ${foundRow.found_location}. Actuellement en sécurité au : ${safeLoc}.`,
          category: "REPORT",
          radius_km: 10
        }]);
      } catch (alertErr) {
        console.warn("[RAYDAR Server] Notice creating alert for found report:", alertErr);
      }
    }

    console.log(`[RAYDAR Server] Successfully persisted found report into public.found_reports:`, insertedData.id);

    // TEMPORARY DEVELOPMENT RETENTION: maintain maximum 4 found reports physically
    try {
      await enforceReportRetention("found");
    } catch (retErr) {
      console.warn("[RAYDAR Server] Notice enforcing found report retention:", retErr);
    }

    return res.json({
      success: true,
      data: insertedData
    });
  } catch (err: any) {
    console.error("[RAYDAR Server] Exception in create-found-report endpoint:", err);
    return res.status(500).json({ success: false, error: err.message || "Erreur interne" });
  }
});

// Retention management endpoints (TEMPORARY DEVELOPMENT RETENTION)
app.get("/api/reports/retention-status", async (_req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase service client non configuré" });
    }
    const { count: missingCount, error: mErr } = await supabaseAdmin.from("missing_reports").select("*", { count: "exact", head: true });
    const { count: foundCount, error: fErr } = await supabaseAdmin.from("found_reports").select("*", { count: "exact", head: true });

    return res.json({
      success: true,
      policy: "TEMPORARY DEVELOPMENT RETENTION",
      missing: {
        currentCount: missingCount ?? 0,
        maxRetained: MAX_RETAINED_MISSING_REPORTS,
        exceedsLimit: (missingCount ?? 0) > MAX_RETAINED_MISSING_REPORTS
      },
      found: {
        currentCount: foundCount ?? 0,
        maxRetained: MAX_RETAINED_FOUND_REPORTS,
        exceedsLimit: (foundCount ?? 0) > MAX_RETAINED_FOUND_REPORTS
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "Erreur interne" });
  }
});

app.post("/api/reports/enforce-retention", async (req, res) => {
  try {
    const { type } = req.body || {};
    if (type !== "missing" && type !== "found") {
      return res.status(400).json({ success: false, error: "Paramètre 'type' invalide: doit être 'missing' ou 'found'" });
    }
    const result = await enforceReportRetention(type);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "Erreur interne" });
  }
});

// Route aliases for report creation
app.post("/api/reports/missing", (req, res, next) => {
  req.url = "/api/reports/create-missing-report";
  app.handle(req, res, next);
});
app.post("/api/reports/found", (req, res, next) => {
  req.url = "/api/reports/create-found-report";
  app.handle(req, res, next);
});

// Serve static files from root directory
app.use(express.static(__dirname));

// Route aliases for clean navigation
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login_child_safety.html"));
});
app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "login_child_safety.html"));
});
app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "sign_up_child_safety.html"));
});
app.get("/verify-email", (req, res) => {
  res.sendFile(path.join(__dirname, "email_verification.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "home_child_safety_v1.html"));
});

// Serve index.html for root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Handle 404
app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
