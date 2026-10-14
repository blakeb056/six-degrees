import { dataDir } from '../../../../lib/db-client';
import { pluginsView, pluginsEnabled } from '../../../../lib/plugins-view';
import { installPlugin, installedPlugin, pluginSummary, PluginError } from '../../../../lib/plugins';
import {
  downloadPackage, listedEntry, catalogSource, linkProblem, holdDownload, heldDownload, releaseDownload,
} from '../../../../lib/plugin-catalog';
import { CONFIRM_HEADER } from '../../../../lib/plugins-client';
import { busyRefusal } from '../../../../lib/scan-state';

// Install from the plugin list, or from a link: the same two steps as Install
// from a file (app/api/plugins/install), with the download in the first.
//
//   ?check=1  { id }   a plugin on the list last loaded (app/api/plugins/catalog):
//                      downloaded from the address that list gives, and used
//                      only if it is the list's exact size and SHA-256, and the
//                      plugin and version the list names.
//             { url }  a link someone pasted: https only. There is no list to
//                      match, so the package's own manifest checksums are the
//                      only check (the page says so).
//             Either way it is then checked all the way through
//             (lib/plugins.js readPackage), nothing is written, and the
//             package is kept in memory by its SHA-256 for the yes
//             (lib/plugin-catalog.js holdDownload)
//             → { ok, plugin, sha256, replaces, from: { kind, host } }.
//   no query  installs that kept package, only with X-Six-Degrees-Plugin-Sha256
//             set to its checksum (lib/plugins-client.js CONFIRM_HEADER): what
//             installs is exactly what was checked and shown, never a second
//             download. → { ok, installed, replaced, from, ...GET /api/plugins }
//
// A package is downloaded only here, on Install. Refused while plugins are off
// and while the scanner runs. Gated with /api/plugins (lib/gate.js): it puts
// code on this computer that scans run.

const sendIdOrUrl = 'Send the plugin’s id from the plugin list, { "id": "…" }, or a link, { "url": "https://…" }.';

export async function POST(request) {
  const check = new URL(request.url).searchParams.has('check');
  if (!pluginsEnabled()) {
    return Response.json({ error: 'Turn on Enable plugins first, then install.' }, { status: 409 });
  }
  const busy = busyRefusal('Plugins can be installed once it has finished.');
  if (busy) return Response.json({ error: busy }, { status: 409 });

  const dir = dataDir();
  try {
    if (!check) {
      const sum = request.headers.get(CONFIRM_HEADER) || null;
      if (!sum) {
        return Response.json({ error: 'Nothing is installed without a yes. Press Install, then confirm it.' }, { status: 409 });
      }
      const kept = heldDownload(sum);
      if (!kept) {
        return Response.json({
          error: 'That download isn’t here any more: one waits for its yes for 15 minutes, and not past a restart. Press Install again.',
        }, { status: 409 });
      }
      const done = installPlugin(dir, kept.buf, { sha256: sum });
      releaseDownload(sum);
      return Response.json({ ok: true, ...done, from: kept.from, ...pluginsView() });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: sendIdOrUrl }, { status: 400 });
    }
    const hasId = typeof body?.id === 'string';
    const hasUrl = typeof body?.url === 'string';
    if (hasId === hasUrl) return Response.json({ error: sendIdOrUrl }, { status: 400 });

    const source = catalogSource();
    let got;
    let kind;
    if (hasId) {
      const listed = listedEntry(body.id);
      if (!listed) {
        return Response.json({ error: 'That plugin isn’t on the plugin list loaded here. Load the list again, then press Install.' }, { status: 409 });
      }
      if (listed.problem) return Response.json({ error: listed.problem }, { status: 409 });
      got = await downloadPackage(listed.url, { listed, test: source.test });
      kind = 'catalog';
    } else {
      const problem = linkProblem(body.url, { test: source.test });
      if (problem) return Response.json({ error: problem }, { status: 400 });
      got = await downloadPackage(body.url.trim(), { test: source.test });
      kind = 'link';
    }
    const from = { kind, host: got.host };
    holdDownload(got.pkg.sha256, got.buf, from);
    const before = installedPlugin(dir, got.pkg.manifest.id);
    return Response.json({
      ok: true,
      plugin: pluginSummary(got.pkg.manifest),
      sha256: got.pkg.sha256,
      // The version this would replace, when one is installed.
      replaces: before ? { version: before.version, state: before.state } : null,
      from,
    });
  } catch (err) {
    if (err instanceof PluginError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: `It couldn’t be installed (${err.message}).` }, { status: 500 });
  }
}
