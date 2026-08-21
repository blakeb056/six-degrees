import { createClient } from '@supabase/supabase-js';

// Client-side: anon key (read-only via RLS). Values come from env only —
// .env.local for local dev, project env vars on Vercel. In the static demo
// build they may be absent, leaving the client null; demo-gated pages never
// call it in that mode.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
