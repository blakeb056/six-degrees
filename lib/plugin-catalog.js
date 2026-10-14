// The plugin list: what Settings → Plugins → Browse and the guided setup's
// Allow plugins box show, and the downloads behind their Install buttons.
//
// The list is one JSON file (docs/PLUGINS.md, "The plugin list"), the official
// one at OFFICIAL_CATALOG_URL. Every entry in it is checked here, and nothing
// in it can make this throw: an entry Sixgree can't trust (a bad id, a link
// that isn't https, no checksum) is left out with why, and one of a kind this
// Sixgree doesn't know, or made for another version of it, is shown as not for
// this version, with why, and never offered.
//
// The network rule, the app's own: Sixgree never goes online by itself.
//   - The list is fetched only when someone opens Settings → Plugins with
//     plugins on, presses Try again, or ticks Allow plugins in the guided
//     setup (app/api/plugins/catalog, a POST so no other website can start it).
//   - A package is downloaded only when Install is pressed
//     (app/api/plugins/download), and only from the address the list gave.
//   - Both from the server: https only, within a time limit and a size cap,
//     sending no cookies and nothing about this computer beyond a User-Agent
//     that names Sixgree's version. Every redirect is checked the same way,
//     so an https link can't hand the download to a plain http one.
//
// A downloaded package is installed only through lib/plugins.js, with the same
// checks and the same yes as a package from a file. From the list, it must
// first match the list's own size and SHA-256, and be the plugin and version
// the list names. From a link there is no list to match, so the package's own
// manifest checksums are the only check, and the page says so.

import { createHash } from 'node:crypto';
import { APP_VERSION } from './app-version.js';
import {
  PLUGIN_ID, PLUGIN_KINDS, PLUGIN_UNLOCKS, PLUGIN_VERSION, UNSAFE_TEXT, PluginError, parseRange, fitProblem, readPackage,
} from './plugins.js';
import { MAX_PLUGIN_BYTES } from './plugins-client.js';

/** The official plugin list. Its repository may not exist yet: a 404 is said plainly, with Try again. */
export const OFFICIAL_CATALOG_URL = 'https://raw.githubusercontent.com/blakeb056/sixgree-plugins/main/catalog.json';
/** A test's own list in place of the official one (catalogSource). Nothing in the app sets it. */
export const CATALOG_ENV = 'SIX_DEGREES_PLUGIN_CATALOG';
export const CATALOG_FORMAT = 'sixgree.plugin-catalog';
export const CATALOG_FORMAT_VERSION = 1;
/** A list of a few dozen plugins is a few kilobytes; anything past this isn't one. */
export const MAX_CATALOG_BYTES = 256 * 1024;
export const MAX_CATALOG_ENTRIES = 200;
export const CATALOG_TIMEOUT_MS = 15_000;
/** A whole package, up to 8 MB, on a slow connection. */
export const PACKAGE_TIMEOUT_MS = 60_000;
/** Plain, and the only thing said about this computer: which Sixgree asks. */
export const USER_AGENT = `Sixgree/${APP_VERSION}`;

const MAX_REDIRECTS = 5;
const MAX_LINK = 2048;
const SHA256 = /^[0-9a-f]{64}$/;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// A kind or an unlock this Sixgree doesn't know is named back only when it is
// plain enough to show; anything else is just "one it doesn't know".
const PLAIN_WORD = /^[a-z0-9-]{1,40}$/;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function hostOf(url) {
  try { return new URL(url).host; } catch { return 'the address'; }
}

// --- Where the list comes from ------------------------------------------------

/**
 * The plugin list to fetch. The official one, unless a test points
 * SIX_DEGREES_PLUGIN_CATALOG at its own, as lib/updater.js releaseSource does
 * for a test release server: an https address, or plain http on 127.0.0.1
 * with a port (a test's server on this computer, and nowhere else). In that
 * test mode, the list's packages may be on http://127.0.0.1 too. Anything
 * else is ignored, the official list is used, and `ignored` says why. The page
 * says which list it shows whenever it isn't the official one.
 * @returns {{ url: string, test: boolean, ignored?: string }}
 */
export function catalogSource(env = process.env) {
  const official = { url: OFFICIAL_CATALOG_URL, test: false };
  const raw = env?.[CATALOG_ENV];
  if (raw === undefined || raw === null || raw === '') return official;
  let url = null;
  try { url = new URL(String(raw)); } catch { /* said below */ }
  let problem = null;
  if (!url) problem = 'it isn’t a web address';
  else if (url.username || url.password) problem = 'it carries a name or password';
  else if (url.hash) problem = 'it has a #fragment';
  else if (url.protocol === 'https:') problem = null;
  else if (!(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port)) {
    problem = 'only an https address, or http on 127.0.0.1 with a port, is used';
  }
  if (problem) return { ...official, ignored: `${CATALOG_ENV} is set but ignored: ${problem}.` };
  return { url: url.href, test: true };
}

/**
 * Why Sixgree won't download from `raw`, in a sentence, or null when it will:
 * https, with no name or password in it. Plain http only on 127.0.0.1, and
 * only in a test (catalogSource).
 */
export function linkProblem(raw, { test = false } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return 'There is no link.';
  if (raw.length > MAX_LINK) return `The link is longer than ${MAX_LINK.toLocaleString('en-US')} characters.`;
  let url;
  try { url = new URL(raw.trim()); } catch { return 'That isn’t a web address.'; }
  if (url.username || url.password) return 'The link has a name or password in it, which Sixgree never sends.';
  if (url.protocol === 'https:') return null;
  if (test && url.protocol === 'http:' && url.hostname === '127.0.0.1') return null;
  return 'The link isn’t https://, so what it downloads could be changed on the way.';
}

// --- The list's entries ---------------------------------------------------------

function plainText(raw, field, max, optional = false) {
  const value = raw[field];
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (optional) return { value: null };
    return { drop: `It has no ${field}.` };
  }
  if (typeof value !== 'string') return { drop: `Its ${field} isn’t text.` };
  const out = value.trim();
  if (out.length > max) return { drop: `Its ${field} is longer than ${max} characters.` };
  if (UNSAFE_TEXT.test(out)) return { drop: `Its ${field} has characters in it that aren’t plain text.` };
  return { value: out };
}

/**
 * One entry of the list. → { entry } to show, or { drop, id } to leave out
 * with why (`id` only when it is a sound one, so a hostile one is never shown).
 * A shown entry's `problem` says why it is not for this version, and then it
 * has no Install.
 */
function checkEntry(raw, { appVersion, test }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { drop: 'It isn’t an entry (a JSON object).', id: null };
  if (typeof raw.id !== 'string' || !PLUGIN_ID.test(raw.id)) {
    return { drop: 'Its id isn’t one Sixgree accepts: 2 to 41 lowercase letters, digits and dashes.', id: null };
  }
  const { id } = raw;
  const out = (drop) => ({ drop, id });
  const name = plainText(raw, 'name', 60);
  if (name.drop) return out(name.drop);
  if (typeof raw.version !== 'string' || !PLUGIN_VERSION.test(raw.version)) return out('Its version isn’t a version number like 1.0.0.');
  const about = plainText(raw, 'about', 400);
  if (about.drop) return out(about.drop);
  const risk = plainText(raw, 'risk', 1000, true);
  if (risk.drop) return out(risk.drop);
  const link = linkProblem(raw.url, { test });
  if (link) return out(link);
  if (typeof raw.sha256 !== 'string' || !SHA256.test(raw.sha256)) return out('Its sha256 isn’t a SHA-256 (64 lowercase hex digits), so its download couldn’t be checked.');
  if (!Number.isSafeInteger(raw.size) || raw.size <= 0) return out('Its size isn’t a number of bytes.');
  if (raw.size > MAX_PLUGIN_BYTES) return out(`It is larger than a plugin package may be (${MAX_PLUGIN_BYTES / 1048576} MB).`);
  const range = parseRange(raw.sixgree);
  if (!range) return out('It doesn’t say which Sixgree it is for in a way Sixgree reads (like ">=1.2.8").');

  // Sound enough to show. Whether it is for this Sixgree comes next: a kind or
  // an unlock it doesn't know (a later Sixgree's), or a range it isn't in.
  let problem = null;
  let kind = null;
  let unlocks = [];
  if (PLUGIN_KINDS.includes(raw.kind)) {
    kind = raw.kind;
    if (!Array.isArray(raw.unlocks) || !raw.unlocks.length || raw.unlocks.length > 10 || new Set(raw.unlocks).size !== raw.unlocks.length) {
      return out(`Its unlocks must list ${PLUGIN_UNLOCKS.map((u) => `"${u}"`).join(' or ')}, or both.`);
    }
    const unknown = raw.unlocks.find((u) => !PLUGIN_UNLOCKS.includes(u));
    if (unknown !== undefined) {
      problem = typeof unknown === 'string' && PLAIN_WORD.test(unknown)
        ? `It turns on something this Sixgree doesn’t have ("${unknown}").`
        : 'It turns on something this Sixgree doesn’t have.';
    }
    unlocks = raw.unlocks.filter((u) => PLUGIN_UNLOCKS.includes(u));
  } else {
    problem = typeof raw.kind === 'string' && PLAIN_WORD.test(raw.kind)
      ? `It is a kind of plugin this Sixgree doesn’t know ("${raw.kind}").`
      : 'It is a kind of plugin this Sixgree doesn’t know.';
  }
  if (!problem) problem = fitProblem({ sixgree: raw.sixgree }, appVersion);

  return {
    entry: {
      id, name: name.value, version: raw.version, about: about.value, risk: risk.value, kind, unlocks,
      sixgree: raw.sixgree.trim(), url: raw.url.trim(), sha256: raw.sha256, size: raw.size, problem,
    },
  };
}

/**
 * Check a plugin list (parsed JSON) against format 1. Never throws.
 * @returns {{ problem: string } | { problem: null, plugins: object[], dropped: { id: string|null, reason: string }[] }}
 *          `problem` when it isn't a list Sixgree reads at all; else every
 *          entry shown (each with its `problem` when not for this version),
 *          and every one left out, with why. An id listed twice is shown once.
 */
export function checkCatalog(raw, { appVersion = APP_VERSION, test = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'It isn’t a plugin list (a JSON object).' };
  if (raw.format !== CATALOG_FORMAT) return { problem: `It isn’t a Sixgree plugin list: it doesn’t say "format": "${CATALOG_FORMAT}".` };
  if (raw.format_version !== CATALOG_FORMAT_VERSION) {
    if (Number.isInteger(raw.format_version) && raw.format_version > CATALOG_FORMAT_VERSION) {
      return { problem: `It is made for a newer Sixgree (list format ${raw.format_version}). Update Sixgree to browse it.` };
    }
    return { problem: 'Its format_version isn’t one Sixgree knows.' };
  }
  if (!Array.isArray(raw.plugins)) return { problem: 'It has no list of plugins.' };

  const plugins = [];
  const dropped = [];
  const seen = new Set();
  for (const item of raw.plugins.slice(0, MAX_CATALOG_ENTRIES)) {
    let checked;
    try {
      checked = checkEntry(item, { appVersion, test });
    } catch {
      // Nothing above throws on any JSON; this keeps the promise if that changes.
      checked = { drop: 'It couldn’t be read.', id: null };
    }
    if (checked.drop) {
      dropped.push({ id: checked.id, reason: checked.drop });
    } else if (seen.has(checked.entry.id)) {
      dropped.push({ id: checked.entry.id, reason: 'It is listed more than once; the first is shown.' });
    } else {
      seen.add(checked.entry.id);
      plugins.push(checked.entry);
    }
  }
  if (raw.plugins.length > MAX_CATALOG_ENTRIES) {
    dropped.push({ id: null, reason: `The list holds ${raw.plugins.length} entries, and only the first ${MAX_CATALOG_ENTRIES} are read.` });
  }
  return { problem: null, plugins, dropped };
}

/** What the page is sent of an entry: no addresses or checksums, only where it comes from. */
export function entryView(entry) {
  return {
    id: entry.id, name: entry.name, version: entry.version, about: entry.about, risk: entry.risk,
    kind: entry.kind, unlocks: [...entry.unlocks], size: entry.size, host: hostOf(entry.url), problem: entry.problem,
  };
}

// --- Fetching -----------------------------------------------------------------

/** Something fetched couldn't be had or used; its message is plain and shown as is. */
export class FetchError extends Error {}

/**
 * GET `url` from the server, and nothing else: https only (linkProblem, for
 * every redirect too), at most `maxBytes` (refused as soon as it's past them,
 * or the moment its Content-Length says it will be), within `timeoutMs`, with
 * no cookies and only a User-Agent and Accept sent.
 * @returns {Promise<{ data: Buffer, url: string }>} `url` is where it finally came from.
 * @throws FetchError saying why, in words.
 */
export async function fetchCapped(url, {
  maxBytes, timeoutMs, test = false, fetchImpl = fetch, accept = '*/*', tooLarge = null,
}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const big = () => new FetchError(tooLarge || `It is larger than ${Math.round(maxBytes / 1024).toLocaleString('en-US')} KB, so it wasn’t read.`);
  let at = url;
  try {
    for (let hop = 0; ; hop++) {
      const problem = linkProblem(at, { test });
      if (problem) throw new FetchError(hop ? `It was sent on to an address Sixgree won’t use. ${problem}` : problem);
      // Redirects are followed here, one at a time, so each one is checked
      // as the first address was.
      const res = await fetchImpl(at, {
        method: 'GET',
        headers: { Accept: accept, 'User-Agent': USER_AGENT },
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal,
      });
      if (REDIRECTS.has(res.status)) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location) throw new FetchError(`${hostOf(at)} answered ${res.status} without saying where to.`);
        if (hop >= MAX_REDIRECTS) throw new FetchError(`It was sent on more than ${MAX_REDIRECTS} times, so Sixgree stopped.`);
        at = new URL(location, at).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new FetchError(`${hostOf(at)} answered ${res.status}${res.status === 404 ? ' (not found)' : ''}.`);
      }
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw big();
      }
      const chunks = [];
      let received = 0;
      if (res.body) {
        for await (const chunk of res.body) {
          received += chunk.byteLength;
          if (received > maxBytes) throw big(); // leaving the loop cancels the rest
          chunks.push(Buffer.from(chunk));
        }
      }
      return { data: Buffer.concat(chunks), url: at };
    }
  } catch (err) {
    if (signal.aborted) {
      throw new FetchError(`${hostOf(at)} didn’t answer in time (${Math.round(timeoutMs / 1000)} seconds). Check your connection and try again.`);
    }
    if (err instanceof FetchError) throw err;
    const why = err?.cause?.code || err?.cause?.message || err?.message || 'no answer';
    throw new FetchError(`${hostOf(at)} couldn’t be reached (${why}).`);
  }
}

// --- The list -----------------------------------------------------------------

/** The list couldn't be had or read: the page says CATALOG_UNLOADED, this as why, and offers Try again. */
export class CatalogError extends Error {}

// The last list loaded, by the address it came from, so Install can download
// exactly what that list named without asking for the list again. On
// globalThis, as lib/scan-state.js keeps its state, so every route sees the
// same one however the bundler splits them.
const LISTED = Symbol.for('six-degrees.plugin-catalog');

/** What the page is told about the list it shows: said out loud whenever it isn't the official one. */
export function sourceView(source) {
  return { host: hostOf(source.url), test: source.test, url: source.test ? source.url : null, ignored: source.ignored || null };
}

/**
 * Fetch the plugin list (catalogSource), check it (checkCatalog), and keep it
 * for Install (listedEntry). Only ever called on a person's click or tick.
 * @returns {Promise<{ source, plugins: object[], dropped: object[] }>} plugins as entryView.
 * @throws CatalogError saying why it couldn't be had or read.
 */
export async function loadCatalog({
  env = process.env, appVersion = APP_VERSION, fetchImpl = fetch, timeoutMs = CATALOG_TIMEOUT_MS,
} = {}) {
  const source = catalogSource(env);
  let data;
  try {
    ({ data } = await fetchCapped(source.url, {
      maxBytes: MAX_CATALOG_BYTES, timeoutMs, test: source.test, fetchImpl, accept: 'application/json',
      tooLarge: `It is larger than a plugin list may be (${MAX_CATALOG_BYTES / 1024} KB), so it wasn’t read.`,
    }));
  } catch (err) {
    throw new CatalogError(err.message);
  }
  let raw;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    throw new CatalogError('It isn’t valid JSON.');
  }
  const checked = checkCatalog(raw, { appVersion, test: source.test });
  if (checked.problem) throw new CatalogError(checked.problem);
  globalThis[LISTED] = { url: source.url, entries: new Map(checked.plugins.map((e) => [e.id, e])) };
  return { source: sourceView(source), plugins: checked.plugins.map(entryView), dropped: checked.dropped };
}

/** The entry `id` in the last list loaded from where the list comes from now, or null. */
export function listedEntry(id, env = process.env) {
  const listed = globalThis[LISTED];
  if (!listed || listed.url !== catalogSource(env).url) return null;
  return listed.entries.get(id) || null;
}

/** Forget the list loaded (for the tests). */
export function forgetCatalog() {
  delete globalThis[LISTED];
}

// --- Downloading a package ------------------------------------------------------

/**
 * Download a package and check it all the way through, writing nothing.
 * `listed` is the plugin list's entry it is from, or null for a link. From
 * the list, it must be the list's exact size and SHA-256, and the plugin and
 * version the list names; then lib/plugins.js readPackage checks it as it
 * checks a package from a file.
 * @returns {Promise<{ buf: Buffer, pkg: object, host: string }>} pkg as readPackage answers.
 * @throws PluginError: 502 when it couldn't be downloaded or isn't what the
 *         list says, else readPackage's own.
 */
export async function downloadPackage(url, {
  listed = null, test = false, appVersion = APP_VERSION, fetchImpl = fetch, timeoutMs = PACKAGE_TIMEOUT_MS,
} = {}) {
  let got;
  try {
    got = await fetchCapped(url, {
      maxBytes: listed ? listed.size : MAX_PLUGIN_BYTES, timeoutMs, test, fetchImpl, accept: 'application/octet-stream',
      tooLarge: listed
        ? 'The download is bigger than the plugin list says it is, so it was stopped. Nothing was installed.'
        : `It is larger than a plugin package may be (${MAX_PLUGIN_BYTES / 1048576} MB), so it was stopped.`,
    });
  } catch (err) {
    throw new PluginError(`It couldn’t be downloaded. ${err.message}`, { status: 502 });
  }
  const buf = got.data;
  if (listed) {
    if (buf.length !== listed.size) {
      throw new PluginError('The download isn’t the size the plugin list gives, so it wasn’t used. Nothing was installed.', { status: 502 });
    }
    if (sha256(buf) !== listed.sha256) {
      throw new PluginError('The download doesn’t match the checksum the plugin list gives, so it wasn’t used. Nothing was installed.', { status: 502 });
    }
  }
  const pkg = readPackage(buf, { appVersion });
  if (listed && (pkg.manifest.id !== listed.id || pkg.manifest.version !== listed.version)) {
    throw new PluginError(`The package is ${pkg.manifest.id} ${pkg.manifest.version}, not the ${listed.id} ${listed.version} the plugin list names, so it wasn’t used.`, { status: 502 });
  }
  return { buf, pkg, host: hostOf(got.url) };
}

// A package downloaded and checked, waiting for its yes: kept in memory by its
// SHA-256, so what installs is exactly what was checked and shown, never a
// second download. A few at most, for a quarter of an hour; a restart forgets
// them, and Install then asks to press Install again.
const HELD = Symbol.for('six-degrees.plugin-downloads');
export const HOLD_MS = 15 * 60 * 1000;
const MAX_HELD = 4;

function held(now) {
  const map = (globalThis[HELD] ||= new Map());
  for (const [key, item] of map) if (now - item.at > HOLD_MS) map.delete(key);
  return map;
}

/** Keep a checked download for its yes. `from` is { kind: 'catalog' | 'link', host }. */
export function holdDownload(sum, buf, from, now = Date.now()) {
  const map = held(now);
  map.delete(sum);
  map.set(sum, { buf, from, at: now });
  while (map.size > MAX_HELD) map.delete(map.keys().next().value);
}

/** The download kept under `sum`, or null when there is none (never checked, too old, or installed). */
export function heldDownload(sum, now = Date.now()) {
  if (typeof sum !== 'string' || !SHA256.test(sum)) return null;
  return held(now).get(sum) || null;
}

/** Let a kept download go, once it is installed. */
export function releaseDownload(sum) {
  globalThis[HELD]?.delete(sum);
}
