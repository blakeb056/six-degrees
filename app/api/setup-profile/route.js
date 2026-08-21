import { db as supabase } from '../../../lib/db';
import { demoGuard } from '../../../lib/api-guard';

// The hosted build created this table at runtime through an `exec_sql` stored
// procedure. That route accepted arbitrary DDL over an unauthenticated
// endpoint; the local build creates user_profile in db/schema.sql at startup
// instead, so no runtime schema changes are needed or possible.

export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const profile = await request.json();

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
