import { scorePerson } from './scoring.js';
// LinkedIn Connections.csv import — parsed ENTIRELY in the browser.
//
// Nothing is uploaded and nothing is written to the database: an imported
// network lives in sessionStorage and disappears when the tab closes. That
// keeps other people's connection lists off this deployment's Supabase.
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

    let connected_date = null;
    const raw = cell(iConnected);
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) connected_date = d.toISOString().split('T')[0];
    }

    connections.push(connectionFrom({ id, name, role, company, profileUrl, connected_date }));
  }

  if (!connections.length) {
    throw new ConnectionsCsvError(
      'That file parsed, but no connections were found in it. Double-check that it is Connections.csv from your LinkedIn data export.'
    );
  }

  connections.sort((a, b) => b.power_score - a.power_score);
  return { connections, skipped, total: connections.length + skipped };
}

// ── Session-scoped storage (never the database) ────────────────────────────
export function saveSessionNetwork({ degree1 = [], degree2 = [], source = 'csv' }) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ degree1, degree2, source, importedAt: Date.now() }));
    return true;
  } catch {
    return false; // quota — very large networks
  }
}

// A scored row is ~540 characters and the tab holds ~5 million, which capped an
// import near 9,000 connections. So the tab keeps only what the export says about
// each person (~130 characters) and scores it again on load: an export at
// LinkedIn's own maximum of 30,000 connections fits.
export function packConnections(connections) {
  return connections.map((c) => [c.id, c.name, c.role, c.company, c.profile_url, c.connected_date]);
}

export function unpackConnections(rows = []) {
  return rows
    .map(([id, name, role, company, profileUrl, connected_date]) => connectionFrom({ id, name, role, company, profileUrl, connected_date }))
    .sort((a, b) => b.power_score - a.power_score);
}

export function saveCsvNetwork(connections) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      packed: packConnections(connections), degree2: [], source: 'csv', importedAt: Date.now(),
    }));
    return true;
  } catch {
    return false; // quota
  }
}

export function hasCsvNetwork() {
  try { return !!sessionStorage.getItem(STORAGE_KEY); } catch { return false; }
}

export function loadCsvNetwork() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const degree1 = parsed.packed ? unpackConnections(parsed.packed) : parsed.degree1 || [];
    return { degree1, degree2: parsed.degree2 || [], source: parsed.source || 'csv' };
  } catch { return null; }
}

export function clearCsvNetwork() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
}

export const CSV_USER = { id: 'csv-local-user', name: 'You' };
