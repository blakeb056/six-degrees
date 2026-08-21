import { db as supabase } from '../../../lib/db';

export async function POST(request) {
  try {
    const { connectionId, bridgeId, bridgeName } = await request.json();

    if (!connectionId) {
      return Response.json({ error: 'Missing connectionId' }, { status: 400 });
    }

    // Mark as pending + store the chain (who led us here)
    const { error } = await supabase
      .from('linkedin_connections')
      .update({
        unlock_status: 'pending',
        unlocked_from_bridge_id: bridgeId || null,
        unlocked_from_name: bridgeName || null,
      })
      .eq('id', connectionId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true, status: 'pending' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
