import { legacyOffer, answerLegacyOffer, parseLegacyAnswer } from '../../../../lib/legacy-offer';

// Paths → Scores' one-time offer to keep the curated list's old scores as your
// own, after the list was made neutral (lib/legacy-offer.js). GET says what is
// offered: {offer: null} or {offer: {companies}}. POST answers it:
// {keep: [names]} keeps those old scores, {keep: []} is No thanks, and either
// way it is never offered again. The server takes only names from the page;
// the scores kept are the old list's own. A POST is a write, so the cross-site
// guard in middleware.js covers it like every other.

export async function GET() {
  try {
    return Response.json({ offer: legacyOffer() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  let keep;
  try {
    keep = parseLegacyAnswer(await request.json());
  } catch (err) {
    return Response.json({ error: err instanceof SyntaxError ? 'Send the answer as JSON.' : err.message }, { status: 400 });
  }
  try {
    return Response.json({ success: true, ...answerLegacyOffer(keep) });
  } catch (err) {
    // The answer is saved even when the rescore after it fails; say what was kept.
    return Response.json({ error: err.message, ...(err.kept ? { kept: err.kept } : {}) }, { status: 500 });
  }
}
