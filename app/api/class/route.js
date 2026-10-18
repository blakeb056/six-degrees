import { getDb } from '../../../lib/db-client';
import { classState, classAction } from '../../../lib/class-store';

// Sixgree Classes (lib/class-store.js): GET the class, the six classes with
// their live counts, and the build in words (?people=1 adds the class tab's
// ranked lists and its quadrant); POST one change: pick, setup, skip-offer,
// duel, answer, undo, finish, skip-questions, avoid, reveal, react, retake.
// A POST, so it takes the app's own page (the cross-site guard in
// middleware.js applies, as to every write).

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    return Response.json(classState(getDb(), { people: searchParams.get('people') === '1' }));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send the change as JSON.' }, { status: 400 });
  }
  const { status, body: out } = classAction(getDb(), body || {});
  return Response.json(out, { status });
}
