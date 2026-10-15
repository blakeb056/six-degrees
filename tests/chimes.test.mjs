// Manual mode's chimes (Blake, 2026-10-12): the sounds (lib/chimes.js), the files
// the scanner plays (lib/chime-files.js), the switch and volume in Settings →
// Sound (lib/linkedin-limits.js), and the scanner playing them at the right
// moments (scripts/scrape.py _chime, _read_by_hand) against stand-in pages and a
// stand-in clock. Nothing plays a sound here, opens a browser or reaches LinkedIn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHIME_NAMES, CHIME_VERSION, CHIME_DEFAULTS, READ_STEPS, SAMPLE_RATE, chimeWav, chimeSamples, readChime, readPitch, validVolume,
} from '../lib/chimes.js';
import { ensureChimes } from '../lib/chime-files.js';
import { readLimits, writeLimits } from '../lib/linkedin-limits.js';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixgree-chimes-'));

function scanner(t, home, script) {
  if (noScanner(t)) return null;
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, script], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
}

/** Zero crossings in the first `seconds`: a rough pitch, enough to tell higher from lower. */
function crossings(samples, seconds = 0.05) {
  let n = 0;
  for (let i = 1; i < Math.round(seconds * SAMPLE_RATE); i++) if ((samples[i - 1] < 0) !== (samples[i] < 0)) n++;
  return n;
}

// ── the sounds ──────────────────────────────────────────────────────────────

test('every chime is a 16-bit mono WAV at 44.1 kHz, never clipped, and the same bytes every time', () => {
  assert.equal(CHIME_NAMES.length, READ_STEPS + 3, 'the read steps, next, done and the break tick');
  for (const name of CHIME_NAMES) {
    const wav = chimeWav(name);
    const dv = new DataView(wav.buffer);
    const text = (at, n) => String.fromCharCode(...wav.slice(at, at + n));
    assert.equal(text(0, 4), 'RIFF', name);
    assert.equal(text(8, 4), 'WAVE', name);
    assert.equal(dv.getUint16(20, true), 1, `${name}: PCM`);
    assert.equal(dv.getUint16(22, true), 1, `${name}: mono`);
    assert.equal(dv.getUint32(24, true), SAMPLE_RATE, name);
    assert.equal(dv.getUint16(34, true), 16, name);
    assert.equal(dv.getUint32(40, true), wav.length - 44, `${name}: the data is all there`);
    const peak = Math.max(...chimeSamples(name).map(Math.abs));
    assert.ok(peak > 0.3 && peak <= 0.86, `${name}: loud enough, never clipped (${peak})`);
    assert.deepEqual(chimeWav(name), wav, `${name}: deterministic`);
  }
});

test('each page in a row chimes a step higher, and the ladder stops at its top', () => {
  for (let k = 1; k < READ_STEPS; k++) assert.ok(readPitch(k + 1) > readPitch(k), `step ${k + 1} is higher`);
  assert.ok(crossings(chimeSamples('read-8')) > crossings(chimeSamples('read-1')) * 2, 'and it sounds higher');
  assert.equal(readChime(1), 'read-1');
  assert.equal(readChime(0), 'read-1');
  assert.equal(readChime(READ_STEPS + 5), `read-${READ_STEPS}`);
});

test('the Next tap is short, the read chime longer, and the list-done flourish the longest', () => {
  const seconds = (name) => chimeSamples(name).length / SAMPLE_RATE;
  assert.ok(seconds('next') < 0.2);
  assert.ok(seconds('read-1') > seconds('next'));
  assert.ok(seconds('done') > seconds('read-1'));
});

test('the files the scanner plays are written once, and again only when the sounds change', () => {
  const dir = scratch();
  try {
    assert.equal(ensureChimes(dir), true);
    for (const name of CHIME_NAMES) {
      assert.deepEqual(new Uint8Array(readFileSync(path.join(dir, 'sounds', `${name}.wav`))), chimeWav(name), name);
    }
    assert.equal(readFileSync(path.join(dir, 'sounds', 'version'), 'utf8'), String(CHIME_VERSION));
    const before = statSync(path.join(dir, 'sounds', 'next.wav')).mtimeMs;
    assert.equal(ensureChimes(dir), false, 'nothing to do');
    assert.equal(statSync(path.join(dir, 'sounds', 'next.wav')).mtimeMs, before);
    writeFileSync(path.join(dir, 'sounds', 'version'), '0');
    assert.equal(ensureChimes(dir), true, 'older sounds are written again');
    assert.equal(ensureChimes(path.join(dir, 'no', '\0bad')), false, 'a folder it can’t write is no reason to fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Settings → Sound: chimes on at 60% unless changed, and only a change is written', () => {
  const dir = scratch();
  try {
    assert.deepEqual(CHIME_DEFAULTS, { chimes: true, chimeVolume: 0.6 });
    assert.equal(readLimits(dir).chimes, true);
    assert.equal(readLimits(dir).chimeVolume, 0.6);
    writeLimits(dir, { daily: 30 });
    const file = () => JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8'));
    assert.equal('chimes' in file(), false);
    assert.equal('chimeVolume' in file(), false);
    writeLimits(dir, { chimes: false, chimeVolume: 0.35 });
    assert.equal(file().chimes, false);
    assert.equal(file().chimeVolume, 0.35);
    writeLimits(dir, { chimeVolume: 7 });
    assert.equal(readLimits(dir).chimeVolume, 0.35, 'a volume outside 0 to 1 keeps the saved one');
    writeLimits(dir, { chimes: true, chimeVolume: 0.6 });
    assert.equal('chimes' in file(), false, 'back to the defaults, nothing of them is written');
    assert.equal(validVolume(0), true);
    assert.equal(validVolume(-0.1), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the scanner plays them ──────────────────────────────────────────────────

test('the scanner plays a chime with the Mac\'s player at the saved volume, and not when turned off or missing', (t) => {
  const home = scratch();
  try {
    ensureChimes(home);
    const r = scanner(t, home, `
import subprocess, types
played = []
subprocess.Popen = lambda args, **kw: played.append(args)
real = ns['sys']
ns['sys'] = types.SimpleNamespace(platform='darwin')
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'daily': 50, 'chimeVolume': 0.35}))
out['on'] = ns['_chime']('read-2')
out['missing'] = ns['_chime']('read-99')
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'daily': 50, 'chimes': False}))
out['off'] = ns['_chime']('next')
ns['sys'] = real
out['played'] = [[a[0], a[1], a[2], a[3].endswith('sounds/read-2.wav')] for a in played]`);
    if (!r) return;
    assert.equal(r.out.on, true);
    assert.equal(r.out.missing, false);
    assert.equal(r.out.off, false);
    assert.deepEqual(r.out.played, [['afplay', '-v', '0.35', true]], 'played once, without waiting for it');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Their list, a person working it, and a request to LinkedIn's search API the
// moment Next is clicked, as the browser makes one.
const PAGE = `
URN = 'ACoAAInventedUrn'
class Page:
    def __init__(self, pages, plan):
        self.pages, self.plan, self.listeners = pages, sorted(plan, key=lambda x: x[0]), []
        self.pg, self.foot, self.closed = 1, False, False
    def on(self, event, fn): self.listeners.append(fn)
    def remove_listener(self, event, fn): self.listeners.remove(fn)
    def _act(self):
        while self.plan and NOW + self.plan[0][0] <= clock.t:
            _, what = self.plan.pop(0)
            if what == 'foot': self.foot = True
            elif what == 'close': self.closed = True
            elif what == 'next':
                for fn in list(self.listeners):
                    fn(types.SimpleNamespace(resource_type='fetch', url='https://www.linkedin.com/voyager/api/graphql?queryId=voyagerSearchDashClusters.x'))
                    fn(types.SimpleNamespace(resource_type='fetch', url='https://www.linkedin.com/voyager/api/graphql?queryId=voyagerSearchDashClusters.y'))
                self.pg, self.foot = self.pg + 1, False
    @property
    def url(self):
        self._act()
        return 'https://www.linkedin.com/search/results/people/?connectionOf=%5B%22' + URN + '%22%5D&page=1'
    def is_closed(self):
        self._act()
        return self.closed
    def evaluate(self, js, *a):
        self._act()
        if js == ns['AT_FOOT_JS']: return self.foot
        if js == ns['NEXT_STATE_JS']: return 'on' if self.pg < self.pages else 'off'
        if js == ns['CURRENT_PAGE_JS']: return self.pg
        if js == ns['RESULT_LINKS_JS']: return [str(self.pg)]
        if js == ns['BRIDGE_RESULTS_JS']: return [person((self.pg - 1) * 10 + i) for i in range(10)]
        return None
chimes = []
ns['_chime'] = lambda name: chimes.append([name, round(clock.t - NOW, 1)])
def read_by_hand(page, total):
    reach = {'last': 0, 'more': False, 'urn': URN, 'found': 0, 'limited': False, 'pushed_back': False}
    ns['_read_by_hand'](page, 'Invented Bridge', 'https://www.linkedin.com/in/invented-bridge/', 'invented-bridge',
                        1, 100, reach, None, total)
    return chimes
`;

test('manual mode: a tap the moment you click Next, a climbing chime as each page is read, a flourish at the end', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${PAGE}
out['chimes'] = read_by_hand(Page(3, [[3, 'foot'], [6, 'next'], [9, 'foot'], [12, 'next'], [15, 'foot']]), 30)`);
    if (!r) return;
    assert.deepEqual(r.out.chimes.map(([n]) => n), ['read-1', 'next', 'read-2', 'next', 'done'], 'one tap a click, though the click made two requests');
    const at = Object.fromEntries(r.out.chimes.map(([n, s], i) => [`${n}#${i}`, s]));
    assert.ok(at['next#1'] >= 6 && at['next#1'] < 6.5, `the tap answers the click at once (${at['next#1']}s)`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode: the scanner opening the list is no click, so the first page never taps', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${PAGE}
page = Page(3, [[1, 'next'], [5, 'foot'], [9, 'close']])
out['chimes'] = read_by_hand(page, 30)`);
    if (!r) return;
    assert.deepEqual(r.out.chimes.map(([n]) => n), ['read-1'], 'no tap before a page is read; then the read chime');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the read chimes climb with a long run and stay at the top of the ladder', (t) => {
  const home = scratch();
  try {
    const plan = [];
    for (let i = 0; i < 11; i++) plan.push([3 + i * 6, 'foot'], [6 + i * 6, 'next']);
    // No break after page 10 here (tests/manual-breaks.test.mjs has those): the most pages between breaks.
    const r = scanner(t, home, `${PAGE}
(ns['_home']() / 'scan-limits.json').write_text(json.dumps({'breakEvery': 25}))
out['chimes'] = read_by_hand(Page(12, ${JSON.stringify(plan)} + [[80, 'close']]), 120)`);
    if (!r) return;
    const reads = r.out.chimes.map(([n]) => n).filter((n) => n.startsWith('read-'));
    assert.deepEqual(reads, ['read-1', 'read-2', 'read-3', 'read-4', 'read-5', 'read-6', 'read-7', 'read-8', 'read-8', 'read-8', 'read-8']);
    assert.ok(existsSync(path.join(home)), 'the data folder is still there');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
