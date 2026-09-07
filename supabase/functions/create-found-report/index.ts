import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseAdmin, getSupabaseUserClient } from "../_shared/supabaseClient.ts";

interface FoundReportPayload {
  name?: string;
  age?: number | string;
  gender?: string;
  location: string;
  date?: string;
  time?: string;
  physicalDescription?: string;
  clothingDescription?: string;
  currentSafeLocation?: string;
  gps?: string;
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

    let reporterId: string | null = null;
    if (authHeader) {
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (!userError && user) {
        reporterId = user.id;
      }
    }

    const payload: FoundReportPayload = await req.json();

    if (!payload.location) {
      return new Response(
        JSON.stringify({ error: "Le lieu de découverte est obligatoire." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const reportId = crypto.randomUUID();
    const cleanName = payload.name?.trim() || "Enfant trouvé (Identité en cours)";
    const physicalDesc = `[TROUVÉ] ${payload.physicalDescription || ''} | Lieu sûr: ${payload.currentSafeLocation || 'Poste de police / Centre de protection'} | GPS: ${payload.gps || ''}`;
    
    // Insert into found_reports
    const foundRow = {
      id: reportId,
      reporter_id: reporterId,
      child_full_name: cleanName,
      child_gender: payload.gender || 'non_specifie',
      found_location: payload.location.trim(),
      found_date: payload.date || new Date().toISOString().split('T')[0],
      found_time: payload.time || new Date().toTimeString().split(' ')[0],
      physical_description: physicalDesc,
      clothing_description: payload.clothingDescription || '',
      child_photo_url: payload.photoUrl || null,
      status: "Published",
      is_public: payload.isPublic !== false
    };

    const { data: foundData, error: foundErr } = await supabaseAdmin
      .from('found_reports')
      .insert([foundRow])
      .select()
      .single();

    if (foundErr) {
      console.error("Insert into found_reports error:", foundErr);
    }

    // Also mirror to missing_reports with status 'Trouvé' for unified directory search & matching
    const mirroredRow = {
      id: reportId,
      reporter_id: reporterId,
      child_full_name: cleanName,
      child_age: payload.age ? Number(payload.age) : null,
      child_gender: payload.gender || 'non_specifie',
      last_seen_location: payload.location.trim(),
      last_seen_date: payload.date || new Date().toISOString().split('T')[0],
      last_seen_time: payload.time || new Date().toTimeString().split(' ')[0],
      physical_description: physicalDesc,
      clothing_description: payload.clothingDescription || '',
      incident_description: `Enfant retrouvé en sécurité à ${payload.currentSafeLocation || payload.location}`,
      emergency_contact_name: "Centre de Protection / Découvreur",
      emergency_contact_phone: "677000000",
      child_photo_url: payload.photoUrl || null,
      status: "Trouvé",
      is_public: payload.isPublic !== false
    };

    await supabaseAdmin.from('missing_reports').insert([mirroredRow]).catch(() => {});

    // Broadcast community alert
    await supabaseAdmin.from('alerts').insert([{
      title: `Enfant trouvé et sécurisé : ${cleanName}`,
      message: `Localisé à ${payload.location}. Actuellement en sécurité au : ${payload.currentSafeLocation || 'Centre de protection'}.`,
      category: 'REPORT',
      radius_km: 10
    }]).catch(() => {});

    return new Response(
      JSON.stringify({ success: true, report: foundData || mirroredRow }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
