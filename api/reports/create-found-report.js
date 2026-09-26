// Vercel Serverless Function: POST /api/reports/create-found-report
//
// WHY THIS FILE EXISTS:
// The frontend (src/reportService.js) calls `${getApiBaseUrl()}/api/reports/create-found-report`,
// expecting an authoritative server-side endpoint (using the Supabase service role key) to persist
// the report and bypass the client-side RLS restrictions.
//
// That endpoint already existed as an Express route in server.ts, but server.ts:
//   1. is never built/routed by vercel.json (only static assets are listed there), and
//   2. ends with `app.listen(...)`, which is a persistent-server pattern incompatible with
//      Vercel's serverless model even if it were added to the build.
// So in Production, the fetch to this path was returning Vercel's default 404, and the frontend's
// fallback direct-insert-from-browser was RLS-blocked unless the logged-in profile's role was
// exactly 'Community Member' or 'Volunteer Helper'.
//
// This file is a self-contained Vercel Function that reproduces server.ts's existing
// `/api/reports/create-found-report` handler byte-for-byte in behavior, so it can actually be
// reached on Production. It does not modify server.ts, create-missing-report, RLS, migrations,
// or the Supabase Edge Function `create-found-report` deployed separately.
//
// verify_jwt / auth note: this endpoint intentionally accepts unauthenticated calls the same way
// server.ts's version always did (resolveProfileId() has an anonymous-safe fallback) — that
// behavior is unchanged here, not something newly introduced by this file.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://ifpbdythbhlgqymsaxtz.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

const MAX_RETAINED_FOUND_REPORTS = 4;

function sanitizeDate(dateInput) {
  if (!dateInput) return new Date().toISOString().split("T")[0];
  const str = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dmyMatch = str.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
  return new Date().toISOString().split("T")[0];
}

function sanitizeTime(timeInput) {
  if (!timeInput) return "12:00:00";
  const str = String(timeInput).trim();
  const matchHms = str.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/);
  if (matchHms) return `${matchHms[1].padStart(2, "0")}:${matchHms[2]}:${matchHms[3]}`;
  const matchHm = str.match(/([01]?[0-9]|2[0-3])[:hH]([0-5][0-9])/);
  if (matchHm) return `${matchHm[1].padStart(2, "0")}:${matchHm[2]}:00`;
  const matchH = str.match(/^([01]?[0-9]|2[0-3])\s*(?:h|hr|hour)?$/i);
  if (matchH) return `${matchH[1].padStart(2, "0")}:00:00`;
  return "12:00:00";
}

function sanitizeReportStatus(statusInput) {
  if (!statusInput) return "Published";
  const s = String(statusInput).trim().toLowerCase();
  if (s.includes("pending") || s.includes("attente") || s.includes("review")) return "Pending Review";
  if (s.includes("approv") || s.includes("approuv")) return "Approved";
  if (s.includes("resol") || s.includes("résol") || s.includes("clôtur") || s.includes("clotur")) return "Resolved";
  if (s.includes("reject") || s.includes("rejet")) return "Rejected";
  return "Published";
}

function sanitizeGender(genderInput) {
  if (!genderInput) return "non_specifie";
  const g = String(genderInput).trim().toLowerCase();
  if (g.includes("fille") || g === "f" || g === "female" || g === "féminin") return "fille";
  if (g.includes("garcon") || g.includes("garçon") || g === "m" || g === "male" || g === "masculin") return "garcon";
  if (g.includes("inconnu")) return "inconnu";
  return "non_specifie";
}

const isUUID = (str) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str || "");

async function uploadBase64ToStorage(dataUri, bucket = "found-reports", prefix = "photo", userId) {
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

    const userFolder = isUUID(userId) ? userId : "community";
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = `${userFolder}/${filename}`;

    const timeoutPromise = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

    const uploadAttempt = async (targetBucket, path) => {
      try {
        const { error: upErr } = await supabaseAdmin.storage
          .from(targetBucket)
          .upload(path, buffer, { contentType: mimeType, cacheControl: "604800", upsert: true });
        if (!upErr) {
          const { data: pub } = supabaseAdmin.storage.from(targetBucket).getPublicUrl(path);
          return pub?.publicUrl || null;
        }
        console.warn(`[create-found-report] Upload to bucket '${targetBucket}' notice:`, upErr.message || upErr);
        return null;
      } catch (err) {
        console.warn(`[create-found-report] Exception uploading to '${targetBucket}':`, err);
        return null;
      }
    };

    const result1 = await Promise.race([uploadAttempt(bucket, filePath), timeoutPromise(15000)]);
    if (result1) return result1;

    const fallbackBucket = bucket === "found-reports" ? "missing-reports" : "found-reports";
    const fallbackPath = `${userFolder}/${prefix}_${Date.now()}.${ext}`;
    const result2 = await Promise.race([uploadAttempt(fallbackBucket, fallbackPath), timeoutPromise(10000)]);
    if (result2) return result2;

    const result3 = await Promise.race([uploadAttempt("system-assets", fallbackPath), timeoutPromise(8000)]);
    if (result3) return result3;

    return null;
  } catch (err) {
    console.error("[create-found-report] Exception in uploadBase64ToStorage:", err);
    return null;
  }
}

async function resolveProfileId(inputReporterId, inputUserId, authHeader) {
  if (!supabaseAdmin) return null;

  const upsertGuardianProfile = async (user) =>
    supabaseAdmin
      .from("profiles")
      .upsert(
        {
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
        },
        { onConflict: "user_id" }
      )
      .select("id")
      .maybeSingle();

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    if (token) {
      try {
        const { data: { user }, error: uErr } = await supabaseAdmin.auth.getUser(token);
        if (!uErr && user?.id) {
          const { data: byUser } = await supabaseAdmin.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
          if (byUser?.id) return byUser.id;

          const { data: newProf } = await upsertGuardianProfile(user);
          if (newProf?.id) return newProf.id;
        }
      } catch (err) {
        console.warn("[create-found-report] Auth token validation notice:", err);
      }
    }
  }

  if (isUUID(inputReporterId)) {
    const { data: byId } = await supabaseAdmin.from("profiles").select("id").eq("id", inputReporterId).maybeSingle();
    if (byId?.id) return byId.id;

    const { data: byUser } = await supabaseAdmin.from("profiles").select("id").eq("user_id", inputReporterId).maybeSingle();
    if (byUser?.id) return byUser.id;

    try {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(inputReporterId);
      if (user) {
        const { data: newProf } = await upsertGuardianProfile(user);
        if (newProf?.id) return newProf.id;
      }
    } catch (uErr) {}
  }

  if (isUUID(inputUserId)) {
    const { data: byUser } = await supabaseAdmin.from("profiles").select("id").eq("user_id", inputUserId).maybeSingle();
    if (byUser?.id) return byUser.id;

    const { data: byId } = await supabaseAdmin.from("profiles").select("id").eq("id", inputUserId).maybeSingle();
    if (byId?.id) return byId.id;

    try {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(inputUserId);
      if (user) {
        const { data: newProf } = await upsertGuardianProfile(user);
        if (newProf?.id) return newProf.id;
      }
    } catch (uErr) {}
  }

  const { data: fallbackProf } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fallbackProf?.id) return fallbackProf.id;

  try {
    const { data: createdProf } = await supabaseAdmin
      .from("profiles")
      .insert([{
        full_name: "Communauté RAYDAR",
        username: "raydar_community",
        role: "Guardian",
        is_verified: true,
        terms_accepted: true,
        onboarding_completed: true,
        account_completed: true
      }])
      .select("id")
      .single();
    if (createdProf?.id) return createdProf.id;
  } catch (cErr) {
    console.warn("[create-found-report] Notice creating default profile:", cErr);
  }

  return null;
}

function extractStorageInfo(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/);
  if (match) {
    let path = match[2];
    const qIdx = path.indexOf("?");
    if (qIdx !== -1) path = path.substring(0, qIdx);
    return { bucket: match[1], path: decodeURIComponent(path) };
  }
  return null;
}

function deriveThumbnailPath(path) {
  if (!path) return null;
  const parts = path.split("/");
  const filename = parts.pop();
  if (!filename || filename.startsWith("thumb_")) return null;
  return (parts.length > 0 ? parts.join("/") + "/" : "") + "thumb_" + filename;
}

function isSystemAsset(path) {
  const p = path.toLowerCase();
  return p.includes("default_child_placeholder") || p.includes("system-assets") || p.endsWith("/test.jpg") || p.endsWith("/sample.jpg");
}

async function enforceFoundReportRetention() {
  if (!supabaseAdmin) return { deletedCount: 0, deletedIds: [], filesRemoved: [] };

  try {
    const { data: allRows, error: fetchErr } = await supabaseAdmin
      .from("found_reports")
      .select("id, child_full_name, child_photo_url, created_at, additional_photos")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (fetchErr || !allRows) {
      console.error("[RETENTION] Error querying found_reports:", fetchErr);
      return { deletedCount: 0, deletedIds: [], filesRemoved: [] };
    }

    const currentCount = allRows.length;
    if (currentCount <= MAX_RETAINED_FOUND_REPORTS) {
      return { deletedCount: 0, deletedIds: [], filesRemoved: [] };
    }

    const surplusCount = currentCount - MAX_RETAINED_FOUND_REPORTS;
    const reportsToPurge = allRows.slice(0, surplusCount);

    const deletedIds = [];
    const filesRemoved = [];

    for (const rep of reportsToPurge) {
      const storageFilesByBucket = {};

      const addFileToRemove = (url) => {
        const info = extractStorageInfo(url);
        if (info && !isSystemAsset(info.path)) {
          if (!storageFilesByBucket[info.bucket]) storageFilesByBucket[info.bucket] = [];
          if (!storageFilesByBucket[info.bucket].includes(info.path)) storageFilesByBucket[info.bucket].push(info.path);
          const thumbPath = deriveThumbnailPath(info.path);
          if (thumbPath && !storageFilesByBucket[info.bucket].includes(thumbPath)) storageFilesByBucket[info.bucket].push(thumbPath);
        }
      };

      addFileToRemove(rep.child_photo_url);
      if (Array.isArray(rep.additional_photos)) rep.additional_photos.forEach((u) => addFileToRemove(u));

      for (const [bucket, paths] of Object.entries(storageFilesByBucket)) {
        try {
          const { error: delErr } = await supabaseAdmin.storage.from(bucket).remove(paths);
          if (!delErr) paths.forEach((p) => filesRemoved.push(`${bucket}/${p}`));
        } catch (sErr) {
          console.warn(`[RETENTION] Storage exception in ${bucket}:`, sErr);
        }
      }

      const { error: dbErr } = await supabaseAdmin.from("found_reports").delete().eq("id", rep.id);
      if (!dbErr) deletedIds.push(rep.id);
    }

    return { deletedCount: deletedIds.length, deletedIds, filesRemoved };
  } catch (err) {
    console.error("[RETENTION] Unexpected exception in enforceFoundReportRetention:", err);
    return { deletedCount: 0, deletedIds: [], filesRemoved: [] };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

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
    } = req.body || {};

    const reportId = id && isUUID(id) ? id : crypto.randomUUID();
    const cleanName = (child_full_name || childName || name || "Enfant trouvé").trim() || "Enfant trouvé";
    const finalLocation = (found_location || location || "Localisation non précisée").trim() || "Localisation non précisée";
    let finalPhotoUrl = child_photo_url || photoUrl || photo || envPhotoUrl || envPhoto;
    let finalEnvUrl = envPhotoUrl || envPhoto;

    const defaultPlaceholderPhoto =
      "https://ifpbdythbhlgqymsaxtz.supabase.co/storage/v1/object/public/found-reports/community/default_child_placeholder.png";

    const uploadTasks = [];

    if (typeof finalPhotoUrl === "string" && finalPhotoUrl.startsWith("data:")) {
      uploadTasks.push(
        (async () => {
          const uploadedUrl = await uploadBase64ToStorage(finalPhotoUrl, "found-reports", `child_${reportId.substring(0, 8)}`, userId);
          finalPhotoUrl = uploadedUrl || defaultPlaceholderPhoto;
        })()
      );
    }

    if (typeof finalEnvUrl === "string" && finalEnvUrl.startsWith("data:")) {
      uploadTasks.push(
        (async () => {
          const uploadedEnv = await uploadBase64ToStorage(finalEnvUrl, "found-reports", `env_${reportId.substring(0, 8)}`, userId);
          finalEnvUrl = uploadedEnv || undefined;
        })()
      );
    }

    if (uploadTasks.length > 0) {
      await Promise.allSettled(uploadTasks);
    }

    if (!finalPhotoUrl && finalEnvUrl) finalPhotoUrl = finalEnvUrl;
    if (!finalPhotoUrl || (typeof finalPhotoUrl === "string" && (finalPhotoUrl.trim() === "" || finalPhotoUrl.startsWith("data:")))) {
      finalPhotoUrl = defaultPlaceholderPhoto;
    }

    const finalReporterId = await resolveProfileId(reporter_id || reporterId, userId, req.headers.authorization);
    if (!finalReporterId) {
      return res.status(400).json({ success: false, error: "Profil déclarant introuvable" });
    }

    const safeLoc = (current_location_of_child || currentSafeLocation || "Poste de Police / Centre de protection").trim() || "Poste de Police / Centre de protection";
    const circumstances =
      (circumstances_description || circumstancesDescription || physical_description || physicalDescription || `Enfant trouvé à ${finalLocation}`).trim() ||
      "Enfant trouvé en attente d'identification";

    let additionalPhotosList = [];
    if (Array.isArray(additional_photos)) {
      additionalPhotosList = additional_photos.filter((p) => typeof p === "string" && p.startsWith("http"));
    }
    if (finalEnvUrl && typeof finalEnvUrl === "string" && finalEnvUrl.startsWith("http") && !additionalPhotosList.includes(finalEnvUrl)) {
      additionalPhotosList.push(finalEnvUrl);
    }

    const cleanDate = sanitizeDate(found_date || date);
    const cleanTime = sanitizeTime(found_time || time);
    const cleanStatus = sanitizeReportStatus(status);
    const cleanGender = sanitizeGender(child_gender || gender);
    const cleanAge =
      estimated_age !== undefined && estimated_age !== null && !isNaN(Number(estimated_age))
        ? Number(estimated_age)
        : age !== undefined && age !== null && !isNaN(Number(age))
        ? Number(age)
        : null;

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

    const { data: insertedData, error: insertError } = await supabaseAdmin
      .from("found_reports")
      .upsert([foundRow], { onConflict: "id" })
      .select()
      .single();

    if (insertError) {
      console.error("[create-found-report] Error inserting into found_reports:", JSON.stringify(insertError, null, 2));
      return res.status(500).json({ success: false, error: insertError.message || "Database insert error", details: insertError });
    }

    if (foundRow.is_public) {
      try {
        await supabaseAdmin.from("alerts").insert([{
          title: `Enfant trouvé et sécurisé : ${cleanName}`,
          message: `Localisé à ${foundRow.found_location}. Actuellement en sécurité au : ${safeLoc}.`,
          category: "REPORT",
          radius_km: 10
        }]);
      } catch (alertErr) {
        console.warn("[create-found-report] Notice creating alert for found report:", alertErr);
      }
    }

    try {
      await enforceFoundReportRetention();
    } catch (retErr) {
      console.warn("[create-found-report] Notice enforcing found report retention:", retErr);
    }

    return res.status(200).json({ success: true, data: insertedData });
  } catch (err) {
    console.error("[create-found-report] Exception in create-found-report endpoint:", err);
    return res.status(500).json({ success: false, error: err?.message || "Erreur interne" });
  }
}
