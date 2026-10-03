import test from 'node:test';
import assert from 'node:assert/strict';
import { addedBackNotification, topCompanyNotification, scanDoneNotification, noteSubject } from '../lib/notifications.js';

// Invented people.
const yuki = { id: 'y', name: 'Yuki Moreau', degree: 1, tier: 'B' };
const ana = { id: 'a', name: 'Ana Lee', degree: 1, tier: 'S', power_score: 8.14, headline: 'CEO at Halcyon', unlocked_from_bridge_id: 'y' };

test('added back: who, through whom, and whether they are worth knowing', () => {
  const n = addedBackNotification({ person: ana, via: yuki, userId: 'me' });
  assert.equal(n.type, 'added_back');
  assert.equal(n.title, 'Ana Lee added you back, through Yuki Moreau');
  assert.match(n.message, /^S-tier · 8\.1 · a valuable person to know · CEO at Halcyon$/);
  assert.deepEqual(n.data, { personId: 'a', viaId: 'y', tier: 'S' });
  assert.equal(addedBackNotification({ person: { ...ana, tier: 'C' }, via: null }).icon, '🤝');
  assert.equal(addedBackNotification({ person: null }), null);
});

test('people at top companies: only from the company score up, best first, one notification', () => {
  const people = [
    { id: 'p1', company: 'Big Co', company_prestige_score: 9, power_score: 7 },
    { id: 'p2', company: 'Small Co', company_prestige_score: 4 },
    { id: 'p3', company: 'Mid Co', company_prestige_score: 8, power_score: 9 },
  ];
  const n = topCompanyNotification({ people, via: yuki });
  assert.equal(n.title, '2 people at top companies in Yuki Moreau’s circle');
  assert.equal(n.message, 'Big Co, Mid Co');
  assert.deepEqual(n.data.personIds, ['p1', 'p3']);
  assert.equal(topCompanyNotification({ people: [people[1]] }), null);
});

test('a finished scan says so; a stop, a failure or a setup step says nothing', () => {
  const n = scanDoneNotification({ action: 'bridge', target: { id: 'y', name: 'Yuki Moreau' }, exitCode: 0, log: ['Speed: Fast.', 'Saved 120 people.', 'Finished.'] });
  assert.equal(n.title, 'Scan done: Yuki Moreau’s circle');
  assert.equal(n.message, 'Saved 120 people.');
  assert.equal(n.data.personId, 'y');
  assert.equal(scanDoneNotification({ action: 'bridge', exitCode: 1 }), null);
  assert.equal(scanDoneNotification({ action: 'bridge', exitCode: 0, stopped: true }), null);
  assert.equal(scanDoneNotification({ action: 'setup', exitCode: 0 }), null);
  assert.equal(scanDoneNotification({ action: 'auto-bridge', exitCode: 0 }).title, 'Mapping the 2nd degree: done for now');
});

test('who a notification is about: by id, else by the name in an older title; and who they came through', () => {
  const d1 = [yuki, ana];
  assert.equal(noteSubject({ data: { personId: 'a' } }, d1).person, ana);
  const old = noteSubject({ title: 'Ana Lee accepted! +100 XP', data: '{}' }, d1);
  assert.equal(old.person, ana);
  assert.equal(old.via, yuki, 'their recorded introducer');
  assert.equal(noteSubject({ title: 'Network up to date' }, d1).person, null);
  const many = noteSubject({ data: { personIds: ['a', 'y', 'gone'] } }, d1);
  assert.deepEqual(many.people.map((p) => p.id), ['a', 'y']);
});
