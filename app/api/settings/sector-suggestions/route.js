import { getDb } from '../../../../lib/db-client';
import { readForScoring, scoringRows } from '../../../../lib/rpc';
import { suggestSectors } from '../../../../lib/sector-directory';

// Settings → Your sector: "Suggested from your network". The directory's
// sectors most of your scanned people work in, counted here from the rows
// with the same read rescoring uses, so a suggestion's companies are the ones
// picking it would lean. Its own read-only GET, not part of GET
// /api/settings: that one is also what the profile page loads, and this reads
// every row. A CSV import or the sample network isn't in the database, so it
// isn't counted (the page says so).

export async function GET() {
  try {
    const rows = scoringRows(getDb());
    return Response.json({ scored: rows.length, suggestions: suggestSectors(rows, readForScoring(rows)) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
