// What saving a setting sets in motion. lib/settings.js only stores; the work a
// change causes lives here, so the store needs none of the modules that work
// uses (rescoring reads the settings itself, which would otherwise go in a
// circle). A setting with no entry here is simply saved.

import { rescoreAll } from './rpc.js';
import { sameFocus, NO_FOCUS } from './sector-focus.js';

// Each entry: `changed(before, after)` says whether a change matters (by
// default, any change to the stored value), and `run(db, after, before)` does
// the work and returns what to tell the page.
const EFFECTS = {
  sectorFocus: {
    // Only a change to what scoring uses: a strength with no sectors picked
    // scores exactly like nothing picked, so it saves without a rescore.
    changed: (before, after) => !sameFocus(before, after),
    // Scores depend on the sector focus, so everyone is rescored, as when a
    // company score changes (app/api/company-scores). The answer says how many
    // people changed tier, counted by the preview's own function from the same
    // rows (rescoreAll's compareWith), so it says what the preview said.
    run(db, after, before) {
      try {
        const { scored, people, up, down } = rescoreAll({ compareWith: before ?? NO_FOCUS });
        return { scored, people, moved: up + down, up, down };
      } catch (err) {
        // The choice is saved and the old scores are stamped with the old
        // choice, so the next load of the map sees they are stale and retries.
        throw new Error(`Saved, but rescoring your network failed (${err.message}). It will try again the next time the map loads.`);
      }
    },
  },
};

const differs = (before, after) => JSON.stringify(before) !== JSON.stringify(after);

/**
 * Run what each changed setting sets in motion. `before` and `after` are full
 * settings objects as lib/settings.js returns them; `effects` defaults to the
 * app's own (tests pass their own, as with lib/settings.js's schema).
 * Every changed setting's work runs, even after another's fails.
 * @returns { [setting]: its result } for those that ran, or null when none did.
 * @throws an Error whose message names every failure, with `.effects` holding
 *   the results of those that did run (or null).
 */
export function afterSettingsChange(db, before, after, effects = EFFECTS) {
  let out = null;
  const failed = [];
  for (const [name, { changed = differs, run }] of Object.entries(effects)) {
    if (!changed(before?.[name], after?.[name])) continue;
    try {
      const result = run(db, after?.[name], before?.[name]);
      out = { ...out, [name]: result };
    } catch (err) {
      failed.push(err.message);
    }
  }
  if (failed.length) throw Object.assign(new Error(failed.join(' ')), { effects: out });
  return out;
}
