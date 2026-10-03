// Saving settings from the browser: POST /api/settings with only the settings
// that change (lib/settings.js keeps the rest as stored). Scores → Your sector
// and Tiers save through it, and so does the Scan page's question about your
// field before the first scan (app/components/FieldStep.js), and the look and
// the Galaxy's saved layouts (lib/synced-setting.js).

/**
 * `keepalive` lets a save sent as the page goes away still arrive.
 * @returns { settings, effects, error }: `settings` as saved, also when the
 *   save landed but the work it set in motion failed (lib/settings-effects.js);
 *   `effects` what that work reported; `error` a message fit to show, or null.
 */
export async function saveSettings(patch, { keepalive = false } = {}) {
  try {
    const r = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: patch }), keepalive,
    });
    const d = await r.json();
    return { settings: d.settings || null, effects: d.effects || null, error: r.ok ? null : d.error || 'Could not save.' };
  } catch {
    return { settings: null, effects: null, error: 'Could not reach the app. Reload this page to see what is saved.' };
  }
}
