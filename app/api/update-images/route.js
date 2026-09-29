import { db as supabase } from '../../../lib/db';
import { getDb } from '../../../lib/db-client';
import { localPhoto, waitingPhotos } from '../../../lib/photos';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// The photos still kept as links, for the scanner to save: at the end of a
// scan, and for Save photos on the Scan page (scrape.py save_waiting_photos).
// A read, so no CORS header: another site's page can't see the answer.
export async function GET() {
  try {
    return Response.json({ waiting: waitingPhotos(getDb()) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// `images`: [{ profileUrl, imageUrl }], each a photo the scanner has saved,
// attached to every row of that person. Only a saved file's path is stored,
// never a link (lib/photos.js).
//
// `forget`: [{ profileUrl, imageUrl }], links the scanner got a definite no for
// (expired, not LinkedIn's, not a picture, or the same picture as someone
// else's), never one it couldn't reach. The link is cleared, and only where it
// is still that link, so each is tried once and the person shows initials.
export async function POST(request) {
  try {
    const { images, forget } = await request.json();

    if ((!images || !Array.isArray(images)) && !Array.isArray(forget)) {
      return Response.json({ error: 'Missing images array' }, { status: 400, headers: CORS_HEADERS });
    }

    let updated = 0;
    const saved = Array.isArray(images) ? images : [];
    for (let i = 0; i < saved.length; i += 20) {
      const batch = saved.slice(i, i + 20);
      const promises = batch.map(({ profileUrl, imageUrl }) => {
        const photo = localPhoto(imageUrl);
        if (!profileUrl || !photo) return Promise.resolve();
        return supabase
          .from('linkedin_connections')
          .update({ profile_image_url: photo })
          .eq('profile_url', profileUrl)
          .then(({ error }) => { if (!error) updated++; });
      });
      await Promise.all(promises);
    }

    let forgotten = 0;
    for (const { profileUrl, imageUrl } of Array.isArray(forget) ? forget : []) {
      if (typeof profileUrl !== 'string' || typeof imageUrl !== 'string' || !imageUrl || localPhoto(imageUrl)) continue;
      const { data, error } = await supabase
        .from('linkedin_connections')
        .update({ profile_image_url: null })
        .eq('profile_url', profileUrl)
        .eq('profile_image_url', imageUrl);
      if (!error && data?.length) forgotten++;
    }

    return Response.json({ success: true, updated, forgotten }, { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}
