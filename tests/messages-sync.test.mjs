// The live messages sync's reader (scrape.py voyager_conversations and
// live_people): from a messaging response, per conversation, who's in it, its
// link, unread, whether it's a group, and the newest message (when, from whom,
// its words); then per person, the 1:1 ones only. And the sample kept for
// tuning the reader (_redact_words) still has no words and no names.
//
// These run the real functions lifted out of scrape.py, on a response shaped
// like LinkedIn's (conversation.messages.elements[], body.text, deliveredAt,
// actor.participantType.member.profileUrl). Nothing here opens LinkedIn; the
// people and what they wrote are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');

const LIFT = `
import ast, json, re, sys
tree = ast.parse(open(sys.argv[1]).read())
names = {'_redact_words', '_dig', '_link_key', 'voyager_conversations', 'live_people'}
consts = {'_WORDS', '_PROFILE_LINK'}
body = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in names)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
found = {n.name for n in body if isinstance(n, ast.FunctionDef)}
assert found == names, sorted(names - found)
ns = {'re': re, 'json': json}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
payload = json.loads(sys.stdin.read())
convos = ns['voyager_conversations'](payload)
me, people = ns['live_people'](convos)
print(json.dumps({'convos': convos, 'me': me, 'people': people, 'sample': ns['_redact_words'](payload)}))
`;

const T = 1790000000000;
const link = (id) => `https://www.linkedin.com/in/${id}`;
const member = (id, first, last) => ({ participantType: { member: { profileUrl: link(id), firstName: { text: first }, lastName: { text: last } } } });
const message = (t, from, text) => ({ body: { text }, deliveredAt: t, actor: { participantType: { member: { profileUrl: link(from) } } } });
const conversation = (n, { people, group = false, unread = 0, at = T, messages = [] }) => ({
  conversationUrl: `https://www.linkedin.com/messaging/thread/2-INVENTED${n}/`,
  unreadCount: unread,
  lastActivityAt: at,
  groupChat: group,
  conversationParticipants: people,
  messages: { elements: messages },
});

const ME = member('ACoAME0', 'Moe', 'Self');
const payload = {
  data: {
    messengerConversationsBySyncToken: {
      elements: [
        conversation(1, { people: [ME, member('ACoAADA', 'Ada', 'Quill')], unread: 2, at: T + 3000, messages: [message(T + 3000, 'ACoAADA', 'Invented hello about the lighthouse')] }),
        conversation(2, { people: [ME, member('ACoABEN', 'Ben', 'Ostrander')], at: T + 2000, messages: [message(T + 1000, 'ACoABEN', 'older'), message(T + 2000, 'ACoAME0', 'Invented reply about kites')] }),
        conversation(3, { people: [ME, member('ACoAADA', 'Ada', 'Quill'), member('ACoACYM', 'Cy', 'Marsh')], group: true, at: T + 4000, messages: [message(T + 4000, 'ACoACYM', 'Invented group chatter')] }),
        conversation(4, { people: [ME, member('ACoADEE', 'Dee', 'Park')], at: T + 500 }),
      ],
    },
  },
};

function read(t) {
  const r = spawnSync(PYTHON, ['-c', LIFT, SCRAPER], { input: JSON.stringify(payload), encoding: 'utf8' });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('each conversation: its link, unread, group or not, and the newest message', (t) => {
  const out = read(t);
  if (!out) return;
  assert.equal(out.convos.length, 4);
  const [ada, ben, group, dee] = out.convos;
  assert.equal(ada.url, 'https://www.linkedin.com/messaging/thread/2-INVENTED1/');
  assert.equal(ada.unread, 2);
  assert.equal(ada.group, false);
  assert.deepEqual(ada.latest, { t: T + 3000, from: `${link('ACoAADA')}/`, text: 'Invented hello about the lighthouse' });
  assert.deepEqual(ben.latest, { t: T + 2000, from: `${link('ACoAME0')}/`, text: 'Invented reply about kites' }, 'the newest of several');
  assert.equal(group.group, true);
  assert.equal(dee.latest, null);
});

test('per person: 1:1 only, who wrote last, the thread link, the preview, and the name only for matching', (t) => {
  const out = read(t);
  if (!out) return;
  assert.equal(out.me, `${link('ACoAME0')}/`);
  assert.deepEqual(Object.keys(out.people).sort(), [`${link('ACoAADA')}/`, `${link('ACoABEN')}/`, `${link('ACoADEE')}/`], 'the group is left out');
  assert.deepEqual(out.people[`${link('ACoAADA')}/`], {
    last: T + 3000, unread: 2, name: 'Ada Quill', threadUrl: 'https://www.linkedin.com/messaging/thread/2-INVENTED1/',
    lastFromThem: true, preview: { t: T + 3000, fromMe: false, text: 'Invented hello about the lighthouse' },
  });
  const ben = out.people[`${link('ACoABEN')}/`];
  assert.deepEqual([ben.lastFromThem, ben.preview.fromMe], [false, true]);
  const dee = out.people[`${link('ACoADEE')}/`];
  assert.deepEqual([dee.lastFromThem, dee.preview], [null, null], 'no message sent along: unknown, not "you"');
});

test('a wire sample of the same response keeps no words and no names', (t) => {
  const out = read(t);
  if (!out) return;
  const sample = JSON.stringify(out.sample);
  for (const words of ['lighthouse', 'kites', 'chatter', 'older', 'Ada', 'Quill', 'Ostrander', 'Marsh', 'Moe']) {
    assert.ok(!sample.includes(words), words);
  }
  assert.ok(sample.includes('2-INVENTED1') && sample.includes(String(T + 3000)), 'the shape stays: links and dates');
});
