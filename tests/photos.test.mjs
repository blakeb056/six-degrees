// Profile photos are shown from this computer only (lib/photos.js): what a page
// may load, the one route it loads photos from, the routes that store them,
// the scanner's rule for what it fetches, and the header that has the browser
// refuse anything else. Nothing here goes online; the people are invented, and
// the links are only ever read as text.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localPhoto, waitingPhotos, waitingPhotoCount } from '../lib/photos.js';
import { PYTHON, noPython } from './python.mjs';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-photos-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let avatars, updateImages, ingest, getDb;

before(async () => {
  avatars = await import('../app/avatars/[file]/route.js');
  updateImages = await import('../app/api/update-images/route.js');
  ingest = await import('../app/api/ingest/route.js');
  ({ getDb } = await import('../lib/db-client.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'notifications', 'app_meta']) getDb().exec(`DELETE FROM ${t}`);
});

// The shape of LinkedIn's signed photo links, which older versions stored.
const LINK = 'https://media.licdn.com/dms/image/v2/D4E03AQ/profile-displayphoto-shrink_100_100/0/1?e=1790000000&v=beta&t=Zx9';
const url = (slug) => `https://www.linkedin.com/in/${slug}`;

let n = 0;
function row(slug, photo, { degree = 1, bridge = null } = {}) {
  getDb().prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, profile_url, profile_image_url, source_connection_id)
    VALUES (?, 'me', ?, ?, ?, ?, ?)`).run(`r${++n}`, degree, slug, url(slug), photo, bridge);
}
const photosOf = (slug) => getDb().prepare('SELECT profile_image_url AS p FROM linkedin_connections WHERE profile_url = ? ORDER BY id')
  .all(url(slug)).map((r) => r.p);
const post = (route, body) => route.POST(new Request('http://127.0.0.1/api', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

// ── What a page may show ────────────────────────────────────────────────────

test('a page shows a saved photo, and never a link or anything else', () => {
  for (const ok of ['/avatars/3f2a9c01b7d4e8aa.webp', '/avatars/ada.png', '/avatars/a_b-c.jpg', '/avatars/x.jpeg']) {
    assert.equal(localPhoto(ok), ok);
  }
  for (const no of [
    LINK, 'http://media.licdn.com/x.jpg', '//media.licdn.com/x.jpg', 'https://127.0.0.1/avatars/x.webp',
    'data:image/png;base64,iVBORw0KGgo=', 'javascript:alert(1)', 'blob:http://127.0.0.1/1',
    '/avatars/../six-degrees.sqlite', '/avatars/a/b.webp', '/avatars/x.svg', '/avatars/x.WEBP', '/avatars/x.webp?v=2',
    '/avatars/x.webp"onerror="alert(1)', ' /avatars/x.webp', '/avatars/', '/avatarsx.webp', 'avatars/x.webp',
    '', null, undefined, 42, {},
  ]) {
    assert.equal(localPhoto(no), null, String(no));
  }
});

// ── The one route photos come from ──────────────────────────────────────────

const serve = (file) => avatars.GET(new Request(`http://127.0.0.1/avatars/${file}`), { params: Promise.resolve({ file }) });

test('/avatars serves a saved photo from the data folder, as the image it is', async () => {
  mkdirSync(path.join(dir, 'avatars'), { recursive: true });
  writeFileSync(path.join(dir, 'avatars', 'ada.webp'), 'RIFF\0\0\0\0WEBPVP8 ');
  writeFileSync(path.join(dir, 'avatars', 'ben.jpg'), '\xff\xd8\xff');
  const res = await serve('ada.webp');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'RIFF\0\0\0\0WEBPVP8 ');
  assert.equal((await serve('ben.jpg')).headers.get('content-type'), 'image/jpeg');
});

test('/avatars answers 404 for a photo not saved, and for any name outside the pattern', async () => {
  mkdirSync(path.join(dir, 'avatars'), { recursive: true });
  for (const file of ['missing.webp', '../test.sqlite', '..%2Ftest.sqlite', '%2E%2E/test.sqlite', 'test.sqlite',
    'x.svg', '.webp', 'a b.webp', 'x.webp.html']) {
    const res = await serve(file);
    assert.equal(res.status, 404, file);
    assert.equal(await res.text(), 'Not found');
  }
});

// ── The routes that store photos ────────────────────────────────────────────

test('a scan stores no link, and a rescan never swaps a saved photo for one', async () => {
  const ada = { name: 'Ada Quill', headline: 'Engineer at Initech', profileUrl: url('ada-quill'), imageUrl: LINK };
  const scan = () => post(ingest, { connections: [ada], type: 'degree1', userId: 'me' });

  await scan();
  assert.deepEqual(photosOf('ada-quill'), [null], 'initials until the scanner saves the picture');

  // The scanner saves it, then attaches its file.
  await post(updateImages, { images: [{ profileUrl: ada.profileUrl, imageUrl: '/avatars/ada.webp' }] });
  assert.deepEqual(photosOf('ada-quill'), ['/avatars/ada.webp']);

  // The next scan reads LinkedIn's link again. It used to overwrite the file's path.
  await scan();
  assert.deepEqual(photosOf('ada-quill'), ['/avatars/ada.webp']);
});

test('/api/update-images attaches a saved photo to every copy of a person, and never a link', async () => {
  row('ben-okafor', null);
  row('ben-okafor', null, { degree: 2, bridge: 'r1' });
  row('cy-lund', null);
  row('dee-marsh', '/avatars/dee.webp');
  const res = await post(updateImages, { images: [
    { profileUrl: url('ben-okafor'), imageUrl: '/avatars/ben.webp' },
    { profileUrl: url('cy-lund'), imageUrl: LINK },
    { profileUrl: url('dee-marsh'), imageUrl: 'javascript:alert(1)' },
  ] });
  assert.equal(res.status, 200);
  assert.deepEqual(photosOf('ben-okafor'), ['/avatars/ben.webp', '/avatars/ben.webp']);
  assert.deepEqual(photosOf('cy-lund'), [null]);
  assert.deepEqual(photosOf('dee-marsh'), ['/avatars/dee.webp']);
});

test('the links still waiting are listed once per person and link, and saved photos are not', async () => {
  row('ada-quill', LINK);
  row('ada-quill', LINK, { degree: 2, bridge: 'r9' });
  row('ben-okafor', '/avatars/ben.webp');
  row('cy-lund', null);
  row('dee-marsh', 'https://photos.example.test/dee.jpg');
  row('eli-park', '');
  const res = await updateImages.GET(new Request('http://127.0.0.1/api/update-images'));
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'another site can\'t read the list');
  assert.deepEqual((await res.json()).waiting, [
    { profileUrl: url('ada-quill'), imageUrl: LINK },
    { profileUrl: url('dee-marsh'), imageUrl: 'https://photos.example.test/dee.jpg' },
  ]);
  assert.equal(waitingPhotoCount(getDb()), 2);
});

test('a link the scanner could not save is forgotten, once, and only where it still stands', async () => {
  row('ada-quill', LINK);
  row('ada-quill', '/avatars/ada.webp', { degree: 2, bridge: 'r9' });
  row('ben-okafor', 'https://media.licdn.com/dms/image/other');
  const res = await post(updateImages, { images: [], forget: [
    { profileUrl: url('ada-quill'), imageUrl: LINK },
    // A link that has changed since the list was read is left for next time.
    { profileUrl: url('ben-okafor'), imageUrl: LINK },
    // A saved photo is never forgotten this way.
    { profileUrl: url('ada-quill'), imageUrl: '/avatars/ada.webp' },
  ] });
  assert.equal((await res.json()).forgotten, 1);
  assert.deepEqual(photosOf('ada-quill'), [null, '/avatars/ada.webp']);
  assert.deepEqual(photosOf('ben-okafor'), ['https://media.licdn.com/dms/image/other']);
  assert.deepEqual(waitingPhotos(getDb()).map((w) => w.profileUrl), [url('ben-okafor')]);
});

// ── What the scanner fetches ────────────────────────────────────────────────

// scripts/image_store.py is_linkedin_image, as written, without its packages.
const IMAGE_STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'image_store.py');
const CHECK = `
import ast, json, sys
src = open(sys.argv[1]).read()
fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == 'is_linkedin_image')
ns = {}
exec("from urllib.parse import urlsplit\\n" + ast.get_source_segment(src, fn), ns)
print(json.dumps([ns['is_linkedin_image'](u) for u in json.loads(sys.argv[2])]))
`;

test('saving a photo fetches only from LinkedIn\'s image servers, over https', (t) => {
  const cases = {
    [LINK]: true,
    'https://media-exp1.licdn.com/dms/image/C5603AQ/x.jpg': true,
    'https://static.licdn.com/aero-v1/sc/h/ghost.svg': true,
    'http://media.licdn.com/dms/image/x.jpg': false,
    'https://licdn.com.example.test/x.jpg': false,
    'https://evillicdn.com/x.jpg': false,
    'https://media.licdn.com@photos.example.test/x.jpg': false,
    'https://photos.example.test/dee.jpg': false,
    'https://127.0.0.1:3000/avatars/x.webp': false,
    'file:///etc/passwd': false,
    'data:image/png;base64,iVBORw0KGgo=': false,
    '/avatars/x.webp': false,
    '': false,
  };
  const run = spawnSync(PYTHON, ['-c', CHECK, IMAGE_STORE, JSON.stringify(Object.keys(cases))], { encoding: 'utf8' });
  if (noPython(t, run)) return;
  assert.equal(run.status, 0, run.stderr);
  const got = JSON.parse(run.stdout);
  Object.entries(cases).forEach(([link, want], i) => assert.equal(got[i], want, link));
});

// ── And the browser's own refusal ───────────────────────────────────────────

test('every page carries a Content-Security-Policy that allows pictures from the app only', async () => {
  const { default: config } = await import('../next.config.mjs');
  const rules = await config.headers();
  const csp = rules.flatMap((r) => r.headers.map((h) => ({ source: r.source, ...h })))
    .filter((h) => h.key.toLowerCase() === 'content-security-policy');
  assert.equal(csp.length, 1);
  assert.equal(csp[0].source, '/(.*)');
  assert.equal(csp[0].value, "img-src 'self' data: blob:");
});
