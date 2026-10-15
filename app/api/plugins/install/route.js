import { dataDir } from '../../../../lib/db-client';
import { pluginsView, pluginsEnabled } from '../../../../lib/plugins-view';
import { readPackage, installPlugin, installedPlugin, pluginSummary, PluginError } from '../../../../lib/plugins';
import { MAX_PLUGIN_BYTES, SIZE_HEADER, CONFIRM_HEADER } from '../../../../lib/plugins-client';
import { busyRefusal } from '../../../../lib/scan-state';
import { settlePluginNotesNow } from '../../../../lib/update-check';

// Settings → Plugins → Install from a file. The body is the .sgplugin package
// itself (application/octet-stream), with its size in X-Six-Degrees-Size.
//
//   ?check=1  reads the package all the way through (lib/plugins.js
//             readPackage) and writes nothing → { ok, plugin, sha256, replaces }:
//             what the page shows before asking for a yes, and the checksum
//             that yes must name.
//   no query  installs it, only with X-Six-Degrees-Plugin-Sha256 set to that
//             checksum (lib/plugins-client.js CONFIRM_HEADER): nothing is
//             installed without the yes, and only the package agreed to is.
//             → { ok, installed, replaced, ...GET /api/plugins }
//
// Plugin packages are a few hundred kilobytes, so the body is read whole,
// under middleware.js's 10 MB copy (MAX_PLUGIN_BYTES). Refused while plugins
// are off (turn on Enable plugins first) and while the scanner runs. Gated
// with /api/plugins (lib/gate.js): it puts code on this computer that scans run.

export async function POST(request) {
  const check = new URL(request.url).searchParams.has('check');
  if (!pluginsEnabled()) {
    return Response.json({ error: 'Turn on Enable plugins first, then install.' }, { status: 409 });
  }
  const busy = busyRefusal('Plugins can be installed once it has finished.');
  if (busy) return Response.json({ error: busy }, { status: 409 });

  // The size the page read from the file: a body that arrives shorter was cut
  // on the way (middleware.js keeps only the first 10 MB of anything larger).
  const declared = Number(request.headers.get(SIZE_HEADER));
  if (!Number.isSafeInteger(declared) || declared <= 0) {
    return Response.json({ error: 'The package’s size wasn’t sent, so whether it arrived whole can’t be told. Try again.' }, { status: 400 });
  }
  if (declared > MAX_PLUGIN_BYTES) {
    return Response.json({ error: `That file is larger than a plugin package may be (${MAX_PLUGIN_BYTES / 1048576} MB).` }, { status: 413 });
  }
  let buf;
  try {
    buf = Buffer.from(await request.arrayBuffer());
  } catch {
    return Response.json({ error: 'The package didn’t arrive whole. Try again.' }, { status: 400 });
  }
  if (buf.length !== declared) {
    return Response.json({ error: 'The package didn’t arrive whole. Try again.' }, { status: 400 });
  }

  const dir = dataDir();
  try {
    if (check) {
      const pkg = readPackage(buf);
      const before = installedPlugin(dir, pkg.manifest.id);
      return Response.json({
        ok: true,
        plugin: pluginSummary(pkg.manifest),
        sha256: pkg.sha256,
        // The version this would replace, when one is installed.
        replaces: before ? { version: before.version, state: before.state } : null,
      });
    }
    const done = installPlugin(dir, buf, { sha256: request.headers.get(CONFIRM_HEADER) || null });
    // An Update done: its "is out" notification has nothing left to say.
    settlePluginNotesNow();
    return Response.json({ ok: true, ...done, ...pluginsView() });
  } catch (err) {
    if (err instanceof PluginError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: `It couldn’t be installed (${err.message}).` }, { status: 500 });
  }
}
