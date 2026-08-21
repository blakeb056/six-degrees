import { db as supabase } from '../../../lib/db';
import { demoGuard } from '../../../lib/api-guard';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// CORS preflight
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Bulk import connections for a specific user
// Used when importing scraped data from another session
export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const { connections, userId } = await request.json();
    if (!connections || !Array.isArray(connections) || !userId) {
      return Response.json({ error: 'Missing connections array or userId' }, { status: 400, headers: CORS_HEADERS });
    }

    // Parse each connection
    const records = connections.map(c => {
      const headline = (c.headline || '').trim();
      const nameParts = headline.split(' at ');
      const role = nameParts[0] || '';
      const company = nameParts[1]?.split('|')[0]?.trim() || '';

      return {
        degree: 1,
        name: (c.name || '').trim(),
        headline: headline.substring(0, 200),
        company: company.substring(0, 100),
        role: role.substring(0, 100),
        profile_url: (c.profileUrl || c.profile_url || '').trim(),
        profile_image_url: c.imageUrl || c.profile_image_url || null,
        user_id: userId,
      };
    }).filter(r => r.name && r.profile_url);

    if (records.length === 0) {
      return Response.json({ error: 'No valid records' }, { status: 400, headers: CORS_HEADERS });
    }

    // Check which already exist for this user
    const urls = records.map(r => r.profile_url);
    const existingUrls = new Set();
    for (let i = 0; i < urls.length; i += 100) {
      const batch = urls.slice(i, i + 100);
      const { data: existing } = await supabase
        .from('linkedin_connections')
        .select('profile_url')
        .eq('user_id', userId)
        .in('profile_url', batch);
      (existing || []).forEach(e => existingUrls.add(e.profile_url));
    }

    const newRecords = records.filter(r => !existingUrls.has(r.profile_url));

    if (newRecords.length === 0) {
      return Response.json({ success: true, imported: 0, skipped: records.length, message: 'All connections already exist' }, { headers: CORS_HEADERS });
    }

    // Insert in batches of 200
    let imported = 0;
    for (let i = 0; i < newRecords.length; i += 200) {
      const batch = newRecords.slice(i, i + 200);
      const { error } = await supabase.from('linkedin_connections').insert(batch);
      if (error) {
        console.error('Bulk import batch error:', error);
      } else {
        imported += batch.length;
      }
    }

    // Trigger scoring
    try { await supabase.rpc('score_new_connections'); } catch (e) { /* optional */ }

    return Response.json({
      success: true,
      imported,
      skipped: records.length - newRecords.length,
      total: records.length,
    }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('Bulk import error:', err);
    return Response.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}
