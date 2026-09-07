// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseAdmin, getSupabaseUserClient } from "../_shared/supabaseClient.ts";

interface MissingReportPayload {
  name: string;
  age?: number | string;
  gender?: string;
  location: string;
  date?: string;
  time?: string;
  physicalDescription?: string;
  clothingDescription?: string;
  notes?: string;
  relationship?: string;
  emergencyPhone?: string;
  photoUrl?: string;
  documentUrls?: string[];
  isPublic?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUser = getSupabaseUserClient(authHeader);
    const supabaseAdmin = getSupabaseAdmin();

    // Authenticate user
    let reporterId: string | null = null;
    if (authHeader) {
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (!userError && user) {
        reporterId = user.id;
      }
    }

    const payload: MissingReportPayload = await req.json();

    if (!payload.name || !payload.location) {
      return new Response(
        JSON.stringify({ error: "Le nom et le lieu de disparition sont obligatoires." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const reportId = crypto.randomUUID();
    const incidentDesc = (payload.notes || payload.physicalDescription || "Signalement de disparition") +
      (payload.documentUrls && payload.documentUrls.length > 0 ? ` [Documents: ${payload.documentUrls.join(', ')}]` : '');

    const newRow = {
      id: reportId,
      reporter_id: reporterId,
      child_full_name: payload.name.trim(),
      child_age: payload.age ? Number(payload.age) : null,
      child_gender: payload.gender || 'non_specifie',
      last_seen_location: payload.location.trim(),
      last_seen_date: payload.date || new Date().toISOString().split('T')[0],
      last_seen_time: payload.time || new Date().toTimeString().split(' ')[0],
      physical_description: payload.physicalDescription || '',
      clothing_description: payload.clothingDescription || '',
      incident_description: incidentDesc,
      emergency_contact_name: payload.relationship || "Parent / Tuteur",
      emergency_contact_phone: payload.emergencyPhone || "677000000",
      child_photo_url: payload.photoUrl || null,
      status: "Published",
      is_public: payload.isPublic !== false
    };

    const { data, error } = await supabaseAdmin
      .from('missing_reports')
      .insert([newRow])
      .select()
      .single();

    if (error) {
      console.error("Database insert error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Trigger an emergency alert if report is public
    if (newRow.is_public) {
      await supabaseAdmin.from('alerts').insert([{
        title: `Disparition signalée : ${newRow.child_full_name}`,
        message: `Disparu à ${newRow.last_seen_location}. ${newRow.physical_description}`,
        category: 'EMERGENCY',
        radius_km: 15
      }]).catch(() => {});
    }

    return new Response(
      JSON.stringify({ success: true, report: data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
