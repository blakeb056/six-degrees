import { pluginsView, setPluginsEnabled } from '../../../../lib/plugins-view';
import { busyRefusal } from '../../../../lib/scan-state';

// Settings → Plugins → Enable plugins: { enabled: true | false }. Off, every
// plugin stays installed and none is used (lib/scanner-files.js findScanner);
// on, an installed scanner plugin is what scans run. Answers as GET
// /api/plugins does. Gated with /api/plugins (lib/gate.js), and refused while
// the scanner runs: a scan under way keeps the scanner it started with, and
// the switch would say otherwise.

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send { "enabled": true } or { "enabled": false }.' }, { status: 400 });
  }
  if (typeof body?.enabled !== 'boolean') {
    return Response.json({ error: 'Send { "enabled": true } or { "enabled": false }.' }, { status: 400 });
  }
  const busy = busyRefusal('Plugins can be turned on or off once it has finished.');
  if (busy) return Response.json({ error: busy }, { status: 409 });
  try {
    setPluginsEnabled(body.enabled);
    return Response.json(pluginsView());
  } catch (err) {
    return Response.json({ error: `It couldn’t be saved (${err.message}).` }, { status: 500 });
  }
}
