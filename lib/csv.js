import { scorePerson, curveCutoffs, curvedTier } from './scoring.js';
import { toIsoDate } from './ingest.js';
// LinkedIn Connections.csv import, read in the browser.
//
// The file itself never leaves the page. What the map needs about each person
// goes to this computer's own server, which keeps it in the data folder
// (csv-network.json, lib/csv-store.js) so it's still there after the window
// closes. It's never written into the database or mixed with a scanned
// network, and nothing goes anywhere else.
//
// The official export carries six usable columns — First Name, Last Name,
// URL, Company, Position, Connected On. It has NO profile photos and no rich
// headline, so imported people render as tier-colored initials and scores come
// from role + company only. The Email Address column is deliberately never read.

const STORAGE_KEY = 'six-degrees-csv-network';

// ── CSV parsing ────────────────────────────────────────────────────────────
// Hand-rolled so the import needs no dependencies. Handles quoted fields,
// escaped quotes ("") and both CRLF and LF line endings.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export class ConnectionsCsvError extends Error {}

// ── Scoring: the same model as everything else (lib/scoring.js), from the
// export's bare position and company, so there is no reach bonus to find. ──
export function scoreRecord(headline, company) {
  const s = scorePerson({ headline, company });
  return { seniority_score: s.title.points, company_prestige_score: s.companyScore, power_score: s.power, tier: s.tier };
}

/**
 * Tiers for a whole import, graded on its own curve (lib/scoring.js CURVE):
 * a CSV import uses the app's defaults, never your settings (no company
 * scores, no sector), and the curve is the default, so the first look at any
 * export has a top. Scores → Tiers says so while one is open. Run on the
 * parse (the import page's counts) and on every load (the data folder keeps only
 * what the export says, packConnections), so the two always agree.
 */
function gradeOnCurve(connections) {
  const cut = curveCutoffs(connections.map((c) => c.power_score));
  for (const c of connections) c.tier = curvedTier(c.power_score, cut);
  return connections;
}

// Stable id from the profile URL so re-importing keeps node identity.
function hashId(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `csv-${Math.abs(h).toString(36)}`;
}

/** One connection, built from what the export itself says about the person. */
function connectionFrom({ id, name, role, company, profileUrl, connected_date }) {
  // /paths and the sidebar read seniority off `headline`, not `role`, so
  // rebuild the "Role at Company" shape the scanner would have produced.
  const headline = role && company ? `${role} at ${company}` : role || company || name;
  return {
    id,
    degree: 1,
    name,
    headline,
    role,
    company,
    profile_url: profileUrl || null,
    profile_image_url: null,   // the official export carries no photos
    connected_date,
    source_connection_id: null,
    is_catalyst: false,
    catalyst_score: null,
    circle_power: null,
    circle_s_count: null,
    circle_a_count: null,
    circle_elite_pct: null,
    outreach_status: null,
    unlock_status: null,
    ...scoreRecord(headline, company),
  };
}

// ── The importer ───────────────────────────────────────────────────────────
export function parseConnectionsCsv(text) {
  const rows = parseCsv(text);

  // LinkedIn prefixes the file with a "Notes:" preamble of varying length, so
  // find the header row by content rather than assuming a line number.
  const headerIndex = rows.findIndex((r) => {
    const cells = r.map((c) => c.trim().toLowerCase());
    return cells.includes('first name') && cells.includes('last name');
  });
  if (headerIndex === -1) {
    throw new ConnectionsCsvError(
      'Could not find the Connections.csv header row (expected columns like "First Name, Last Name, URL, Company, Position"). Make sure this is the Connections.csv from your LinkedIn data export.'
    );
  }

  const header = rows[headerIndex].map((c) => c.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iFirst = col('first name'), iLast = col('last name'), iUrl = col('url');
  const iCompany = col('company'), iPosition = col('position'), iConnected = col('connected on');

  const connections = [];
  const seen = new Set();
  let skipped = 0;

  for (const r of rows.slice(headerIndex + 1)) {
    const cell = (i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const name = `${cell(iFirst)} ${cell(iLast)}`.trim();
    if (!name) { skipped++; continue; }

    const company = cell(iCompany);
    const role = cell(iPosition);
    const profileUrl = cell(iUrl);

    const id = profileUrl ? hashId(profileUrl) : `csv-row-${connections.length}`;
    if (seen.has(id)) { skipped++; continue; }
    seen.add(id);

    // "28 Sep 2026", read as the calendar date it is. new Date(raw).toISOString()
    // made it local midnight in UTC, a day early anywhere east of London.
    const connected_date = toIsoDate(cell(iConnected));

    connections.push(connectionFrom({ id, name, role, company, profileUrl, connected_date }));
  }

  if (!connections.length) {
    throw new ConnectionsCsvError(
      'That file parsed, but no connections were found in it. Double-check that it is Connections.csv from your LinkedIn data export.'
    );
  }

  gradeOnCurve(connections).sort((a, b) => b.power_score - a.power_score);
  return { connections, skipped, total: connections.length + skipped };
}

// ── Where an open network is kept ──────────────────────────────────────────
// A CSV import is kept in the data folder through /api/data/csv
// (lib/csv-store.js) until × beside "Your CSV" removes it. It used to live in
// sessionStorage and was gone when the window closed (the 1.0 list,
// 2026-10-03: CSV imports survive closing the window).
//
// The sample network stays in this window only. It's a look around, not
// anyone's network, so it never goes into the data folder, a copy or a backup.

const SAMPLE_KEY = 'six-degrees-sample-network';
const CSV_ROUTE = '/api/data/csv';

export function saveSampleNetwork({ degree1 = [], degree2 = [] }) {
  try {
    sessionStorage.setItem(SAMPLE_KEY, JSON.stringify({ degree1, degree2, source: 'sample', importedAt: Date.now() }));
    return true;
  } catch {
    return false; // storage full or off
  }
}

function sampleOpen() {
  try { return !!sessionStorage.getItem(SAMPLE_KEY); } catch { return false; }
}

function sampleNetwork() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SAMPLE_KEY));
    return parsed ? { degree1: parsed.degree1 || [], degree2: parsed.degree2 || [], source: 'sample' } : null;
  } catch { return null; }
}

function leaveSample() {
  try { sessionStorage.removeItem(SAMPLE_KEY); } catch { /* storage off: nothing was kept */ }
}

// The file keeps only what the export says about each person (~130 characters)
// and the page scores it again on every load, so it always follows the scoring
// model and LinkedIn's maximum of 30,000 connections is one request of about
// 4 MB, well under the 10 MB Next reads before middleware (docs/brain/ENDPOINTS.md).
export function packConnections(connections) {
  return connections.map((c) => [c.id, c.name, c.role, c.company, c.profile_url, c.connected_date]);
}

export function unpackConnections(rows = []) {
  return gradeOnCurve(rows.map(([id, name, role, company, profileUrl, connected_date]) => connectionFrom({ id, name, role, company, profileUrl, connected_date })))
    .sort((a, b) => b.power_score - a.power_score);
}

// The kept import, asked for once per page: who "you" are, the map, and the
// Settings sections all ask, and it's the same answer. Forgotten whenever it
// changes, since a link to another page keeps this module loaded.
let kept = null;
function keptCsv() {
  kept ??= fetch(CSV_ROUTE, { cache: 'no-store' })
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { csv: null, problem: `Your kept CSV import couldn't be loaded (${j.error || `the app answered ${r.status}`}).` };
      return { csv: j.csv || null, problem: j.problem || null };
    })
    // No answer at all: the app isn't running, and nothing else on the page will load either.
    .catch(() => ({ csv: null, problem: null }));
  return kept;
}

/** The network open instead of the database: the sample (this window only), else a kept CSV import, else null. */
export async function loadCsvNetwork() {
  const sample = sampleNetwork();
  if (sample) return sample;
  const { csv } = await keptCsv();
  if (!csv) return null;
  return { degree1: unpackConnections(csv.connections), degree2: [], source: 'csv', importedAt: csv.importedAt };
}

/** 'sample' or 'csv' when one is open, else null, without scoring it as loadCsvNetwork() does. */
export async function csvNetworkSource() {
  if (sampleOpen()) return 'sample';
  return (await keptCsv()).csv ? 'csv' : null;
}

/** Why a kept import is there but can't be opened, or null. Said on the welcome screen, never passed off as no import (TRAPS §7). */
export async function keptCsvProblem() {
  return (await keptCsv()).problem;
}

/** Keep an import, in place of any kept before. Resolves { ok: true, people } or { ok: false, error }, the error fit to show. */
export async function saveCsvNetwork(connections) {
  kept = null;
  try {
    const r = await fetch(CSV_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connections: packConnections(connections) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || `The import couldn't be kept (the app answered ${r.status}).` };
    // The import is what the map opens on now, not a sample still open in this window.
    leaveSample();
    return { ok: true, people: j.people };
  } catch {
    return { ok: false, error: "The import couldn't be kept: Six Degrees didn't answer. Check that it's still running, then try again." };
  }
}

/** Close what's open: the sample is forgotten by this window; a CSV import is removed from the data folder. Resolves { ok } or { ok: false, error }. */
export async function closeCsvNetwork(source) {
  kept = null;
  if (source === 'sample') {
    leaveSample();
    return { ok: true };
  }
  try {
    const r = await fetch(CSV_ROUTE, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, error: j.error || `The import couldn't be removed (the app answered ${r.status}).` };
  } catch {
    return { ok: false, error: "The import couldn't be removed: Six Degrees didn't answer. Check that it's still running, then try again." };
  }
}

export const CSV_USER = { id: 'csv-local-user', name: 'You' };
