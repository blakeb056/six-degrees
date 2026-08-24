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

// Same prestige ladder the server scorer uses, shipped as the default so an
// imported network is scored the moment it lands (an unscored record renders
// as "NaN" across the UI).
const DEFAULT_PRESTIGE = {
  s_score: 10, a_score: 7, b_score: 5, c_score: 3, d_score: 2,
  s_tier: ['snap', 'snapchat', 'google', 'meta', 'facebook', 'apple', 'amazon', 'microsoft',
    'netflix', 'tesla', 'spotify', 'tiktok', 'bytedance', 'anthropic', 'openai', 'stripe',
    'coinbase', 'palantir', 'blackrock', 'anduril', 'nvidia', 'deepmind'],
  a_tier: ['pinterest', 'disney', 'nike', 'coca-cola', 'polymarket', 'whatnot', 'shopify',
    'spacex', 'reddit', 'robinhood', 'databricks', 'figma', 'notion', 'ramp'],
  b_tier: ['uber', 'lyft', 'airbnb', 'twitter', 'linkedin', 'salesforce', 'adobe', 'oracle',
    'ibm', 'jpmorgan', 'goldman sachs', 'intel', 'cisco', 'paypal', 'square', 'block'],
  c_tier: [],
};

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

// ── Scoring (mirrors app/api/ingest/route.js so tiers match the real app) ──
function seniorityFrom(headline) {
  const hl = (headline || '').toLowerCase();
  if (hl.match(/ceo|chief|founder|president|chairman|co-founder/i)) return 10;
  if (hl.match(/\bvp\b|vice president|svp|evp|managing director/i)) return 9;
  if (hl.match(/director|head of|senior director/i)) return 8;
  if (hl.match(/manager|lead|principal|staff/i)) return 7;
  if (hl.match(/senior|sr\.|sr /i)) return 6;
  if (hl.match(/engineer|developer|analyst|designer|scientist/i)) return 5;
  if (hl.match(/intern|student|aspiring/i)) return 3;
  return 5;
}

function prestigeFrom(company, cfg = DEFAULT_PRESTIGE) {
  const c = (company || '').toLowerCase();
  if (!c) return cfg.d_score;
  const tiers = [
    { list: cfg.s_tier, score: cfg.s_score },
    { list: cfg.a_tier, score: cfg.a_score },
    { list: cfg.b_tier, score: cfg.b_score },
    { list: cfg.c_tier, score: cfg.c_score },
  ];
  for (const t of tiers) for (const name of t.list) if (c.includes(name)) return t.score;
  return cfg.d_score;
}

export function scoreRecord(headline, company) {
  const seniority = seniorityFrom(headline);
  const prestige = prestigeFrom(company);
  const power = Math.round((seniority * 0.5 + prestige * 0.3) * 10) / 10;
  const tier = power >= 7 ? 'S' : power >= 5.5 ? 'A' : power >= 4 ? 'B' : power >= 2.5 ? 'C' : 'D';
  return { seniority_score: seniority, company_prestige_score: prestige, power_score: power, tier };
}

// Stable id from the profile URL so re-importing keeps node identity.
function hashId(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `csv-${Math.abs(h).toString(36)}`;
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

    // /paths and the sidebar read seniority off `headline`, not `role`, so
    // rebuild the "Role at Company" shape the scraper would have produced.
    const headline = role && company ? `${role} at ${company}` : role || company || name;

    const id = profileUrl ? hashId(profileUrl) : `csv-row-${connections.length}`;
    if (seen.has(id)) { skipped++; continue; }
    seen.add(id);

    let connected_date = null;
    const raw = cell(iConnected);
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) connected_date = d.toISOString().split('T')[0];
    }

    connections.push({
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
    });
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

export function saveCsvNetwork(connections) {
  return saveSessionNetwork({ degree1: connections, degree2: [], source: 'csv' });
}

export function hasCsvNetwork() {
  try { return !!sessionStorage.getItem(STORAGE_KEY); } catch { return false; }
}

export function loadCsvNetwork() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { degree1: parsed.degree1 || [], degree2: parsed.degree2 || [], source: parsed.source || 'csv' };
  } catch { return null; }
}

export function clearCsvNetwork() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
}

export const CSV_USER = { id: 'csv-local-user', name: 'You' };
