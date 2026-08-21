import { supabaseAdmin as supabase } from '../../../lib/supabase-admin';
import { demoGuard } from '../../../lib/api-guard';

export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const profile = await request.json();

    // Create table if not exists (idempotent)
    await supabase.rpc('exec_sql', {
      sql: `CREATE TABLE IF NOT EXISTS user_profile (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name TEXT NOT NULL,
        headline TEXT,
        role TEXT,
        company TEXT,
        industry TEXT,
        sectors TEXT[],
        goals TEXT[],
        linkedin_url TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )`
    }).catch(() => {});

    // Try direct insert — table might already exist from a previous run
    const { error } = await supabase
      .from('user_profile')
      .upsert([{
        name: profile.name || 'User',
        headline: profile.headline || '',
        role: profile.role || '',
        company: profile.company || '',
        industry: profile.industry || '',
        sectors: profile.sectors || [],
        goals: profile.goals || [],
        linkedin_url: profile.linkedin_url || '',
      }], { onConflict: 'id' });

    if (error && error.code === '42P01') {
      // Table doesn't exist — create it via raw SQL workaround
      // Use the from().select() trick to trigger table creation
      return Response.json({ error: 'Table not created yet. Run the migration manually.', hint: error.message }, { status: 500 });
    }

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const { data, error } = await supabase
      .from('user_profile')
      .select('*')
      .limit(1)
      .single();

    if (error) return Response.json({ profile: null });
    return Response.json({ profile: data });
  } catch {
    return Response.json({ profile: null });
  }
}
