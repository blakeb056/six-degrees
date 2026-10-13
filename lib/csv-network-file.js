// Connections.csv as a network file: the format's first producer
// (docs/NETWORK-FILE.md), and the way a CSV import goes into your network.
//
// The page reads the CSV as it always has (lib/csv.js parseConnectionsCsv:
// the file never leaves the page, and its Email Address column is never read)
// and sends the six fields lib/csv.js packConnections makes. Here they become
// a network file with source 'export', so the importer (lib/network-import.js)
// treats them as an export: they fill what's blank on someone a scan saved,
// and bring an export's own rows up to date (a new job).
//
// Who someone is, is their profile link in canonical form
// (lib/network-file.js canonicalProfileUrl): an export writes
// ".../in/ada-lovelace" and a scan saved ".../in/ada-lovelace/", and they're
// one person, never two.
//
// People with no profile link can't be kept (the link is who they are, and
// profile_url is NOT NULL), so they're left out and counted, and the page says
// "3 people had no profile link" (Blake, 2026-10-12). A link that isn't one (a
// cell with no web address in it) is counted the same way: the person can't
// be found by it. Two rows naming one person, the same link written two ways,
// keep the first, and the rest are counted.
//
// The other half is the quiet move (moveKeptCsv): a CSV import an older
// version kept beside the database (csv-network.json, lib/csv-store.js) goes
// in through the same importer once, at the start, with no card and no click.

import { packConnections } from './csv.js';
import {
  csvRowsProblem, readCsvNetwork, removeCsvNetwork, CsvStoreError,
} from './csv-store.js';
import {
  canonicalProfileUrl, personMatchKey, LIMITS, NetworkFileError,
} from './network-file.js';
import { stageNetwork, dropStage } from './network-stage.js';
import { applyNetworkImport, networkImportPreflight } from './network-import.js';
import { getDb, dataDir as dataFolder, backupsFolder } from './db-client.js';
import { resolveProfile } from './profile.js';
import { scannerJob } from './scan-state.js';
import { pendingImport } from './data-import.js';
import { APP_VERSION } from './app-version.js';

/** Who wrote the file: Sixgree's own reading of a connections export. */
export const CSV_PRODUCER = Object.freeze({ name: 'Connections export', version: APP_VERSION });

const clip = (s, max) => String(s ?? '').trim().slice(0, max);

/** "2026-02-28" yes, "2026-02-30" no: the format refuses a date that isn't one, so it's left out here. */
function calendarDate(v) {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Packed rows as they are, or parsed connections (parseConnectionsCsv's) packed. */
function packed(rows) {
  const parsed = Array.isArray(rows) && rows.length > 0 && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0]);
  return parsed ? packConnections(rows) : rows;
}

/**
 * A Connections.csv import as a network file's parts.
 * @param rows packed rows ([id, name, role, company, profile_url, connected_date],
 *   what the page sends), or the connections parseConnectionsCsv returns.
 * @returns {{ parts: { people, connections }, leftOut: { no_profile_link }, repeated, received }}
 * @throws CsvStoreError, fit to show inside a sentence, when they aren't rows the page makes.
 */
export function csvNetworkParts(rows) {
  const list = packed(rows);
  const problem = csvRowsProblem(list);
  if (problem) throw new CsvStoreError(problem);
  const people = [];
  const connections = [];
  const seen = new Set();
  let noLink = 0;
  let repeated = 0;
  for (const [, name, role, company, profileUrl, connected] of list) {
    const key = canonicalProfileUrl(profileUrl || '');
    if (!key) { noLink += 1; continue; }
    const match = personMatchKey(key);
    if (seen.has(match)) { repeated += 1; continue; }
    seen.add(match);
    // No headline: an export has none, and the importer builds "Role at Company".
    const person = { key, name: clip(name, LIMITS.name) };
    if (clip(role, LIMITS.text)) person.role = clip(role, LIMITS.text);
    if (clip(company, LIMITS.text)) person.company = clip(company, LIMITS.text);
    people.push(person);
    connections.push({ person: key, ...(calendarDate(connected) ? { connected_date: connected } : {}), source: 'export' });
  }
  return { parts: { people, connections }, leftOut: { no_profile_link: noLink }, repeated, received: list.length };
}

/** "3 people" or "1 person". */
export const peopleWord = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'person' : 'people'}`;

/**
 * Stage a CSV import as a network file in the data folder (lib/network-stage.js),
 * for a preview and then Import.
 * @returns {{ id, model, leftOut, repeated, received }}
 * @throws CsvStoreError for rows the page doesn't make; NetworkFileError (422)
 *   when nobody in it has a profile link, so there's nothing to import.
 */
export function stageCsvNetwork(dir, rows, { now = new Date() } = {}) {
  const { parts, leftOut, repeated, received } = csvNetworkParts(rows);
  if (!parts.connections.length) {
    throw new NetworkFileError(
      `Nobody in this file has a profile link, so there's nothing to import (${peopleWord(leftOut.no_profile_link)} had none).`,
      { status: 422 },
    );
  }
  const { id, model } = stageNetwork(dir, parts, { producer: CSV_PRODUCER, leftOut, now });
  return { id, model, leftOut, repeated, received };
}

// ── the quiet move ───────────────────────────────────────────────────────────

/**
 * Move a CSV import an older version kept in the data folder into your
 * network. Blake, 2026-10-12: no new concept, so no card and no click; it's
 * done at the start (lib/db-client.js getDb starts it, once per server).
 *
 * In order, each step only after the one before it worked:
 *   1. Nothing while a scan runs or an import waits (the importer's own
 *      preflight), and nothing when the file can't be read or nobody in it has
 *      a profile link: the file stays, and a window shows it as before.
 *   2. A before-import backup, even of an empty network: it carries the kept
 *      file itself, so the way back has it.
 *   3. The import, in one transaction (lib/network-import.js).
 *   4. Only then is the file removed (lib/csv-store.js removeCsvNetwork).
 *
 * Safe to run again: once everyone is in, the import changes nothing and
 * makes no backup, and the file is removed. A failure anywhere leaves the
 * file where it was, to be tried at the next start.
 *
 * @returns {{ moved: true, people, counts, backup, leftOut, repeated, removed }
 *   | { moved: false, reason }}
 */
export async function moveKeptCsv({
  db = getDb(), dataDir: dir = dataFolder(), backupsDir = backupsFolder(), scanRunning = scannerJob(), pending, now = new Date(),
} = {}) {
  const { csv, problem } = readCsvNetwork(dir);
  if (!csv) return { moved: false, reason: problem ? `it can't be read: ${problem}` : 'there is no kept CSV import' };
  let parts;
  try {
    parts = csvNetworkParts(csv.connections);
  } catch (err) {
    return { moved: false, reason: err.message };
  }
  if (!parts.parts.connections.length) return { moved: false, reason: 'nobody in it has a profile link' };
  const waiting = pending === undefined ? pendingImport(dir) : pending;
  const refusal = networkImportPreflight({ scanRunning, pending: waiting });
  if (refusal) return { moved: false, reason: refusal.message };

  let stage;
  try {
    // The profile that is "you", made on an install that only ever opened a CSV (lib/profile.js).
    const me = resolveProfile();
    stage = stageNetwork(dir, parts.parts, { producer: CSV_PRODUCER, leftOut: parts.leftOut, now });
    const done = await applyNetworkImport(db, stage.model, {
      userId: me.id, dataDir: dir, backupsDir, scanRunning, pending: waiting, now, alwaysBackUp: true,
    });
    let removed = true;
    try { removeCsvNetwork(dir); } catch { removed = false; }
    return {
      moved: true,
      people: parts.parts.connections.length,
      counts: done.counts,
      backup: done.backup ? done.backup.name : null,
      leftOut: parts.leftOut,
      repeated: parts.repeated,
      removed,
    };
  } catch (err) {
    return { moved: false, reason: err.message };
  } finally {
    if (stage) dropStage(dir, stage.id);
  }
}
