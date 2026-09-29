// The live messages sync's full-history read (scrape.py --messages
// --full-history): it keeps scrolling until the list stops growing, at most 60
// scrolls or 1,000 conversations. What decides that is pure and runs here:
// tally_conversations (one conversation however many responses mention it,
// how many are new), history_done (why to stop), and live_groups (the group
// conversations it now sends, with no words).
//
// The real functions lifted out of scrape.py, as tests/messages-sync.test.mjs
// does. Nothing here opens LinkedIn; the people are invented.

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
names = {'conversation_id', 'tally_conversations', 'history_done', 'live_groups', 'live_people'}
consts = {'MESSAGE_HISTORY_SCROLLS', 'MESSAGE_HISTORY_MAX', 'MESSAGE_HISTORY_STILL', 'MESSAGE_SCROLLS', 'MESSAGE_WAIT'}
body = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in names)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
found = {n.name for n in body if isinstance(n, ast.FunctionDef)}
assert found == names, sorted(names - found)
ns = {'re': re, 'json': json}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
job = json.loads(sys.stdin.read())
out = {'limits': {k: ns[k] for k in consts}}
seen = {}
out['tallies'] = [ns['tally_conversations'](seen, batch) for batch in job['batches']]
out['seen'] = sorted(seen)
out['newest'] = {k: v['at'] for k, v in seen.items()}
out['done'] = [ns['history_done'](*case) for case in job['cases']]
me, _ = ns['live_people'](list(seen.values()))
out['me'] = me
out['groups'] = ns['live_groups'](list(seen.values()), me)
print(json.dumps(out))
`;

const T = 1790000000000;
const link = (id) => `https://www.linkedin.com/in/${id}/`;
const thread = (n) => `https://www.linkedin.com/messaging/thread/2-INVENTED${n}/`;
const ME = link('ACoAME0');
const convo = (n, people, at, extra = {}) => ({ people: [ME, ...people].sort(), at, unread: 0, names: {}, url: thread(n), group: null, latest: null, ...extra });

function run(t, job) {
  const r = spawnSync(PYTHON, ['-c', LIFT, SCRAPER], { input: JSON.stringify(job), encoding: 'utf8' });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('the ceilings: 60 scrolls, 1,000 conversations, 3 still scrolls, fixed 4-second waits; the daily sync stays at 15', (t) => {
  const out = run(t, { batches: [], cases: [] });
  if (!out) return;
  assert.deepEqual(out.limits, {
    MESSAGE_HISTORY_SCROLLS: 60, MESSAGE_HISTORY_MAX: 1000, MESSAGE_HISTORY_STILL: 3, MESSAGE_SCROLLS: 15, MESSAGE_WAIT: 4,
  });
});

test('each conversation counts once however many responses carry it, and keeps its newest activity', (t) => {
  const ada = link('ACoAADA');
  const ben = link('ACoABEN');
  const out = run(t, {
    batches: [
      [convo(1, [ada], T + 10), convo(2, [ben], T + 5)],
      [convo(1, [ada], T + 30), convo(2, [ben], T + 1)],     // the same two again, one newer
      [convo(3, [ada, ben], T + 20), { people: [ME, ada], at: T + 2, unread: 0, names: {}, url: null, latest: null }],
      [],
    ],
    cases: [],
  });
  if (!out) return;
  assert.deepEqual(out.tallies, [2, 0, 2, 0]);
  assert.equal(out.seen.length, 4, 'a conversation with no link is known by who is in it');
  assert.equal(out.newest[thread(1)], T + 30, 'the newer sighting wins');
  assert.equal(out.newest[thread(2)], T + 5, 'an older one does not');
});

test('it stops when the list stops growing, or at a ceiling, and not before', (t) => {
  const out = run(t, {
    batches: [],
    cases: [
      [[20, 20, 20], 60],                 // still growing
      [[20, 20, 0, 0], 40],               // two still scrolls: could be a slow load
      [[20, 20, 0, 0, 0], 40],            // three: the end
      [[20, 0, 0, 5], 25],                // it grew again after a pause
      [Array(60).fill(10), 600],          // 60 scrolls
      [[400, 400, 250], 1050],            // 1,000 conversations
      [[20, 0, 0, 0], 20, 60, 1000, 5],   // patience given
    ],
  });
  if (!out) return;
  const [growing, two, three, again, scrolls, many, patient] = out.done;
  assert.equal(growing, null);
  assert.equal(two, null);
  assert.match(three, /stopped growing/);
  assert.equal(again, null);
  assert.match(scrolls, /60 scrolls/);
  assert.match(many, /1,000 conversations/);
  assert.equal(patient, null);
});

test('groups: everyone but you, the names only for matching, who wrote last, and no words', (t) => {
  const ada = link('ACoAADA');
  const ben = link('ACoABEN');
  const cy = link('ACoACYM');
  const out = run(t, {
    batches: [[
      convo(1, [ada], T + 1),
      convo(2, [ben], T + 2),
      convo(3, [ada, ben, cy], T + 9, {
        group: true, unread: 4, names: { [ada]: 'Ada Quill', [cy]: 'Cy Marsh' },
        latest: { t: T + 9, from: cy, text: 'Invented plans for the picnic' },
      }),
      convo(4, [ben, cy], T + 3, { latest: { t: T + 3, from: ME, text: 'Invented reply' } }),
    ]],
    cases: [],
  });
  if (!out) return;
  assert.equal(out.me, ME);
  const byUrl = Object.fromEntries(out.groups.map((g) => [g.threadUrl, g]));
  assert.deepEqual(Object.keys(byUrl).sort(), [thread(3), thread(4)]);
  assert.deepEqual(byUrl[thread(3)], {
    threadUrl: thread(3), people: [ada, ben, cy].sort(), names: { [ada]: 'Ada Quill', [cy]: 'Cy Marsh' },
    last: T + 9, unread: 4, lastFromThem: true,
  });
  assert.equal(byUrl[thread(4)].lastFromThem, false, 'you wrote last');
  const all = JSON.stringify(out.groups);
  assert.ok(!all.includes('picnic') && !all.includes('Invented reply'), 'no words');
});
