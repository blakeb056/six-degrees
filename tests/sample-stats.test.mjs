// The launch page's numbers are the invented sample network's own
// (lib/sample-stats.js), counted again from public/demo-data.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAMPLE_STATS } from '../lib/sample-stats.js';
import { buildCompanyIndex } from '../lib/companies.js';

test('the launch page\'s numbers are the invented sample\'s, counted from the file', () => {
  const demo = JSON.parse(readFileSync(new URL('../public/demo-data.json', import.meta.url), 'utf8'));
  assert.equal(demo.meta.synthetic, true);
  const { degree1: d1, degree2: d2 } = demo;
  const rows = [...d1, ...d2];
  const connected = new Set(d1.map((r) => r.profile_url));
  assert.deepEqual(SAMPLE_STATS, {
    connections: rows.length,
    degree1: d1.length,
    degree2: d2.length,
    people: new Set(rows.map((r) => r.profile_url)).size,
    bridges: new Set(d2.map((r) => r.source_connection_id).filter(Boolean)).size,
    companies: buildCompanyIndex(rows).size,
    // As app/queue/page.js builds its recommendations.
    recommendations: d2.filter((r) => ['S', 'A', 'B'].includes(r.tier) && !connected.has(r.profile_url)).length,
  });
});
