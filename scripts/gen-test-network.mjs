// A large, entirely invented network for checking the UI at scale, written
// straight into a scratch data folder with the app's own schema. Every name,
// company and profile link comes from the fixed word lists below: nobody real.
// Never point it at your own data folder (~/.six-degrees): it deletes the
// database in the folder you give it.
//
//   node scripts/gen-test-network.mjs . /tmp/sd-test [--d1 1500] [--bridges 320] [--seed 7]
//   SIX_DEGREES_HOME=/tmp/sd-test npx next dev -p 3457
//
// 1st degree, the first --bridges of them with a scanned circle (a few big ones,
// then 25 to 175 people), about one in seven 2nd-degree people found through a
// second bridge as well, eight company scans (3rd degree) and 3,000 ties between
// your connections.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

const [repo, home] = process.argv.slice(2);
if (!repo || !home) { console.error('Usage: node scripts/gen-test-network.mjs <repo> <scratch-folder> [--d1 N] [--bridges N] [--seed N]'); process.exit(2); }
if (path.resolve(home) === path.resolve(process.env.HOME || '', '.six-degrees')) { console.error('That is your real data folder. Pick a scratch folder.'); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? Number(process.argv[i + 1]) : d; };
const D1 = arg('--d1', 1500), BRIDGES = arg('--bridges', 320), SEED = arg('--seed', 7);
const { SCHEMA_SQL } = await import(path.resolve(repo, 'db/schema.js'));

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(SEED);
const pick = (a) => a[Math.floor(rand() * a.length)];

const FIRST = 'Ada Bo Cleo Dev Esme Finn Gia Hugo Iris Jai Kira Lev Mina Nils Otto Pia Quinn Rune Sana Tobias Ula Vero Wren Xanthe Yuki Zane Amara Bodhi Cassia Dario Elio Freya Gideon Halle Ines Jonah Kaya Liora Marek Nadia Oona Paolo Rhea Soren Tamsin Ursa Viggo Wilder Ximena Yusuf Zora Callum Delphine Emeka Fiora Gustav Hana Idris Juno Kepler Linnea Mateo Noor'.split(' ');
const LAST = 'Ashworth Baptiste Calloway Delacroix Eriksen Farrow Gallagher Halvorsen Ibarra Jansson Kowalczyk Lindqvist Marchetti Nakamura Okonkwo Pereira Quintero Rasmussen Silvestri Thorne Ueda Vasquez Whitlock Ximenes Yamamoto Zabala Brennan Castellan Dumont Espinoza Fontaine Grimaldi Hollis Ingram Jokinen Kristiansen Lindgren Moreau Nyberg Ostrowski Petrov Rosales Stavros Tsegaye Varga Weatherby'.split(' ');
const PRE = 'Northwind Halcyon Verity Lumen Kestrel Meridian Orchard Tessellate Bright Harbor Ironwood Sable Cobalt Fernhill Ridgeline Aperture Quarry Blue Larch Everly Pinecrest Solace Amberly Quillon Vantor Brisk Ostara Calder Wynd Marlow Tamber Juniper Oberon Kinetic Sterling Driftwood Lanternfish Copperleaf Silvergate Redfern Hollow Crestline Bramble Mossbank'.split(' ');
const SUF = ['Labs','Health','Capital','Media','Foods','University','Consulting','Robotics','Studios','Energy','Realty','Analytics','Software','Bank','Logistics','Group','Partners','Ventures','Clinic','Games','Foundation','Systems','Retail','Law'];
const COMPANIES = [];
for (const p of PRE) for (const s of SUF) if (rand() < 0.55) COMPANIES.push(`${p} ${s}`);
// Zipf-ish: a few big employers, a long tail.
const weights = COMPANIES.map((_, i) => 1 / Math.pow(i + 1, 0.8));
const wTotal = weights.reduce((a, b) => a + b, 0);
function company() { let r = rand() * wTotal; for (let i = 0; i < COMPANIES.length; i++) if ((r -= weights[i]) < 0) return COMPANIES[i]; return COMPANIES[0]; }
const TITLES = ['Chief Executive Officer','Founder','Co-Founder','President','Chief Technology Officer','CFO','VP of Engineering','VP of Marketing','SVP of Operations','Managing Director','Partner','Director of Product','Director of Engineering','Head of Growth','Head of Design','Senior Engineering Manager','Group Product Manager','Engineering Manager','Principal Engineer','Staff Software Engineer','Lead Data Scientist','Senior Software Engineer','Senior Product Designer','Senior Manager, Partnerships','Account Manager','Client Partner','Brand Strategist','Software Engineer','Product Designer','Data Analyst','Program Coordinator','Registered Nurse','Associate Attorney','Recruiter','Marketing Intern','Research Assistant','Student'];
function headline(title, co) {
  const r = rand();
  if (!co) return title;
  if (r < 0.55) return `${title} at ${co}`;
  if (r < 0.7) return `${title} @ ${co} | Building the future of ${pick(['health','payments','media','AI','logistics'])}`;
  if (r < 0.82) return `${title} | ${co} | ex-${company()}`;
  if (r < 0.92) return `${title}, ${co}`;
  return `${title} at ${co} · Former ${pick(TITLES)} at ${company()}`;
}

const dbFile = path.join(home, 'six-degrees.sqlite');
mkdirSync(home, { recursive: true });
for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) if (existsSync(f)) rmSync(f);
const db = new DatabaseSync(dbFile);
db.exec(SCHEMA_SQL);
const userId = 'perf-user-0001';
db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(userId, 'You');
const ins = db.prepare(`INSERT INTO linkedin_connections (id, degree, source_connection_id, name, headline, company, role, profile_url, profile_image_url, mutual_count, scanned_company, user_id, unlock_status, influence_signals)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}')`);
let n = 0;
const person = (degree, source, scanned = null) => {
  n++;
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const co = rand() < 0.06 ? '' : (scanned || company());
  const title = pick(TITLES);
  return { id: `perf-${degree}-${n}`, degree, source, name, headline: headline(title, co), company: co || null, role: title,
    url: `https://www.linkedin.com/in/${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${n.toString(36)}`, scanned };
};
const put = (p) => ins.run(p.id, p.degree, p.source, p.name, p.headline, p.company, p.role, p.url, p.degree === 2 ? Math.floor(rand() * 40) : null, p.scanned, userId, p.degree === 1 ? 'unlocked' : 'locked');

db.exec('BEGIN');
const d1 = Array.from({ length: D1 }, () => person(1, null));
d1.forEach(put);
const bridges = d1.slice(0, BRIDGES);
const d2 = [];
for (const b of bridges) {
  const size = [980, 950, 500, 310, 260, 180][bridges.indexOf(b)] ?? (25 + Math.floor(rand() * 150));
  for (let i = 0; i < size; i++) { const p = person(2, b.id); put(p); d2.push(p); }
}
// About one in seven 2nd-degree people is known by a second bridge: same profile, another row.
let shared = 0;
for (const p of d2.slice()) {
  if (rand() >= 0.15) continue;
  const b = pick(bridges); if (b.id === p.source) continue;
  put({ ...p, id: `${p.id}-via`, source: b.id }); shared++;
}
// A few company scans (3rd+).
let d3 = 0;
for (const co of COMPANIES.slice(0, 8)) for (let i = 0; i < 50; i++) { put(person(3, null, co)); d3++; }
// Ties between your own connections.
const tie = db.prepare('INSERT OR IGNORE INTO connection_ties (id, user_id, a_url, b_url) VALUES (?, ?, ?, ?)');
for (let i = 0; i < 3000; i++) { const [a, b] = [pick(d1).url, pick(d1).url].sort(); if (a !== b) tie.run(`t${i}`, userId, a, b); }
db.exec('COMMIT');
console.log(JSON.stringify({ home, companies: COMPANIES.length, d1: d1.length, d2: d2.length + shared, d2People: d2.length, shared, d3 }));