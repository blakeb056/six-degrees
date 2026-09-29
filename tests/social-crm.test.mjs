// The Social tab's CRM (lib/social-crm.js, app/api/social/crm): everyone
// you've been in touch with as one contact each, the views (Inbox, Awaiting
// reply, Follow-ups due, Pipeline, Sent, Received), your own notes kept per
// profile, and the CSV export. Invented people and text only.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildContacts, inboxOf, awaitingOf, followUpsDue, pipelineOf, sentOf, receivedOf, suggestedStage, matchesContact,
  emptyCrm, cleanCrm, patchCrm, cleanTags, crmCsv, csvCell, localDay, AWAIT_DAYS,
} from '../lib/social-crm.js';

register('./helpers/extensionless.mjs', import.meta.url);

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 29, 12);
const url = (s) => `https://www.linkedin.com/in/${s}`;
const ADA = url('ada-quill');       // a connection who wrote last
const BEN = url('ben-ostrander');   // a connection you wrote to, no reply for 12 days
const CY = url('cy-marsh');         // 2nd degree, a request tracked in the app, through Ada
const DEE = url('dee-park');        // not a connection: messaged you, invited you
const EVE = url('eve-lind');        // a request you sent, since accepted
const ACME = 'https://www.linkedin.com/company/invented-acme';

const network = {
  degree1: [
    { id: 'r-ada', name: 'Ada Quill', profile_url: ADA, tier: 'A', company: 'Hooli', degree: 1 },
    { id: 'r-ben', name: 'Ben Ostrander', profile_url: BEN, tier: 'S', company: 'Initech', degree: 1 },
    { id: 'r-eve', name: 'Eve Lind', profile_url: EVE, tier: 'B', company: 'Vandelay', degree: 1, outreach_status: 'sent' },
  ],
  degree2: [
    { id: 'r-cy1', name: 'Cy Marsh', profile_url: CY, tier: 'S', company: 'Globex', degree: 2, source_connection_id: 'r-ada', outreach_status: 'sent', unlock_status: 'pending' },
    { id: 'r-cy2', name: 'Cy Marsh', profile_url: CY, tier: 'S', company: 'Globex', degree: 2, source_connection_id: 'r-ben' },
  ],
};

const conversations = [
  { id: 'c-ada', people: [ADA], group: false, last: NOW - 2 * DAY, lastFromThem: true, count: 6, mine: 3, unread: null },
  { id: 'c-ben', people: [BEN], group: false, last: NOW - 12 * DAY, lastFromThem: false, count: 2, mine: 2, unread: null },
  { id: 'c-ben-old', people: [BEN], group: false, last: NOW - 400 * DAY, lastFromThem: true, count: 9, mine: 4 },
  { id: 'c-dee', people: [DEE], group: false, last: NOW - 1 * DAY, lastFromThem: true, count: 1, mine: 0, unread: 1 },
  { id: 'c-ad', people: [ACME], group: false, kind: 'sponsored', last: NOW - DAY, lastFromThem: true, count: 1, mine: 0 },
  { id: 'c-ezra', people: ['name:ezra vale'], group: false, last: NOW - 30 * DAY, lastFromThem: false, count: 1, mine: 1 },
  { id: 'g1', people: [ADA, DEE], group: true, last: NOW - 3 * DAY, lastFromThem: true, count: 4 },
  { id: 'c-nobody', people: [], group: false, last: NOW - 5 * DAY, lastFromThem: false, count: 1, mine: 1 },
];
const invitations = [
  { id: `in|${DEE}|1`, dir: 'in', key: DEE, name: 'Dee Park', t: NOW - 4 * DAY },
  { id: `in|${ADA}|2`, dir: 'in', key: ADA, name: 'Ada Quill', t: NOW - 900 * DAY },
  { id: 'out|name:eve lind|3', dir: 'out', key: 'name:eve lind', name: 'Eve Lind', t: NOW - 20 * DAY },
  { id: 'out|name:finn oak|4', dir: 'out', key: 'name:finn oak', name: 'Finn Oak', t: NOW - 6 * DAY },
];
const names = { [DEE]: 'Dee Park', 'name:ezra vale': 'Ezra Vale', [ACME]: 'Invented Acme' };
const crm = cleanCrm({
  people: {
    [ADA]: { stage: 'meeting', tags: ['investor', 'Orlando'], notes: 'Invented: coffee in October', followUp: '2026-09-29' },
    [DEE]: { stage: 'new', followUp: '2026-10-15' },
    [url('gil-noone')]: { notes: 'Invented: met at a meetup', followUp: '2026-09-01' },
  },
});

const built = () => buildContacts({ conversations, invitations, network, crm, names });

test('one contact per person: connections and not, joined by link or name, with their card basics', () => {
  const { contacts, groups } = built();
  const ada = contacts.get(ADA);
  assert.deepEqual([ada.name, ada.connection, ada.row.tier, ada.row.company], ['Ada Quill', true, 'A', 'Hooli']);
  assert.equal(ada.crm.stage, 'meeting');
  const ben = contacts.get(BEN);
  assert.deepEqual([ben.last, ben.lastFromThem, ben.count, ben.conversations.map((c) => c.id)], [NOW - 12 * DAY, false, 11, ['c-ben', 'c-ben-old']], 'the newest conversation says who wrote last');
  const dee = contacts.get(DEE);
  assert.deepEqual([dee.name, dee.connection, dee.profileUrl, dee.groups], ['Dee Park', false, DEE, ['g1']]);
  assert.deepEqual(contacts.get(CY).introducers.sort(), ['Ada Quill', 'Ben Ostrander'], 'who can introduce you, 2nd degree');
  assert.equal(contacts.get(EVE).invitesOut.length, 1, 'a name-only request joins the network\'s person of that name');
  assert.deepEqual([contacts.get('name:finn oak').name, contacts.get('name:finn oak').profileUrl], ['Finn Oak', null]);
  assert.equal(contacts.get('name:ezra vale').name, 'Ezra Vale');
  assert.equal(contacts.get(ACME).kind, 'sponsored');
  assert.ok(contacts.has(url('gil-noone')), 'a CRM note alone makes a contact');
  assert.deepEqual(groups.map((g) => g.id).sort(), ['c-nobody', 'g1'], 'groups, and a conversation with no one named, are kept apart, not dropped');
});

test('Inbox: waiting on you, unread first; adverts are not', () => {
  const { contacts } = built();
  assert.deepEqual(inboxOf(contacts.values()).map((c) => c.key), [DEE, ADA]);
});

test('Awaiting reply: you wrote last and N days have passed, 7 unless you say otherwise', () => {
  const { contacts } = built();
  assert.equal(AWAIT_DAYS, 7);
  assert.deepEqual(awaitingOf(contacts.values(), NOW).map((a) => [a.contact.key, a.waited]), [[BEN, 12], ['name:ezra vale', 30]]);
  assert.deepEqual(awaitingOf(contacts.values(), NOW, 20).map((a) => a.contact.key), ['name:ezra vale']);
  assert.deepEqual(awaitingOf(contacts.values(), NOW, 31), []);
});

test('Follow-ups due: today or overdue, oldest first; later ones wait', () => {
  const { contacts } = built();
  assert.deepEqual(followUpsDue(contacts.values(), '2026-09-29').map((c) => c.key), [url('gil-noone'), ADA]);
  assert.deepEqual(followUpsDue(contacts.values(), '2026-10-15').map((c) => c.key), [url('gil-noone'), ADA, DEE]);
  assert.match(localDay(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('Sent: requests from the export and the app, with their status, and messages awaiting a reply', () => {
  const { contacts } = built();
  const sent = Object.fromEntries(sentOf(contacts.values(), NOW).map((s) => [s.contact.key, s.items]));
  assert.deepEqual(sent[EVE].map((i) => [i.type, i.status]), [['invite', 'accepted'], ['request', 'accepted']], 'accepted: they\'re a connection now');
  assert.deepEqual(sent['name:finn oak'].map((i) => [i.type, i.status]), [['invite', 'pending']]);
  assert.deepEqual(sent[CY].map((i) => [i.type, i.status]), [['request', 'pending']]);
  assert.deepEqual(sent[BEN].map((i) => [i.type, i.waited]), [['awaiting', 12]]);
  assert.equal(sent[ADA], undefined);
});

test('Received: requests to you from people who aren\'t connections yet', () => {
  const { contacts } = built();
  assert.deepEqual(receivedOf(contacts.values()).map((r) => r.contact.key), [DEE], 'Ada\'s was accepted long ago: she\'s a connection');
});

test('Pipeline by stage, suggested stages, and search across names, companies, tags, notes and what was said', () => {
  const { contacts } = built();
  const p = pipelineOf(contacts.values());
  assert.deepEqual(Object.keys(p), ['new', 'contacted', 'replied', 'meeting', 'won', 'not-now']);
  assert.deepEqual([p.meeting.map((c) => c.key), p.new.map((c) => c.key)], [[ADA], [DEE]]);
  assert.deepEqual([suggestedStage(contacts.get(ADA)), suggestedStage(contacts.get(CY)), suggestedStage(contacts.get(url('gil-noone')))], ['replied', 'contacted', 'new']);
  const find = (q, said) => [...contacts.values()].filter((c) => matchesContact(c, q, said)).map((c) => c.key);
  assert.deepEqual(find('hooli'), [ADA]);
  assert.deepEqual(find('ORLANDO'), [ADA], 'tags, whatever the case');
  assert.deepEqual(find('meetup'), [url('gil-noone')], 'notes');
  assert.deepEqual(find('lighthouse', new Set(['c-ben-old'])), [BEN], 'kept messages, by conversation');
});

test('the store: only real fields, merged one person at a time, cleared when empty', () => {
  assert.deepEqual(cleanTags(['VIP', 'vip', ' a,b ', '', 'x'.repeat(80)]), ['VIP', 'a b', 'x'.repeat(40)]);
  const raw = { settings: { awaitDays: 'lots' }, people: { [ADA]: { stage: 'best-friend', tags: 'one, two', notes: '  ', followUp: '2026-02-30', password: 'no' }, '': { notes: 'x' } } };
  const clean = cleanCrm(raw);
  assert.deepEqual(clean, { version: 1, settings: { awaitDays: 7 }, people: { [ADA]: { tags: ['one', 'two'] } } });

  let s = patchCrm(emptyCrm(), { key: BEN, set: { stage: 'contacted', notes: 'Invented first note' } }, NOW);
  s = patchCrm(s, { key: BEN, set: { tags: ['partner'], followUp: '2026-10-01' } }, NOW + 1000);
  assert.deepEqual(s.people[BEN], {
    stage: 'contacted', tags: ['partner'], notes: 'Invented first note', followUp: '2026-10-01', updatedAt: new Date(NOW + 1000).toISOString(),
  }, 'the second change keeps the first');
  s = patchCrm(s, { key: BEN, set: { notes: '', tags: [] } }, NOW);
  assert.deepEqual(Object.keys(s.people[BEN]).sort(), ['followUp', 'stage', 'updatedAt']);
  s = patchCrm(s, { key: BEN, set: { stage: null, followUp: null } }, NOW);
  assert.equal(s.people[BEN], undefined, 'nothing left: taken out');
  assert.equal(patchCrm(s, { settings: { awaitDays: 14 } }).settings.awaitDays, 14);
  assert.equal(patchCrm(s, { settings: { awaitDays: 0 } }).settings.awaitDays, 7);
});

test('the CSV: every column, quoted where it must be, and no formulas', () => {
  const { contacts } = built();
  const text = crmCsv([contacts.get(ADA), contacts.get(DEE), contacts.get(BEN)]);
  assert.ok(text.startsWith('﻿Name,Company,Profile,Connection,Stage,Tags,Last contact,Who wrote last,Next follow-up,Notes\r\n'));
  const lines = text.slice(1).trim().split('\r\n');
  assert.equal(lines[1], `Ada Quill,Hooli,${ADA},Yes,Meeting,investor; Orlando,2026-09-27,Them,2026-09-29,Invented: coffee in October`);
  assert.equal(lines[2], `Dee Park,,${DEE},No,New,,2026-09-28,Them,2026-10-15,`);
  assert.equal(lines[3], `Ben Ostrander,Initech,${BEN},Yes,,,2026-09-17,You,,`);
  assert.equal(csvCell('He said "hi", then left\nfor lunch'), '"He said ""hi"", then left\nfor lunch"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('-5 invented'), "'-5 invented");
  assert.equal(csvCell(null), '');
});

// ── The route, on a temporary data folder ─────────────────────────────────

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-crm-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
let crmRoute;
let socialRoute;
let files;

before(async () => {
  const { resolveProfile } = await import('../lib/profile.js');
  resolveProfile({ create: true });
  crmRoute = await import('../app/api/social/crm/route.js');
  socialRoute = await import('../app/api/social/route.js');
  ({ socialFiles: files } = await import('../lib/social-store.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const patch = (body) => crmRoute.PATCH(new Request('http://127.0.0.1/api/social/crm', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).then((r) => r.json());

test('the route keeps your notes per profile, one person at a time, and deletes them only when asked', async () => {
  assert.deepEqual((await (await crmRoute.GET()).json()).crm, emptyCrm());
  await patch({ key: ADA, set: { stage: 'replied', notes: 'Invented note' } });
  await patch({ key: ADA, set: { tags: ['friend'] } });
  const saved = await patch({ settings: { awaitDays: 10 } });
  assert.equal(saved.settings.awaitDays, 10);
  const { crm: got } = await (await crmRoute.GET()).json();
  assert.deepEqual([got.people[ADA].stage, got.people[ADA].notes, got.people[ADA].tags], ['replied', 'Invented note', ['friend']]);
  const file = files().crm;
  assert.match(path.basename(file), /^crm-[\w-]+\.json$/);
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).people[ADA]);

  // Forget it (the Social tab's findings) leaves the notes: they go on their own confirm.
  await socialRoute.DELETE();
  assert.ok(existsSync(file));
  await crmRoute.DELETE();
  assert.equal(existsSync(file), false);
  assert.deepEqual((await (await crmRoute.GET()).json()).crm, emptyCrm());
});
