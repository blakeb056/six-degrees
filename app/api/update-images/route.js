import { db as supabase } from '../../../lib/db';
import { demoGuard } from '../../../lib/api-guard';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const { images } = await request.json();

    if (!images || !Array.isArray(images)) {
      return Response.json({ error: 'Missing images array' }, { status: 400, headers: CORS_HEADERS });
    }

    let updated = 0;
    for (let i = 0; i < images.length; i += 20) {
      const batch = images.slice(i, i + 20);
      const promises = batch.map(({ profileUrl, imageUrl }) => {
        if (!profileUrl || !imageUrl) return Promise.resolve();
        return supabase
          .from('linkedin_connections')
          .update({ profile_image_url: imageUrl })
          .eq('profile_url', profileUrl)
          .then(({ error }) => { if (!error) updated++; });
      });
      await Promise.all(promises);
    }

    return Response.json({ success: true, updated }, { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}
