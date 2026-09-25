import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectionsCsv, packConnections, unpackConnections } from '../lib/csv.js';

// An invented export in LinkedIn's format: a Notes preamble, then the columns.
function exportOf(n) {
  const first = ['Ava', 'Ben', 'Cleo', 'Dara', 'Eli', 'Fiona', 'Gus', 'Hana', 'Ivo', 'Jae'];
  const last = ['Hollis', 'Pereira', 'Dumont', 'Ximenes', 'Jokinen', 'Tsegaye', 'Ingram', 'Lindgren'];
  const roles = ['Software Engineer', 'Founder', 'VP of Sales', 'Chief Technology Officer', 'Designer', 'Recruiter'];
  const cos = ['Northwind Labs', 'Halcyon', 'Meridian Health', 'Ironwood Capital', 'Cobalt Studio'];
  const lines = ['Notes:', '"When exporting your connection data, you may notice that some of the email addresses are missing."', '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On'];
  for (let i = 0; i < n; i++) {
    lines.push([first[i % 10], `${last[i % 8]}-${i}`, `https://www.linkedin.com/in/invented-person-${i}`, '',
      cos[i % 5], roles[i % 6], '01 Sep 2026'].join(','));
  }
  return lines.join('\n');
}

test('an export at LinkedIn\'s 30,000 maximum fits in the tab once packed', () => {
  const { connections } = parseConnectionsCsv(exportOf(30000));
  assert.equal(connections.length, 30000);
  const stored = JSON.stringify({ packed: packConnections(connections), degree2: [], source: 'csv', importedAt: 0 });
  // Chrome's per-origin session storage holds about 5 million characters.
  assert.ok(stored.length < 4_500_000, `packed is ${stored.length} characters`);
  // The old form (every scored field) would not have fitted.
  assert.ok(JSON.stringify(connections).length > 5_000_000);
});

test('packing and unpacking gives back exactly what was parsed', () => {
  const { connections } = parseConnectionsCsv(exportOf(500));
  const back = unpackConnections(JSON.parse(JSON.stringify(packConnections(connections))));
  assert.deepEqual(back, connections);
});
