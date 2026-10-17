// Separation's results in tier sections (Blake, 2026-10-16: "I want the Separation to be
// more clean and readable, separating the tiers and cleaning up the UI on it so there's
// no clashing"). The list under the map is one section per tier, S to D, each counted and
// foldable; the tier chips show and hide whole sections; inside one, the list's own order
// (rank, or the slider's) stands. Every name here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  separationPeople, tierSections, tierShown, tierOf, sectionLayout, itemsBetween, TIERS,
} from '../lib/separation.js';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const bridge = (id, tier) => ({ id, name: `Bridge ${id}`, tier, power_score: 5, degree: 1, profile_url: `/in/bridge-${id}` });
const row = (id, url, via, tier, power_score) =>
  ({ id, degree: 2, name: `Person ${url}`, profile_url: url, source_connection_id: via, tier, power_score });

// Two gold and two purple connections; people of every tier, out of order on purpose.
const connections = [bridge('g1', 'S'), bridge('g2', 'S'), bridge('p1', 'A'), bridge('p2', 'A')];
const rows = [
  row('1', '/in/c-low', 'g1', 'C', 3.1),
  row('2', '/in/s-top', 'p1', 'S', 9.6),
  row('3', '/in/b-one', 'g2', 'B', 5.5),
  row('4', '/in/a-hi', 'g1', 'A', 7.9),
  row('5', '/in/s-two', 'g1', 'S', 9.1),
  row('6', '/in/s-two', 'p2', 'S', 9.1),     // a second way in to the same person
  row('7', '/in/d-one', 'p2', 'D', 1.2),
  row('8', '/in/a-lo', 'p1', 'A', 7.2),
  row('9', '/in/c-hi', 'p1', 'C', 3.8),
];
const model = separationPeople(rows, connections);

test('the results come back in sections S, A, B, C, D, each person in their own tier', () => {
  const sections = tierSections(model.people);
  assert.deepEqual(sections.map((s) => s.tier), ['S', 'A', 'B', 'C', 'D']);
  for (const s of sections) for (const p of s.people) assert.equal(p.tier, s.tier, p.key);
  // No one lost, no one twice.
  const all = sections.flatMap((s) => s.people.map((p) => p.key));
  assert.equal(all.length, model.people.length);
  assert.equal(new Set(all).size, all.length);
});

test('each section counts its people, and a tier with no one in it has no section', () => {
  const sections = tierSections(model.people);
  assert.deepEqual(Object.fromEntries(sections.map((s) => [s.tier, s.count])), { S: 2, A: 2, B: 1, C: 2, D: 1 });
  for (const s of sections) assert.equal(s.count, s.people.length);
  assert.deepEqual(Object.fromEntries(sections.map((s) => [s.tier, s.count])), model.summary.byTier, 'the same counts the chips show');
  const noB = tierSections(model.people.filter((p) => p.tier !== 'B'));
  assert.deepEqual(noB.map((s) => s.tier), ['S', 'A', 'C', 'D']);
  assert.deepEqual(tierSections([]), []);
});

test('a tier the app does not know goes to D, and the chips treat it as D', () => {
  const odd = { key: 'odd', tier: undefined, score: 0.4 };
  assert.equal(tierOf(odd), 'D');
  const sections = tierSections([...model.people, odd]);
  assert.ok(sections.find((s) => s.tier === 'D').people.includes(odd));
  assert.equal(tierShown(new Set(['D']), undefined), true);
  assert.equal(tierShown(new Set(['S']), undefined), false);
});

test('the tier chips show and hide whole sections; none switched on is every tier', () => {
  assert.deepEqual(tierSections(model.people, { tiers: new Set(['S', 'C']) }).map((s) => s.tier), ['S', 'C']);
  assert.deepEqual(tierSections(model.people, { tiers: new Set(['A']) }).map((s) => s.tier), ['A']);
  assert.deepEqual(tierSections(model.people, { tiers: new Set() }).map((s) => s.tier), TIERS);
  assert.deepEqual(tierSections(model.people, { tiers: null }).map((s) => s.tier), TIERS);
  for (const t of TIERS) {
    assert.equal(tierShown(null, t), true);
    assert.equal(tierShown(new Set(), t), true);
    assert.equal(tierShown(new Set([t]), t), true);
  }
  assert.equal(tierShown(new Set(['S']), 'A'), false);
  // A section shown is whole: every one of its people, the same objects, ways in untouched.
  const s = tierSections(model.people, { tiers: new Set(['S']) })[0];
  const whole = tierSections(model.people).find((x) => x.tier === 'S');
  assert.deepEqual(s.people, whole.people);
  const twoWays = s.people.find((p) => p.key === '/in/s-two');
  assert.deepEqual(twoWays.routes.map((r) => r.bridge.tier).sort(), ['A', 'S'], 'a purple and a gold way in, whatever the chip');
});

test('inside a section the list keeps its order: by rank, or as the slider has it', () => {
  const sections = tierSections(model.people);
  for (const sec of sections) {
    const ranks = sec.people.map((p) => p.rank);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${sec.tier} by rank`);
  }
  assert.deepEqual(sections.find((x) => x.tier === 'S').people.map((p) => p.key), ['/in/s-top', '/in/s-two']);
  assert.deepEqual(sections.find((x) => x.tier === 'C').people.map((p) => p.key), ['/in/c-hi', '/in/c-low']);
  // Reordered (the slider towards rare or easy): each section follows that order, never re-sorts it.
  const reordered = [...model.people].reverse();
  const again = tierSections(reordered);
  assert.deepEqual(again.map((x) => x.tier), ['S', 'A', 'B', 'C', 'D'], 'the sections stay S to D');
  assert.deepEqual(again.find((x) => x.tier === 'S').people.map((p) => p.key), ['/in/s-two', '/in/s-top']);
});

test('the layout: a header, then its rows; a folded section is its header alone', () => {
  const sections = tierSections(model.people, { collapsed: new Set(['A']) });
  assert.equal(sections.find((s) => s.tier === 'A').collapsed, true);
  const { items, height } = sectionLayout(sections, { top: 100, head: 44, row: 60, gap: 14 });
  const kinds = items.map((it) => (it.kind === 'head' ? `[${it.tier}]` : it.p.key));
  assert.deepEqual(kinds, ['[S]', '/in/s-top', '/in/s-two', '[A]', '[B]', '/in/b-one', '[C]', '/in/c-hi', '/in/c-low', '[D]', '/in/d-one']);
  // Back to back, a gap between sections, never an overlap.
  assert.equal(items[0].top, 100);
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const gap = items[i].kind === 'head' ? 14 : 0;
    assert.equal(items[i].top, prev.top + prev.height + gap, kinds[i]);
  }
  assert.equal(height, 5 * 44 + 4 * 14 + 6 * 60);
  // A section with a taller header of its own (the unranked finds' note).
  const tall = sectionLayout([{ tier: 'unranked', people: [{ key: 'u' }], head: 90, collapsed: false }], { head: 44, row: 60 });
  assert.deepEqual(tall.items.map((it) => [it.top, it.height]), [[0, 90], [90, 60]]);
});

test('windowing finds the items in view, whatever the sections above', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ key: `p${i}`, tier: TIERS[i % 5], rank: i + 1, score: 10 - i / 50 }));
  const { items, height } = sectionLayout(tierSections(many), { top: 300, head: 44, row: 60, gap: 14 });
  assert.equal(itemsBetween(items, 0, 300).length, 0, 'nothing above the list');
  const view = itemsBetween(items, 5000, 5900);
  assert.ok(view.length > 0 && view.length <= 17);
  for (const it of view) assert.ok(it.top < 5900 && it.top + it.height > 5000, it.key);
  // The ones just outside are left out.
  const first = items.indexOf(view[0]);
  assert.ok(first === 0 || items[first - 1].top + items[first - 1].height <= 5000);
  const last = items.indexOf(view[view.length - 1]);
  assert.ok(last === items.length - 1 || items[last + 1].top >= 5900);
  assert.equal(itemsBetween(items, 300 + height, 300 + height + 500).length, 0, 'nothing past the end');
});

test('the view draws the sections, folds them with a real button, and acts through OpenProfile', () => {
  const view = src('app/components/SeparationView.js');
  // The list is the sections, windowed by arithmetic.
  assert.match(view, /sectionLayout\(sections, \{ top: HEAD,/);
  assert.match(view, /itemsBetween\(list\.items, /);
  // A header is a heading with a button that says whether it's open.
  assert.match(view, /role="heading" aria-level=\{3\}/);
  assert.match(view, /<button type="button" aria-expanded=\{open\} onClick=\{\(\) => onToggle\(section\.tier\)\}/);
  // Each card: the person is a button (Tab, Enter, Space), and the two links are OpenProfile's.
  assert.match(view, /<button type="button" className="seppick" aria-pressed=\{selected\}/);
  assert.match(view, /<OpenProfile person=\{person\} stopPropagation className="sepgo"[\s\S]{0,200}onOpen=\{\(\) => \{ markRequested\(person, \{ bridgeId \}\)/);
  assert.match(view, /<OpenProfile person=\{person\} stopPropagation className="sepview"/);
  assert.doesNotMatch(view, /window\.open|target="_blank"/);
  // Where a request stands replaces Connect, in no tier's colour.
  assert.match(view, /asked: \{ text: 'Request sent'/);
  assert.match(view, /\.sepstate\[data-state="asked"\] \{ background: var\(--sd-fg-1/);
  // Hover is CSS, never React state (TRAPS §29).
  assert.doesNotMatch(view, /onMouseEnter|onMouseLeave/);
  // No em dash in what the view says.
  const strings = view.match(/'[^'\n]*'|`[^`\n]*`/g) || [];
  assert.deepEqual(strings.filter((t) => t.includes('\u2014')), []);
});
