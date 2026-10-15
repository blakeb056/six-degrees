// Sixgree network files, format 1.0: reading one, checking it, and writing one.
//
// A network file is a folder: manifest.json, a few JSON Lines files and,
// optionally, photos/. It's the one documented handoff between whatever finds
// your network (your Connections export, an add-on, a list made by hand) and
// the app, so the app never needs to know which of them made it. The format
// itself is docs/NETWORK-FILE.md; this file is its reader and writer, and
// lib/network-import.js brings a checked one into the database.
//
// The folder is untrusted until it has been checked (SECURITY.md): it came
// from another program. readNetworkFolder() reads nothing outside it, follows
// no link, checks every file against the manifest's SHA-256 and row count,
// caps every size, and refuses the whole folder on the first thing wrong,
// rather than importing part of it and saying it worked (TRAPS §7).
//
// Person identity is the profile link, and a link can be written many ways.
// Every link Sixgree has stored ends in "/", and an export's links don't, so
// matching them as text would add everyone a second time. Two links are the
// same person when their match keys are equal (personMatchKey).
//
// Plain Node: no imports beyond node: built-ins and this folder's own helpers.

import {
  readFileSync, writeFileSync, lstatSync, readdirSync, mkdirSync, renameSync, rmSync,
} from 'node:fs';
import { isUtf8 } from 'node:buffer';
import path from 'node:path';
import { sha256 } from './data-export.js';
import { durable } from './durable.js';
import { MAX_ROLES } from './experience.js';
import { LOCATION_MAX } from './ingest.js';

export const NETWORK_FORMAT = 'sixgree.network';
export const NETWORK_FORMAT_VERSION = '1.0';

export const MANIFEST_FILE = 'manifest.json';
export const PHOTOS_FOLDER = 'photos';

/** The data files format 1.0 defines, by the name the reader returns each under. */
export const PART_FILES = Object.freeze({
  people: 'people.jsonl',
  connections: 'connections.jsonl',
  edges: 'edges.jsonl',
  circles: 'circles.jsonl',
  ties: 'ties.jsonl',
  companyScans: 'company_scans.jsonl',
});

/** Where a fact came from. It decides precedence: an export fills blanks, a scan or a hand edit overwrites. */
export const SOURCES = Object.freeze(['export', 'scan', 'manual']);

/** How far one connection's own list was read. */
export const CIRCLE_STATUSES = Object.freeze(['read', 'partial', 'hidden', 'unclear']);

/** What a stored experience can say (lib/experience.js). */
export const EXPERIENCE_STATUSES = Object.freeze(['read', 'unreadable', 'card']);

/** Picture types a photo may be, by its name's extension. The /avatars route serves the same ones (lib/photos.js). */
export const PHOTO_TYPES = Object.freeze({ webp: 'webp', png: 'png', jpg: 'jpeg', jpeg: 'jpeg' });

/** The optional parts a manifest says it carries ("includes"). */
export const INCLUDES = Object.freeze(['second_degree', 'mutual_counts', 'photos', 'experience']);

/**
 * Every bound the reader holds a folder to. Generous for a real network (a
 * site's own cap on connections is in the tens of thousands), and still a
 * bound on what one folder can make the app read or keep.
 */
export const LIMITS = Object.freeze({
  manifestBytes: 64 * 1024,
  fileBytes: 256 * 1024 * 1024,   // one JSON Lines file
  lineBytes: 64 * 1024,           // one row
  text: 1000,                     // characters in one text field
  name: 200,                      // characters in a person's name
  url: 2048,                      // characters in a profile link
  people: 500000,
  connections: 50000,
  edges: 1000000,
  circles: 50000,
  ties: 1000000,
  companyScans: 500000,
  photos: 500000,
  photoBytes: 256 * 1024,
  photoSide: 2048,                // pixels, either way
  pages: 10000,                   // pages of one list read
  count: 1000000000,              // any count on a card
  unknownNames: 50,               // field names not in the format, reported per file
});

/** A refusal whose message is fit to show as it is. Nothing was changed. */
export class NetworkFileError extends Error {
  constructor(message, { status = 400, ...extra } = {}) {
    super(message);
    this.name = 'NetworkFileError';
    this.status = status;
    this.extra = extra;
  }
}

// Names and values from the folder are shown in messages; keep a hostile one short.
const short = (s) => String(s).slice(0, 80);

// ── versions ─────────────────────────────────────────────────────────────────

// How to bring an older major version up to this one, by major. None yet:
// 1.0 is the first format anyone wrote. A future 2.0 reader adds 1 here.
const UPGRADES = Object.freeze({});

/**
 * Whether this copy reads a file of `formatVersion` ("1.0"). Only the
 * format's version counts, never the app's: an older app reads a newer
 * file as long as only its minor number moved.
 *   - a newer major is refused: update Sixgree;
 *   - a newer minor is read, and what it adds that this copy doesn't know is
 *     left out, counted and said (newerMinor);
 *   - an older major is upgraded in memory when this copy knows how, and
 *     refused when it doesn't.
 * @returns {{ ok: true, version, major, minor, newerMinor, upgrade } | { ok: false, newer?: true, reason }}
 */
export function versionVerdict(formatVersion) {
  const m = typeof formatVersion === 'string' ? /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.exec(formatVersion) : null;
  if (!m) return { ok: false, reason: `its format version (${short(formatVersion ?? 'none')}) isn't one Sixgree knows.` };
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const [ourMajor, ourMinor] = NETWORK_FORMAT_VERSION.split('.').map(Number);
  if (major > ourMajor) {
    return {
      ok: false,
      newer: true,
      reason: `it was made in format ${formatVersion}, and this copy of Sixgree reads format ${ourMajor}. Update Sixgree, then import it again.`,
    };
  }
  if (major < ourMajor) {
    const upgrade = UPGRADES[major] || null;
    if (!upgrade) return { ok: false, reason: `it was made in format ${formatVersion}, which no copy of Sixgree reads any more.` };
    return { ok: true, version: formatVersion, major, minor, newerMinor: false, upgrade };
  }
  return { ok: true, version: formatVersion, major, minor, newerMinor: minor > ourMinor, upgrade: null };
}

// ── person identity ──────────────────────────────────────────────────────────

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

// RFC 3986 §6.2.2: an escaped letter, digit or -._~ is the character itself,
// and every other escape is written with capital hex. A "%" that starts no
// escape makes the link unreadable.
function normalizeEscapes(s) {
  if (/%(?![0-9A-Fa-f]{2})/.test(s)) return null;
  return s.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(ch) ? ch : `%${hex.toUpperCase()}`;
  });
}

function canonicalOnce(text) {
  let u;
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || !u.hostname) return null;
  // The URL parser has lowered the host, written any other character in the
  // path as UTF-8 escapes, and resolved "." and "..". The path's case is kept:
  // a site may tell people apart by it.
  const escaped = normalizeEscapes(u.pathname);
  if (escaped == null) return null;
  const trimmed = escaped.replace(/\/+$/, '');
  if (!trimmed) return null;   // a site's front page is nobody's profile
  const port = u.port && u.port !== '443' ? `:${u.port}` : '';
  return `https://${u.hostname}${port}${trimmed}/`;
}

/**
 * A profile link as Sixgree stores it: https, the host in lower case, no
 * query or fragment, escapes normalized, and exactly one "/" at the end. It's
 * the form every link already stored has (all 12,770 of them on 2026-10-12),
 * so a scan saved later and a file imported now agree. Extra path segments
 * are kept: which part of a path names the person is the site's business,
 * not this format's. null for anything that isn't an http(s) link to a page.
 */
export function canonicalProfileUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw || raw.length > LIMITS.url) return null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 32 || c === 127) return null;   // never part of a link someone copied
  }
  const once = canonicalOnce(raw);
  // Once more, so the answer is stable: unescaping can make a path the parser reads differently.
  const twice = once && canonicalOnce(once);
  if (!twice) return null;
  return twice === once || canonicalOnce(twice) === twice ? twice : null;
}

/**
 * What two links are compared by: the canonical link without its last "/".
 * A Connections export's link (no "/") and the stored one (with it) have the
 * same key. null when the link isn't one (canonicalProfileUrl).
 */
export function personMatchKey(url) {
  const canonical = canonicalProfileUrl(url);
  return canonical ? canonical.slice(0, -1) : null;
}

// ── pictures ─────────────────────────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * What a picture really is, from its first bytes, and its size in pixels:
 * { type: 'png' | 'jpeg' | 'webp', width, height }, width and height null
 * when the header doesn't say. null when it's none of the three.
 */
export function pictureInfo(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    if (bytes.toString('latin1', 12, 16) !== 'IHDR') return { type: 'png', width: null, height: null };
    return { type: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
      // A start-of-frame segment says the size; DHT, JPG and DAC share the range and don't.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
      }
      const length = bytes.readUInt16BE(i + 2);
      if (length < 2) break;
      i += 2 + length;
    }
    return { type: 'jpeg', width: null, height: null };
  }
  if (bytes.length >= 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { type: 'webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { type: 'webp', width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    return { type: 'webp', width: null, height: null };
  }
  return null;
}

// ── reading one row ──────────────────────────────────────────────────────────

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const HASH = /^[0-9a-f]{64}$/;
const MONTH = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;

const isTime = (v) => typeof v === 'string' && ISO_TIME.test(v) && !Number.isNaN(Date.parse(v));

/** "2026-02-28" yes, "2026-02-30" no. A calendar date has no time zone, so none is used (TRAPS §33). */
function isCalendarDate(v) {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
const plainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Field names a file's rows carry that the format doesn't define: left out,
 * and counted per file, so a newer minor version's additions (or a typo in an
 * optional field) are said rather than silently dropped.
 */
function unknownTally() {
  const byFile = {};
  return {
    add(file, name) {
      const counts = (byFile[file] ||= {});
      const key = short(name);
      if (!(key in counts) && Object.keys(counts).length >= LIMITS.unknownNames) return;
      counts[key] = (counts[key] || 0) + 1;
    },
    get: () => byFile,
  };
}

/** Typed reads of one row's fields, each refusing with "<file>, line <n>: …". */
function rowReader(file, lineNo, obj, known, tally) {
  for (const k of Object.keys(obj)) if (!known.has(k)) tally.add(file, k);
  const where = lineNo ? `${file}, line ${lineNo}` : file;
  const fail = (msg) => { throw new NetworkFileError(`${where}: ${msg}`); };
  const has = (name) => obj[name] !== undefined && obj[name] !== null;
  return {
    fail,
    has,
    text(name, { required = false, max = LIMITS.text } = {}) {
      if (!has(name)) { if (required) fail(`"${name}" is missing.`); return null; }
      const v = obj[name];
      if (typeof v !== 'string') fail(`"${name}" must be text.`);
      const t = v.trim();
      if (required && !t) fail(`"${name}" is empty.`);
      if (t.length > max) fail(`"${name}" is longer than ${max} characters.`);
      return t || null;
    },
    link(name, { required = true } = {}) {
      if (!has(name)) { if (required) fail(`"${name}" is missing.`); return null; }
      const key = canonicalProfileUrl(obj[name]);
      if (!key) fail(`"${name}" isn't a profile link (an http or https address of someone's page).`);
      return key;
    },
    int(name, { min = 0, max = LIMITS.count, required = false } = {}) {
      if (!has(name)) { if (required) fail(`"${name}" is missing.`); return null; }
      const v = obj[name];
      if (!Number.isInteger(v) || v < min || v > max) fail(`"${name}" must be a whole number from ${min} to ${max}.`);
      return v;
    },
    bool(name, { fallback = false } = {}) {
      if (!has(name)) return fallback;
      if (typeof obj[name] !== 'boolean') fail(`"${name}" must be true or false.`);
      return obj[name];
    },
    oneOf(name, values, { required = true } = {}) {
      if (!has(name)) { if (required) fail(`"${name}" is missing.`); return null; }
      if (!values.includes(obj[name])) fail(`"${name}" must be one of ${values.join(', ')}.`);
      return obj[name];
    },
    time(name, { required = false } = {}) {
      if (!has(name)) { if (required) fail(`"${name}" is missing.`); return null; }
      if (!isTime(obj[name])) fail(`"${name}" must be a time written like 2026-10-12T20:30:00Z.`);
      return obj[name];
    },
    date(name) {
      if (!has(name)) return null;
      if (!isCalendarDate(obj[name])) fail(`"${name}" must be a calendar date written like 2026-10-12.`);
      return obj[name];
    },
    hash(name) {
      if (!has(name)) return null;
      if (typeof obj[name] !== 'string' || !HASH.test(obj[name])) fail(`"${name}" must name a photo by its SHA-256 (64 lower-case hex characters).`);
      return obj[name];
    },
    object(name) {
      if (!has(name)) return null;
      if (!plainObject(obj[name])) fail(`"${name}" must be an object.`);
      return obj[name];
    },
  };
}

// ── the rows of each file ────────────────────────────────────────────────────

const KNOWN = {
  people: new Set(['key', 'name', 'headline', 'role', 'company', 'location', 'photo', 'experience', 'mutual_count', 'mutual_count_at']),
  connections: new Set(['person', 'connected_date', 'observed_at', 'source']),
  edges: new Set(['via', 'person', 'observed_at', 'source', 'provenance']),
  circles: new Set(['person', 'status', 'pages', 'more', 'total', 'connections', 'connections_plus', 'complete', 'read_at']),
  ties: new Set(['a', 'b', 'observed_at']),
  companyScans: new Set(['company', 'person', 'observed_at', 'source']),
};
const KNOWN_EXPERIENCE = new Set(['status', 'at', 'source', 'shown', 'roles', 'why', 'card']);
const KNOWN_ROLE = new Set(['title', 'company', 'start', 'end', 'current', 'company_id', 'logo']);
const KNOWN_CARD = new Set(['followers', 'connections', 'connections_plus']);

/** One person's experience, as the format writes it (docs/NETWORK-FILE.md), checked. Logos are photo hashes. */
function readExperienceField(r, value, file, lineNo, tally, logos) {
  if (value == null) return null;
  if (!plainObject(value)) r.fail('"experience" must be an object.');
  const e = rowReader(`${file} experience`, lineNo, value, KNOWN_EXPERIENCE, tally);
  const status = e.oneOf('status', EXPERIENCE_STATUSES);
  const out = { status, at: e.time('at') };
  if (status === 'read') {
    const roles = value.roles;
    if (!Array.isArray(roles) || roles.length === 0) e.fail('a read experience needs at least one role in "roles".');
    if (roles.length > MAX_ROLES) e.fail(`"roles" has more than ${MAX_ROLES} roles.`);
    out.source = e.oneOf('source', ['data', 'page'], { required: false });
    out.shown = e.int('shown', { max: LIMITS.count });
    out.roles = roles.map((role) => {
      if (!plainObject(role)) e.fail('each role must be an object.');
      const rr = rowReader(`${file} experience role`, lineNo, role, KNOWN_ROLE, tally);
      const month = (name) => {
        if (!rr.has(name)) return null;
        if (typeof role[name] !== 'string' || !MONTH.test(role[name])) rr.fail(`"${name}" must be a year or a month, written like 2024 or 2024-03.`);
        return role[name];
      };
      const logo = rr.hash('logo');
      if (logo) logos.add(logo);
      const companyId = rr.text('company_id', { max: 64 });
      return {
        title: rr.text('title', { required: true }),
        company: rr.text('company'),
        start: month('start'),
        end: month('end'),
        current: rr.has('current') ? rr.bool('current') : null,
        ...(companyId ? { company_id: companyId } : {}),
        ...(logo ? { logo } : {}),
      };
    });
  } else if (status === 'unreadable') {
    out.why = e.text('why');
  }
  const card = e.object('card');
  if (card) {
    const c = rowReader(`${file} experience card`, lineNo, card, KNOWN_CARD, tally);
    out.card = {
      followers: c.int('followers'),
      connections: c.int('connections'),
      connections_plus: c.bool('connections_plus'),
    };
  } else if (status === 'card') {
    e.fail('an experience with status "card" needs its "card".');
  }
  return out;
}

const ROW_READERS = {
  people(r, obj, ctx) {
    const key = r.link('key');
    const photo = r.hash('photo');
    return {
      key,
      name: r.text('name', { required: true, max: LIMITS.name }),
      headline: r.text('headline'),
      role: r.text('role'),
      company: r.text('company'),
      // Where they are ("Seattle, Washington, United States"), when something read it.
      location: r.text('location', { max: LOCATION_MAX }),
      photo,
      experience: readExperienceField(r, obj.experience, ctx.file, ctx.lineNo, ctx.tally, ctx.logos),
      mutual_count: r.int('mutual_count', { min: 0 }),
      mutual_count_at: r.time('mutual_count_at'),
    };
  },
  connections(r) {
    return {
      person: r.link('person'),
      connected_date: r.date('connected_date'),
      observed_at: r.time('observed_at'),
      source: r.oneOf('source', SOURCES),
    };
  },
  edges(r) {
    const provenance = r.object('provenance');
    if (provenance) {
      for (const f of ['method', 'run_id']) {
        if (provenance[f] != null && (typeof provenance[f] !== 'string' || provenance[f].length > 200)) r.fail(`"provenance.${f}" must be text of up to 200 characters.`);
      }
    }
    return {
      via: r.link('via'),
      person: r.link('person'),
      observed_at: r.time('observed_at'),
      source: r.oneOf('source', SOURCES),
      provenance: provenance ? { method: provenance.method ?? null, run_id: provenance.run_id ?? null } : null,
    };
  },
  circles(r) {
    return {
      person: r.link('person'),
      status: r.oneOf('status', CIRCLE_STATUSES),
      pages: r.int('pages', { max: LIMITS.pages }) ?? 0,
      more: r.bool('more'),
      total: r.int('total'),
      connections: r.int('connections'),
      connections_plus: r.bool('connections_plus'),
      complete: r.bool('complete'),
      read_at: r.time('read_at', { required: true }),
    };
  },
  ties(r) {
    const a = r.link('a');
    const b = r.link('b');
    if (personMatchKey(a) === personMatchKey(b)) r.fail('a tie is between two different people.');
    // Smaller first, so a pair is one tie whichever way round it was written (lib/ties.js).
    return { ...(a < b ? { a, b } : { a: b, b: a }), observed_at: r.time('observed_at') };
  },
  companyScans(r) {
    return {
      company: r.text('company', { required: true, max: 200 }),
      person: r.link('person'),
      observed_at: r.time('observed_at'),
      source: r.oneOf('source', SOURCES),
    };
  },
};

// ── reading the files ────────────────────────────────────────────────────────

/** A plain file directly in the folder, never through a link. @returns its size. */
function plainFileSize(abs, label) {
  let s;
  try { s = lstatSync(abs); } catch { throw new NetworkFileError(`${label} is missing.`); }
  if (!s.isFile()) throw new NetworkFileError(`${label} isn't a plain file.`);
  return s.size;
}

/**
 * The rows of one listed JSON Lines file, after its checksum and row count
 * match the manifest. Each row goes to `onRow(obj, lineNo)`.
 */
function readLines(abs, name, declared, onRow) {
  const size = plainFileSize(abs, name);
  if (size > LIMITS.fileBytes) throw new NetworkFileError(`${name} is larger than ${LIMITS.fileBytes / 1024 / 1024} MB.`);
  const bytes = readFileSync(abs);
  if (sha256(bytes) !== declared.sha256) {
    throw new NetworkFileError(`${name} doesn't match the checksum in its manifest. It was changed or damaged after it was made.`);
  }
  if (!isUtf8(bytes)) throw new NetworkFileError(`${name} isn't UTF-8 text.`);
  const text = bytes.toString('utf8');
  if (text.length && !text.endsWith('\n')) throw new NetworkFileError(`${name} doesn't end with a line break, so its last row may be cut short.`);
  const lines = text.length ? text.slice(0, -1).split('\n') : [];
  if (declared.rows != null && lines.length !== declared.rows) {
    throw new NetworkFileError(`${name} has ${lines.length} rows, and its manifest says ${declared.rows}.`);
  }
  if (!onRow) return lines.length;
  lines.forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const where = `${name}, line ${i + 1}`;
    if (line.length > LIMITS.lineBytes || Buffer.byteLength(line) > LIMITS.lineBytes) {
      throw new NetworkFileError(`${where} is longer than ${LIMITS.lineBytes / 1024} KB.`);
    }
    if (!line.trim()) throw new NetworkFileError(`${where} is empty.`);
    let obj;
    try { obj = JSON.parse(line); } catch { throw new NetworkFileError(`${where} isn't JSON.`); }
    if (!plainObject(obj)) throw new NetworkFileError(`${where} isn't a JSON object.`);
    onRow(obj, i + 1);
  });
  return lines.length;
}

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const KNOWN_MANIFEST = new Set(['format', 'format_version', 'producer', 'generated_at', 'owner', 'includes', 'left_out', 'files']);
const PART_LIMIT = {
  people: LIMITS.people,
  connections: LIMITS.connections,
  edges: LIMITS.edges,
  circles: LIMITS.circles,
  ties: LIMITS.ties,
  companyScans: LIMITS.companyScans,
};

/** manifest.json, checked: the format, its version, and the files it lists. */
function readManifest(dir, tally) {
  const abs = path.join(dir, MANIFEST_FILE);
  let size;
  try { size = plainFileSize(abs, MANIFEST_FILE); } catch {
    throw new NetworkFileError(`This folder isn't a Sixgree network file: it has no ${MANIFEST_FILE}.`);
  }
  if (size > LIMITS.manifestBytes) throw new NetworkFileError(`${MANIFEST_FILE} is larger than ${LIMITS.manifestBytes / 1024} KB.`);
  let m;
  try { m = JSON.parse(readFileSync(abs, 'utf8')); } catch { throw new NetworkFileError(`${MANIFEST_FILE} isn't JSON.`); }
  if (!plainObject(m) || m.format !== NETWORK_FORMAT) {
    throw new NetworkFileError(`This folder isn't a Sixgree network file: its ${MANIFEST_FILE} doesn't say "format": "${NETWORK_FORMAT}".`);
  }
  const verdict = versionVerdict(m.format_version);
  if (!verdict.ok) throw new NetworkFileError(`This network file can't be imported: ${verdict.reason}`, { newer: Boolean(verdict.newer) });

  const r = rowReader(MANIFEST_FILE, null, m, KNOWN_MANIFEST, tally);
  const producer = r.object('producer');
  if (!producer) r.fail('"producer" is missing.');
  const pr = rowReader(`${MANIFEST_FILE} producer`, null, producer, new Set(['name', 'version']), tally);
  const owner = r.object('owner');
  const ow = owner ? rowReader(`${MANIFEST_FILE} owner`, null, owner, new Set(['key', 'name']), tally) : null;
  const includes = r.object('includes') || {};
  const inc = rowReader(`${MANIFEST_FILE} includes`, null, includes, new Set(INCLUDES), tally);
  const leftOut = r.object('left_out') || {};
  const lo = rowReader(`${MANIFEST_FILE} left_out`, null, leftOut, new Set(['no_profile_link']), tally);
  const files = r.object('files');
  if (!files) r.fail('"files" is missing.');

  const listed = {};
  for (const [name, entry] of Object.entries(files)) {
    if (!FILE_NAME.test(name) || name === MANIFEST_FILE || name === PHOTOS_FOLDER) {
      r.fail(`"files" lists "${short(name)}", which isn't a file name a network file can hold.`);
    }
    if (!plainObject(entry)) r.fail(`"files"."${name}" must be an object.`);
    const jsonl = name.endsWith('.jsonl');
    const rows = entry.rows;
    if (jsonl && (!Number.isInteger(rows) || rows < 0)) r.fail(`"files"."${name}".rows must be a whole number.`);
    if (typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256)) r.fail(`"files"."${name}".sha256 must be 64 lower-case hex characters.`);
    listed[name] = { rows: jsonl ? rows : null, sha256: entry.sha256 };
  }
  for (const required of [PART_FILES.people, PART_FILES.connections]) {
    if (!listed[required]) r.fail(`"files" doesn't list ${required}, which every network file has.`);
  }
  for (const [part, name] of Object.entries(PART_FILES)) {
    if (listed[name] && listed[name].rows > PART_LIMIT[part]) {
      throw new NetworkFileError(`${name} has ${listed[name].rows.toLocaleString('en-US')} rows, more than the ${PART_LIMIT[part].toLocaleString('en-US')} a network file can hold.`);
    }
  }

  return {
    verdict,
    manifest: {
      format: NETWORK_FORMAT,
      format_version: m.format_version,
      producer: { name: pr.text('name', { required: true, max: 100 }), version: pr.text('version', { max: 50 }) },
      generated_at: r.time('generated_at', { required: true }),
      owner: ow ? { key: ow.link('key', { required: false }), name: ow.text('name', { max: LIMITS.name }) } : null,
      includes: Object.fromEntries(INCLUDES.map((k) => [k, inc.bool(k)])),
      left_out: { no_profile_link: lo.int('no_profile_link') ?? 0 },
      files: listed,
    },
  };
}

/** photos/: every picture named by its own SHA-256, checked against it, its type and its size. */
function readPhotoFolder(dir) {
  const folder = path.join(dir, PHOTOS_FOLDER);
  const byHash = new Map();
  for (const name of readdirSync(folder)) {
    if (name === '.DS_Store') continue;   // Finder leaves one in any folder it shows
    const label = `${PHOTOS_FOLDER}/${short(name)}`;
    const m = /^([0-9a-f]{64})\.([a-z]+)$/.exec(name);
    if (!m || !PHOTO_TYPES[m[2]]) throw new NetworkFileError(`${label} isn't named by its contents (its SHA-256, then .webp, .png, .jpg or .jpeg).`);
    const size = plainFileSize(path.join(folder, name), label);
    if (size > LIMITS.photoBytes) throw new NetworkFileError(`${label} is larger than ${LIMITS.photoBytes / 1024} KB.`);
    const bytes = readFileSync(path.join(folder, name));
    if (sha256(bytes) !== m[1]) throw new NetworkFileError(`${label} doesn't match its name. It was changed or damaged after it was made.`);
    const info = pictureInfo(bytes);
    if (!info || info.type !== PHOTO_TYPES[m[2]]) throw new NetworkFileError(`${label} isn't the kind of picture its name says.`);
    if (!info.width || !info.height) throw new NetworkFileError(`${label}'s size in pixels can't be read.`);
    if (info.width > LIMITS.photoSide || info.height > LIMITS.photoSide) {
      throw new NetworkFileError(`${label} is ${info.width} by ${info.height} pixels, larger than ${LIMITS.photoSide} either way.`);
    }
    if (byHash.has(m[1])) throw new NetworkFileError(`${PHOTOS_FOLDER}/ holds the same picture twice (${m[1].slice(0, 12)}…).`);
    if (byHash.size >= LIMITS.photos) throw new NetworkFileError(`${PHOTOS_FOLDER}/ holds more than ${LIMITS.photos.toLocaleString('en-US')} pictures.`);
    byHash.set(m[1], { hash: m[1], name, file: path.join(folder, name), type: info.type, bytes: size, width: info.width, height: info.height });
  }
  return byHash;
}

/**
 * Read and check a network file's folder. Nothing outside `dir` is read, no
 * link is followed, and the first problem refuses the whole folder.
 *
 * Every profile link comes back in canonical form (canonicalProfileUrl), and
 * every reference (a connection's person, an edge's `via`, a tie's two
 * people) is checked to name someone in people.jsonl, so the folder stands on
 * its own. What the format doesn't define is left out and counted in
 * `ignored`, never guessed at.
 *
 * @returns {{ manifest, version, people, connections, edges, circles, ties, companyScans, photos, ignored }}
 * @throws NetworkFileError, fit to show.
 */
export function readNetworkFolder(dir) {
  let s;
  try { s = lstatSync(dir); } catch { throw new NetworkFileError('That network file isn\'t there any more.'); }
  if (!s.isDirectory()) throw new NetworkFileError('A network file is a folder, and this isn\'t one.');

  const tally = unknownTally();
  const { manifest, verdict } = readManifest(dir, tally);

  // Nothing in the folder that the manifest doesn't account for.
  let hasPhotos = false;
  const unknownFiles = [];
  for (const name of readdirSync(dir)) {
    if (name === MANIFEST_FILE || name === '.DS_Store') continue;
    if (name === PHOTOS_FOLDER) {
      if (!lstatSync(path.join(dir, name)).isDirectory()) throw new NetworkFileError(`${PHOTOS_FOLDER} must be a folder.`);
      hasPhotos = true;
      continue;
    }
    if (!manifest.files[name]) throw new NetworkFileError(`This network file holds "${short(name)}", which its manifest doesn't list.`);
  }

  const parts = { people: [], connections: [], edges: [], circles: [], ties: [], companyScans: [] };
  const logos = new Set();
  const lineOf = {};
  for (const [part, name] of Object.entries(PART_FILES)) {
    const declared = manifest.files[name];
    if (!declared) continue;
    lineOf[part] = [];
    readLines(path.join(dir, name), name, declared, (obj, lineNo) => {
      const r = rowReader(name, lineNo, obj, KNOWN[part], tally);
      parts[part].push(ROW_READERS[part](r, obj, { file: name, lineNo, tally, logos }));
      lineOf[part].push(lineNo);
    });
  }
  // Files a newer minor version added: checked against the manifest, then left out.
  for (const [name, declared] of Object.entries(manifest.files)) {
    if (Object.values(PART_FILES).includes(name)) continue;
    readLines(path.join(dir, name), name, declared, null);
    unknownFiles.push(name);
  }

  // ── one person, once; every reference to someone in the file ──
  const people = new Map();   // match key -> person
  parts.people.forEach((p, i) => {
    const k = personMatchKey(p.key);
    if (people.has(k)) {
      throw new NetworkFileError(`${PART_FILES.people}, line ${lineOf.people[i]}: the same person as line ${lineOf.people[parts.people.indexOf(people.get(k))]} (their links name the same page).`);
    }
    people.set(k, p);
  });
  const at = (part, i) => `${PART_FILES[part]}, line ${lineOf[part][i]}`;
  const mustBePerson = (part, i, key, what = 'person') => {
    if (!people.has(personMatchKey(key))) throw new NetworkFileError(`${at(part, i)}: its ${what} isn't in ${PART_FILES.people}.`);
  };

  const connected = new Set();
  const ownerKey = manifest.owner?.key ? personMatchKey(manifest.owner.key) : null;
  parts.connections.forEach((c, i) => {
    mustBePerson('connections', i, c.person);
    const k = personMatchKey(c.person);
    if (connected.has(k)) throw new NetworkFileError(`${at('connections', i)}: this person is listed as a connection twice.`);
    if (k === ownerKey) throw new NetworkFileError(`${at('connections', i)}: this is the file's owner, who can't be their own connection.`);
    connected.add(k);
  });
  const isConnection = (key) => connected.has(personMatchKey(key));

  const seenEdges = new Set();
  parts.edges.forEach((e, i) => {
    mustBePerson('edges', i, e.person);
    if (!isConnection(e.via)) throw new NetworkFileError(`${at('edges', i)}: "via" must be one of the connections in ${PART_FILES.connections}.`);
    if (isConnection(e.person)) {
      throw new NetworkFileError(`${at('edges', i)}: this person is one of your connections. Two connections who know each other are a tie (${PART_FILES.ties}), not an edge.`);
    }
    const pair = `${personMatchKey(e.via)} ${personMatchKey(e.person)}`;
    if (seenEdges.has(pair)) throw new NetworkFileError(`${at('edges', i)}: the same edge is listed twice.`);
    seenEdges.add(pair);
  });
  const seenCircles = new Set();
  parts.circles.forEach((c, i) => {
    if (!isConnection(c.person)) throw new NetworkFileError(`${at('circles', i)}: a circle belongs to one of the connections in ${PART_FILES.connections}.`);
    const k = personMatchKey(c.person);
    if (seenCircles.has(k)) throw new NetworkFileError(`${at('circles', i)}: this person's circle is listed twice.`);
    seenCircles.add(k);
  });
  const seenTies = new Set();
  parts.ties.forEach((t, i) => {
    if (!isConnection(t.a) || !isConnection(t.b)) throw new NetworkFileError(`${at('ties', i)}: a tie is between two of the connections in ${PART_FILES.connections}.`);
    const pair = `${personMatchKey(t.a)} ${personMatchKey(t.b)}`;
    if (seenTies.has(pair)) throw new NetworkFileError(`${at('ties', i)}: the same tie is listed twice.`);
    seenTies.add(pair);
  });
  const seenScans = new Set();
  parts.companyScans.forEach((c, i) => {
    mustBePerson('companyScans', i, c.person);
    if (isConnection(c.person)) {
      throw new NetworkFileError(`${at('companyScans', i)}: this person is one of your connections, and nobody is a connection and found by a company scan at once.`);
    }
    const pair = `${c.company.toLowerCase()} ${personMatchKey(c.person)}`;
    if (seenScans.has(pair)) throw new NetworkFileError(`${at('companyScans', i)}: the same person at the same company is listed twice.`);
    seenScans.add(pair);
  });

  // ── photos ──
  const photoFiles = hasPhotos ? readPhotoFolder(dir) : new Map();
  parts.people.forEach((p, i) => {
    if (p.photo && !photoFiles.has(p.photo)) throw new NetworkFileError(`${at('people', i)}: its photo isn't in ${PHOTOS_FOLDER}/.`);
  });
  for (const logo of logos) {
    if (!photoFiles.has(logo)) throw new NetworkFileError(`${PART_FILES.people}: a role's logo (${logo.slice(0, 12)}…) isn't in ${PHOTOS_FOLDER}/.`);
  }
  // One picture on more than one person is nobody's face for sure: it's
  // dropped for all of them (TRAPS §20, one person's face handed to
  // everybody). Logos are shared by design and exempt.
  const faces = new Map();
  for (const p of parts.people) if (p.photo) faces.set(p.photo, (faces.get(p.photo) || 0) + 1);
  let sharedPhotos = 0;
  for (const p of parts.people) {
    if (p.photo && faces.get(p.photo) > 1) { p.photo = null; sharedPhotos += 1; }
  }
  const used = new Set([...logos, ...parts.people.map((p) => p.photo).filter(Boolean)]);
  const photos = [...photoFiles.values()].filter((f) => used.has(f.hash));

  // ── what the manifest says it carries ──
  const present = {
    second_degree: parts.edges.length > 0,
    mutual_counts: parts.people.some((p) => p.mutual_count != null),
    photos: photoFiles.size > 0,
    experience: parts.people.some((p) => p.experience),
  };
  for (const k of INCLUDES) {
    if (present[k] && !manifest.includes[k]) {
      throw new NetworkFileError(`${MANIFEST_FILE} says "includes"."${k}" is false, and the file has them.`);
    }
  }

  const referenced = new Set([
    ...connected,
    ...parts.edges.map((e) => personMatchKey(e.person)),
    ...parts.companyScans.map((c) => personMatchKey(c.person)),
  ]);

  return {
    manifest,
    version: verdict,
    people: parts.people,
    connections: parts.connections,
    edges: parts.edges,
    circles: parts.circles,
    ties: parts.ties,
    companyScans: parts.companyScans,
    photos,
    ignored: {
      fields: tally.get(),
      files: unknownFiles,
      unreferencedPeople: [...people.keys()].filter((k) => !referenced.has(k)).length,
      sharedPhotos,
      unusedPhotos: photoFiles.size - photos.length,
    },
  };
}

// ── writing one ──────────────────────────────────────────────────────────────

/**
 * Write a network file to the folder `dir`, which must not exist yet. It's
 * written as `<dir>.partial`, synced, read back with readNetworkFolder, and
 * only then renamed to `dir` (the vacuumCopy pattern, lib/data-import.js): a
 * folder with the name is always a whole one that passes the reader's checks.
 *
 * `parts` holds rows in the format's own shape (docs/NETWORK-FILE.md):
 * { people, connections, edges, circles, ties, companyScans } and `photos` as
 * [{ bytes, ext }], named here by their SHA-256. Every profile link is written
 * in canonical form. `leftOut` counts what the producer couldn't include
 * ({ no_profile_link }).
 *
 * @returns {{ dir, manifest }}
 * @throws NetworkFileError when a part can't be written as a valid file; nothing is left behind.
 */
export function writeNetworkFolder(dir, parts = {}, { producer, owner = null, now = new Date(), leftOut = {} } = {}) {
  if (!producer?.name) throw new NetworkFileError('A network file needs a producer name.');
  try {
    lstatSync(dir);
    throw new NetworkFileError(`${short(path.basename(dir))} already exists.`);
  } catch (err) {
    if (err instanceof NetworkFileError) throw err;
  }
  const link = (value, what) => {
    const key = canonicalProfileUrl(value);
    if (!key) throw new NetworkFileError(`${what} isn't a profile link: ${short(value)}`);
    return key;
  };
  const shaped = {
    people: (parts.people || []).map((p, i) => ({ ...p, key: link(p.key, `person ${i + 1}`) })),
    connections: (parts.connections || []).map((c, i) => ({ ...c, person: link(c.person, `connection ${i + 1}`) })),
    edges: (parts.edges || []).map((e, i) => ({ ...e, via: link(e.via, `edge ${i + 1}`), person: link(e.person, `edge ${i + 1}`) })),
    circles: (parts.circles || []).map((c, i) => ({ ...c, person: link(c.person, `circle ${i + 1}`) })),
    ties: (parts.ties || []).map((t, i) => ({ ...t, a: link(t.a, `tie ${i + 1}`), b: link(t.b, `tie ${i + 1}`) })),
    companyScans: (parts.companyScans || []).map((c, i) => ({ ...c, person: link(c.person, `company scan ${i + 1}`) })),
  };
  const ownerKey = owner?.key ? link(owner.key, 'the owner') : null;

  const partial = `${dir}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  try {
    const files = {};
    for (const [part, name] of Object.entries(PART_FILES)) {
      const rows = shaped[part];
      // people and connections are always written, even empty; the rest only when there's something in them.
      if (!rows.length && part !== 'people' && part !== 'connections') continue;
      const text = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
      const bytes = Buffer.from(text, 'utf8');
      writeFileSync(path.join(partial, name), bytes);
      durable.syncFile(path.join(partial, name));
      files[name] = { rows: rows.length, sha256: sha256(bytes) };
    }
    const photos = parts.photos || [];
    if (photos.length) {
      const folder = path.join(partial, PHOTOS_FOLDER);
      mkdirSync(folder);
      for (const { bytes, ext } of photos) {
        const file = path.join(folder, `${sha256(bytes)}.${ext}`);
        writeFileSync(file, bytes);
        durable.syncFile(file);
      }
      durable.syncFolder(folder);
    }
    const manifest = {
      format: NETWORK_FORMAT,
      format_version: NETWORK_FORMAT_VERSION,
      producer: { name: producer.name, ...(producer.version ? { version: producer.version } : {}) },
      generated_at: now.toISOString(),
      owner: owner ? { ...(ownerKey ? { key: ownerKey } : {}), ...(owner.name ? { name: owner.name } : {}) } : null,
      includes: {
        second_degree: shaped.edges.length > 0,
        mutual_counts: shaped.people.some((p) => p.mutual_count != null),
        photos: photos.length > 0,
        experience: shaped.people.some((p) => p.experience != null),
      },
      left_out: { no_profile_link: Number(leftOut.no_profile_link) || 0 },
      files,
    };
    writeFileSync(path.join(partial, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    durable.syncFile(path.join(partial, MANIFEST_FILE));
    durable.syncFolder(partial);
    readNetworkFolder(partial);   // a file Sixgree writes always passes its own reader
    renameSync(partial, dir);
    durable.syncFolder(path.dirname(dir));
    return { dir, manifest };
  } catch (err) {
    rmSync(partial, { recursive: true, force: true });
    throw err;
  }
}
