import { getDb, backupOptions } from '../../../../lib/db-client';
import { makeBackup, noteBackupFailure } from '../../../../lib/backups';
import { countPeople } from '../../../../lib/data-export';

// Settings → Your data → Back up now: a backup in backups/ like the daily ones
// (lib/backups.js), kept until the person deletes it. Nothing is taken from
// the request. Gated (lib/gate.js) with the routes that hand over or replace
// the whole network: it writes all of it to a file.

export async function POST() {
  const db = getDb();
  if (countPeople(db) === 0) {
    return Response.json({ error: 'There’s no network here to back up yet.' }, { status: 409 });
  }
  try {
    const made = makeBackup('manual', backupOptions(db));
    return Response.json({
      ok: true,
      backup: { name: made.name, bytes: made.bytes, people: made.people, photos: made.photos, verified: made.verified },
    });
  } catch (err) {
    noteBackupFailure('manual', err);
    return Response.json({ error: `The backup couldn’t be made: ${err.message}` }, { status: 500 });
  }
}
