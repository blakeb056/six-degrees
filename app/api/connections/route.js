import { db as supabase } from '../../../lib/db';

// A small filtered read for the scraper, which needs to look up a bridge by
// name, list existing profile URLs for stop-loss, and find pending unlocks.
// The hosted build let the scraper query the database directly; locally it
// asks the app instead, so there is exactly one process touching the file.
//
// Filters are an allowlist — arbitrary column filtering is not exposed.
const FILTERS = ['degree', 'name', 'source_connection_id', 'unlock_status', 'tier', 'user_id', 'profile_url'];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = supabase.from('linkedin_connections').select('*');

    for (const key of FILTERS) {
      const value = searchParams.get(key);
      if (value === null) continue;
      if (key === 'degree') q.eq('degree', Number(value));
      else q.eq(key, value);
    }

    const order = searchParams.get('order');
    if (order === 'power_score.desc') q.order('power_score', { ascending: false });

    const limit = searchParams.get('limit');
    if (limit) q.limit(Number(limit));

    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ connections: data || [] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
