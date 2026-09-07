import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabaseClient.ts";

interface MatchResult {
  missingReport: any;
  foundReport: any;
  confidenceScore: number;
  criteria: {
    nameSimilarity: number;
    ageMatch: boolean;
    genderMatch: boolean;
    locationProximityScore: number;
    clothingSimilarity: number;
  };
}

function calculateTextSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return Math.min(100, Math.round((intersection / Math.max(wordsA.size, wordsB.size)) * 100));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { reportId, limit = 10 } = await req.json().catch(() => ({}));

    // Fetch missing reports (status Published)
    const { data: missingReports, error: mErr } = await supabaseAdmin
      .from('missing_reports')
      .select('*')
      .eq('status', 'Published');

    // Fetch found reports
    const { data: foundReports, error: fErr } = await supabaseAdmin
      .from('found_reports')
      .select('*');

    if (mErr || fErr) {
      return new Response(
        JSON.stringify({ error: "Erreur lors de la récupération des signalements." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const matches: MatchResult[] = [];

    const mList = reportId 
      ? (missingReports || []).filter(m => m.id === reportId) 
      : (missingReports || []);

    const fList = foundReports || [];

    for (const m of mList) {
      for (const f of fList) {
        let score = 0;
        let weightSum = 0;

        // 1. Gender check (weight 20)
        const genderMatch = m.child_gender && f.child_gender && m.child_gender === f.child_gender;
        if (genderMatch) {
          score += 20;
        }
        weightSum += 20;

        // 2. Location proximity (weight 30)
        const locSim = calculateTextSimilarity(m.last_seen_location || '', f.found_location || '');
        score += (locSim / 100) * 30;
        weightSum += 30;

        // 3. Clothing description (weight 25)
        const clothSim = calculateTextSimilarity(m.clothing_description || '', f.clothing_description || '');
        score += (clothSim / 100) * 25;
        weightSum += 25;

        // 4. Physical description (weight 25)
        const physSim = calculateTextSimilarity(m.physical_description || '', f.physical_description || '');
        score += (physSim / 100) * 25;
        weightSum += 25;

        const totalConfidence = Math.min(99, Math.max(30, Math.round((score / weightSum) * 100)));

        if (totalConfidence >= 50 || genderMatch) {
          matches.push({
            missingReport: m,
            foundReport: f,
            confidenceScore: totalConfidence,
            criteria: {
              nameSimilarity: calculateTextSimilarity(m.child_full_name || '', f.child_full_name || ''),
              ageMatch: m.child_age ? true : false,
              genderMatch: !!genderMatch,
              locationProximityScore: locSim,
              clothingSimilarity: clothSim
            }
          });
        }
      }
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidenceScore - a.confidenceScore);

    return new Response(
      JSON.stringify({
        success: true,
        count: matches.length,
        matches: matches.slice(0, limit)
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
