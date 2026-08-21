import { db as supabase } from '../../../lib/db';
import { demoGuard } from '../../../lib/api-guard';

export async function GET() {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const { data } = await supabase
      .from('queue_items')
      .select('*')
      .order('created_at', { ascending: false });
    return Response.json({ items: data || [] });
  } catch (err) {
    return Response.json({ items: [], error: err.message });
  }
}

export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'add') {
      // Add person to queue
      const { connectionId, profileUrl, name, xpReward, bridgeName } = body;
      const { error } = await supabase.from('queue_items').upsert([{
        connection_id: connectionId || null,
        profile_url: profileUrl,
        name,
        status: 'suggested',
        xp_reward: xpReward || 10,
        bridge_name: bridgeName || null,
      }], { onConflict: 'profile_url', ignoreDuplicates: true });

      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ success: true });
    }

    if (action === 'update-status') {
      // Update queue item status
      const { id, status } = body;
      const updates = { status };
      if (status === 'sent') updates.sent_at = new Date().toISOString();
      if (status === 'accepted') updates.accepted_at = new Date().toISOString();
      if (status === 'scanned') updates.scanned_at = new Date().toISOString();

      const { error } = await supabase.from('queue_items').update(updates).eq('id', id);
      if (error) return Response.json({ error: error.message }, { status: 500 });

      // Award XP on accepted
      if (status === 'accepted') {
        const { data: item } = await supabase.from('queue_items').select('xp_reward,name').eq('id', id).single();
        if (item) {
          await supabase.rpc('increment_xp', { amount: item.xp_reward }).catch(() => {
            // Fallback: direct update
            supabase.from('user_stats').select('xp').limit(1).single().then(({ data: stats }) => {
              if (stats) supabase.from('user_stats').update({ xp: (stats.xp || 0) + item.xp_reward }).eq('id', stats.id);
            });
          });

          // Create notification
          await supabase.from('notifications').insert([{
            type: 'connection_accepted',
            title: `${item.name} accepted!`,
            message: `+${item.xp_reward} XP — Ready to scan their cluster`,
            icon: '🎉',
          }]);
        }
      }

      return Response.json({ success: true });
    }

    if (action === 'remove') {
      const { id } = body;
      await supabase.from('queue_items').delete().eq('id', id);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
