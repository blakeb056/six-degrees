// What saving a setting sets in motion. lib/settings.js only stores; the work a
// change causes lives here, so the store needs none of the modules that work
// uses (rescoring reads the settings itself, which would otherwise go in a
// circle). A setting with no entry here is simply saved.

import { rescoreAll, scoringRows } from './rpc.js';
import { tierMoves } from './sector-focus.js';

const EFFECTS = {
  // Scores depend on the sector focus, so everyone is rescored, as when a
  // company score changes (app/api/company-scores). The answer says how many
  // people changed tier, counted the way the preview counts them.
  sectorFocus(db) {
    try {
      const before = new Map(scoringRows(db, { withPeople: true }).map((r) => [r.id, r.tier]));
      const { scored } = rescoreAll();
      const moved = tierMoves(scoringRows(db, { withPeople: true }), (r) => before.get(r.id), (r) => r.tier, { examples: 0 });
      return { scored, moved: moved.up + moved.down, up: moved.up, down: moved.down };
    } catch (err) {
      // The choice is saved and the old scores are stamped with the old
      // choice, so the next load of the map sees they are stale and retries.
      throw new Error(`Saved, but rescoring your network failed (${err.message}). It will try again the next time the map loads.`);
    }
  },
};

/**
 * Run what each changed setting sets in motion. `before` and `after` are full
 * settings objects as lib/settings.js returns them.
 * @returns { [setting]: its result } for those that ran, or null when none did.
 */
export function afterSettingsChange(db, before, after) {
  let out = null;
  for (const [name, run] of Object.entries(EFFECTS)) {
    if (JSON.stringify(before?.[name]) === JSON.stringify(after?.[name])) continue;
    out = out || {};
    out[name] = run(db, after?.[name], before?.[name]);
  }
  return out;
}
