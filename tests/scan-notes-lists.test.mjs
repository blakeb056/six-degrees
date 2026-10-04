// The rings round a connection's dot show how far their list was read
// (lib/reach.js scanBars), from GET /api/scraper?reach=1's `lists`. The page's
// loader dropped `lists` until 2026-10-03, so every scanned connection drew 2
// of 5 bars, "partly read", even when their whole list was in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScanNotes, NO_SCAN_NOTES } from '../lib/scraper-client.js';
import { reachIndex, scanBars } from '../lib/reach.js';

const URL_A = 'https://www.linkedin.com/in/ada-quill';
const URL_B = 'https://www.linkedin.com/in/bo-larsen';

function answering(body, ok = true) {
  const was = globalThis.fetch;
  globalThis.fetch = async () => ({ ok, json: async () => body });
  return () => { globalThis.fetch = was; };
}

test('the loader keeps how far each list was read', async () => {
  const lists = { [URL_A]: { pages: 12, more: false, total: 118 }, [URL_B]: { pages: 3, more: true, total: 240 } };
  const restore = answering({ skips: [], read: [URL_A, URL_B], lists });
  try {
    const notes = await loadScanNotes();
    assert.deepEqual(notes.lists, lists);
    assert.deepEqual(notes.read, [URL_A, URL_B]);
  } finally { restore(); }
});

test('a whole list read draws all 5 bars, a part-read one fewer', async () => {
  const restore = answering({
    skips: [], read: [URL_A, URL_B],
    lists: { [URL_A]: { pages: 12, more: false, total: 118 }, [URL_B]: { pages: 3, more: true, total: 240 } },
  });
  try {
    const notes = await loadScanNotes();
    const ada = { id: 'a', name: 'Ada Quill', profile_url: URL_A, degree: 1 };
    const bo = { id: 'b', name: 'Bo Larsen', profile_url: URL_B, degree: 1 };
    const reach = reachIndex([ada, bo], [], notes);
    assert.equal(scanBars(ada, reach), 5);
    assert.ok(scanBars(bo, reach) < 5);
  } finally { restore(); }
});

test('no lists, or lists that are not an object, read as none', async () => {
  for (const lists of [undefined, null, [], 'x', 7]) {
    const restore = answering({ skips: [], read: [], lists });
    try {
      assert.deepEqual((await loadScanNotes()).lists, {});
    } finally { restore(); }
  }
  assert.deepEqual(NO_SCAN_NOTES.lists, {});
});
