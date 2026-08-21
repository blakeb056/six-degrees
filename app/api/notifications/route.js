import { db as supabase } from '../../../lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    if (userId) query = query.eq('user_id', userId);

    const { data } = await query;
    return Response.json({ notifications: data || [] });
  } catch (err) {
    return Response.json({ notifications: [], error: err.message });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const userId = body.userId || null;

    if (body.action === 'mark-seen') {
      const q = supabase.from('notifications').update({ seen: true }).eq('id', body.id);
      if (userId) q.eq('user_id', userId);
      await q;
      return Response.json({ success: true });
    }

    if (body.action === 'mark-all-seen') {
      const q = supabase.from('notifications').update({ seen: true }).eq('seen', false);
      if (userId) q.eq('user_id', userId);
      await q;
      return Response.json({ success: true });
    }

    if (body.action === 'create') {
      const { type, title, message, icon, data: notifData } = body;
      await supabase.from('notifications').insert([{
        type, title, message, icon: icon || '📌', data: notifData || {},
        user_id: userId,
      }]);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
