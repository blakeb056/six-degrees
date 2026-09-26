import { readTitle, currentCompany, rolesWithCompanies, networkCompanies } from './scoring.js';
// Companies and industries across your network — what the Paths analyzer is
// built on. Plain functions, no React, so tests/companies.test.mjs runs them.
//
// LinkedIn doesn't give an industry for a person, and this app stores none, so
// industry is inferred from the company name and headline, and labelled
// "inferred" wherever it is shown. Unclear stays unclear rather than guessed.

// Seniority for grouping and filters, read by lib/scoring.js so Paths and the
// power score never disagree about someone's level (0 intern/student … 6 C-suite).
export function getSeniority(headline) {
  const t = readTitle(headline);
  return { key: t.key, label: t.label, level: t.level };
}

/**
 * The company someone works at now: a company scan's, else their current
 * role's, named as scoring names it (lib/scoring.js cleanCompany), so Paths
 * groups people under the companies the score is built on. It used to merge
 * names by a second, hand-picked list of its own, which also merged by
 * mistake: Oxford, Hartford and Bradford were Ford, and Bainbridge was Bain.
 */
export function companyOf(c) {
  return currentCompany(c);
}

// Order matters: the first industry whose words match wins, checked against the
// company name first (it is the stronger signal), then the headline. The words
// are the same for everyone: no one school, region or company of one person's,
// no job every kind of company has (a "Head of Growth" can work anywhere, so
// it is "growth marketing" here), and no word that is also plain English ("AR
// Specialist" is accounts receivable). docs/brain/SCORING.md lists the words
// taken out. Editing them changes the stored scores' list stamp (lib/rpc.js),
// since a company's one industry can decide its estimate and your sector.
export const INDUSTRIES = [
  { key: 'defense', label: 'Government, Defense & Aerospace', color: '#7f8c8d',
    words: /\b(government|federal|state of|county|city of|defen[cs]e|army|navy|air force|marine corps|military|dod|nasa|aerospace|lockheed|northrop|boeing|raytheon|l3harris|leidos|blue origin|spacex|public sector)\b/i },
  { key: 'finance', label: 'Finance & Investing', color: '#2ecc71',
    words: /\b(bank|banking|capital|ventures?|vc|investments?|investor|fund|private equity|growth equity|asset management|wealth|trading|trader|hedge|crypto|blockchain|web3|defi|fintech|stripe|coinbase|blackrock|robinhood|goldman|morgan stanley|jpmorgan|chase|bny|mellon|wells fargo|citi|citigroup|capital one|fidelity|vanguard|schwab|visa|mastercard|amex|american express|paypal|insurance|accounting|cpa|financial)\b/i },
  { key: 'health', label: 'Healthcare & Biotech', color: '#e74c3c',
    words: /\b(health|healthcare|medical|medicine|hospital|clinic|pharma|pharmaceutical|biotech|nurse|nursing|physician|doctor|dental|therapy|therapist|wellness)\b/i },
  { key: 'education', label: 'Education', color: '#f1c40f',
    words: /\b(university|college|school|education|student|professor|teacher|academy|phd|faculty|alumni)\b/i },
  { key: 'media', label: 'Marketing & Media', color: '#e67e22',
    words: /\b(marketing|brand|branding|advertising|agency|media|content|social media|creative|creator|influencer|pr|public relations|communications|tiktok|pinterest|youtube|growth marketing)\b/i },
  { key: 'entertainment', label: 'Entertainment & Gaming', color: '#9b59b6',
    words: /\b(entertainment|film|movie|music|records|gaming|games?|esports|studio|studios|netflix|disney|spotify|hollywood|theater|theatre|sports)\b/i },
  { key: 'tech', label: 'Tech, Software & AI', color: '#3498db',
    words: /\b(software|saas|engineer|engineering|developer|tech|technology|technologies|ai|artificial intelligence|machine learning|ml|data|cloud|cyber|security|devops|product manager|google|microsoft|apple|meta|amazon|nvidia|openai|anthropic|palantir|salesforce|oracle|ibm|intel|app|apps|startup|platform|labs?)\b/i },
  { key: 'consulting', label: 'Consulting, Legal & Services', color: '#1abc9c',
    words: /\b(consulting|consultant|consultancy|deloitte|accenture|mckinsey|kpmg|pwc|ey|bain|bcg|legal|law|lawyer|attorney|paralegal|recruiting|recruiter|staffing|talent)\b/i },
  { key: 'realestate', label: 'Real Estate & Construction', color: '#d35400',
    words: /\b(real estate|realtor|realty|property|properties|construction|architecture|architect|mortgage|homes|housing|builders?)\b/i },
  { key: 'consumer', label: 'Retail, Consumer & Hospitality', color: '#ff79c6',
    words: /\b(retail|e-?commerce|shopify|consumer|cpg|fashion|apparel|beauty|cosmetics|food|beverage|restaurant|hospitality|hotel|travel|tourism|coca-cola|nike|store|shop)\b/i },
  { key: 'industry', label: 'Manufacturing, Energy & Logistics', color: '#95a5a6',
    words: /\b(manufacturing|energy|oil|gas|solar|utilities|automotive|tesla|siemens|ge|general electric|honeywell|3m|logistics|supply chain|shipping|freight|fedex|ups|industrial|mining|chemicals?)\b/i },
  { key: 'nonprofit', label: 'Nonprofit & Community', color: '#bdc3c7',
    words: /\b(nonprofit|non-profit|foundation|charity|ngo|church|ministry|volunteer)\b/i },
];
export const UNKNOWN_INDUSTRY = { key: 'unknown', label: 'Unclear', color: '#555c66' };
const BY_KEY = Object.fromEntries([...INDUSTRIES, UNKNOWN_INDUSTRY].map((i) => [i.key, i]));
export const industryByKey = (key) => BY_KEY[key] || UNKNOWN_INDUSTRY;

/** The inferred industry for a company name, then a headline. */
export function industryOf(company, headline) {
  for (const text of [company, headline]) {
    if (!text) continue;
    const hit = INDUSTRIES.find((i) => i.words.test(text));
    if (hit) return hit;
  }
  return UNKNOWN_INDUSTRY;
}

/** industryOf as a key: what lib/scoring.js is handed, since it imports nothing. */
export const industryKeyOf = (company, headline) => industryOf(company, headline).key;

export const isSenior = (headline) => getSeniority(headline).level >= 4;

/**
 * Every company in the network with the people there.
 * @returns Map name -> { name, industry, people, d1, d2, d3, S, A, senior }
 * People are kept once (by profile URL), at their closest degree.
 *
 * A company's industry is the one scoring uses (lib/scoring.js
 * networkCompanies over the same rows): the curated list's, else the name's,
 * else what most of its people say. So a company's colour here is the sector
 * Settings → Your sector leans on, and each company is the one scoring
 * scores: both name it with cleanCompany().
 */
export function buildCompanyIndex(rows = []) {
  // Each headline is read once, for the industries and for companyOf below.
  const parsed = new Map();
  const rolesOf = (r) => {
    if (!parsed.has(r)) parsed.set(r, rolesWithCompanies(r));
    return parsed.get(r);
  };
  const { industries } = networkCompanies(rows, { industryOf: industryKeyOf, rolesOf });
  const best = new Map();
  for (const r of rows) {
    const key = r.profile_url || `id:${r.id}`;
    const prev = best.get(key);
    if (!prev || (r.degree || 9) < (prev.degree || 9)) best.set(key, r);
  }
  const index = new Map();
  for (const r of best.values()) {
    // companyOf(r), from the roles already read.
    const name = rolesOf(r).find((x) => !x.former)?.company;
    if (!name) continue;
    let co = index.get(name);
    if (!co) {
      co = { name, people: [], d1: 0, d2: 0, d3: 0, S: 0, A: 0, senior: 0 };
      index.set(name, co);
    }
    co.people.push(r);
    if (r.degree === 1) co.d1++; else if (r.degree === 2) co.d2++; else co.d3++;
    if (r.tier === 'S') co.S++;
    if (r.tier === 'A') co.A++;
    if (isSenior(r.headline)) co.senior++;
  }
  // Every company here is someone's current one, so networkCompanies read it too.
  for (const co of index.values()) co.industry = industryByKey(industries.get(co.name));
  return index;
}

/**
 * How companies connect through your people: one of your connections at A
 * whose circle includes people at B is a way from A into B.
 * @returns [{ a, b, weight, via: Set of bridge ids }] with a < b.
 */
export function companyLinks(degree1 = [], degree2 = []) {
  const bridgeCompany = new Map();
  for (const c of degree1) {
    const co = companyOf(c);
    if (co) bridgeCompany.set(c.id, co);
  }
  const links = new Map();
  for (const r of degree2) {
    const a = bridgeCompany.get(r.source_connection_id);
    const b = companyOf(r);
    if (!a || !b || a === b) continue;
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = `${x}\u0000${y}`;
    let l = links.get(k);
    if (!l) { l = { a: x, b: y, weight: 0, via: new Set() }; links.set(k, l); }
    l.weight++;
    l.via.add(r.source_connection_id);
  }
  return [...links.values()];
}

/** Who can get you into a company: direct connections there, then bridges who know people there. */
export function waysInto(company, degree1 = [], degree2 = []) {
  const direct = degree1.filter((c) => companyOf(c) === company);
  const counts = new Map();
  for (const r of degree2) {
    if (companyOf(r) !== company) continue;
    counts.set(r.source_connection_id, (counts.get(r.source_connection_id) || 0) + 1);
  }
  const byId = new Map(degree1.map((c) => [c.id, c]));
  const bridges = [...counts.entries()]
    .map(([id, n]) => ({ bridge: byId.get(id), n }))
    .filter((b) => b.bridge)
    .sort((x, y) => y.n - x.n || (Number(y.bridge.power_score) || 0) - (Number(x.bridge.power_score) || 0));
  return { direct, bridges };
}
