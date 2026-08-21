import { db as supabase } from '../../../lib/db';
import { demoGuard } from '../../../lib/api-guard';

// XP rewards by tier
const XP_SEND = { S: 25, A: 15, B: 10, C: 5, D: 2 };
const XP_ACCEPT = { S: 100, A: 60, B: 35, C: 15, D: 5 };

async function awardXP(userId, amount) {
  if (!userId || !amount) return;
  // Upsert: create if not exists, increment if exists
  const { data: existing } = await supabase.from('user_stats').select('xp').eq('id', userId).single();
  if (existing) {
    await supabase.from('user_stats').update({ xp: (existing.xp || 0) + amount }).eq('id', userId);
  } else {
    await supabase.from('user_stats').insert([{ id: userId, xp: amount, level: 1 }]).catch(() => {});
  }
}

export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const body = await request.json();
    const { action, connectionId, profileUrl, userId } = body;

    if (action === 'mark-sent') {
      // Get the person's tier for XP calculation
      let tierQuery = supabase.from('linkedin_connections').select('tier');
      tierQuery = connectionId ? tierQuery.eq('id', connectionId) : tierQuery.eq('profile_url', profileUrl);
      const { data: person } = await tierQuery.single();
      const tier = person?.tier || 'D';

      let query = supabase.from('linkedin_connections').update({ outreach_status: 'sent' });
      query = connectionId ? query.eq('id', connectionId) : query.eq('profile_url', profileUrl);
      if (userId) query = query.eq('user_id', userId);
      const { error } = await query;
      if (error) return Response.json({ error: error.message }, { status: 500 });

      // Award XP for sending request
      await awardXP(userId, XP_SEND[tier] || 2);

      return Response.json({ success: true, xp: XP_SEND[tier] || 2 });
    }

    if (action === 'mark-accepted') {
      let query = supabase.from('linkedin_connections').update({ outreach_status: 'accepted' });
      query = connectionId ? query.eq('id', connectionId) : query.eq('profile_url', profileUrl);
      if (userId) query = query.eq('user_id', userId);
      const { error } = await query;
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ success: true });
    }

    if (action === 'undo') {
      let query = supabase.from('linkedin_connections').update({ outreach_status: null });
      query = connectionId ? query.eq('id', connectionId) : query.eq('profile_url', profileUrl);
      if (userId) query = query.eq('user_id', userId);
      const { error } = await query;
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Outreach error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    let query = supabase.from('linkedin_connections').select('*').eq('outreach_status', 'sent').order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ pending: data || [] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
