import { db as supabase } from '../../../lib/db';
import { getDb } from '../../../lib/db-client';
import { allTies } from '../../../lib/ties-store';
import { extendedNetwork, firstDegreeByKey } from '../../../lib/mutual-web';
import { urlKey } from '../../../lib/ties';

// One read endpoint for the whole client.
//
// The hosted build had four pages issuing nine near-identical queries straight
// from the browser, which required shipping database credentials to the client.
// Locally there is no such thing as a browser-side database, so the pages fetch
// this instead. The response shape matches lib/demo.js's loadDemoNetwork() so
// both paths feed the same rendering code.

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    const forDegree = (degree) => {
      const q = supabase
        .from('linkedin_connections')
        .select('*')
        .eq('degree', degree)
        .order('power_score', { ascending: false });
      if (userId) q.eq('user_id', userId);
      return q;
    };

    // Scores stored by an older scoring model are recomputed once, here.
    try { await supabase.rpc('rescore_if_stale'); } catch { /* serve what's stored */ }

    const [d1, d2all, d3] = await Promise.all([forDegree(1), forDegree(2), forDegree(3)]);

    const firstError = d1.error || d2all.error || d3.error;
    if (firstError) {
      return Response.json({ error: firstError.message }, { status: 500 });
    }

    // People known only through the mutual web (seen_via 'ties', lib/ties-store.js)
    // are never a scan's: kept out of the 2nd degree, and shown only through
    // their ties, in `seen` below.
    const degree2 = (d2all.data || []).filter((r) => r.seen_via !== 'ties');
    const tiePeople = (d2all.data || []).filter((r) => r.seen_via === 'ties');

    // The mutual web (lib/ties.js): everyone a tie links to one of your
    // connections, outside what a scan of their circle read, attached to them as
    // "seen outside the scan" (lib/mutual-web.js extendedNetwork). And how many
    // ties are between two of your own connections, for network health on the
    // Scores tab (what circle scans alone used to keep).
    let ties = 0;
    let seen = [];
    try {
      const all = allTies(getDb(), userId || null);
      const mine = firstDegreeByKey(d1.data || []);
      ties = all.filter((t) => mine.has(urlKey(t.a)) && mine.has(urlKey(t.b))).length;
      seen = extendedNetwork({ degree1: d1.data || [], degree2, degree3: d3.data || [], tiePeople, ties: all });
    } catch { /* an older database: none yet */ }

    return Response.json({
      ties,
      degree1: d1.data || [],
      degree2,
      degree3: d3.data || [],
      seen,
      counts: {
        degree1: d1.data?.length || 0,
        degree2: degree2.length,
        degree3: d3.data?.length || 0,
        seen: seen.length,
      },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
