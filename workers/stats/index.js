// sixgree.com's own visit and download counter (a Cloudflare Worker + D1, at
// stats.sixgree.com). It exists so "has anyone tried it?" has a real answer:
// GitHub's download counts are mostly link crawlers, and the site had no
// numbers at all (Blake, 2026-11-15).
//
// What it keeps, and only this: per day, how many page views each page had,
// which site sent them (the referrer's host name), which country (from
// Cloudflare), and how many download buttons were clicked per platform. Each
// day's unique visitors are counted with a one-way hash of (secret salt, day,
// IP, browser). The hashes are deleted when the day ends (a cron at 00:05 UTC,
// and every view deletes any older than yesterday); only the day's count
// stays, in daily_visitors. No IP address, cookie or browser fingerprint is
// ever stored. Browsers that send Do Not Track or Global Privacy Control are
// never counted (site/app.js doesn't send for them).
//
// POST /e     {t: "view" | "download", p: path or platform, r: referrer host}
//             sent by site/app.js as a CORS fetch (keepalive); always 204.
// GET /stats  ?days=28 (1–90): the totals as JSON, public.
//
// Deployed by hand through the Cloudflare API (see README.md beside this file).

const ORIGINS = new Set(['https://sixgree.com', 'https://www.sixgree.com']);
const PLATFORMS = new Set(['mac-apple-silicon', 'mac-intel', 'windows', 'linux-deb', 'linux-tar', 'other']);
// Anything that announces itself as a robot, a link preview or a script.
// "bot" not after "cu": Cubot is an Android phone brand, its Chrome is a person.
const BOT = /(?<!cu)bot|crawl|spider|slurp|preview|fetch|monitor|headless|lighthouse|inspectiontool|python|curl|wget|httpclient|scanner/i;
const PATH = /^\/[a-z0-9\-/._]{0,80}$/;
// A host name: dot-separated labels, ending in letters (no IP addresses, no "localhost").
const HOST = /^(?=.{4,80}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// The lists /stats shows are cut at this many rows; it says when one was cut.
const LIST = 25;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), req);
    if (req.method === 'POST' && url.pathname === '/e') {
      // The body is read before answering: once the response has gone,
      // Cloudflare has closed it (the first deploy counted nothing).
      const raw = await req.text().catch(() => '');
      // Never a silent zero (TRAPS §7): a failed write is logged (Workers Logs).
      ctx.waitUntil(record(req, raw, env).catch((e) => console.error('stats: record failed:', e && e.message)));
      return withCors(new Response(null, { status: 204 }), req);
    }
    if (req.method === 'GET' && url.pathname === '/stats') return stats(url, env);
    return new Response('sixgree stats\n', { status: 404, headers: { 'content-type': 'text/plain' } });
  },

  // Daily at 00:05 UTC (the Worker's cron trigger): forget every hash from
  // before today, so none outlives its day even when nobody visits.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(env.DB.prepare('DELETE FROM visitors WHERE day < ?').bind(today()).run()
      .catch((e) => console.error('stats: hash cleanup failed:', e && e.message)));
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
const dayBefore = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

async function hash(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A page path as the site has them: lower case, no "..", no "//". Anything
// else is filed as /other.
function pagePath(p) {
  if (typeof p !== 'string') return '/other';
  const path = p.toLowerCase();
  return PATH.test(path) && !path.includes('..') && !path.includes('//') ? path : '/other';
}

function refHost(r) {
  if (typeof r !== 'string') return '';
  const host = r.toLowerCase().replace(/^www\./, '');
  return HOST.test(host) && host !== 'sixgree.com' ? host : '';
}

async function record(req, raw, env) {
  // Only requests from the site's own pages, from something that isn't a robot.
  if (!ORIGINS.has(req.headers.get('origin'))) return;
  const ua = req.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return;
  if (!raw || raw.length > 1000) return;
  let body;
  try { body = JSON.parse(raw); } catch { return; }
  if (!body || typeof body !== 'object') return;

  const kind = body.t === 'download' ? 'download' : body.t === 'view' ? 'view' : null;
  if (!kind) return;
  const key = kind === 'view' ? pagePath(body.p) : PLATFORMS.has(body.p) ? body.p : 'other';
  const ref = refHost(body.r);
  const country = (req.cf && req.cf.country) || 'XX';
  const day = today();

  const writes = [
    env.DB.prepare(
      `INSERT INTO events (day, kind, key, ref, country, n) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (day, kind, key, ref, country) DO UPDATE SET n = n + 1`,
    ).bind(day, kind, key, ref, country),
  ];
  if (kind === 'view' && !env.SALT) {
    // Without the secret the hash could be reversed by anyone, so no hash at
    // all: the view still counts, the visitor doesn't.
    console.error('stats: the SALT secret is missing, so unique visitors are not being counted');
  } else if (kind === 'view') {
    const ip = req.headers.get('cf-connecting-ip') || '';
    const h = await hash(`${env.SALT}|${day}|${ip}|${ua}`);
    // A D1 batch is one transaction, run in order. First the day's count goes
    // up by one if this hash is new today (one indexed lookup, never a count
    // of the whole day), then the hash is kept, then hashes older than
    // yesterday go (the cron's backstop).
    writes.push(
      env.DB.prepare(
        `INSERT INTO daily_visitors (day, n) SELECT ?, 1
         WHERE NOT EXISTS (SELECT 1 FROM visitors WHERE day = ? AND h = ?)
         ON CONFLICT (day) DO UPDATE SET n = n + 1`,
      ).bind(day, day, h),
      env.DB.prepare('INSERT OR IGNORE INTO visitors (day, h) VALUES (?, ?)').bind(day, h),
      env.DB.prepare('DELETE FROM visitors WHERE day < ?').bind(dayBefore(day)),
    );
  }
  await env.DB.batch(writes);
}

async function stats(url, env) {
  const asked = Math.trunc(Number(url.searchParams.get('days')));
  const days = Number.isFinite(asked) && asked >= 1 ? Math.min(90, asked) : 28;
  const since = new Date(Date.parse(`${today()}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const q = (sql) => env.DB.prepare(sql).bind(since).all().then((r) => r.results);
  let rows;
  try {
    rows = await Promise.all([
      q(`SELECT day, SUM(CASE WHEN kind = 'view' THEN n ELSE 0 END) AS views,
                SUM(CASE WHEN kind = 'download' THEN n ELSE 0 END) AS downloads
         FROM events WHERE day >= ? GROUP BY day ORDER BY day`),
      q('SELECT day, n AS visitors FROM daily_visitors WHERE day >= ? ORDER BY day'),
      q(`SELECT key AS page, SUM(n) AS views FROM events WHERE day >= ? AND kind = 'view'
         GROUP BY key ORDER BY views DESC, key LIMIT ${LIST + 1}`),
      q(`SELECT ref AS site, SUM(n) AS views FROM events WHERE day >= ? AND kind = 'view' AND ref != ''
         GROUP BY ref ORDER BY views DESC, ref LIMIT ${LIST + 1}`),
      q(`SELECT country, SUM(n) AS views FROM events WHERE day >= ? AND kind = 'view'
         GROUP BY country ORDER BY views DESC, country LIMIT ${LIST + 1}`),
      q(`SELECT key AS platform, SUM(n) AS clicks FROM events WHERE day >= ? AND kind = 'download'
         GROUP BY key ORDER BY clicks DESC, key`),
    ]);
  } catch (e) {
    // Say it failed; never answer zeros (TRAPS §7).
    console.error('stats: read failed:', e && e.message);
    return json({ error: 'the counter could not be read', detail: String(e && e.message) }, 500);
  }
  const [daily, visitors, pages, refs, countries, downloads] = rows;
  const byDay = new Map(daily.map((d) => [d.day, { ...d, visitors: 0 }]));
  for (const v of visitors) byDay.set(v.day, { ...(byDay.get(v.day) || { day: v.day, views: 0, downloads: 0 }), visitors: v.visitors });
  const perDay = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const sum = (k) => perDay.reduce((s, d) => s + (d[k] || 0), 0);
  return json({
    since, days,
    totals: { views: sum('views'), visitorDays: sum('visitors'), downloadClicks: sum('downloads') },
    perDay,
    pages: pages.slice(0, LIST), referrers: refs.slice(0, LIST), countries: countries.slice(0, LIST), downloads,
    cut: { pages: pages.length > LIST, referrers: refs.length > LIST, countries: countries.length > LIST, at: LIST },
    note: 'Counted by sixgree.com itself: no cookies, no IP addresses kept, robots and Do Not Track excluded. '
      + 'Referring sites are host names only. The lists are cut at 25 rows; "cut" says which were.',
  });
}

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
});
