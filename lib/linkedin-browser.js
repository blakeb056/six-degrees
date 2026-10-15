// The LinkedIn browser plugin's people list (app/components/LinkedInBrowser.js;
// Blake, 2026-10-15: "open LinkedIn within the actual application but they can
// use the side panel on their right for finding people and can be
// interactive"). While you browse LinkedIn in Sixgree's own browser, the list
// on the right finds people in your own network by name, company or place,
// opens their profile in the panel, and says what Sixgree knows about the
// person on screen.
//
// The pure parts: one entry per person from the network's rows (a person
// reached through two of your connections is two rows, one per bridge), the
// search, and the profile on screen matched against the stored profile_urls.
// No Node imports: the page reads it.

/** The plugin's id, and what it unlocks (lib/plugins.js PLUGIN_KIND_UNLOCKS). */
export const LINKEDIN_BROWSER = 'linkedin-browser';

/**
 * The <slug> of a LinkedIn profile link (https://www.linkedin.com/in/<slug>/,
 * with or without www., a trailing slash, a query or a #part, and any page
 * under it), decoded and in lower case, or null for anything else. Stored
 * profile_urls and the panel's page are both read this way, so the two meet
 * (desktop/lib.mjs panelProfileSlug reads the panel's the same way).
 */
export function profileSlug(url) {
  const raw = String(url ?? '').trim();
  if (!raw || raw.length > 2000) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (!(host === 'linkedin.com' || host.endsWith('.linkedin.com'))) return null;
  const m = u.pathname.match(/^\/in\/([^/]+)/i);
  if (!m) return null;
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* kept as it is */ }
  slug = slug.trim().toLowerCase();
  return slug && slug.length <= 200 ? slug : null;
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const better = (a, b) => (a.degree !== b.degree ? a.degree < b.degree : (Number(a.power_score) || 0) > (Number(b.power_score) || 0));

/**
 * One entry per person, from loadNetwork's { degree1, degree2, degree3 }:
 *   { key, id, name, headline, company, location, tier, degree, mutual, via,
 *     profileUrl, photo, power }
 * `key` is their profile's slug (or the row's id when it has none), `id` the
 * row Outlink opens (their closest one), `degree` the closest, `mutual` the
 * largest mutual count read, `via` who connects you: the names of the
 * connections they were found through, closest first.
 * → { people (strongest first), bySlug: Map<slug, person> }
 */
export function peopleIndex(network = {}) {
  const rows = [...(network.degree1 || []), ...(network.degree2 || []), ...(network.degree3 || [])]
    .filter((r) => r && r.name && Number.isFinite(Number(r.degree)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const grouped = new Map();
  for (const row of rows) {
    const slug = profileSlug(row.profile_url);
    const key = slug || `id:${row.id}`;
    const r = { ...row, degree: Number(row.degree) };
    const g = grouped.get(key);
    if (!g) grouped.set(key, { slug, best: r, rows: [r] });
    else {
      g.rows.push(r);
      if (better(r, g.best)) g.best = r;
    }
  }
  const people = [];
  const bySlug = new Map();
  for (const [key, { slug, best, rows: mine }] of grouped) {
    const via = [];
    for (const r of [...mine].sort((a, b) => a.degree - b.degree)) {
      const from = r.source_connection_id ? byId.get(r.source_connection_id)?.name : null;
      if (from && !via.includes(from)) via.push(from);
    }
    const pick = (field) => best[field] || mine.find((r) => r[field])?.[field] || null;
    // Never read is null, not 0: only counts a scan read.
    const mutuals = mine.map((r) => r.mutual_count).filter((v) => v !== null && v !== undefined && v !== '')
      .map(Number).filter((n) => Number.isFinite(n) && n >= 0);
    const person = {
      key,
      id: best.id,
      name: best.name,
      headline: pick('headline'),
      company: pick('company'),
      location: pick('location'),
      tier: best.tier || null,
      degree: best.degree,
      mutual: mutuals.length ? Math.max(...mutuals) : null,
      via,
      profileUrl: best.profile_url || null,
      photo: pick('profile_image_url'),
      power: Number(best.power_score) || 0,
    };
    people.push(person);
    if (slug) bySlug.set(slug, person);
  }
  people.sort((a, b) => a.degree - b.degree || b.power - a.power || a.name.localeCompare(b.name));
  return { people, bySlug };
}

/**
 * The people matching `query` by name, company, headline or place: every word
 * of it somewhere in those, accents and case ignored. Names that start with
 * it first, then names that hold it, then the rest; within each, closest
 * degree, then strongest. At most `limit`. Fewer than 2 letters finds nobody.
 */
export function searchPeople(index, query, limit = 30) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!index?.people || words.join('').length < 2) return [];
  const q = words.join(' ');
  const scored = [];
  for (const p of index.people) {
    const name = fold(p.name);
    const all = `${name} ${fold(p.company)} ${fold(p.headline)} ${fold(p.location)}`;
    if (!words.every((w) => all.includes(w))) continue;
    const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
    scored.push({ p, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.p.degree - b.p.degree || b.p.power - a.p.power);
  return scored.slice(0, limit).map((s) => s.p);
}

/** The person whose profile the panel is on (its slug, desktop/lib.mjs panelProfileSlug), or null when they aren't in your network data. */
export function personOnScreen(index, slug) {
  if (!index?.bySlug || typeof slug !== 'string' || !slug) return null;
  return index.bySlug.get(slug.toLowerCase()) || null;
}

/** "1st", "2nd", "3rd". */
export function degreeLabel(degree) {
  return { 1: '1st', 2: '2nd', 3: '3rd' }[degree] || `${degree}th`;
}
