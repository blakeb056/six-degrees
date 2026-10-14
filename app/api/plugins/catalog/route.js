import { pluginsEnabled } from '../../../../lib/plugins-view';
import { loadCatalog, CatalogError, catalogSource, sourceView } from '../../../../lib/plugin-catalog';
import { CATALOG_UNLOADED } from '../../../../lib/plugins-client';

// Settings → Plugins → Browse, and the guided setup's Allow plugins box: the
// plugin list, fetched from the official address (or a test's,
// SIX_DEGREES_PLUGIN_CATALOG) and checked (lib/plugin-catalog.js loadCatalog)
// → { ok, source, plugins, dropped }. Each entry is { id, name, version, about,
// risk, kind, unlocks, size, host, problem }: `problem` says why one is not for
// this version, and `dropped` lists what was left out, with why.
//
// The page asks only when someone opens the section with plugins on, presses
// Try again, or ticks Allow plugins: Sixgree never goes online by itself. A
// POST, not a GET, because this one goes online: only a write is refused when
// another website sends it (lib/gate.js isCrossSiteWrite), so no page
// elsewhere can make Sixgree fetch anything. Refused while plugins are off.
// Allowed while the scanner runs, since it changes nothing here. Gated with
// /api/plugins (lib/gate.js).
//
// A list that can't be had or read is 502: { error: CATALOG_UNLOADED, detail, source }.

export async function POST() {
  if (!pluginsEnabled()) {
    return Response.json({ error: 'Turn on Enable plugins first, then browse.' }, { status: 409 });
  }
  try {
    return Response.json({ ok: true, ...(await loadCatalog()) });
  } catch (err) {
    const source = sourceView(catalogSource());
    if (err instanceof CatalogError) return Response.json({ error: CATALOG_UNLOADED, detail: err.message, source }, { status: 502 });
    return Response.json({ error: CATALOG_UNLOADED, detail: `Something went wrong reading it (${err.message}).`, source }, { status: 500 });
  }
}
