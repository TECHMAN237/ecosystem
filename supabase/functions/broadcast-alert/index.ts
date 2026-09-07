import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseAdmin, getSupabaseUserClient } from "../_shared/supabaseClient.ts";

interface BroadcastAlertPayload {
  title: string;
  message: string;
  category?: 'EMERGENCY' | 'REPORT' | 'COMMUNITY' | 'MATCH' | 'WEARABLE';
  latitude?: number;
  longitude?: number;
  radius_km?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseAdmin = getSupabaseAdmin();
    const payload: BroadcastAlertPayload = await req.json();

    if (!payload.title || !payload.message) {
      return new Response(
        JSON.stringify({ error: "Le titre et le message de l'alerte sont requis." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const newAlert = {
      title: payload.title.trim(),
      message: payload.message.trim(),
      category: payload.category || 'EMERGENCY',
      latitude: payload.latitude || null,
      longitude: payload.longitude || null,
      radius_km: payload.radius_km || 10
    };

    const { data, error } = await supabaseAdmin
      .from('alerts')
      .insert([newAlert])
      .select()
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, alert: data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
