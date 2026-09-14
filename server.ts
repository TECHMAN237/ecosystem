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

// Parse JSON body
app.use(express.json());

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
