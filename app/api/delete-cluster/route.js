import { db as supabase } from '../../../lib/db';

export async function POST(request) {
  try {
    const { bridgeId } = await request.json();

    if (!bridgeId) {
      return Response.json({ error: 'Missing bridgeId' }, { status: 400 });
    }

    const { error } = await supabase
      .from('linkedin_connections')
      .delete()
      .eq('source_connection_id', bridgeId)
      .eq('degree', 2);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
