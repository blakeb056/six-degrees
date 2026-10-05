// A LinkedIn Connections.csv import, kept in the data folder (csv-network.json)
// so it is still there after the window closes and after the app restarts.
//
// Kept beside the database, never merged into it. The 1.0 list (2026-10-03)
// chose this over adding the rows to linkedin_connections as 1st degree:
// merging means matching CSV people to rows the scanner wrote by profile link,
// under a profile the CSV knows nothing about, and that is how people were
// duplicated, hidden and deleted before (TRAPS §19, §25, §36). Here the map
// reads the file instead of the database while it's open, as it always did
// from the window, and deleting the file is the whole of removing it.
//
// Only what the export says about each person is kept, packed as lib/csv.js
// packConnections makes it: id, name, position, company, profile link and the
// date you connected. Scores and tiers are worked out again on every load, so
// they follow the scoring model. The Email Address column is never read, so it
// can't be here.
//
// The file is read as untrusted: an import from another computer brings one
// (lib/data-folder.js NETWORK_FILES), and a hand edit or a bad disk can change
// it. A file that doesn't hold what this writes is never shown as a network;
// the page says it couldn't be read instead (TRAPS §7).

import { readFileSync, lstatSync, rmSync } from 'node:fs';
import path from 'node:path';
import { durable } from './durable.js';
import { CSV_NETWORK_FILE } from './data-folder.js';

export { CSV_NETWORK_FILE };

/** Bump when the file's layout changes in a way this version couldn't read. */
export const CSV_FORMAT = 1;

/** Each packed row, in order (lib/csv.js packConnections). */
export const CSV_COLUMNS = ['id', 'name', 'role', 'company', 'profile_url', 'connected_date'];

/**
 * LinkedIn allows 30,000 connections. This leaves room, and still bounds what
 * one request can make the app keep.
 */
export const MAX_CSV_PEOPLE = 50000;
const MAX_FIELD = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A refusal whose message is fit to show inside a sentence. Nothing was written. */
export class CsvStoreError extends Error {}

const text = (v, { empty = true } = {}) => typeof v === 'string' && v.length <= MAX_FIELD && (empty || v.trim() !== '');

/** Why `rows` aren't a packed import this app would make, or null when they are. */
export function csvRowsProblem(rows) {
  if (!Array.isArray(rows)) return 'it has no list of people';
  if (!rows.length) return 'it has nobody in it';
  if (rows.length > MAX_CSV_PEOPLE) return `it has ${rows.length.toLocaleString('en-US')} people, more than the ${MAX_CSV_PEOPLE.toLocaleString('en-US')} it can hold`;
  const ids = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const which = `person ${i + 1}`;
    if (!Array.isArray(r) || r.length !== CSV_COLUMNS.length) return `${which} isn't laid out the way the import keeps people`;
    const [id, name, role, company, profileUrl, connected] = r;
    if (!text(id, { empty: false }) || !text(name, { empty: false })) return `${which} has a name or id that is missing or too long`;
    if (!text(role) || !text(company)) return `${which} has a position or company that isn't text, or is too long`;
    if (profileUrl !== null && !text(profileUrl)) return `${which} has a profile link that isn't text, or is too long`;
    if (connected !== null && !(typeof connected === 'string' && ISO_DATE.test(connected))) return `${which} has a date that isn't one`;
    if (ids.has(id)) return `two people share the id ${JSON.stringify(id.slice(0, 40))}`;
    ids.add(id);
  }
  return null;
}

/** Why `doc` isn't a kept import this app wrote, or null when it is. */
export function csvNetworkProblem(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return "it isn't what Sixgree writes";
  if (doc.format !== CSV_FORMAT) {
    return Number.isInteger(doc.format) && doc.format > CSV_FORMAT
      ? 'it was written by a newer Sixgree than this one'
      : "it isn't what Sixgree writes";
  }
  if (typeof doc.importedAt !== 'string' || Number.isNaN(Date.parse(doc.importedAt))) return "it doesn't say when it was imported";
  return csvRowsProblem(doc.connections);
}

/**
 * The kept import in `dir`: `{ csv: { connections, importedAt, people }, problem: null }`,
 * `{ csv: null, problem: null }` when there is none, or `{ csv: null, problem }`
 * when a file is there but can't be used. Never throws.
 */
export function readCsvNetwork(dir) {
  const file = path.join(dir, CSV_NETWORK_FILE);
  let st;
  try {
    st = lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return { csv: null, problem: null };
    return { csv: null, problem: `it couldn't be opened (${err.code || err.message})` };
  }
  // A link is never followed, as nowhere else in the data folder is.
  if (!st.isFile()) return { csv: null, problem: "it isn't a plain file" };
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { csv: null, problem: err instanceof SyntaxError ? "it isn't readable JSON" : `it couldn't be read (${err.code || err.message})` };
  }
  const problem = csvNetworkProblem(doc);
  if (problem) return { csv: null, problem };
  return { csv: { connections: doc.connections, importedAt: doc.importedAt, people: doc.connections.length }, problem: null };
}

/**
 * Keep `connections` (packed rows) as the import, in place of any kept before.
 * Written whole or not at all, and on the disk before this returns
 * (lib/durable.js): a temporary file, synced, then renamed over the old one.
 * @throws {CsvStoreError} when the rows aren't an import this app would make.
 */
export function writeCsvNetwork(dir, connections, { now = new Date() } = {}) {
  const problem = csvRowsProblem(connections);
  if (problem) throw new CsvStoreError(problem);
  const doc = { format: CSV_FORMAT, source: 'csv', importedAt: now.toISOString(), columns: CSV_COLUMNS, connections };
  durable.writeFileDurably(path.join(dir, CSV_NETWORK_FILE), JSON.stringify(doc));
  return { people: connections.length, importedAt: doc.importedAt };
}

/** Remove the kept import. Returns whether there was one. */
export function removeCsvNetwork(dir) {
  const file = path.join(dir, CSV_NETWORK_FILE);
  let had = true;
  try { lstatSync(file); } catch { had = false; }
  rmSync(file, { force: true });
  if (had) durable.syncFolder(dir);
  return had;
}
