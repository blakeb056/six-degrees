// Plugins: packages that add to Sixgree, installed into the data folder.
//
// A package is a .sgplugin file, a zip holding manifest.json and the plugin's
// files (docs/PLUGINS.md is the format). Installed, it is a folder of its own,
// <data folder>/plugins/<id>/, holding exactly what the package held. Nothing
// else of Sixgree's is ever written by an install, and an uninstall removes
// that folder and nothing more: whatever the plugin brought into your network
// stays.
//
// Settings → Plugins drives all of it (app/api/plugins). Enable plugins is a
// switch, off by default (lib/settings.js GATED_SETTINGS): off, plugins are
// listed but never used. The first kind is the scanner, which scans run from
// an installed scanner plugin when there is one (lib/scanner-files.js
// findScanner).
//
// The rules, each kept because a package comes from outside:
//   - Nothing installs without a yes: the install must name the package's
//     checksum, which only its check answers (lib/plugins-client.js
//     CONFIRM_HEADER), so what was agreed to is what goes in.
//   - The zip is read by lib/zip-read.js, which refuses anything that could
//     write outside the plugin's folder or fill the disk.
//   - Every file must be listed in the manifest with its SHA-256, and a file the
//     manifest doesn't list is refused.
//   - A plugin made for other versions of Sixgree is refused, and one already
//     installed that a new Sixgree no longer fits is kept but switched off.
//   - Unpacked into a private working folder first, read back from the disk
//     through the same checks an installed plugin gets, and only then moved
//     into plugins/. A reinstall moves the old copy aside and back again if
//     the new one can't be put in place, so it never ends half one, half the other.
//   - Every installed plugin is checked again whenever it is listed or about to
//     be used: a file changed or gone since makes it broken, never thrown, and
//     never run.

import { createHash } from 'node:crypto';
import {
  lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { readZip, ZipError, zipPathProblem, collisionKey, ZIP_LIMITS } from './zip-read.js';
import { PLUGIN_WORK_PREFIX, sweepLeftovers } from './data-folder.js';
import { compareVersions } from './release.js';
import { APP_VERSION } from './app-version.js';
import { MAX_PLUGIN_BYTES } from './plugins-client.js';

export const PLUGIN_FORMAT = 'sixgree.plugin';
export const PLUGIN_FORMAT_VERSION = 1;
export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const PLUGIN_KINDS = Object.freeze(['scanner']);
// What a plugin turns on in the app: "auto" and "manual", for the two scanner
// plugins. What each one unlocks, and what the app shows and refuses without
// it, is lib/scanner-capabilities.js.
export const PLUGIN_UNLOCKS = Object.freeze(['auto', 'manual']);
export const MANIFEST_FILE = 'manifest.json';
export const PLUGINS_DIR = 'plugins';
// A scanner plugin's folder of scanner files, and the two the app itself uses:
// the program a scan runs, and the packages Install puts in the scanner's
// Python (lib/scanner-files.js findScanner). The rest are the scanner's own
// business (today's imports image_store.py from beside it).
export const SCANNER_FOLDER = 'scanner';
export const SCANNER_PLUGIN_FILES = Object.freeze(['scanner/scrape.py', 'scanner/requirements.txt']);

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_FILES = 200;
const SHA256 = /^[0-9a-f]{64}$/;
// A plugin's version (and a plugin list entry's, lib/plugin-catalog.js).
export const PLUGIN_VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/;
// Control characters, and the ones that turn text around on screen so a
// name could read as something else. The plugin list's text is held to it too.
export const UNSAFE_TEXT = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;

/** A package or a plugin that can't be accepted; its message is plain and shown as is. */
export class PluginError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.status = status;
  }
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** <data folder>/plugins: where installed plugins live, one folder each. */
export function pluginsFolder(dataDir) {
  return path.join(dataDir, PLUGINS_DIR);
}

// --- Which Sixgree a plugin is for ------------------------------------------

const COMPARATOR = /^(>=|<=|>|<|=)?v?(\d{1,6}\.\d{1,6}\.\d{1,6})$/;
const RANGE_WORDS = {
  '>=': (v) => `${v} or newer`,
  '>': (v) => `newer than ${v}`,
  '<=': (v) => `${v} or older`,
  '<': (v) => `older than ${v}`,
  '=': (v) => v,
};

/**
 * A manifest's `sixgree` range (">=1.2.8", ">=2.0.0 <3.0.0"): up to four
 * comparisons, all of which must hold, or null when it isn't one.
 */
export function parseRange(range) {
  if (typeof range !== 'string' || range.length > 100 || !range.trim()) return null;
  const parts = range.trim().split(/\s+/);
  if (parts.length > 4) return null;
  const out = [];
  for (const part of parts) {
    const m = COMPARATOR.exec(part);
    if (!m) return null;
    out.push({ op: m[1] || '=', version: m[2] });
  }
  return out;
}

/** Does `version` fall in the parsed range? (lib/release.js compareVersions: a pre-release tag is ignored.) */
export function rangeAllows(comparisons, version) {
  return comparisons.every(({ op, version: v }) => {
    const c = compareVersions(version, v);
    if (op === '>=') return c >= 0;
    if (op === '>') return c > 0;
    if (op === '<=') return c <= 0;
    if (op === '<') return c < 0;
    return c === 0;
  });
}

/** Why a plugin doesn't fit this copy of Sixgree, in words, or null when it does. */
export function fitProblem(manifest, appVersion = APP_VERSION) {
  const range = parseRange(manifest.sixgree);
  if (rangeAllows(range, appVersion)) return null;
  const words = range.map(({ op, version }) => RANGE_WORDS[op](version)).join(' and ');
  return `It is made for Sixgree ${words}, and this copy is ${appVersion}.`;
}

// --- The manifest -------------------------------------------------------------

function text(raw, field, { max, optional = false }) {
  const value = raw[field];
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (optional) return null;
    throw new PluginError(`Its manifest has no ${field}.`);
  }
  if (typeof value !== 'string') throw new PluginError(`Its manifest’s ${field} isn’t text.`);
  const out = value.trim();
  if (out.length > max) throw new PluginError(`Its manifest’s ${field} is longer than ${max} characters.`);
  if (UNSAFE_TEXT.test(out)) throw new PluginError(`Its manifest’s ${field} has characters in it that aren’t plain text.`);
  return out;
}

/**
 * Check a manifest (parsed JSON) against format 1 (docs/PLUGINS.md).
 * @returns the manifest, cleaned and frozen: format, format_version, id, name,
 *          version, sixgree, about, risk (or null), kind, unlocks, files.
 * @throws PluginError saying what's wrong. Which Sixgree it fits is
 *         fitProblem's question, not this one's.
 */
export function checkManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PluginError('Its manifest isn’t a JSON object.');
  if (raw.format !== PLUGIN_FORMAT) {
    throw new PluginError(`It isn’t a Sixgree plugin: its manifest doesn’t say "format": "${PLUGIN_FORMAT}".`);
  }
  if (raw.format_version !== PLUGIN_FORMAT_VERSION) {
    if (Number.isInteger(raw.format_version) && raw.format_version > PLUGIN_FORMAT_VERSION) {
      throw new PluginError(`It is made for a newer Sixgree (plugin format ${raw.format_version}). Update Sixgree, then install it.`, { status: 409 });
    }
    throw new PluginError('Its manifest’s format_version isn’t one Sixgree knows.');
  }
  if (typeof raw.id !== 'string' || !PLUGIN_ID.test(raw.id)) {
    throw new PluginError('Its id isn’t one Sixgree accepts: 2 to 41 lowercase letters, digits and dashes, starting with a letter or digit.');
  }
  const name = text(raw, 'name', { max: 60 });
  if (typeof raw.version !== 'string' || !PLUGIN_VERSION.test(raw.version)) {
    throw new PluginError('Its version isn’t a version number like 1.0.0.');
  }
  if (!parseRange(raw.sixgree)) {
    throw new PluginError('Its manifest doesn’t say which Sixgree it is for in a way Sixgree reads (like ">=1.2.8").');
  }
  const about = text(raw, 'about', { max: 400 });
  const risk = text(raw, 'risk', { max: 1000, optional: true });
  if (!PLUGIN_KINDS.includes(raw.kind)) {
    throw new PluginError(`It is a kind of plugin this Sixgree doesn’t know (${JSON.stringify(String(raw.kind ?? ''))}).`);
  }
  const unlocks = raw.unlocks;
  if (!Array.isArray(unlocks) || !unlocks.length || unlocks.some((u) => !PLUGIN_UNLOCKS.includes(u)) || new Set(unlocks).size !== unlocks.length) {
    throw new PluginError(`Its manifest’s unlocks must list ${PLUGIN_UNLOCKS.map((u) => `"${u}"`).join(' or ')}, or both.`);
  }

  const files = raw.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new PluginError('Its manifest has no list of files.');
  const names = Object.keys(files);
  if (!names.length || names.length > MAX_FILES) throw new PluginError(`Its manifest must list 1 to ${MAX_FILES} files.`);
  const keys = new Set();
  for (const name of names) {
    const problem = zipPathProblem(name);
    if (problem) throw new PluginError(`Its manifest lists ${problem}.`);
    if (collisionKey(name) === MANIFEST_FILE) throw new PluginError('Its manifest lists manifest.json, which is the manifest itself.');
    if (keys.has(collisionKey(name))) throw new PluginError(`Its manifest lists ${name} twice.`);
    keys.add(collisionKey(name));
    if (typeof files[name] !== 'string' || !SHA256.test(files[name])) {
      throw new PluginError(`Its manifest’s checksum for ${name} isn’t a SHA-256 (64 lowercase hex digits).`);
    }
  }
  // A path listed as a file and as a folder of another (a file "a" and a file "a/b").
  for (const name of names) {
    const parts = name.split('/');
    for (let n = 1; n < parts.length; n++) {
      if (keys.has(collisionKey(parts.slice(0, n).join('/')))) {
        throw new PluginError(`Its manifest lists ${parts.slice(0, n).join('/')} as a file and as a folder.`);
      }
    }
  }
  if (raw.kind === 'scanner') {
    const missing = SCANNER_PLUGIN_FILES.filter((f) => !Object.hasOwn(files, f));
    if (missing.length) throw new PluginError(`It is a scanner, but its manifest doesn’t list ${missing.join(' and ')}.`);
  }
  return Object.freeze({
    format: PLUGIN_FORMAT, format_version: PLUGIN_FORMAT_VERSION, id: raw.id, name, version: raw.version,
    sixgree: raw.sixgree.trim(), about, risk, kind: raw.kind, unlocks: Object.freeze([...unlocks]),
    files: Object.freeze(Object.fromEntries(names.map((n) => [n, files[n]]))),
  });
}

function parseManifest(bytes) {
  if (bytes.length > MAX_MANIFEST_BYTES) throw new PluginError('Its manifest.json is larger than a manifest ever needs to be.');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PluginError('Its manifest.json isn’t valid JSON.');
  }
}

/** What the Settings page shows of a plugin. */
export function pluginSummary(manifest) {
  return {
    id: manifest.id, name: manifest.name, version: manifest.version, about: manifest.about,
    risk: manifest.risk, kind: manifest.kind, unlocks: [...manifest.unlocks],
  };
}

// --- A package ----------------------------------------------------------------

/**
 * Read and check a package held in memory, all the way through, writing nothing.
 * @returns {{ manifest, manifestBytes: Buffer, files: Map<string, Buffer>, sha256: string }}
 * @throws PluginError: 400 for a package that isn't a sound one, 409 for one
 *         made for other versions of Sixgree, 413 for one that's too large.
 */
export function readPackage(buf, { appVersion = APP_VERSION } = {}) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new PluginError('There is no package to read.');
  if (buf.length > MAX_PLUGIN_BYTES) {
    throw new PluginError(`It is larger than a plugin package may be (${MAX_PLUGIN_BYTES / 1048576} MB).`, { status: 413 });
  }
  let entries;
  try {
    entries = readZip(buf);
  } catch (err) {
    if (err instanceof ZipError) throw new PluginError(`It can’t be opened safely as a plugin package. ${err.message}`);
    throw err;
  }
  const top = entries.find((e) => !e.dir && e.name === MANIFEST_FILE);
  if (!top) throw new PluginError('It has no manifest.json at its top, so it isn’t a Sixgree plugin package.');
  const manifest = checkManifest(parseManifest(top.data));
  const fit = fitProblem(manifest, appVersion);
  if (fit) throw new PluginError(fit, { status: 409 });

  // The folders the listed files are in: the only folders a package may name.
  const folders = new Set();
  for (const name of Object.keys(manifest.files)) {
    const parts = name.split('/');
    for (let n = 1; n < parts.length; n++) folders.add(parts.slice(0, n).join('/'));
  }
  const files = new Map();
  for (const entry of entries) {
    if (entry === top) continue;
    if (entry.dir) {
      if (!folders.has(entry.name)) throw new PluginError(`It holds a folder its manifest doesn’t list: ${entry.name}/.`);
      continue;
    }
    if (!Object.hasOwn(manifest.files, entry.name)) throw new PluginError(`It holds a file its manifest doesn’t list: ${entry.name}.`);
    if (sha256(entry.data) !== manifest.files[entry.name]) {
      throw new PluginError(`${entry.name} doesn’t match its checksum in the manifest, so it was changed after the package was made.`);
    }
    files.set(entry.name, entry.data);
  }
  for (const name of Object.keys(manifest.files)) {
    if (!files.has(name)) throw new PluginError(`Its manifest lists ${name}, but the package doesn’t hold it.`);
  }
  return { manifest, manifestBytes: top.data, files, sha256: sha256(buf) };
}

// --- Installed plugins --------------------------------------------------------

/** `name` (a checked relative path) inside `folder`, refused if it would land anywhere else. */
function inside(folder, name) {
  const base = path.resolve(folder);
  const to = path.resolve(base, ...name.split('/'));
  if (!to.startsWith(base + path.sep)) throw new PluginError(`${name} would land outside the plugin’s folder.`);
  return to;
}

/**
 * Read `name` in `folder` from the disk: each part of the way a real folder,
 * and the file itself a plain one. A link anywhere along it is refused, so
 * nothing outside the plugin's folder is ever read as part of it.
 */
function readPlainFile(folder, name, max) {
  const parts = name.split('/');
  let at = path.resolve(folder);
  for (let i = 0; i < parts.length; i++) {
    at = path.join(at, parts[i]);
    let s;
    try { s = lstatSync(at); } catch { throw new PluginError(`${name} is missing.`); }
    const last = i === parts.length - 1;
    if (last ? !s.isFile() : !s.isDirectory()) throw new PluginError(`${name} isn’t a plain ${last ? 'file' : 'folder'}.`);
    if (last && s.size > max) throw new PluginError(`${name} is larger than a plugin’s file may be.`);
  }
  return readFileSync(at);
}

function isRealFolder(p) {
  try { return lstatSync(p).isDirectory(); } catch { return false; }
}

/**
 * An installed plugin's folder, checked through as it is on the disk now: its
 * manifest, and every file it lists, by checksum.
 * @returns {{ id, name, version, about, risk, kind, unlocks, state, problem }}
 *          `state` is 'ready', 'unsupported' (it doesn't fit this version of
 *          Sixgree, so it is switched off) or 'broken'; `problem` says why
 *          when it isn't ready. Never throws.
 */
export function inspectPlugin(folder, { appVersion = APP_VERSION, id = path.basename(folder) } = {}) {
  const out = { id, name: id, version: null, about: null, risk: null, kind: null, unlocks: [], state: 'broken', problem: null };
  try {
    if (!isRealFolder(folder)) throw new PluginError('It isn’t a folder.');
    const manifest = checkManifest(parseManifest(readPlainFile(folder, MANIFEST_FILE, MAX_MANIFEST_BYTES)));
    Object.assign(out, pluginSummary(manifest), { id });
    if (manifest.id !== id) throw new PluginError(`Its folder is ${id}, but its manifest says it is ${manifest.id}.`);
    for (const [name, sum] of Object.entries(manifest.files)) {
      if (sha256(readPlainFile(folder, name, ZIP_LIMITS.maxTotalBytes)) !== sum) {
        throw new PluginError(`${name} has changed since it was installed.`);
      }
    }
    const fit = fitProblem(manifest, appVersion);
    if (fit) return { ...out, state: 'unsupported', problem: `${fit} It stays installed, switched off.` };
    return { ...out, state: 'ready' };
  } catch (err) {
    return { ...out, state: 'broken', problem: err instanceof PluginError ? err.message : `It couldn’t be read (${err.message}).` };
  }
}

/** The installed plugin `id`, checked through (inspectPlugin), or null when there is none. */
export function installedPlugin(dataDir, id, { appVersion = APP_VERSION } = {}) {
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) return null;
  const folder = path.join(pluginsFolder(dataDir), id);
  try { lstatSync(folder); } catch { return null; }
  return inspectPlugin(folder, { appVersion, id });
}

/**
 * Every installed plugin, each checked through (inspectPlugin), by name. Only
 * folders named as a plugin's id are plugins; anything else in plugins/ (a
 * file the system left there) is not one, and is left alone.
 */
export function listPlugins(dataDir, { appVersion = APP_VERSION } = {}) {
  const home = pluginsFolder(dataDir);
  let names = [];
  try { names = readdirSync(home); } catch { return []; }
  return names.filter((n) => PLUGIN_ID.test(n))
    .map((n) => inspectPlugin(path.join(home, n), { appVersion, id: n }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The scanner plugin scans would use: the newest version among the installed
 * scanner plugins that are ready (auto-scan and manual-scan share the same
 * scanner code; on a tie, the first by id). `skipped` says why any other
 * scanner plugin installed can't be used.
 * @returns {{ plugin: object|null, dir: string|null, skipped: string[] }}
 */
export function scannerPlugin(dataDir, { appVersion = APP_VERSION } = {}) {
  const all = listPlugins(dataDir, { appVersion });
  const usable = all.filter((p) => p.kind === 'scanner' && p.state === 'ready')
    .sort((a, b) => compareVersions(b.version, a.version) || a.id.localeCompare(b.id));
  const skipped = all.filter((p) => p.state !== 'ready' && (p.kind === 'scanner' || p.kind === null))
    .map((p) => `${p.name}${p.version ? ` ${p.version}` : ''} can’t be used: ${p.problem}`);
  const plugin = usable[0] || null;
  return { plugin, dir: plugin ? path.join(pluginsFolder(dataDir), plugin.id) : null, skipped };
}

/** Write a checked package's files into `folder`, which must not exist yet. */
function unpackInto(folder, { manifestBytes, files }) {
  mkdirSync(folder, { mode: 0o755 });
  // 'wx': never through anything already there.
  writeFileSync(path.join(folder, MANIFEST_FILE), manifestBytes, { flag: 'wx', mode: 0o644 });
  for (const [name, data] of files) {
    const to = inside(folder, name);
    mkdirSync(path.dirname(to), { recursive: true, mode: 0o755 });
    writeFileSync(to, data, { flag: 'wx', mode: 0o644 });
  }
}

/**
 * Install the package in `buf` into <dataDir>/plugins/<id>/, replacing any
 * version already there. `sha256` is the yes: the package's checksum as its
 * check (readPackage) answered it, and nothing installs without it.
 * `rename` is for the tests, to fail the move into place.
 * @returns {{ installed: object, replaced: { version, state } | null }}
 * @throws PluginError; whatever was installed before is then exactly as it was.
 */
export function installPlugin(dataDir, buf, { appVersion = APP_VERSION, sha256: confirmed = null, rename = renameSync } = {}) {
  const pkg = readPackage(buf, { appVersion });
  if (confirmed !== pkg.sha256) {
    throw new PluginError(confirmed
      ? 'This isn’t the package you said yes to, so nothing was installed. Choose it again.'
      : 'Nothing is installed without a yes. Check the package first, then confirm it.', { status: 409 });
  }
  const { manifest } = pkg;
  const home = pluginsFolder(dataDir);
  mkdirSync(home, { recursive: true });
  try { sweepLeftovers(dataDir); } catch { /* swept at the next start */ }
  // A private working folder beside plugins/, on the same disk, so the moves
  // below are renames: each one all or nothing.
  const work = mkdtempSync(path.join(dataDir, PLUGIN_WORK_PREFIX));
  try {
    const staged = path.join(work, manifest.id);
    unpackInto(staged, pkg);
    // What is on the disk now, read back through the same checks as any installed plugin.
    const check = inspectPlugin(staged, { appVersion, id: manifest.id });
    if (check.state !== 'ready') {
      throw new PluginError(`It didn’t unpack as it should (${check.problem}), so nothing was installed.`, { status: 500 });
    }
    const target = path.join(home, manifest.id);
    const before = installedPlugin(dataDir, manifest.id, { appVersion });
    const previous = path.join(work, 'previous');
    if (before) {
      try {
        rename(target, previous);
      } catch (err) {
        throw new PluginError(`It couldn’t be put in place (${err.message}). The version installed before is kept as it was.`, { status: 500 });
      }
    }
    try {
      rename(staged, target);
    } catch (err) {
      let restored = !before;
      if (before) {
        try { rename(previous, target); restored = true; } catch { /* said below */ }
      }
      throw new PluginError(`It couldn’t be put in place (${err.message}). ${
        !before ? 'Nothing was installed.'
          : restored ? 'The version installed before is kept as it was.'
          : 'The version installed before couldn’t be put back either. Install it again.'}`, { status: 500 });
    }
    return { installed: pluginSummary(manifest), replaced: before ? { version: before.version, state: before.state } : null };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Remove the installed plugin `id`: its folder, and nothing else. What it
 * brought into the network stays.
 * @returns {{ removed: { id, name, version } }}
 * @throws PluginError: 400 for a name that can't be a plugin's, 404 for one not installed.
 */
export function uninstallPlugin(dataDir, id, { appVersion = APP_VERSION } = {}) {
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) throw new PluginError('That isn’t the id of a plugin.');
  const target = path.join(pluginsFolder(dataDir), id);
  try { lstatSync(target); } catch { throw new PluginError(`No plugin called ${id} is installed.`, { status: 404 }); }
  const was = inspectPlugin(target, { appVersion, id });
  try { sweepLeftovers(dataDir); } catch { /* swept at the next start */ }
  // Moved out of plugins/ whole first, so it is never seen half removed, then deleted.
  const work = mkdtempSync(path.join(dataDir, PLUGIN_WORK_PREFIX));
  try {
    renameSync(target, path.join(work, id));
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    throw new PluginError(`It couldn’t be removed (${err.message}).`, { status: 500 });
  }
  rmSync(work, { recursive: true, force: true });
  return { removed: { id, name: was.name, version: was.version } };
}
