// The Sixgree network file, format 1.0 (lib/network-file.js, docs/NETWORK-FILE.md):
// its versions, what makes two profile links the same person, and the reader's
// promise that a folder is checked whole before anything is read out of it.
// Every person here is invented, on example.com.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync, renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  NETWORK_FORMAT, NETWORK_FORMAT_VERSION, LIMITS, NetworkFileError,
  versionVerdict, canonicalProfileUrl, personMatchKey, pictureInfo, readNetworkFolder, writeNetworkFolder,
} from '../lib/network-file.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'sixgree-network-file-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const fresh = (tag) => path.join(scratch, `${tag}-${++n}`);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const NOW = new Date('2026-10-12T20:30:00.000Z');
const PRODUCER = { name: 'Test producer', version: '1.0.0' };

const ada = { key: 'https://example.com/in/ada-lovelace', name: 'Ada Lovelace', role: 'Engineer', company: 'Analytical Engines' };
const grace = { key: 'https://example.com/in/grace-hopper', name: 'Grace Hopper', headline: 'Rear Admiral at Navy | Compilers' };
const alan = { key: 'https://example.com/in/alan-turing', name: 'Alan Turing', headline: 'Mathematician' };
const conn = (p, extra = {}) => ({ person: p.key, connected_date: '2026-09-28', source: 'export', ...extra });

/** A valid folder of invented people, written by the writer itself. */
function folder(tag, parts = {}, opts = {}) {
  const dir = fresh(tag);
  writeNetworkFolder(dir, {
    people: [ada, grace],
    connections: [conn(ada), conn(grace)],
    ...parts,
  }, { producer: PRODUCER, now: NOW, ...opts });
  return dir;
}

/** Rewrite one listed file and keep the manifest's checksum and row count true, to reach a later check. */
function rewrite(dir, name, text) {
  writeFileSync(path.join(dir, name), text);
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  m.files[name] = { rows: text ? text.split('\n').length - 1 : 0, sha256: sha(Buffer.from(text)) };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
}
const manifestOf = (dir) => JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const setManifest = (dir, change) => {
  const m = manifestOf(dir);
  change(m);
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
};
const lines = (...rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join('');
const refused = (dir, pattern) => assert.throws(() => readNetworkFolder(dir), (err) => {
  assert.ok(err instanceof NetworkFileError, `a NetworkFileError, not ${err?.constructor?.name}: ${err?.message}`);
  assert.match(err.message, pattern);
  assert.doesNotMatch(err.message, /—/);
  return true;
});

// Tiny pictures: headers only, which is all the reader looks at.
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function webpLossless(w, h, salt = 0) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8L', 12, 'latin1');
  b.writeUInt32LE(20, 16);
  b[20] = 0x2f;
  b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  b[39] = salt;   // a different picture with the same header
  return b;
}
function webpExtended(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}
function webpLossy(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8 ', 12, 'latin1');
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(w, 26);
  b.writeUInt16LE(h, 28);
  return b;
}
function jpeg(w, h) {
  // SOI, an APP0 segment to step over, then SOF0 with the size.
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0, 0, 0, 0]);
}

// ── versions ─────────────────────────────────────────────────────────────────

test('the format version, never the app version, decides: newer major refused, newer minor read, older major refused with no upgrade', () => {
  assert.equal(NETWORK_FORMAT, 'sixgree.network');
  assert.equal(NETWORK_FORMAT_VERSION, '1.0');
  const same = versionVerdict('1.0');
  assert.deepEqual([same.ok, same.major, same.minor, same.newerMinor], [true, 1, 0, false]);
  const minor = versionVerdict('1.4');
  assert.deepEqual([minor.ok, minor.newerMinor], [true, true]);
  const major = versionVerdict('2.0');
  assert.equal(major.ok, false);
  assert.equal(major.newer, true);
  assert.match(major.reason, /Update Sixgree/);
  const older = versionVerdict('0.9');
  assert.equal(older.ok, false);
  assert.match(older.reason, /no copy of Sixgree reads/);
  for (const bad of ['1', '1.0.0', '01.0', 'v1.0', '', null, 1.0, '1.x']) {
    assert.equal(versionVerdict(bad).ok, false, String(bad));
  }
});

// ── who is who ───────────────────────────────────────────────────────────────

test('REGRESSION: an export\'s link (no "/") and the stored one (with it) are the same person', () => {
  // Every link Sixgree stored ended in "/" (12,770 of them, 2026-10-12) and a
  // Connections export's don't: compared as text, a merge would add everyone twice.
  const stored = 'https://example.com/in/ada-lovelace/';
  assert.equal(canonicalProfileUrl('https://example.com/in/ada-lovelace'), stored);
  assert.equal(canonicalProfileUrl(stored), stored, 'a stored link is already canonical');
  assert.equal(personMatchKey('https://example.com/in/ada-lovelace'), personMatchKey(stored));
  assert.equal(personMatchKey(stored), 'https://example.com/in/ada-lovelace');
});

test('the canonical link: https, host in lower case, no query or fragment, one "/" at the end, escapes normalized', () => {
  const want = 'https://example.com/in/ada-lovelace/';
  for (const url of [
    'http://example.com/in/ada-lovelace',
    'HTTPS://EXAMPLE.COM/in/ada-lovelace',
    'https://example.com/in/ada-lovelace/?from=search#top',
    'https://example.com/in/ada-lovelace///',
    '  https://example.com/in/ada-lovelace  ',
    'https://example.com:443/in/ada-lovelace',
    'http://example.com:80/in/ada-lovelace',
    'https://example.com/in/ada%2Dlovelace',      // an escaped "-" is a "-"
    'https://example.com/in/./ada-lovelace',
  ]) assert.equal(canonicalProfileUrl(url), want, url);

  // Escapes: capital hex, and the raw characters a person may have typed become them.
  const jose = 'https://example.com/in/jos%C3%A9-garc%C3%ADa/';
  assert.equal(canonicalProfileUrl('https://example.com/in/jos%c3%a9-garc%c3%ada'), jose);
  assert.equal(canonicalProfileUrl('https://example.com/in/josé-garcía'), jose);
  assert.equal(canonicalProfileUrl('https://example.com/in/a%7Eb'), 'https://example.com/in/a~b/');

  // Kept as they are: a path's case, extra segments, a port that isn't the default.
  assert.equal(canonicalProfileUrl('https://example.com/in/AbC'), 'https://example.com/in/AbC/');
  assert.notEqual(personMatchKey('https://example.com/in/AbC'), personMatchKey('https://example.com/in/abc'));
  assert.equal(canonicalProfileUrl('https://example.com/in/ada-lovelace/en'), 'https://example.com/in/ada-lovelace/en/');
  assert.equal(canonicalProfileUrl('https://example.com:8443/in/ada'), 'https://example.com:8443/in/ada/');

  // Not links to anyone's page.
  for (const bad of [
    '', 'ada-lovelace', 'example.com/in/ada', 'ftp://example.com/in/ada', 'javascript:alert(1)',
    'https://example.com', 'https://example.com/', 'https://user:pw@example.com/in/ada',
    'https://example.com/in/ada\nlovelace', 'https://example.com/in/100%', `https://example.com/${'a'.repeat(LIMITS.url)}`,
    null, undefined, 42, {},
  ]) assert.equal(canonicalProfileUrl(bad), null, String(bad));
});

test('canonical twice is canonical once', () => {
  for (const url of [
    'https://example.com/in/jos%c3%a9', 'https://example.com/in/a%2E%2E/b', 'https://example.com/in/%2e%2e',
    'https://Example.COM/in/x/?q#f', 'https://example.com/in/a%20b', 'https://example.com/in/%41',
  ]) {
    const once = canonicalProfileUrl(url);
    if (once) assert.equal(canonicalProfileUrl(once), once, url);
  }
});

// ── pictures ─────────────────────────────────────────────────────────────────

test('a picture is known by its first bytes, with its size in pixels', () => {
  assert.deepEqual(pictureInfo(png(96, 80)), { type: 'png', width: 96, height: 80 });
  assert.deepEqual(pictureInfo(webpLossless(96, 64)), { type: 'webp', width: 96, height: 64 });
  assert.deepEqual(pictureInfo(webpExtended(400, 300)), { type: 'webp', width: 400, height: 300 });
  assert.deepEqual(pictureInfo(webpLossy(120, 90)), { type: 'webp', width: 120, height: 90 });
  assert.deepEqual(pictureInfo(jpeg(640, 480)), { type: 'jpeg', width: 640, height: 480 });
  assert.equal(pictureInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(pictureInfo('not a buffer'), null);
});

// ── a whole folder ───────────────────────────────────────────────────────────

test('a folder the writer made reads back whole, every link canonical', () => {
  const dir = folder('ok', {
    people: [ada, grace, alan],
    connections: [conn(ada), conn(grace, { source: 'scan', observed_at: '2026-10-12T20:00:00Z' })],
    edges: [{ via: grace.key, person: alan.key, source: 'scan', observed_at: '2026-10-12T20:00:00Z', provenance: { method: 'test', run_id: 'r1' } }],
  }, { owner: { key: 'https://example.com/in/you', name: 'You' }, leftOut: { no_profile_link: 2 } });
  assert.deepEqual(readdirSync(dir).sort(), ['connections.jsonl', 'edges.jsonl', 'manifest.json', 'people.jsonl']);
  assert.ok(!existsSync(`${dir}.partial`), 'no .partial left behind');
  const model = readNetworkFolder(dir);
  assert.equal(model.manifest.format_version, '1.0');
  assert.deepEqual(model.manifest.producer, PRODUCER);
  assert.equal(model.manifest.generated_at, NOW.toISOString());
  assert.deepEqual(model.manifest.owner, { key: 'https://example.com/in/you/', name: 'You' });
  assert.deepEqual(model.manifest.left_out, { no_profile_link: 2 });
  assert.deepEqual(model.manifest.includes, { second_degree: true, mutual_counts: false, photos: false, experience: false });
  assert.deepEqual(model.people.map((p) => p.key), [`${ada.key}/`, `${grace.key}/`, `${alan.key}/`]);
  assert.deepEqual(model.connections.map((c) => [c.person, c.source, c.connected_date]), [
    [`${ada.key}/`, 'export', '2026-09-28'], [`${grace.key}/`, 'scan', '2026-09-28'],
  ]);
  assert.deepEqual(model.edges[0], {
    via: `${grace.key}/`, person: `${alan.key}/`, observed_at: '2026-10-12T20:00:00Z', source: 'scan', provenance: { method: 'test', run_id: 'r1' },
  });
  assert.deepEqual(model.ignored, { fields: {}, files: [], unreferencedPeople: 0, sharedPhotos: 0, unusedPhotos: 0 });
});

test('the writer never leaves a half-made folder, and never writes over one', () => {
  const dir = fresh('w');
  assert.throws(() => writeNetworkFolder(dir, { people: [{ key: 'not a link', name: 'X' }], connections: [] }, { producer: PRODUCER }),
    /isn't a profile link/);
  assert.ok(!existsSync(dir) && !existsSync(`${dir}.partial`));
  // A row the reader would refuse is refused before the folder takes its name.
  assert.throws(() => writeNetworkFolder(dir, { people: [ada], connections: [conn(grace)] }, { producer: PRODUCER }),
    /isn't in people\.jsonl/);
  assert.ok(!existsSync(dir) && !existsSync(`${dir}.partial`));
  writeNetworkFolder(dir, { people: [ada], connections: [conn(ada)] }, { producer: PRODUCER });
  assert.throws(() => writeNetworkFolder(dir, { people: [ada], connections: [conn(ada)] }, { producer: PRODUCER }), /already exists/);
  assert.throws(() => writeNetworkFolder(fresh('w'), {}, {}), /producer name/);
});

test('not a network file: no folder, no manifest, another format, or a newer major version', () => {
  refused(path.join(scratch, 'nowhere'), /isn't there/);
  const file = fresh('file');
  writeFileSync(file, 'x');
  refused(file, /is a folder/);
  const empty = fresh('empty');
  mkdirSync(empty);
  refused(empty, /no manifest\.json/);
  const other = folder('other');
  setManifest(other, (m) => { m.format = 'something.else'; });
  refused(other, /isn't a Sixgree network file/);
  const newer = folder('newer');
  setManifest(newer, (m) => { m.format_version = '2.0'; });
  assert.throws(() => readNetworkFolder(newer), (err) => err.extra.newer === true && /format 2\.0.*Update Sixgree/.test(err.message));
});

test('every listed file must match its checksum and row count, and nothing unlisted may be in the folder', () => {
  const changed = folder('sum');
  writeFileSync(path.join(changed, 'people.jsonl'), lines(ada));
  refused(changed, /people\.jsonl doesn't match the checksum/);

  const short = folder('rows');
  setManifest(short, (m) => { m.files['people.jsonl'].rows = 3; });
  refused(short, /people\.jsonl has 2 rows, and its manifest says 3/);

  const extra = folder('extra');
  writeFileSync(path.join(extra, 'notes.txt'), 'hello');
  refused(extra, /holds "notes\.txt", which its manifest doesn't list/);

  const finder = folder('finder');
  writeFileSync(path.join(finder, '.DS_Store'), 'x');
  assert.equal(readNetworkFolder(finder).people.length, 2, "Finder's own file is no reason to refuse");

  const linked = folder('link');
  const outside = fresh('outside');
  writeFileSync(outside, readFileSync(path.join(linked, 'people.jsonl')));
  rmSync(path.join(linked, 'people.jsonl'));
  symlinkSync(outside, path.join(linked, 'people.jsonl'));
  refused(linked, /people\.jsonl isn't a plain file/);

  const missing = folder('missing');
  rmSync(path.join(missing, 'connections.jsonl'));
  refused(missing, /connections\.jsonl is missing/);

  const unlisted = folder('required');
  setManifest(unlisted, (m) => { delete m.files['connections.jsonl']; });
  rmSync(path.join(unlisted, 'connections.jsonl'));
  refused(unlisted, /doesn't list connections\.jsonl/);
});

test('each line is one JSON object, UTF-8, under the size cap, and the file ends with a line break', () => {
  const cases = [
    ['not JSON', 'people.jsonl', `${JSON.stringify(ada)}\n{nope\n`, /people\.jsonl, line 2 isn't JSON/],
    ['an array', 'people.jsonl', `${JSON.stringify(ada)}\n[1]\n`, /line 2 isn't a JSON object/],
    ['a blank line', 'people.jsonl', `${JSON.stringify(ada)}\n\n`, /line 2 is empty/],
    ['cut short', 'people.jsonl', `${JSON.stringify(ada)}\n${JSON.stringify(grace)}`, /doesn't end with a line break/],
    ['too long', 'people.jsonl', lines(ada, { ...grace, headline: 'x'.repeat(LIMITS.lineBytes) }), /line 2 is longer than 64 KB/],
  ];
  for (const [what, name, text, pattern] of cases) {
    const dir = folder('lines');
    if (what === 'cut short') {
      writeFileSync(path.join(dir, name), text);
      setManifest(dir, (m) => { m.files[name] = { rows: 2, sha256: sha(Buffer.from(text)) }; });
    } else rewrite(dir, name, text);
    refused(dir, pattern);
  }
  const latin = folder('latin');
  const bytes = Buffer.concat([Buffer.from('{"key":"https://example.com/in/x","name":"Jos'), Buffer.from([0xe9]), Buffer.from('"}\n')]);
  writeFileSync(path.join(latin, 'people.jsonl'), bytes);
  setManifest(latin, (m) => { m.files['people.jsonl'] = { rows: 1, sha256: sha(bytes) }; });
  refused(latin, /isn't UTF-8/);
});

test('fields are checked by type, and a bad one is named with its file and line', () => {
  const cases = [
    ['people.jsonl', lines(ada, { ...grace, name: '' }), /people\.jsonl, line 2: "name" is empty/],
    ['people.jsonl', lines(ada, { ...grace, name: 7 }), /"name" must be text/],
    ['people.jsonl', lines(ada, { ...grace, key: 'grace' }), /"key" isn't a profile link/],
    ['people.jsonl', lines(ada, { ...grace, headline: 'x'.repeat(LIMITS.text + 1) }), /"headline" is longer than 1000/],
    ['people.jsonl', lines(ada, { ...grace, mutual_count: -1 }), /"mutual_count" must be a whole number/],
    ['people.jsonl', lines(ada, { ...grace, photo: 'face.webp' }), /"photo" must name a photo by its SHA-256/],
    ['connections.jsonl', lines(conn(ada), conn(grace, { source: 'guess' })), /connections\.jsonl, line 2: "source" must be one of export, scan, manual/],
    ['connections.jsonl', lines(conn(ada), conn(grace, { source: undefined })), /"source" is missing/],
    ['connections.jsonl', lines(conn(ada), conn(grace, { connected_date: '2026-02-30' })), /"connected_date" must be a calendar date/],
    ['connections.jsonl', lines(conn(ada), conn(grace, { connected_date: '28 Sep 2026' })), /"connected_date" must be a calendar date/],
    ['connections.jsonl', lines(conn(ada), conn(grace, { observed_at: 'yesterday' })), /"observed_at" must be a time/],
  ];
  for (const [name, text, pattern] of cases) {
    const dir = folder('types');
    rewrite(dir, name, text);
    refused(dir, pattern);
  }
});

test('one person once, and every reference names someone in the file', () => {
  const twice = folder('twice');
  // Written two ways, the same page: one person.
  rewrite(twice, 'people.jsonl', lines(ada, grace, { ...ada, key: `${ada.key}/`, name: 'Ada again' }));
  refused(twice, /line 3: the same person as line 1/);

  const stranger = folder('stranger');
  rewrite(stranger, 'connections.jsonl', lines(conn(ada), conn(alan)));
  refused(stranger, /connections\.jsonl, line 2: its person isn't in people\.jsonl/);

  const again = folder('again');
  rewrite(again, 'connections.jsonl', lines(conn(ada), conn(grace), conn({ key: `${ada.key}/` })));
  refused(again, /listed as a connection twice/);

  const owner = fresh('owner');
  assert.throws(() => writeNetworkFolder(owner, { people: [ada], connections: [conn(ada)] }, { producer: PRODUCER, owner: { key: ada.key } }),
    /the file's owner, who can't be their own connection/);
});

test('"via" is a connection in the same file, so the file stands on its own; connections in a circle are ties', () => {
  const edge = (via, person) => ({ via: via.key, person: person.key, source: 'scan' });
  const base = { people: [ada, grace, alan], connections: [conn(ada), conn(grace)] };
  assert.throws(() => writeNetworkFolder(fresh('via'), { ...base, edges: [edge(alan, ada)] }, { producer: PRODUCER }),
    /"via" must be one of the connections/);
  assert.throws(() => writeNetworkFolder(fresh('via'), { ...base, edges: [edge(ada, grace)] }, { producer: PRODUCER }),
    /are a tie \(ties\.jsonl\), not an edge/);
  assert.throws(() => writeNetworkFolder(fresh('via'), { ...base, edges: [edge(ada, alan), edge(ada, { key: `${alan.key}/` })] }, { producer: PRODUCER }),
    /the same edge is listed twice/);
  assert.throws(() => writeNetworkFolder(fresh('via'), { ...base, ties: [{ a: ada.key, b: alan.key }] }, { producer: PRODUCER }),
    /a tie is between two of the connections/);
  assert.throws(() => writeNetworkFolder(fresh('via'), { ...base, ties: [{ a: ada.key, b: `${ada.key}/` }] }, { producer: PRODUCER }),
    /a tie is between two different people/);
  assert.throws(() => writeNetworkFolder(fresh('via'), { ...base, circles: [{ person: alan.key, status: 'read', read_at: '2026-10-12T20:00:00Z' }] }, { producer: PRODUCER }),
    /a circle belongs to one of the connections/);
  assert.throws(() => writeNetworkFolder(fresh('via'), { ...base, companyScans: [{ company: 'Analytical Engines', person: ada.key, source: 'scan' }] }, { producer: PRODUCER }),
    /nobody is a connection and found by a company scan at once/);

  const dir = folder('parts', {
    ...base,
    edges: [edge(ada, alan)],
    ties: [{ a: grace.key, b: ada.key }],
    circles: [{ person: ada.key, status: 'partial', pages: 3, more: true, total: 120, connections: 500, connections_plus: true, read_at: '2026-10-12T20:00:00Z' }],
    companyScans: [{ company: 'Analytical Engines', person: alan.key, source: 'scan' }],
  });
  const model = readNetworkFolder(dir);
  assert.deepEqual(model.ties, [{ a: `${ada.key}/`, b: `${grace.key}/`, observed_at: null }], 'smaller link first');
  assert.deepEqual(model.circles[0], {
    person: `${ada.key}/`, status: 'partial', pages: 3, more: true, total: 120, connections: 500, connections_plus: true, complete: false, read_at: '2026-10-12T20:00:00Z',
  });
  assert.equal(model.companyScans[0].company, 'Analytical Engines');
});

test('the manifest says what the file carries, and can\'t say less than it has', () => {
  const dir = folder('includes', { people: [ada, { ...grace, mutual_count: 12, mutual_count_at: '2026-10-12T20:00:00Z' }] });
  assert.equal(readNetworkFolder(dir).manifest.includes.mutual_counts, true);
  setManifest(dir, (m) => { m.includes.mutual_counts = false; });
  refused(dir, /"includes"\."mutual_counts" is false, and the file has them/);
});

test('photos: named by their SHA-256, checked against it, the right kind, not too big; one face on two people is dropped for both', () => {
  const face = webpLossless(96, 96, 1);
  const other = png(96, 96);
  const logo = webpLossless(64, 64, 2);
  const experience = { status: 'read', at: '2026-10-12T20:00:00Z', roles: [{ title: 'Engineer', company: 'Analytical Engines', start: '2024-03', logo: sha(logo) }] };
  const dir = folder('photos', {
    people: [{ ...ada, photo: sha(face), experience }, { ...grace, photo: sha(other), experience }, alan],
    connections: [conn(ada), conn(grace), conn(alan)],
    photos: [{ bytes: face, ext: 'webp' }, { bytes: other, ext: 'png' }, { bytes: logo, ext: 'webp' }],
  });
  const model = readNetworkFolder(dir);
  assert.deepEqual(model.people.map((p) => p.photo), [sha(face), sha(other), null]);
  assert.deepEqual(model.photos.map((p) => [p.type, p.width, p.height]).sort(), [['png', 96, 96], ['webp', 64, 64], ['webp', 96, 96]]);
  assert.equal(model.people[0].experience.roles[0].logo, sha(logo), 'a logo shared by two people is kept');

  // REGRESSION (TRAPS §20): one picture on two people is nobody's face for sure.
  const shared = folder('shared', {
    people: [{ ...ada, photo: sha(face) }, { ...grace, photo: sha(face) }, alan],
    connections: [conn(ada), conn(grace), conn(alan)],
    photos: [{ bytes: face, ext: 'webp' }, { bytes: other, ext: 'png' }],
  });
  const s = readNetworkFolder(shared);
  assert.deepEqual(s.people.map((p) => p.photo), [null, null, null]);
  assert.equal(s.ignored.sharedPhotos, 2);
  assert.equal(s.ignored.unusedPhotos, 2);
  assert.deepEqual(s.photos, []);

  const photosOf = (d) => path.join(d, 'photos');
  const damaged = folder('damaged', { people: [{ ...ada, photo: sha(face) }, grace], photos: [{ bytes: face, ext: 'webp' }] });
  writeFileSync(path.join(photosOf(damaged), `${sha(face)}.webp`), webpLossless(96, 96, 9));
  refused(damaged, /doesn't match its name/);

  // The writer refuses these itself; a folder changed after it was written is refused by the reader.
  assert.throws(() => folder('disguised', { people: [{ ...ada, photo: sha(other) }, grace], photos: [{ bytes: other, ext: 'webp' }] }),
    /isn't the kind of picture its name says/);
  const disguised = folder('disguised', { people: [{ ...ada, photo: sha(other) }, grace], photos: [{ bytes: other, ext: 'png' }] });
  renameSync(path.join(photosOf(disguised), `${sha(other)}.png`), path.join(photosOf(disguised), `${sha(other)}.webp`));
  refused(disguised, /isn't the kind of picture its name says/);

  const huge = folder('huge', { people: [{ ...ada, photo: sha(face) }, grace], photos: [{ bytes: face, ext: 'webp' }] });
  writeFileSync(path.join(photosOf(huge), `${sha(png(4000, 10))}.png`), png(4000, 10));
  refused(huge, /4000 by 10 pixels, larger than 2048/);

  const gone = folder('gone', { people: [{ ...ada, photo: sha(face) }, grace], photos: [{ bytes: face, ext: 'webp' }] });
  rmSync(path.join(photosOf(gone), `${sha(face)}.webp`));
  refused(gone, /line 1: its photo isn't in photos\//);

  const named = folder('named', { people: [{ ...ada, photo: sha(face) }, grace], photos: [{ bytes: face, ext: 'webp' }] });
  writeFileSync(path.join(photosOf(named), 'face.webp'), face);
  refused(named, /photos\/face\.webp isn't named by its contents/);

  const big = folder('big', { people: [{ ...ada, photo: sha(face) }, grace], photos: [{ bytes: face, ext: 'webp' }] });
  const heavy = Buffer.concat([png(96, 96), Buffer.alloc(LIMITS.photoBytes)]);
  writeFileSync(path.join(photosOf(big), `${sha(heavy)}.png`), heavy);
  refused(big, /larger than 256 KB/);
});

test('experience: read, unreadable or card, with roles checked', () => {
  const at = '2026-10-12T20:00:00Z';
  const ok = folder('exp', {
    people: [
      { ...ada, experience: { status: 'read', at, source: 'page', roles: [{ title: 'Engineer', company: 'Analytical Engines', start: '2024', current: true, company_id: '2889' }], card: { followers: 1200, connections: 500, connections_plus: true } } },
      { ...grace, experience: { status: 'unreadable', at, why: 'the page changed' } },
      { ...alan, experience: { status: 'card', at, card: { followers: 40 } } },
    ],
    connections: [conn(ada), conn(grace), conn(alan)],
  });
  const people = readNetworkFolder(ok).people;
  assert.deepEqual(people[0].experience.roles[0], { title: 'Engineer', company: 'Analytical Engines', start: '2024', end: null, current: true, company_id: '2889' });
  assert.deepEqual(people[0].experience.card, { followers: 1200, connections: 500, connections_plus: true });
  assert.equal(people[1].experience.why, 'the page changed');
  for (const [experience, pattern] of [
    [{ status: 'read', at, roles: [] }, /at least one role/],
    [{ status: 'read', at, roles: [{ company: 'X' }] }, /"title" is missing/],
    [{ status: 'read', at, roles: [{ title: 'X', start: 'March 2024' }] }, /"start" must be a year or a month/],
    [{ status: 'card', at }, /needs its "card"/],
    [{ status: 'maybe' }, /"status" must be one of read, unreadable, card/],
    ['read', /"experience" must be an object/],
  ]) {
    const dir = folder('exp-bad');
    rewrite(dir, 'people.jsonl', lines(ada, { ...grace, experience }));
    setManifest(dir, (m) => { m.includes.experience = true; });
    refused(dir, pattern);
  }
});

test('a newer minor version is read: what it adds is left out and counted, never guessed at', () => {
  const dir = folder('minor');
  rewrite(dir, 'people.jsonl', lines({ ...ada, pronouns: 'she/her' }, { ...grace, pronouns: 'she/her', favourite: 'COBOL' }));
  rewrite(dir, 'groups.jsonl', lines({ name: 'Navy' }));
  setManifest(dir, (m) => { m.format_version = '1.3'; m.colour = 'blue'; });
  const model = readNetworkFolder(dir);
  assert.equal(model.version.newerMinor, true);
  assert.deepEqual(model.ignored.fields, { 'people.jsonl': { pronouns: 2, favourite: 1 }, 'manifest.json': { colour: 1 } });
  assert.deepEqual(model.ignored.files, ['groups.jsonl']);
  assert.equal(model.people.length, 2);
  // Its own listed files are still checked.
  writeFileSync(path.join(dir, 'groups.jsonl'), lines({ name: 'Army' }));
  refused(dir, /groups\.jsonl doesn't match the checksum/);
});

test('someone the file names but nothing points at is counted, not refused', () => {
  const dir = folder('lonely', { people: [ada, grace, alan] });
  assert.equal(readNetworkFolder(dir).ignored.unreferencedPeople, 1);
});

test('the manifest is checked as carefully as the rows', () => {
  for (const [change, pattern] of [
    [(m) => { delete m.producer; }, /"producer" is missing/],
    [(m) => { m.generated_at = 'today'; }, /"generated_at" must be a time/],
    [(m) => { m.files['../escape.jsonl'] = { rows: 0, sha256: sha('') }; }, /isn't a file name a network file can hold/],
    [(m) => { m.files['people.jsonl'].sha256 = 'abc'; }, /sha256 must be 64 lower-case hex/],
    [(m) => { m.files['people.jsonl'].rows = LIMITS.people + 1; }, /more than the 500,000 a network file can hold/],
    [(m) => { m.left_out = { no_profile_link: -3 }; }, /"no_profile_link" must be a whole number/],
  ]) {
    const dir = folder('manifest');
    setManifest(dir, change);
    refused(dir, pattern);
  }
});
