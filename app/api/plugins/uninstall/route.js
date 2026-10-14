import { dataDir } from '../../../../lib/db-client';
import { pluginsView } from '../../../../lib/plugins-view';
import { uninstallPlugin, PluginError } from '../../../../lib/plugins';
import { busyRefusal } from '../../../../lib/scan-state';

// Settings → Plugins → Uninstall: { id }, the plugin's id, never a path
// (lib/plugins.js uninstallPlugin). Its folder goes, and nothing else: what it
// brought into your network stays. → { ok, removed, ...GET /api/plugins }.
// Allowed with plugins off too, since removing one is always safe. Refused
// while the scanner runs, which may be running the plugin's own code. Gated
// with /api/plugins (lib/gate.js).

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send the plugin’s id: { "id": "…" }.' }, { status: 400 });
  }
  const busy = busyRefusal('Plugins can be uninstalled once it has finished.');
  if (busy) return Response.json({ error: busy }, { status: 409 });
  try {
    const done = uninstallPlugin(dataDir(), body?.id);
    return Response.json({ ok: true, ...done, ...pluginsView() });
  } catch (err) {
    if (err instanceof PluginError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: `It couldn’t be uninstalled (${err.message}).` }, { status: 500 });
  }
}
