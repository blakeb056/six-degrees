import { db as supabase } from '../../../lib/db';

// Which connections already have a mapped circle.
//
// This used to be answered by pulling every 2nd-degree row and collecting the
// distinct source ids — with a limit of 2000. Past that many, the answer was
// silently wrong: bridges that had been mapped looked unmapped, so a resumed
// auto-bridge run scraped them all over again. On a real database with 2,738
// 2nd-degree rows, 738 of them were invisible.
//
// One row per bridge instead of one per person: a few dozen, not a few thousand,
// and no limit to outgrow.

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    let q = supabase
      .from('linkedin_connections')
      .select('source_connection_id')
      .eq('degree', 2);
    if (userId) q = q.eq('user_id', userId);

    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const counts = {};
    for (const row of data || []) {
      const id = row.source_connection_id;
      if (!id) continue;
      counts[id] = (counts[id] || 0) + 1;
    }

    return Response.json({
      bridgeIds: Object.keys(counts),
      counts,
      total: Object.keys(counts).length,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
