#!/usr/bin/env node
// How many people visited sixgree.com and clicked a download, from the site's own
// counter (workers/stats). Usage: node scripts/site-stats.mjs [days, default 28]
const days = Math.min(90, Math.max(1, Number(process.argv[2]) || 28));
const res = await fetch(`https://stats.sixgree.com/stats?days=${days}`);
if (!res.ok) { console.error(`stats.sixgree.com answered ${res.status}`); process.exit(1); }
const s = await res.json();
const line = (rows, k, v) => (rows.length ? rows.map((r) => `${r[k]} ${r[v]}`).join(', ') : 'none yet');
console.log(`sixgree.com, last ${s.days} days (since ${s.since})`);
console.log(`  page views ${s.totals.views} · visitor-days ${s.totals.visitorDays} · download clicks ${s.totals.downloadClicks}`);
console.log(`  downloads: ${line(s.downloads, 'platform', 'clicks')}`);
console.log(`  came from: ${line(s.referrers, 'site', 'views')}`);
console.log(`  countries: ${line(s.countries, 'country', 'views')}`);
console.log(`  top pages: ${line(s.pages.slice(0, 8), 'page', 'views')}`);
if (s.perDay.length) console.log('  by day: ' + s.perDay.map((d) => `${d.day.slice(5)} ${d.visitors}/${d.views}/${d.downloads}`).join('  ') + '  (visitors/views/downloads)');
