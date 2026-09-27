import { getDb } from '../../../../lib/db-client';
import { companyOverrides, readForScoring, scoringRows, sectorFocusOf } from '../../../../lib/rpc';
import { parseSectorFocus, previewSectorFocus } from '../../../../lib/sector-focus';

// Settings → Your sector, before you save: what a sector focus would change,
// against the one saved now. It reads the network once and scores it twice in
// memory, with the inputs rescoreAll() uses (readForScoring: each company's
// industry and its sectors from the directory), and writes nothing. A save
// counts its changes with the same function (rescoreAll's compareWith), so the
// two agree. A POST because it takes a body; the cross-site guard in
// middleware.js covers it like every write.

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send the sector focus as JSON.' }, { status: 400 });
  }
  let to;
  try {
    to = parseSectorFocus(body?.sectorFocus);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  try {
    const db = getDb();
    const rows = scoringRows(db, { withPeople: true });
    return Response.json(previewSectorFocus(rows, {
      overrides: companyOverrides(db),
      read: readForScoring(rows),
      from: sectorFocusOf(db),
      to,
    }));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
