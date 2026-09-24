import { getDb, newId, nowIso } from '../../../lib/db-client';
import { rescoreAll, companyOverrides } from '../../../lib/rpc';
import { rolesWithCompanies, companyScore, KNOWN_COMPANIES } from '../../../lib/scoring';
import { industryOf } from '../../../lib/companies';

// Every company in your network with the score it gets and where that score
// comes from — and the one place to set your own. Setting or clearing a score
// rescores everyone, since a person's power depends on their company's.

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id, degree, headline, role, company, scanned_company, profile_url, tier FROM linkedin_connections').all();
    const overrides = companyOverrides(db);
    const byName = new Map();
    const seen = new Set();
    for (const r of rows) {
      for (const role of rolesWithCompanies(r)) {
        if (!role.company || role.former) continue;
        const key = `${role.company}|${r.profile_url || r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const c = byName.get(role.company) || { name: role.company, people: 0, d1: 0, senior: 0, S: 0, A: 0, headline: r.headline };
        c.people++;
        if (r.degree === 1) c.d1++;
        if (role.title.level >= 4) c.senior++;
        if (r.tier === 'S') c.S++;
        if (r.tier === 'A') c.A++;
        byName.set(role.company, c);
      }
    }
    const companies = [...byName.values()].map((c) => {
      const industry = industryOf(c.name, c.headline);
      const { score, source } = companyScore(c.name, { overrides, headcount: c.people, industry: industry.key });
      const known = KNOWN_COMPANIES.find(([n]) => n === c.name);
      return { ...c, headline: undefined, score, source, suggested: known ? known[1] : null, industry: { key: industry.key, label: industry.label, color: industry.color } };
    }).sort((a, b) => b.people - a.people || b.score - a.score);
    return Response.json({ companies });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { name, score } = await request.json();
    if (!name || typeof name !== 'string') return Response.json({ error: 'name is required' }, { status: 400 });
    const db = getDb();
    if (score === null || score === undefined || score === '') {
      db.prepare('DELETE FROM company_scores WHERE name = ?').run(name);
    } else {
      const n = Number(score);
      if (!Number.isFinite(n) || n < 1 || n > 10) return Response.json({ error: 'score must be 1–10' }, { status: 400 });
      db.prepare(`INSERT INTO company_scores (id, name, score, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`).run(newId(), name, n, nowIso());
    }
    const result = rescoreAll();
    return Response.json({ success: true, ...result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
