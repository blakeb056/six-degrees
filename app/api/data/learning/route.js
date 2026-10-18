import { getDb } from '../../../../lib/db-client';
import { exportLog, deleteLog, logStats } from '../../../../lib/learning-log';

// Settings → Your data → Learning log: Export (one JSON file, sent back as a
// download) and Delete learning log (every event, at once). Gated with the
// other routes that hand over or destroy data (lib/gate.js DESTRUCTIVE_ROUTES),
// and a POST, so it takes a click on the app's own page.

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { /* said below */ }
  try {
    const db = getDb();
    if (body?.action === 'export') {
      const data = JSON.stringify(exportLog(db));
      const day = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return new Response(data, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="Sixgree learning log ${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    if (body?.action === 'delete') {
      if (body.confirm !== true) return Response.json({ error: 'Deleting the learning log needs a confirmation.' }, { status: 400 });
      const deleted = deleteLog(db);
      return Response.json({ ok: true, deleted, stats: logStats(db) });
    }
    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
