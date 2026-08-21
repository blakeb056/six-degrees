import { db as supabase } from '../../../lib/db';
import { demoGuard } from '../../../lib/api-guard';

export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const { profileUrl, updates } = await request.json();
    if (!profileUrl || !updates) {
      return Response.json({ error: 'Missing profileUrl or updates' }, { status: 400 });
    }

    const { error } = await supabase
      .from('linkedin_connections')
      .update(updates)
      .eq('profile_url', profileUrl);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
