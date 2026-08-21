import { db as supabase } from '../../../lib/db';

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

    const [d1, d2, d3] = await Promise.all([forDegree(1), forDegree(2), forDegree(3)]);

    const firstError = d1.error || d2.error || d3.error;
    if (firstError) {
      return Response.json({ error: firstError.message }, { status: 500 });
    }

    return Response.json({
      degree1: d1.data || [],
      degree2: d2.data || [],
      degree3: d3.data || [],
      counts: {
        degree1: d1.data?.length || 0,
        degree2: d2.data?.length || 0,
        degree3: d3.data?.length || 0,
      },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
