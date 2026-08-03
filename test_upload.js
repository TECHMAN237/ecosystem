import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ifpbdythbhlgqymsaxtz.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_ZFWamWb5cIOB2XastpKLhg_Xpm47wPV";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);

async function testBuckets() {
  const buckets = ["public", "images", "documents", "media", "files", "uploads", "storage"];
  for (const b of buckets) {
    const { data, error } = await supabase.storage
      .from(b)
      .upload("test.jpg", Buffer.from("test"), { upsert: true });
    console.log(`Bucket "${b}":`, { data, error: error?.message });
  }
}
testBuckets();
