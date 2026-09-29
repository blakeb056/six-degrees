import { db as supabase } from '../../../lib/db';

export async function POST(request) {
  try {
    const { profileUrl } = await request.json();
    if (!profileUrl) return Response.json({ error: 'Missing profileUrl' }, { status: 400 });

    const { error } = await supabase
      .from('linkedin_connections')
      .delete()
      .eq('profile_url', profileUrl);

    if (error) return Response.json({ error: error.message }, { status: 500 });
    // And every tie they're in (lib/ties.js).
    await supabase.from('connection_ties').delete().eq('a_url', profileUrl);
    await supabase.from('connection_ties').delete().eq('b_url', profileUrl);
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
