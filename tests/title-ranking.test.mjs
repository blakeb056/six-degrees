import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePerson, scoreNetwork, LEVELS, explainScore, titleHas } from '../lib/scoring.js';
import { TITLE_RANKING_SETTING, NO_RANKING, rankingFingerprint, isDefaultRanking, RANKING_PRESETS, MAX_ROLES } from '../lib/title-ranking.js';
import { readSettings, writeSettings, SettingsError } from '../lib/settings.js';

// Invented people and companies only.
const ae = { id: 1, degree: 1, headline: 'Senior Account Executive at Hooli' };
const owner = { id: 2, degree: 1, headline: 'Owner at Pied Piper Bakery' };
const vp = { id: 3, degree: 1, headline: 'VP of Sales at Hooli' };

test('no ranking scores exactly as before', () => {
  for (const row of [ae, owner, vp]) {
    assert.deepEqual(scorePerson(row, undefined, undefined, null), scorePerson(row));
    assert.deepEqual(scorePerson(row, undefined, undefined, { points: {}, roles: [] }).power, scorePerson(row).power);
  }
});

test('a level counts your points for it', () => {
  const before = scorePerson(owner);
  const after = scorePerson(owner, undefined, undefined, { points: { owner: 10 }, roles: [] });
  assert.equal(before.title.points, LEVELS.owner.points);
  assert.equal(after.title.points, 10);
  assert.ok(after.power > before.power);
  assert.equal(after.title.ranked, true);
  assert.match(explainScore(after), /your ranking/);
});

test('a role you are looking for lifts everyone with it, whole words only', () => {
  const titles = { points: {}, roles: [{ text: 'account executive', points: 10 }] };
  const lifted = scorePerson(ae, undefined, undefined, titles);
  assert.equal(lifted.title.points, 10);
  assert.ok(lifted.power > scorePerson(ae).power);
  assert.equal(scorePerson(vp, undefined, undefined, titles).power, scorePerson(vp).power);   // not an AE
  // It can also push a role down, and several matches take the highest.
  assert.equal(scorePerson(vp, undefined, undefined, { points: {}, roles: [{ text: 'vp', points: 2 }] }).title.points, 2);
  assert.equal(scorePerson(ae, undefined, undefined, { points: {}, roles: [{ text: 'executive', points: 6 }, { text: 'account executive', points: 9 }] }).title.points, 9);
  assert.equal(titleHas('Doctor of Medicine', 'cto'), false);
  assert.equal(titleHas('Partner, VC fund', 'vc'), true);
});

test('a former role still counts 70% of your points', () => {
  const row = { id: 4, degree: 1, headline: 'Former Account Executive at Hooli' };
  const s = scorePerson(row, undefined, undefined, { points: {}, roles: [{ text: 'account executive', points: 10 }] });
  assert.equal(s.title.points, 7);
});

test('the whole network scores with it', () => {
  const titles = { points: {}, roles: [{ text: 'account executive', points: 10 }] };
  const plain = scoreNetwork([ae, owner, vp]).scores.get(1).power;
  const ranked = scoreNetwork([ae, owner, vp], { titles }).scores.get(1).power;
  assert.ok(ranked > plain);
});

test('the setting: cleaned, defaults not stored, refused with plain words', () => {
  const parsed = TITLE_RANKING_SETTING.parse({ points: { owner: 10, vp: LEVELS.vp.points, director: 6.8 }, roles: [{ text: '  Account   Executive ', points: 10 }, { text: 'account executive', points: 3 }] });
  assert.deepEqual(parsed, { points: { owner: 10, director: 7 }, roles: [{ text: 'account executive', points: 10 }] });
  assert.throws(() => TITLE_RANKING_SETTING.parse({ points: { emperor: 10 } }), /no kind of title/);
  assert.throws(() => TITLE_RANKING_SETTING.parse({ points: { owner: 11 } }), /0 to 10/);
  assert.throws(() => TITLE_RANKING_SETTING.parse({ roles: [{ text: 'a', points: 5 }] }), /two letters/);
  assert.throws(() => TITLE_RANKING_SETTING.parse({ roles: Array.from({ length: MAX_ROLES + 1 }, (_, i) => ({ text: `role ${i}`, points: 5 })) }), /Up to/);
  assert.equal(rankingFingerprint(NO_RANKING), 'none');
  assert.equal(isDefaultRanking(TITLE_RANKING_SETTING.parse({ points: { vp: LEVELS.vp.points } })), true);
  assert.equal(rankingFingerprint({ points: { owner: 10 }, roles: [{ text: 'b', points: 1 }, { text: 'a', points: 2 }] }),
    rankingFingerprint({ points: { owner: 10 }, roles: [{ text: 'a', points: 2 }, { text: 'b', points: 1 }] }));
  // Every preset with a ranking is a valid one.
  for (const p of RANKING_PRESETS) if (p.ranking) assert.doesNotThrow(() => TITLE_RANKING_SETTING.parse(p.ranking));
});

test('it is a setting like the others: stored, read back, a bad one refused', () => {
  const store = new Map();
  const db = {
    prepare: (sql) => ({
      get: () => (store.has('settings') ? { value: store.get('settings') } : undefined),
      run: (...args) => { store.set('settings', args.find((a) => typeof a === 'string' && a.startsWith('{'))); },
    }),
  };
  writeSettings(db, { titleRanking: { points: { owner: 10 }, roles: [] } });
  assert.deepEqual(readSettings(db).titleRanking, { points: { owner: 10 }, roles: [] });
  assert.throws(() => writeSettings(db, { titleRanking: { points: { owner: 'lots' } } }), SettingsError);
});
