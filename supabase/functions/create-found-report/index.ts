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
    let reporterProfileId: string | null = null;
    if (authHeader) {
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (!userError && user) {
        reporterId = user.id;
        // Resolve profiles.id from user_id (auth.uid() -> profiles.user_id -> profiles.id)
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (profile?.id) {
          reporterProfileId = profile.id;
        }
      }
    }

    const finalReporterId = reporterProfileId || reporterId;

    const payload: FoundReportPayload = await req.json();

    if (!payload.location) {
      return new Response(
        JSON.stringify({ error: "Le lieu de découverte est obligatoire." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve a valid profiles.id
    if (!finalReporterId) {
      const { data: fallbackProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (fallbackProfile?.id) {
        reporterProfileId = fallbackProfile.id;
      }
    }

    const effectiveReporterId = reporterProfileId || finalReporterId;

    const reportId = crypto.randomUUID();
    const cleanName = payload.name?.trim() || "Enfant trouvé (Identité en cours)";
    const safeLoc = payload.currentSafeLocation || 'Poste de police / Centre de protection';
    const physicalDesc = `[TROUVÉ] ${payload.physicalDescription || ''} | Lieu sûr: ${safeLoc} | GPS: ${payload.gps || ''}`;
    const circumstances = payload.physicalDescription || "Enfant trouvé en attente d'identification";
    
    // Insert into found_reports
    const foundRow = {
      id: reportId,
      reporter_id: effectiveReporterId,
      child_full_name: cleanName,
      child_gender: payload.gender || 'non_specifie',
      estimated_age: payload.age ? Number(payload.age) : null,
      found_location: payload.location.trim(),
      found_date: payload.date || new Date().toISOString().split('T')[0],
      found_time: payload.time || new Date().toTimeString().split(' ')[0],
      physical_description: physicalDesc,
      clothing_description: payload.clothingDescription || '',
      current_location_of_child: safeLoc,
      circumstances_description: circumstances,
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

    // Also mirror to missing_reports with status 'Published' and [TROUVÉ] tag for unified directory search & matching
    const mirroredRow = {
      id: reportId,
      reporter_id: effectiveReporterId,
      child_full_name: cleanName,
      child_age: payload.age ? Number(payload.age) : null,
      child_gender: payload.gender || 'non_specifie',
      last_seen_location: payload.location.trim(),
      last_seen_date: payload.date || new Date().toISOString().split('T')[0],
      last_seen_time: payload.time || new Date().toTimeString().split(' ')[0],
      physical_description: physicalDesc,
      clothing_description: payload.clothingDescription || '',
      incident_description: `[TROUVÉ] Enfant retrouvé en sécurité à ${safeLoc}`,
      emergency_contact_name: "Centre de Protection / Découvreur",
      emergency_contact_phone: "677000000",
      child_photo_url: payload.photoUrl || null,
      status: "Published",
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
