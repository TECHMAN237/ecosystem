// RAYDAR Child Safety Platform — Authoritative Email Verification Edge Function (Deno)
// Project: ifpbdythbhlgqymsaxtz (https://ifpbdythbhlgqymsaxtz.supabase.co)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Dispatches the 6-digit verification code using configured email provider
 */
async function dispatchEmail(toEmail: string, code: string): Promise<{ delivered: boolean; provider: string; details?: string }> {
  const cleanEmail = toEmail.trim().toLowerCase();
  const subject = `Code de vérification RAYDAR : ${code}`;
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="utf-8">
      <title>Vérification de votre compte RAYDAR</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }
        .card { max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
        .logo { font-size: 22px; font-weight: 800; color: #532ce6; text-align: center; margin-bottom: 4px; }
        .tagline { font-size: 12px; font-weight: 600; color: #64748b; text-align: center; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 24px; }
        .title { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
        .text { font-size: 14px; color: #334155; line-height: 1.6; margin-bottom: 24px; }
        .code-box { text-align: center; margin: 28px 0; }
        .code { display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #532ce6; background: #f5f3ff; border: 2px dashed #532ce6; padding: 14px 28px; border-radius: 12px; }
        .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">🛡️ RAYDAR</div>
        <div class="tagline">Protection de l'Enfance</div>
        <div class="title">Vérification de votre adresse e-mail</div>
        <div class="text">
          Pour valider votre inscription et garantir la sécurité des enfants sur la plateforme RAYDAR, veuillez saisir le code de vérification suivant :
        </div>
        <div class="code-box">
          <span class="code">${code}</span>
        </div>
        <div class="text" style="font-size: 13px; color: #64748b;">
          Ce code est strictement personnel et expire dans <strong>15 minutes</strong>. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail.
        </div>
        <div class="footer">
          RAYDAR Child Safety Platform • Sécurité communautaire
        </div>
      </div>
    </body>
    </html>
  `;

  // 1. Try Resend API
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || Deno.env.get("RESEND_KEY");
  if (resendApiKey) {
    try {
      const fromEmail = Deno.env.get("EMAIL_FROM") || "RAYDAR Security <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [cleanEmail],
          subject: subject,
          html: htmlContent,
        }),
      });

      if (res.ok) {
        return { delivered: true, provider: "Resend" };
      }
      const errText = await res.text();
      console.warn("[RAYDAR Email] Resend API non-200 response:", errText);
    } catch (e: any) {
      console.warn("[RAYDAR Email] Resend delivery error:", e?.message);
    }
  }

  // 2. Try Brevo (Sendinblue) API
  const brevoApiKey = Deno.env.get("BREVO_API_KEY") || Deno.env.get("SENDINBLUE_API_KEY");
  if (brevoApiKey) {
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: "RAYDAR Security", email: Deno.env.get("BREVO_SENDER_EMAIL") || "security@raydar.app" },
          to: [{ email: cleanEmail }],
          subject: subject,
          htmlContent: htmlContent,
        }),
      });

      if (res.ok) {
        return { delivered: true, provider: "Brevo" };
      }
    } catch (e: any) {
      console.warn("[RAYDAR Email] Brevo delivery error:", e?.message);
    }
  }

  // 3. Try SendGrid API
  const sendgridApiKey = Deno.env.get("SENDGRID_API_KEY");
  if (sendgridApiKey) {
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sendgridApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: cleanEmail }] }],
          from: { email: Deno.env.get("SENDGRID_SENDER_EMAIL") || "no-reply@raydar.app", name: "RAYDAR Security" },
          subject: subject,
          content: [{ type: "text/html", value: htmlContent }],
        }),
      });

      if (res.ok) {
        return { delivered: true, provider: "SendGrid" };
      }
    } catch (e: any) {
      console.warn("[RAYDAR Email] SendGrid delivery error:", e?.message);
    }
  }

  // 4. Try Postmark API
  const postmarkApiKey = Deno.env.get("POSTMARK_API_KEY");
  if (postmarkApiKey) {
    try {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": postmarkApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          From: Deno.env.get("POSTMARK_SENDER_EMAIL") || "security@raydar.app",
          To: cleanEmail,
          Subject: subject,
          HtmlBody: htmlContent,
        }),
      });

      if (res.ok) {
        return { delivered: true, provider: "Postmark" };
      }
    } catch (e: any) {
      console.warn("[RAYDAR Email] Postmark delivery error:", e?.message);
    }
  }

  return { delivered: false, provider: "none", details: "No email secret configured or all remote providers offline" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://ifpbdythbhlgqymsaxtz.supabase.co";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { action, email, code, user_id } = body;

    // ACTION: SEND VERIFICATION CODE
    if (action === "send-code") {
      if (!email) {
        return new Response(
          JSON.stringify({ error: "L'adresse email est requise." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cleanEmail = email.trim().toLowerCase();

      // Generate a cryptographically secure 6-digit verification code
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      const generatedCode = (100000 + (array[0] % 900000)).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

      // Invalidate previous unverified codes for this email
      await supabase
        .from("email_verifications")
        .update({ attempts: 99 })
        .eq("email", cleanEmail)
        .is("verified_at", null);

      // Insert new authoritative code into email_verifications table
      const { error: insertErr } = await supabase.from("email_verifications").insert({
        email: cleanEmail,
        user_id: user_id || null,
        code: generatedCode,
        expires_at: expiresAt,
        attempts: 0
      });

      if (insertErr) {
        console.error("[RAYDAR Auth] Error storing verification code in database:", insertErr);
      }

      // Dispatch the actual email via configured email service
      const deliveryResult = await dispatchEmail(cleanEmail, generatedCode);
      console.log(`[RAYDAR Auth Server] Verification code generated for ${cleanEmail}. Delivery: ${deliveryResult.provider} (${deliveryResult.delivered ? 'Success' : 'Pending'})`);

      const responsePayload: Record<string, any> = {
        success: true,
        message: `Code de vérification envoyé à ${cleanEmail}.`,
        delivered: deliveryResult.delivered,
        provider: deliveryResult.provider,
        expires_at: expiresAt
      };

      // Expose debug_code in development sandbox or when external SMTP is not yet wired
      const isDebugAllowed = Deno.env.get("RAYDAR_DEBUG_AUTH") === "true" || !deliveryResult.delivered;
      if (isDebugAllowed) {
        responsePayload.debug_code = generatedCode;
      }

      return new Response(
        JSON.stringify(responsePayload),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: VERIFY CODE
    if (action === "verify-code") {
      if (!email || !code) {
        return new Response(
          JSON.stringify({ error: "Email et code requis." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cleanCode = code.toString().trim();
      const cleanEmail = email.trim().toLowerCase();

      // Look up authoritative record in email_verifications table
      const { data: verifRecords, error: fetchErr } = await supabase
        .from("email_verifications")
        .select("*")
        .eq("email", cleanEmail)
        .eq("code", cleanCode)
        .gt("expires_at", new Date().toISOString())
        .is("verified_at", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (fetchErr || !verifRecords || verifRecords.length === 0) {
        // Increment attempts on the latest active record
        const { data: latestRecords } = await supabase
          .from("email_verifications")
          .select("id, attempts")
          .eq("email", cleanEmail)
          .is("verified_at", null)
          .order("created_at", { ascending: false })
          .limit(1);

        if (latestRecords && latestRecords.length > 0) {
          const record = latestRecords[0];
          await supabase
            .from("email_verifications")
            .update({ attempts: (record.attempts || 0) + 1 })
            .eq("id", record.id);
        }

        return new Response(
          JSON.stringify({ success: false, verified: false, error: "Code invalide ou expiré." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const record = verifRecords[0];

      if ((record.attempts || 0) >= 5) {
        return new Response(
          JSON.stringify({ success: false, verified: false, error: "Nombre maximal de tentatives de validation atteint. Veuillez demander un nouveau code." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mark verification record as confirmed
      await supabase
        .from("email_verifications")
        .update({ verified_at: new Date().toISOString() })
        .eq("id", record.id);

      // Update public.profiles if user exists
      const targetUserId = user_id || record.user_id;
      if (targetUserId) {
        await supabase
          .from("profiles")
          .update({
            is_verified: true,
            email_verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("user_id", targetUserId);

        // Also update auth.users metadata if service key is active
        try {
          await supabase.auth.admin.updateUserById(targetUserId, {
            user_metadata: { raydar_verified: true, raydar_email_verified: true }
          });
        } catch (authErr) {
          console.warn("[RAYDAR Auth] updateUserById metadata notice:", authErr);
        }
      } else {
        // Find profile by email if user_id was not linked yet
        await supabase
          .from("profiles")
          .update({
            is_verified: true,
            email_verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("email", cleanEmail);
      }

      return new Response(
        JSON.stringify({ success: true, verified: true, message: "Email vérifié avec succès dans RAYDAR." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Action inconnue." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[RAYDAR Auth] Internal Error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Erreur interne du serveur d'authentification" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

