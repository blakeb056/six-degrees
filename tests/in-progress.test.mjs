// A circle scan that stopped partway says so on the person's card and on the
// Scan page (lib/in-progress.js). Invented page numbers; nobody real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanBoxTitle, stoppedLine, inProgressSummary } from '../lib/in-progress.js';

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
