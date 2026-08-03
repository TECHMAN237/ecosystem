import { createClient } from "@supabase/supabase-js";

// ==========================================
// SUPABASE CONFIGURATION
// Replace the values below with your actual credentials when needed.
// ==========================================

const SUPABASE_URL = "https://ifpbdythbhlgqymsaxtz.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_ZFWamWb5cIOB2XastpKLhg_Xpm47wPV";

// Create and export the single Supabase client instance
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
