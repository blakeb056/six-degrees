import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';
import { PACES, PACE_NAMES, DEFAULT_PACE, paceSeconds, searchesPerHour, durationText } from '../lib/scan-pace.js';
import { readLimits, writeLimits } from '../lib/linkedin-limits.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

test('Fast is today\'s pacing, and Medium and Slow are only ever slower', () => {
  assert.deepEqual([PACES.fast.pagePause, PACES.fast.chunkCooldown, PACES.fast.profileGap], [20, 60, 60]);
  for (const k of ['pagePause', 'chunkCooldown', 'profileGap', 'longRest']) {
    assert.ok(PACES.medium[k] > PACES.fast[k]);
    assert.ok(PACES.slow[k] > PACES.medium[k]);
  }
  assert.equal(DEFAULT_PACE, 'fast');
  assert.deepEqual(PACE_NAMES, ['slow', 'medium', 'fast']);
});

test('how long a budget takes at each speed, and searches an hour, with gentle pacing and without', () => {
  // Without gentle pacing, as it always was: 50 searches at Fast are 50 × (6 + 20) s and 5 × 60 s = 27 min.
  assert.equal(paceSeconds('fast', 50, false), 50 * 26 + 5 * 60);
  assert.deepEqual(PACE_NAMES.map((n) => searchesPerHour(n, false)), [29, 52, 113]);
  // Gentle pacing (the default) only adds: about 77, 40 and 23 an hour.
  assert.deepEqual(PACE_NAMES.map((n) => searchesPerHour(n)), [23, 40, 77]);
  for (const n of PACE_NAMES) {
    assert.ok(searchesPerHour(n) < searchesPerHour(n, false), `${n}: gentle is never quicker`);
    for (const k of [1, 10, 50, 120]) assert.ok(paceSeconds(n, k) > paceSeconds(n, k, false));
  }
  assert.ok(paceSeconds('medium', 50) > paceSeconds('fast', 50));
  assert.ok(paceSeconds('slow', 50) > paceSeconds('medium', 50));
  assert.equal(paceSeconds('fast', 0), 0);
  assert.equal(paceSeconds('nonsense', 10), paceSeconds('fast', 10));
  assert.ok(searchesPerHour('fast') > searchesPerHour('medium') && searchesPerHour('medium') > searchesPerHour('slow'));
  assert.equal(durationText(30), 'under a minute');
  assert.equal(durationText(27 * 60), 'about 27 min');
  assert.equal(durationText(67 * 60), 'about 1 h 7 min');
  assert.equal(durationText(120 * 60), 'about 2 h');
});

test('what a page costs on average is worked out from the pacing numbers, scroll included', async () => {
  const { pageSeconds, scrollSeconds, expectedInterval, PACING, profilesPerHour, paceLine } = await import('../lib/scan-pace.js');
  assert.ok(Math.abs(expectedInterval(20) - 21.995) < 0.01, 'a paced wait averages about 1.1 × its floor');
  assert.equal(expectedInterval(20, false), 20);
  // The scroll: 3 to 8 steps, a pause after each, a scroll back now and then, an idle moment, one count to settle.
  assert.ok(scrollSeconds() > 2.5 && scrollSeconds() < 4, `about 3 s a page (${scrollSeconds()})`);
  assert.equal(pageSeconds('fast', false), 26);
  const fast = pageSeconds('fast');
  const reading = expectedInterval(PACING.readPerResult * 10);
  assert.ok(fast > 26 + reading + scrollSeconds(), 'the old page, reading time and the scroll, at least');
  assert.ok(profilesPerHour('fast') <= 60 && profilesPerHour('slow') <= 30, 'never more than one profile a minute');
  assert.match(paceLine('fast', false), /^At Fast it rests at least 20 seconds before each page and a minute more after every 10\.$/);
  assert.match(paceLine('slow'), /^At Slow it rests at least 90 seconds before each page and 5 minutes more after every 10, a little longer at random/);
});

test('the speed is saved with the budget, and the budget is the same at every speed', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pace-'));
  try {
    assert.equal(readLimits(dir).pace, 'fast');
    const saved = writeLimits(dir, { pace: 'slow' });
    assert.equal(saved.pace, 'slow');
    assert.equal(saved.daily, 50);
    assert.equal(writeLimits(dir, { daily: 25 }).pace, 'slow', 'saving the budget keeps the speed');
    assert.equal(writeLimits(dir, { pace: 'warp' }).pace, 'slow', 'only the three speeds');
    writeFileSync(path.join(dir, 'scan-limits.json'), JSON.stringify({ daily: 50, pace: 'ludicrous' }));
    assert.equal(readLimits(dir).pace, 'fast');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the scanner\'s own speeds match the page\'s', (t) => {
  const run = spawnSync(PYTHON, ['-c', `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'SCAN_PACES' for t in node.targets):
        print(json.dumps(ast.literal_eval(node.value)))
`, SCRAPER], { encoding: 'utf8' });
  if (noPython(t, run)) return;
  assert.equal(run.status, 0, run.stderr);
  const py = JSON.parse(run.stdout);
  for (const name of PACE_NAMES) {
    assert.deepEqual(py[name], {
      page_pause: PACES[name].pagePause, chunk_cooldown: PACES[name].chunkCooldown, profile_gap: PACES[name].profileGap,
      short_break: PACES[name].shortBreak, long_rest: PACES[name].longRest,
    });
  }
});

test('the first circle shows in about 5 minutes at Fast, later at the slower speeds', async () => {
  const { firstCircleSeconds } = await import('../lib/scan-pace.js');
  // Ten pages, when the scanner first saves, and the rest after them.
  assert.equal(firstCircleSeconds('fast'), paceSeconds('fast', 10));
  assert.equal(durationText(firstCircleSeconds('fast', false)), 'about 5 min', 'as it was without gentle pacing');
  assert.equal(durationText(firstCircleSeconds('fast')), 'about 7 min');
  assert.equal(durationText(firstCircleSeconds(undefined)), 'about 7 min', 'no speed saved is Fast');
  assert.ok(firstCircleSeconds('medium') > firstCircleSeconds('fast'));
  assert.ok(firstCircleSeconds('slow') > firstCircleSeconds('medium'));
});
