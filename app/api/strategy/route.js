import { db as supabase } from '../../../lib/db';
import { strategyEngineAsync, strategyJson, networkStamp } from '../../../lib/strategy-engine';

// The strategy engine (experimental, lib/strategy-engine.js): everyone's
// position in the network. Asked for only while Settings → Experimental has it
// on (lib/strategy-client.js); nothing else calls this.
//
// The betweenness pass is about a second on 15,000 people, so it never runs per
// request: one answer is kept per network, keyed by networkStamp (who is where,
// the ties, tiers and work), and worked out again only when that changes, after
// a scan or a rescore. While it runs it yields between slices, so a scan's
// saves aren't held up. Two requests during one run share it.

const kept = new Map();   // userId → { stamp, promise }

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    const q = supabase.from('linkedin_connections').select('*');
    if (userId) q.eq('user_id', userId);
    const { data: rows, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    let ties = [];
    try {
      let tq = supabase.from('connection_ties').select('a_url, b_url');
      if (userId) tq = tq.eq('user_id', userId);
      const { data, error: tieError } = await tq;
      if (tieError) throw tieError;
      ties = data || [];
    } catch (err) {
      // An older database has no ties table: say so rather than pretend there are none.
      if (!/no such table/i.test(String(err?.message))) throw err;
    }

    const stamp = networkStamp(rows || [], ties);
    const key = userId || '';
    let entry = kept.get(key);
    let cached = true;
    if (!entry || entry.stamp !== stamp) {
      cached = false;
      entry = { stamp, promise: strategyEngineAsync(rows || [], ties).then(strategyJson) };
      kept.set(key, entry);
      entry.promise.catch(() => { if (kept.get(key) === entry) kept.delete(key); });
    }
    const result = await entry.promise;
    return Response.json({ ...result, stamp, cached, ties: ties.length });
  } catch (err) {
    return Response.json({ error: err.message || 'The strategy engine could not read the network.' }, { status: 500 });
  }
}
