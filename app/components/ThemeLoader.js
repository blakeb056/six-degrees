'use client';

// Loads the theme store on every page (lib/theme-store.js), which applies the
// theme in use before anything draws. It renders nothing.
//
// Then it asks the server once for the choices kept with the network (the
// look, the Galaxy's saved layouts: lib/settings.js), which win over this
// browser's copy of them: a restore or an import brings its own
// (lib/synced-setting.js). The layouts' code loads only then.
import { useEffect } from 'react';
import { adoptSavedTheme } from '../../lib/theme-store';

export default function ThemeLoader() {
  useEffect(() => {
    let live = true;
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (d) => {
        if (!live || !d?.settings) return;
        adoptSavedTheme(d.settings.theme);
        const { adoptSavedLayouts } = await import('../../lib/galaxy-lab');
        if (live) adoptSavedLayouts(d.settings.galaxyLayouts);
      })
      .catch(() => { /* no server (the sample, a static page): this browser's copy stands */ });
    return () => { live = false; };
  }, []);
  return null;
}
