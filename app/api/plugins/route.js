import { pluginsView } from '../../../lib/plugins-view';

// Settings → Plugins: whether plugins are on, what is installed, and which
// scanner scans use (lib/plugins-view.js). Installed plugins are listed even
// with plugins off, each checked through; a broken one is listed as broken
// with why, never an error here.
//
// Every route under /api/plugins is gated (lib/gate.js), this read included:
// together they decide whose code runs on this computer. The writes are
// enabled/, install/ and uninstall/, each refused while the scanner runs.

export async function GET() {
  try {
    return Response.json(pluginsView());
  } catch (err) {
    return Response.json({ error: `The plugins couldn’t be read (${err.message}).` }, { status: 500 });
  }
}
