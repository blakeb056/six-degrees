import { getDb } from '../../../lib/db-client';
import { rescoreAll, companyOverrides, sectorFocusOf, setCompanyScores, readForScoring } from '../../../lib/rpc';
import { companyScore, KNOWN_COMPANIES } from '../../../lib/scoring';
import { industryByKey } from '../../../lib/companies';

// Every company in your network with the score it gets and where that score
// comes from — and the one place to set your own. Setting or clearing a score
// rescores everyone, since a person's power depends on their company's.
// Industries and the sector lean (Settings → Your sector) come from the same
// read rescoring uses (lib/rpc.js readForScoring), so a score here is the one
// people carry.

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id, degree, headline, role, company, scanned_company, profile_url, tier FROM linkedin_connections').all();
    const overrides = companyOverrides(db);
    const focus = sectorFocusOf(db);
    // The same read rescoring uses: each company's industry, its directory
    // sectors and the industries those sit under, so a sector lean shown here
    // is the one people carry. Each headline is read once, here too.
    const read = readForScoring(rows);
    const byName = new Map();
    const seen = new Set();
    for (const r of rows) {
      for (const role of read.people.get(r).roles) {
        if (!role.company || role.former) continue;
        const key = `${role.company}|${r.profile_url || r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const c = byName.get(role.company) || { name: role.company, people: 0, d1: 0, senior: 0, S: 0, A: 0 };
        c.people++;
        if (r.degree === 1) c.d1++;
        if (role.title.level >= 4) c.senior++;
        if (r.tier === 'S') c.S++;
        if (r.tier === 'A') c.A++;
        byName.set(role.company, c);
      }
    }
    const companies = [...byName.values()].map((c) => {
      const facts = read.companies.get(c.name);
      const industry = industryByKey(facts?.industry);
      const { score, source, sectorBonus = 0 } = companyScore(c.name, {
        overrides, headcount: c.people, industry: industry.key, sectors: facts?.sectors, sectorIndustries: facts?.sectorIndustries, focus,
      });
      const known = KNOWN_COMPANIES.find(([n]) => n === c.name);
      return { ...c, score, source, sectorBonus, suggested: known ? known[1] : null, industry: { key: industry.key, label: industry.label, color: industry.color } };
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
      setCompanyScores(db, [[name, n]]);
    }
    const result = rescoreAll();
    return Response.json({ success: true, ...result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
