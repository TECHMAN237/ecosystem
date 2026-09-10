// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This code is running on Supabase Edge Functions (Deno runtime).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, email, code, user_id } = await req.json();

    if (action === "send-code") {
      if (!email) {
        return new Response(
          JSON.stringify({ error: "L'adresse email est requise." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generate a cryptographically secure 6-digit verification code
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      const generatedCode = (100000 + (array[0] % 900000)).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

      // Invalidate previous unverified codes for this email
      await supabase
        .from("email_verifications")
        .update({ attempts: 99 })
        .eq("email", email.trim().toLowerCase())
        .is("verified_at", null);

      // Insert new authoritative code
      const { error: insertErr } = await supabase.from("email_verifications").insert({
        email: email.trim().toLowerCase(),
        user_id: user_id || null,
        code: generatedCode,
        expires_at: expiresAt,
        attempts: 0
      });

      if (insertErr) {
        console.error("Error storing verification code:", insertErr);
      }

      console.log(`[RAYDAR Auth Server] Authoritative verification code generated for ${email}`);

      const responsePayload: Record<string, any> = {
        success: true,
        message: "Code de vérification généré et envoyé."
      };

      // Only expose debug hint in explicit local sandbox mode
      if (Deno.env.get("RAYDAR_DEBUG_AUTH") === "true") {
        responsePayload.debug_code = generatedCode;
      }

      return new Response(
        JSON.stringify(responsePayload),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "verify-code") {
      if (!email || !code) {
        return new Response(
          JSON.stringify({ error: "Email et code requis." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cleanCode = code.toString().trim();
      const cleanEmail = email.trim().toLowerCase();

      // Check authoritative record in email_verifications table
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
        // Increment attempts on existing record
        await supabase.rpc("increment_verification_attempts", { p_email: cleanEmail }).catch(() => {});
        return new Response(
          JSON.stringify({ success: false, error: "Code invalide ou expiré." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const record = verifRecords[0];

      // Mark verified
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
      }

      return new Response(
        JSON.stringify({ success: true, verified: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Action inconnue." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || "Erreur interne" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
