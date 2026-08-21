import { createClient } from '@supabase/supabase-js';

// Server-side ONLY: service_role key has full write access
// NEVER import this file from client components
// Null when env is absent (demo builds / local dev without the key) — the
// demoGuard in each API route returns 403 before this is ever touched.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin =
  supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
