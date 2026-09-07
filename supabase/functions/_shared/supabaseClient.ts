import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || "https://ifpbdythbhlgqymsaxtz.supabase.co";
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || "";
  
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}

export function getSupabaseUserClient(authHeader: string | null) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || "https://ifpbdythbhlgqymsaxtz.supabase.co";
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || "";

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}
