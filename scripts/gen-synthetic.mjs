#!/usr/bin/env node
/**
 * Generates the sample network that ships with the app.
 *
 * Every person in it is invented. The point is to have something to look at on
 * a first run, in screenshots, and in the demo — without putting a single real
 * person's name, employer or face in a public repository.
 *
 * Deterministic: the same seed always produces the same network, so the file
 * only changes when this script does, and diffs stay reviewable.
 *
 *   node scripts/gen-synthetic.mjs [--seed 20260824] [--out public/demo-data.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// ── deterministic PRNG (mulberry32) ────────────────────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Ada','Bo','Cleo','Dev','Esme','Finn','Gia','Hugo','Iris','Jai','Kira','Lev','Mina','Nils','Otto',
  'Pia','Quinn','Rune','Sana','Tobias','Ula','Vero','Wren','Xanthe','Yuki','Zane','Amara','Bodhi',
  'Cassia','Dario','Elio','Freya','Gideon','Halle','Ines','Jonah','Kaya','Liora','Marek','Nadia',
  'Oona','Paolo','Rhea','Soren','Tamsin','Ursa','Viggo','Wilder','Ximena','Yusuf','Zora','Callum',
  'Delphine','Emeka','Fiora','Gustav','Hana','Idris','Juno','Kepler','Linnea','Mateo','Noor',
];
const LAST = [
  'Ashworth','Baptiste','Calloway','Delacroix','Eriksen','Farrow','Gallagher','Halvorsen','Ibarra',
  'Jansson','Kowalczyk','Lindqvist','Marchetti','Nakamura','Okonkwo','Pereira','Quintero','Rasmussen',
  'Silvestri','Thorne','Ueda','Vasquez','Whitlock','Ximenes','Yamamoto','Zabala','Brennan','Castellan',
  'Dumont','Espinoza','Fontaine','Grimaldi','Hollis','Ingram','Jokinen','Kristiansen','Lindgren',
  'Moreau','Nyberg','Ostrowski','Petrov','Rosales','Stavros','Tsegaye','Varga','Weatherby',
];

// Invented companies, spread across the prestige ladder so the tier mix looks
// like a real network rather than everyone landing in one band.
const COMPANIES = [
  { name: 'Northwind Labs',      weight: 6 },
  { name: 'Halcyon',             weight: 5 },
  { name: 'Verity Systems',      weight: 5 },
  { name: 'Lumen Robotics',      weight: 4 },
  { name: 'Kestrel Analytics',   weight: 4 },
  { name: 'Meridian Health',     weight: 4 },
  { name: 'Orchard Pay',         weight: 4 },
  { name: 'Tessellate',          weight: 3 },
  { name: 'Bright Harbor Media', weight: 3 },
  { name: 'Ironwood Capital',    weight: 3 },
  { name: 'Sable & Finch',       weight: 3 },
  { name: 'Cobalt Studio',       weight: 3 },
  { name: 'Fernhill Foods',      weight: 2 },
  { name: 'Ridgeline Outfitters',weight: 2 },
  { name: 'Aperture Grid',       weight: 2 },
  { name: 'Quarry Interactive',  weight: 2 },
  { name: 'Blue Larch',          weight: 2 },
  { name: 'Everly Group',        weight: 2 },
  { name: 'Pinecrest University',weight: 2 },
  { name: '',                    weight: 2 },  // some people list no employer
];

const TITLES = [
  'Chief Executive Officer','Founder','President','Chief Technology Officer',
  'VP of Engineering','VP of Marketing','SVP of Operations','Managing Director',
  'Director of Product','Director of Engineering','Head of Growth','Head of Design',
  'Senior Engineering Manager','Group Product Manager','Engineering Manager',
  'Principal Engineer','Staff Software Engineer','Lead Data Scientist',
  'Senior Software Engineer','Senior Product Designer','Senior Manager, Partnerships',
  'Account Manager','Client Partner','Brand Strategist',
  'Software Engineer','Product Designer','Data Analyst','Program Coordinator',
  'Marketing Intern','Research Assistant',
];

// ── scoring: mirrors lib/rpc.js, which mirrors scripts/score_new_connections.sql ──
const SENIORITY = [
  [/CEO|Chief|Founder|President|Owner/i, 10],
  [/VP|Vice President|SVP|EVP|Managing Director|Global Head|Country Director/i, 9],
  [/Senior Director|Director|Head of|Country Lead/i, 8],
  [/Senior Manager|Manager,|Engineering Manager|Group Product/i, 7],
  [/Lead|Principal|Staff|Senior.*Engineer|Senior.*Designer|Senior.*Manager/i, 6],
  [/Partner|Client Partner|Account Manager|Strategist/i, 5],
  [/Engineer|Developer|Designer|Analyst|Coordinator/i, 4],
  [/Intern|Student|Undergraduate|Junior|Entry/i, 2],
];
// Invented companies need their own prestige table; the real one keys off real
// employers and would score every one of these a flat 4.
const PRESTIGE = {
  'Northwind Labs': 9, 'Halcyon': 9, 'Verity Systems': 8, 'Lumen Robotics': 8,
  'Kestrel Analytics': 7, 'Meridian Health': 7, 'Orchard Pay': 7, 'Tessellate': 6,
  'Bright Harbor Media': 6, 'Ironwood Capital': 8, 'Sable & Finch': 5, 'Cobalt Studio': 5,
  'Fernhill Foods': 4, 'Ridgeline Outfitters': 4, 'Aperture Grid': 5, 'Quarry Interactive': 4,
  'Blue Larch': 4, 'Everly Group': 5, 'Pinecrest University': 3,
};

const seniorityOf = (title) => (SENIORITY.find(([re]) => re.test(title)) || [null, 3])[1];
const prestigeOf = (company) => (company ? (PRESTIGE[company] ?? 4) : 2);
const tierFor = (p) => (p >= 7 ? 'S' : p >= 5.5 ? 'A' : p >= 4 ? 'B' : p >= 2.5 ? 'C' : 'D');

function pickWeighted(rand, items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rand() * total;
  for (const i of items) if ((r -= i.weight) < 0) return i.name;
  return items[items.length - 1].name;
}

function main() {
  const args = process.argv.slice(2);
  const seed = Number(args[args.indexOf('--seed') + 1]) || 20260824;
  const outArg = args.indexOf('--out');
  const out = outArg > -1 ? args[outArg + 1] : 'public/demo-data.json';

  const rand = rng(seed);
  const used = new Set();
  const uniqueName = () => {
    for (let i = 0; i < 500; i++) {
      const n = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
    return `Person ${used.size + 1}`;
  };

  const person = (degree, sourceId) => {
    const name = uniqueName();
    const title = TITLES[Math.floor(rand() * TITLES.length)];
    const company = pickWeighted(rand, COMPANIES);
    const seniority = seniorityOf(title);
    const prestige = prestigeOf(company);
    const power = Math.round((seniority * 0.5 + prestige * 0.3) * 10) / 10;
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '-');
    return {
      id: `syn-${degree}-${used.size}-${Math.floor(rand() * 1e6).toString(36)}`,
      degree,
      source_connection_id: sourceId ?? null,
      name,
      headline: company ? `${title} at ${company}` : title,
      company,
      role: title,
      profile_url: `https://www.linkedin.com/in/${slug}`,
      profile_image_url: null,        // invented people have no photographs
      connected_date: null,
      seniority_score: seniority,
      company_prestige_score: prestige,
      power_score: power,
      tier: tierFor(power),
      influence_signals: {},
      is_catalyst: false,
      catalyst_score: 0,
      circle_power: 0, circle_s_count: 0, circle_a_count: 0, circle_elite_pct: 0,
      outreach_status: null,
      unlock_status: null,
      scanned_company: null,
    };
  };

  const D1_COUNT = 150;
  const BRIDGE_COUNT = 14;

  const degree1 = Array.from({ length: D1_COUNT }, () => person(1));
  degree1.sort((a, b) => b.power_score - a.power_score);

  // The highest-leverage people become bridges with a mapped circle behind
  // them, which is what makes the Bridges view worth opening.
  const bridges = degree1.slice(0, BRIDGE_COUNT);
  const degree2 = [];
  for (const b of bridges) {
    const size = 18 + Math.floor(rand() * 45);
    const circle = Array.from({ length: size }, () => person(2, b.id));
    degree2.push(...circle);

    const s = circle.filter((c) => c.tier === 'S').length;
    const a = circle.filter((c) => c.tier === 'A').length;
    b.circle_s_count = s;
    b.circle_a_count = a;
    b.circle_elite_pct = circle.length ? Math.round(((s + a) / circle.length) * 100) / 100 : 0;
    b.circle_power = Math.round((s * 3 + a * 1.5 + b.circle_elite_pct * 10 + Math.log(circle.length + 1) * 1.5) * 10) / 10;
    b.is_catalyst = (s >= 5 && b.circle_elite_pct >= 0.25) || b.circle_power >= 50;
    b.catalyst_score = b.is_catalyst ? b.circle_power : 0;
  }
  degree2.sort((x, y) => y.power_score - x.power_score);

  const payload = {
    user: { id: 'synthetic-demo-user', name: 'You', headline: 'Sample network' },
    degree1,
    degree2,
    counts: { degree1: degree1.length, degree2: degree2.length },
    meta: {
      synthetic: true,
      seed,
      generated_by: 'scripts/gen-synthetic.mjs',
      note: 'Every person in this file is invented. No real individual is represented.',
    },
  };

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload));

  const tiers = {};
  degree1.forEach((c) => { tiers[c.tier] = (tiers[c.tier] || 0) + 1; });
  const kb = Math.round(JSON.stringify(payload).length / 1024);
  console.log(`wrote ${out}  (${kb} KB, seed ${seed})`);
  console.log(`  1st degree : ${degree1.length}`);
  console.log(`  2nd degree : ${degree2.length} across ${BRIDGE_COUNT} bridges`);
  console.log(`  catalysts  : ${bridges.filter((b) => b.is_catalyst).length}`);
  console.log(`  tier mix   : ${['S','A','B','C','D'].map((t) => `${t}:${tiers[t] || 0}`).join('  ')}`);
}

main();
