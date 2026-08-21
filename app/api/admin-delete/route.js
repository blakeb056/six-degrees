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
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
