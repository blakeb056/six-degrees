import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('an import is graded on its own curve, the same on the import page and on the map', () => {
  // Thirty invented people at companies the built-in list doesn't know: an owner, three
  // directors, eight managers and eighteen technicians, as a first look at a real export.
  const town = ['North', 'South', 'East', 'West', 'Harbor', 'Pine', 'Maple', 'Cedar', 'Lake', 'River'];
  const trade = ['Plumbing', 'Electric', 'Freight'];
  const title = (k) => (k === 0 ? 'Owner' : k <= 3 ? 'Director of Operations' : k <= 11 ? 'Store Manager' : 'Technician');
  const lines = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On'];
  for (let k = 0; k < 30; k++) {
    lines.push(['Invented', `Person-${k}`, `https://www.linkedin.com/in/invented-worker-${k}`, '', `${town[k % 10]} ${trade[Math.floor(k / 10)]}`, title(k), '01 Sep 2026'].join(','));
  }
  const count = (list) => list.reduce((m, x) => ({ ...m, [x.tier]: (m[x.tier] || 0) + 1 }), {});
  const { connections } = parseConnectionsCsv(lines.join('\n'));
  // On the fixed scale this export would be 1 A, 11 B and 18 C: no S at all.
  assert.deepEqual(count(connections), { S: 1, A: 3, B: 8, C: 18 });
  const back = unpackConnections(JSON.parse(JSON.stringify(packConnections(connections))));
  assert.deepEqual(count(back), count(connections));
});


// "Connected On" as the export writes it, for four invented people. 29 Feb and
// the turn of a year are where a day's shift shows most.
const DATED = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
  'Ines,Varga-1,https://www.linkedin.com/in/invented-dated-1,,Halcyon,Designer,28 Sep 2026',
  'Ines,Varga-2,https://www.linkedin.com/in/invented-dated-2,,Halcyon,Designer,01 Jan 2026',
  'Ines,Varga-3,https://www.linkedin.com/in/invented-dated-3,,Halcyon,Designer,31 Dec 2025',
  'Ines,Varga-4,https://www.linkedin.com/in/invented-dated-4,,Halcyon,Designer,29 Feb 2024',
].join('\n');
const DATES = {
  'Ines Varga-1': '2026-09-28', 'Ines Varga-2': '2026-01-01', 'Ines Varga-3': '2025-12-31', 'Ines Varga-4': '2024-02-29',
};

test('the export\'s "Connected On" dates are read as calendar dates', () => {
  const { connections } = parseConnectionsCsv(DATED);
  assert.deepEqual(Object.fromEntries(connections.map((c) => [c.name, c.connected_date])), DATES);
  // A date it can't read is left out, never guessed at.
  const odd = parseConnectionsCsv(DATED.replace('28 Sep 2026', 'sometime').replace('01 Jan 2026', '30 Feb 2026')).connections;
  assert.equal(odd.find((c) => c.name === 'Ines Varga-1').connected_date, null);
  assert.equal(odd.find((c) => c.name === 'Ines Varga-2').connected_date, null);
});

test('REGRESSION: the same dates in every time zone, not a day early east of London', () => {
  // new Date('28 Sep 2026').toISOString() is local midnight in UTC: 2026-09-27
  // in Tokyo and Berlin. TZ is read when a process starts, so each zone gets
  // its own, and says which zone it ran in.
  const src = `
    import { parseConnectionsCsv } from ${JSON.stringify(new URL('../lib/csv.js', import.meta.url).href)};
    const { connections } = parseConnectionsCsv(${JSON.stringify(DATED)});
    console.log(JSON.stringify({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dates: Object.fromEntries(connections.map((c) => [c.name, c.connected_date])),
    }));`;
  for (const zone of ['Asia/Tokyo', 'Europe/Berlin', 'Pacific/Kiritimati', 'UTC', 'America/Los_Angeles', 'Pacific/Pago_Pago']) {
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', src], {
      encoding: 'utf8', env: { ...process.env, TZ: zone },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.zone, zone);
    assert.deepEqual(out.dates, DATES, `in ${zone}`);
  }
});
