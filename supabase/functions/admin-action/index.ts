import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseAdmin, getSupabaseUserClient } from "../_shared/supabaseClient.ts";

interface AdminActionPayload {
  action: 'UPDATE_REPORT_STATUS' | 'DELETE_REPORT' | 'VERIFY_USER' | 'LIST_ALL_REPORTS' | 'GET_SYSTEM_STATS';
  reportId?: string;
  reportType?: 'missing' | 'found';
  newStatus?: string;
  targetUserId?: string;
  adminNotes?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentification requise pour les opérations administratives." }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUser = getSupabaseUserClient(authHeader);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Session invalide ou expirée." }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify admin role in profiles table
    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('role, is_admin')
      .eq('user_id', user.id)
      .maybeSingle();

    const isAdmin = profile && (profile.is_admin === true || (profile.role && profile.role.toLowerCase().includes('admin')));

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Accès refusé : privilèges administrateur requis." }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload: AdminActionPayload = await req.json();

    switch (payload.action) {
      case 'UPDATE_REPORT_STATUS': {
        if (!payload.reportId || !payload.newStatus) {
          return new Response(
            JSON.stringify({ error: "reportId et newStatus sont requis." }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const targetTable = payload.reportType === 'found' ? 'found_reports' : 'missing_reports';
        const { data, error } = await supabaseAdmin
          .from(targetTable)
          .update({
            status: payload.newStatus,
            admin_notes: payload.adminNotes || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', payload.reportId)
          .select()
          .single();

        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, updatedReport: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'GET_SYSTEM_STATS': {
        const { count: missingCount } = await supabaseAdmin.from('missing_reports').select('*', { count: 'exact', head: true });
        const { count: foundCount } = await supabaseAdmin.from('found_reports').select('*', { count: 'exact', head: true });
        const { count: alertsCount } = await supabaseAdmin.from('alerts').select('*', { count: 'exact', head: true });
        const { count: profilesCount } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true });

        return new Response(
          JSON.stringify({
            success: true,
            stats: {
              missingReports: missingCount || 0,
              foundReports: foundCount || 0,
              alerts: alertsCount || 0,
              activeGuardians: profilesCount || 0
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Action inconnue: ${payload.action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
