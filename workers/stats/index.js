// sixgree.com's own visit and download counter (a Cloudflare Worker + D1, at
// stats.sixgree.com). It exists so "has anyone tried it?" has a real answer:
// GitHub's download counts are mostly link crawlers, and the site had no
// numbers at all (Blake, 2026-11-15).
//
// What it keeps, and only this: per day, how many page views each page had,
// which site sent them (the referrer's host name), which country (from
// Cloudflare), and how many download buttons were clicked per platform. Daily
// unique visitors are counted from a hash of (secret salt, day, IP, browser)
// that changes every day and is deleted after 35 days (each day's count is kept
// on its own in daily_visitors); no IP address, cookie or browser fingerprint
// is ever stored. Browsers that send Do Not Track or
// Global Privacy Control are never counted (site/app.js doesn't send for them).
//
// POST /e     {t: "view" | "download", p: path or platform, r: referrer host}
//             sent by site/app.js as a CORS fetch (keepalive); always 204.
// GET /stats  ?days=28 (1–90): the totals as JSON, public, no personal data.
//
// Deployed by hand through the Cloudflare API (see README.md beside this file).

const ORIGINS = new Set(['https://sixgree.com', 'https://www.sixgree.com']);
const PLATFORMS = new Set(['mac-apple-silicon', 'mac-intel', 'windows', 'linux-deb', 'linux-tar', 'other']);
// Anything that announces itself as a robot, a link preview or a script.
const BOT = /bot|crawl|spider|slurp|preview|fetch|monitor|headless|lighthouse|python|curl|wget|httpclient|scanner/i;
const PATH = /^\/[a-z0-9\-/._]{0,80}$/i;
const HOST = /^[a-z0-9.-]{1,80}$/i;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), req);
    if (req.method === 'POST' && url.pathname === '/e') {
      // The body is read before answering: once the response has gone,
      // Cloudflare has closed it (the first deploy counted nothing).
      const raw = await req.text().catch(() => '');
      ctx.waitUntil(record(req, raw, env).catch(() => {}));
      return withCors(new Response(null, { status: 204 }), req);
    }
    if (req.method === 'GET' && url.pathname === '/stats') return stats(url, env);
    return new Response('sixgree stats\n', { status: 404, headers: { 'content-type': 'text/plain' } });
  },
};

function withCors(res, req) {
  const origin = req.headers.get('origin');
  if (ORIGINS.has(origin)) {
    res.headers.set('access-control-allow-origin', origin);
    res.headers.set('access-control-allow-methods', 'POST');
    res.headers.set('access-control-allow-headers', 'content-type');
  }
  return res;
}

const today = () => new Date().toISOString().slice(0, 10);

async function hash(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function record(req, raw, env) {
  // Only beacons from the site's own pages, from something that isn't a robot.
  if (!ORIGINS.has(req.headers.get('origin'))) return;
  const ua = req.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return;
  if (!raw || raw.length > 1000) return;
  let body;
  try { body = JSON.parse(raw); } catch { return; }

  const kind = body.t === 'download' ? 'download' : body.t === 'view' ? 'view' : null;
  if (!kind) return;
  let key;
  if (kind === 'view') key = typeof body.p === 'string' && PATH.test(body.p) ? body.p : '/other';
  else key = PLATFORMS.has(body.p) ? body.p : 'other';
  let ref = typeof body.r === 'string' && HOST.test(body.r) ? body.r.toLowerCase().replace(/^www\./, '') : '';
  if (ref === 'sixgree.com') ref = '';
  const country = (req.cf && req.cf.country) || 'XX';
  const day = today();

  const writes = [
    env.DB.prepare(
      `INSERT INTO events (day, kind, key, ref, country, n) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (day, kind, key, ref, country) DO UPDATE SET n = n + 1`,
    ).bind(day, kind, key, ref, country),
  ];
  if (kind === 'view') {
    const ip = req.headers.get('cf-connecting-ip') || '';
    writes.push(env.DB.prepare('INSERT OR IGNORE INTO visitors (day, h) VALUES (?, ?)')
      .bind(day, await hash(`${env.SALT}|${day}|${ip}|${ua}`)));
    // The day's count, kept apart from the hashes so deleting old hashes
    // never erases how many visitors a day had.
    writes.push(env.DB.prepare(
      `INSERT INTO daily_visitors (day, n) VALUES (?, (SELECT COUNT(*) FROM visitors WHERE day = ?))
       ON CONFLICT (day) DO UPDATE SET n = excluded.n`,
    ).bind(day, day));
  }
  // Now and then, forget the daily hashes past 35 days.
  if (Math.random() < 0.02) {
    writes.push(env.DB.prepare("DELETE FROM visitors WHERE day < date('now', '-35 day')"));
  }
  await env.DB.batch(writes);
}

async function stats(url, env) {
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 28));
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const q = (sql) => env.DB.prepare(sql).bind(since).all().then((r) => r.results);
  const [daily, visitors, pages, refs, countries, downloads] = await Promise.all([
    q(`SELECT day, SUM(CASE WHEN kind = 'view' THEN n ELSE 0 END) AS views,
              SUM(CASE WHEN kind = 'download' THEN n ELSE 0 END) AS downloads
       FROM events WHERE day >= ? GROUP BY day ORDER BY day`),
    q('SELECT day, n AS visitors FROM daily_visitors WHERE day >= ? ORDER BY day'),
    q(`SELECT key AS page, SUM(n) AS views FROM events WHERE day >= ? AND kind = 'view'
       GROUP BY key ORDER BY views DESC LIMIT 25`),
    q(`SELECT ref AS site, SUM(n) AS views FROM events WHERE day >= ? AND kind = 'view' AND ref != ''
       GROUP BY ref ORDER BY views DESC LIMIT 25`),
    q(`SELECT country, SUM(n) AS views FROM events WHERE day >= ? AND kind = 'view'
       GROUP BY country ORDER BY views DESC LIMIT 25`),
    q(`SELECT key AS platform, SUM(n) AS clicks FROM events WHERE day >= ? AND kind = 'download'
       GROUP BY key ORDER BY clicks DESC`),
  ]);
  const byDay = new Map(daily.map((d) => [d.day, { ...d, visitors: 0 }]));
  for (const v of visitors) byDay.set(v.day, { ...(byDay.get(v.day) || { day: v.day, views: 0, downloads: 0 }), visitors: v.visitors });
  const perDay = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const sum = (k) => perDay.reduce((s, d) => s + (d[k] || 0), 0);
  return new Response(JSON.stringify({
    since, days,
    totals: { views: sum('views'), visitorDays: sum('visitors'), downloadClicks: sum('downloads') },
    perDay, pages, referrers: refs, countries, downloads,
    note: 'Counted by sixgree.com itself: no cookies, no IP addresses stored, robots and Do Not Track excluded.',
  }, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
}
