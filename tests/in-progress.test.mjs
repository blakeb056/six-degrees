// A circle scan that stopped partway says so on the person's card and on the
// Scan page (lib/in-progress.js). Invented page numbers; nobody real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanBoxTitle, stoppedLine, inProgressSummary, pagesReadText, pagesKnownRead, pageRunsText } from '../lib/in-progress.js';

test('the scan box says IN PROGRESS before anything else when there is something to resume', () => {
  const resume = { nextPage: 5, pagesRead: 4, legacy: false };
  assert.equal(scanBoxTitle({ resume, hasCluster: true }), 'SCAN IN PROGRESS');
  // Nothing saved yet (everyone on the pages read was already yours) is still in progress.
  assert.equal(scanBoxTitle({ resume, hasCluster: false }), 'SCAN IN PROGRESS');
  assert.equal(scanBoxTitle({ resume: null, hasCluster: true }), 'CLUSTER ACTIVE');
  assert.equal(scanBoxTitle({ resume: null, hasCluster: false }), 'CREATE CLUSTER');
  // Not known yet: what the box said before.
  assert.equal(scanBoxTitle({ resume: undefined, hasCluster: true }), 'CLUSTER ACTIVE');
});

test('the line by their name names the last page read, and nothing when there is nothing to resume', () => {
  assert.equal(stoppedLine({ nextPage: 5, pagesRead: 4 }), 'Scan stopped after page 4');
  // Mapped before 0.1.6 kept notes: read to page 10.
  assert.equal(stoppedLine({ nextPage: 11, pagesRead: 10, legacy: true }), 'Scan stopped after page 10');
  assert.equal(stoppedLine({ nextPage: 1, pagesRead: 0 }), 'Scan stopped before its first page');
  assert.equal(stoppedLine(null), null);
  assert.equal(stoppedLine(undefined), null);
});

test('the In progress card counts the people, one or many, and is absent with nobody', () => {
  const one = [{ id: 'a', nextPage: 5 }];
  const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(inProgressSummary(one), '1 person stopped partway. Resume carries on from the page they stopped at.');
  assert.equal(inProgressSummary(three), '3 people stopped partway. Resume carries on from the page each one stopped at.');
  assert.equal(inProgressSummary([]), null);
  assert.equal(inProgressSummary(undefined), null);
  // An older server's answer with no list at all.
  assert.equal(inProgressSummary(null), null);
});

test('people mapped before whole lists were read are counted, so their page 10 makes sense', () => {
  assert.equal(
    inProgressSummary([{ id: 'a', legacy: true }]),
    '1 person stopped partway. Resume carries on from the page they stopped at. Their list was read to page 10, before whole lists were read.',
  );
  assert.equal(
    inProgressSummary([{ id: 'a', legacy: true }, { id: 'b' }]),
    '2 people stopped partway. Resume carries on from the page each one stopped at. 1 of them was read to page 10, before whole lists were read.',
  );
  assert.equal(
    inProgressSummary([{ id: 'a', legacy: true }, { id: 'b', legacy: true }, { id: 'c' }]),
    '3 people stopped partway. Resume carries on from the page each one stopped at. 2 of them were read to page 10, before whole lists were read.',
  );
});

test('none of it says scraping or uses an em dash', () => {
  const said = [
    scanBoxTitle({ resume: { pagesRead: 1 } }), stoppedLine({ pagesRead: 3 }), stoppedLine({ pagesRead: 0 }),
    inProgressSummary([{}]), inProgressSummary([{}, {}]), inProgressSummary([{ legacy: true }, { legacy: true }]),
  ].join('\n');
  assert.doesNotMatch(said, /scrap/i);
  assert.doesNotMatch(said, /—/);
});

// Blake, 2026-10-14: pages 2 to 14 of someone's list read, page 1 not (it opened on page 2),
// and the card said page 1, as if nothing was read. The pages read past a gap now say so.
test('pages read past one still to read: the card names them, and the page Resume starts at', () => {
  const resume = { nextPage: 1, pagesRead: 0, legacy: false, readPages: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] };
  assert.equal(stoppedLine(resume), 'Pages 2–14 read; page 1 still to read');
  assert.equal(pagesReadText(resume), 'Pages 2–14 read');
  const two = { nextPage: 6, pagesRead: 5, readPages: [1, 2, 3, 4, 5, 8, 9, 10, 12] };
  assert.equal(stoppedLine(two), 'Pages 1–5, 8–10 and 12 read; page 6 still to read');
  assert.equal(pagesReadText({ nextPage: 1, pagesRead: 0, readPages: [3] }), 'Page 3 read');
  // No gap, or no readPages at all (every note before 2026-10-14): as before.
  assert.equal(pagesReadText({ nextPage: 5, pagesRead: 4 }), 'Read to page 4');
  assert.equal(pagesReadText({ nextPage: 5, pagesRead: 4, readPages: [1, 2, 3, 4] }), 'Read to page 4');
  assert.equal(stoppedLine({ nextPage: 5, pagesRead: 4, readPages: [1, 2, 3, 4] }), 'Scan stopped after page 4');
});

test('the pages a note says are read: through the bookmark, and readPages past a gap, within page 100', () => {
  assert.deepEqual(pagesKnownRead({ pages: 3, more: true }), [1, 2, 3]);
  assert.deepEqual(pagesKnownRead({ pages: 0, more: true, readPages: [[2, 5]] }), [2, 3, 4, 5]);
  assert.deepEqual(pagesKnownRead({ pages: 2, readPages: [[1, 2], [4, 4], 7, 'x', [99, 300]] }), [1, 2, 4, 7, 99, 100]);
  assert.deepEqual(pagesKnownRead(null), []);
  assert.equal(pageRunsText([]), '');
  assert.equal(pageRunsText([4]), '4');
  assert.equal(pageRunsText([1, 2, 3, 7, 8]), '1–3 and 7–8');
});
