// Companies and industries across your network — what the Paths analyzer is
// built on. Plain functions, no React, so tests/companies.test.mjs runs them.
//
// LinkedIn doesn't give an industry for a person, and this app stores none, so
// industry is inferred from the company name and headline, and labelled
// "inferred" wherever it is shown. Unclear stays unclear rather than guessed.

// Merge company name variants
export function normalizeCompany(name) {
  const n = (name || '').trim().toLowerCase();
  // Social / Media
  if (n.includes('snap') && (n.includes('inc') || n === 'snap' || n === 'snapchat')) return 'Snap';
  if (n.includes('meta') && (n.includes('platform') || n === 'meta' || n.includes('facebook'))) return 'Meta';
  if (n.includes('tiktok') || n.includes('bytedance')) return 'TikTok';
  if (n.includes('pinterest')) return 'Pinterest';
  // Big Tech
  if (n === 'google' || n.includes('alphabet') || (n.includes('google') && n.includes('llc'))) return 'Google';
  if (n === 'apple' || n === 'apple inc' || n === 'apple inc.') return 'Apple';
  if (n.includes('amazon') && !n.includes('amazon ')) return 'Amazon';
  if (n.includes('microsoft')) return 'Microsoft';
  // AI
  if (n.includes('anthropic')) return 'Anthropic';
  if (n.includes('openai') || n === 'open ai') return 'OpenAI';
  if (n.includes('deepmind')) return 'DeepMind';
  if (n.includes('cohere')) return 'Cohere';
  if (n.includes('mistral')) return 'Mistral';
  if (n.includes('hugging') && n.includes('face')) return 'Hugging Face';
  // Fintech / Crypto
  if (n.includes('stripe')) return 'Stripe';
  if (n.includes('coinbase')) return 'Coinbase';
  if (n.includes('polymarket')) return 'Polymarket';
  if (n.includes('blackrock')) return 'BlackRock';
  if (n.includes('robinhood')) return 'Robinhood';
  // Growth / Commerce
  if (n.includes('whatnot')) return 'Whatnot';
  if (n.includes('shopify')) return 'Shopify';
  if (n.includes('palantir')) return 'Palantir';
  if (n.includes('anduril')) return 'Anduril';
  if (n.includes('netflix')) return 'Netflix';
  if (n.includes('spotify')) return 'Spotify';
  if (n.includes('tesla')) return 'Tesla';
  if (n.includes('spacex')) return 'SpaceX';
  if (n.includes('nvidia')) return 'NVIDIA';
  // Defense / Aerospace
  if (n.includes('lockheed')) return 'Lockheed Martin';
  if (n.includes('northrop')) return 'Northrop Grumman';
  if (n.includes('boeing')) return 'Boeing';
  if (n.includes('l3harris') || n.includes('l3 harris')) return 'L3Harris';
  if (n.includes('leidos')) return 'Leidos';
  if (n.includes('nasa')) return 'NASA';
  if (n.includes('sandia')) return 'Sandia National Labs';
  if (n.includes('blue origin')) return 'Blue Origin';
  if (n.includes('raytheon')) return 'Raytheon';
  if (n.includes('general dynamics')) return 'General Dynamics';
  if (n.includes('bae systems')) return 'BAE Systems';
  // Finance
  if (n.includes('goldman')) return 'Goldman Sachs';
  if (n.includes('jpmorgan') || n.includes('jp morgan')) return 'JPMorgan Chase';
  if (n.includes('wells fargo')) return 'Wells Fargo';
  if (n.includes('citi') && !n.includes('citizen')) return 'Citi';
  if (n.includes('mastercard')) return 'Mastercard';
  if (n.includes('visa') && n.length < 15) return 'Visa';
  if (n.includes('paypal')) return 'PayPal';
  if (n.includes('bny') || n.includes('bank of new york') || n.includes('mellon')) return 'BNY Mellon';
  if (n.includes('deloitte')) return 'Deloitte';
  if (n.includes('bain')) return 'Bain & Company';
  if (n.includes('bloomberg')) return 'Bloomberg';
  if (n.includes('usaa')) return 'USAA';
  if (n.includes('navy federal')) return 'Navy Federal';
  if (n.includes('raymond james')) return 'Raymond James';
  if (n.includes('geico')) return 'GEICO';
  // Enterprise / Industrial
  if (n.includes('oracle')) return 'Oracle';
  if (n.includes('ibm')) return 'IBM';
  if (n.includes('servicenow')) return 'ServiceNow';
  if (n.includes('siemens')) return 'Siemens';
  if (n.includes('texas instruments')) return 'Texas Instruments';
  if (n.includes('qualcomm')) return 'Qualcomm';
  if (n.includes('databricks')) return 'Databricks';
  if (n.includes('together.ai') || n.includes('together ai')) return 'Together AI';
  if (n.includes('zoox')) return 'Zoox';
  // Entertainment
  if (n.includes('nbcuniversal') || n.includes('nbc universal')) return 'NBCUniversal';
  if (n.includes('universal destinations')) return 'Universal Destinations';
  // Other
  if (n.includes('humana')) return 'Humana';
  if (n.includes('booz allen')) return 'Booz Allen Hamilton';
  if (n.includes('abbott')) return 'Abbott';
  if (n.includes('walmart')) return 'Walmart';
  if (n.includes('publix')) return 'Publix';
  if (n.includes('mitsubishi')) return 'Mitsubishi Power';
  if (n.includes('oscar health')) return 'Oscar Health';
  if (n.includes('ford') && n.length < 15) return 'Ford';
  if (n.includes('coca') && n.includes('cola')) return 'Coca-Cola';
  if (n.includes('nike')) return 'Nike';
  if (n.includes('disney')) return 'Disney';
  if (n.includes('ucf') || n.includes('university of central florida')) return 'UCF';
  return (name || '').trim();
}

export const SENIORITY_LEVELS = [
  { key: 'csuite', label: 'C-Suite', match: /ceo|chief|founder|president|chairman|co-founder/i, level: 6 },
  { key: 'vp', label: 'VP / SVP', match: /\bvp\b|vice president|svp|evp|managing director/i, level: 5 },
  { key: 'director', label: 'Director / Head', match: /director|head of|senior director/i, level: 4 },
  { key: 'manager', label: 'Manager / Lead', match: /manager|lead|principal|staff/i, level: 3 },
  { key: 'senior', label: 'Senior IC', match: /senior|sr\.|sr /i, level: 2 },
  { key: 'ic', label: 'IC / Entry', match: /./, level: 1 },
];

export function getSeniority(headline) {
  const h = (headline || '').toLowerCase();
  if (h.match(/intern|student|aspiring/i)) return { key: 'intern', label: 'Intern / Student', level: 0 };
  for (const s of SENIORITY_LEVELS) if (s.match.test(h)) return s;
  return { key: 'ic', label: 'IC / Entry', level: 1 };
}

/** The company a row belongs to: a company scan's, the stored one, or the headline's "at X". */
export function companyOf(c) {
  const hl = c?.headline || '';
  const fromHeadline = hl.split(/ at | @ /)?.[1]?.split(/[|,•·]/)?.[0]?.trim();
  const co = normalizeCompany(c?.scanned_company || c?.company || fromHeadline);
  return co && co.length >= 2 ? co : null;
}

// Order matters: the first industry whose words match wins, checked against the
// company name first (it is the stronger signal), then the headline.
export const INDUSTRIES = [
  { key: 'defense', label: 'Government, Defense & Aerospace', color: '#7f8c8d',
    words: /\b(government|federal|state of|county|city of|defen[cs]e|army|navy|air force|marine corps|military|dod|nasa|aerospace|lockheed|northrop|boeing|raytheon|l3harris|leidos|anduril|sandia|blue origin|spacex|public sector)\b/i },
  { key: 'finance', label: 'Finance, VC & Crypto', color: '#2ecc71',
    words: /\b(bank|banking|capital|ventures?|vc|investments?|investor|fund|private equity|asset management|wealth|trading|trader|hedge|crypto|blockchain|web3|defi|fintech|stripe|coinbase|blackrock|robinhood|polymarket|goldman|morgan stanley|jpmorgan|chase|bny|mellon|wells fargo|citi|citigroup|capital one|fidelity|vanguard|schwab|visa|mastercard|amex|american express|paypal|insurance|accounting|cpa|financial)\b/i },
  { key: 'health', label: 'Healthcare & Biotech', color: '#e74c3c',
    words: /\b(health|healthcare|medical|medicine|hospital|clinic|pharma|pharmaceutical|biotech|nurse|nursing|physician|doctor|dental|therapy|therapist|wellness)\b/i },
  { key: 'education', label: 'Education', color: '#f1c40f',
    words: /\b(university|college|school|education|student|professor|teacher|academy|ucf|phd|faculty|alumni)\b/i },
  { key: 'media', label: 'Marketing, Media & Creator', color: '#e67e22',
    words: /\b(marketing|brand|branding|advertising|agency|media|content|social media|creative|creator|influencer|pr|public relations|communications|snap|snapchat|tiktok|pinterest|youtube|lens|ar|growth)\b/i },
  { key: 'entertainment', label: 'Entertainment & Gaming', color: '#9b59b6',
    words: /\b(entertainment|film|movie|music|records|gaming|games?|esports|studio|studios|netflix|disney|spotify|hollywood|theater|theatre|sports)\b/i },
  { key: 'tech', label: 'Tech, Software & AI', color: '#3498db',
    words: /\b(software|saas|engineer|engineering|developer|tech|technology|technologies|ai|artificial intelligence|machine learning|ml|data|cloud|cyber|security|devops|product manager|google|microsoft|apple|meta|amazon|nvidia|openai|anthropic|palantir|salesforce|oracle|ibm|intel|app|apps|startup|platform|labs?)\b/i },
  { key: 'consulting', label: 'Consulting, Legal & Services', color: '#1abc9c',
    words: /\b(consulting|consultant|consultancy|deloitte|accenture|mckinsey|kpmg|pwc|ey|bain|bcg|legal|law|lawyer|attorney|paralegal|recruiting|recruiter|staffing|talent)\b/i },
  { key: 'realestate', label: 'Real Estate & Construction', color: '#d35400',
    words: /\b(real estate|realtor|realty|property|properties|construction|architecture|architect|mortgage|homes|housing|builders?)\b/i },
  { key: 'consumer', label: 'Retail, Consumer & Hospitality', color: '#ff79c6',
    words: /\b(retail|e-?commerce|shopify|consumer|cpg|fashion|apparel|beauty|cosmetics|food|beverage|restaurant|hospitality|hotel|travel|tourism|coca-cola|nike|whatnot|store|shop)\b/i },
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

export const isSenior = (headline) => getSeniority(headline).level >= 4;

/**
 * Every company in the network with the people there.
 * @returns Map name -> { name, industry, people, d1, d2, d3, S, A, senior }
 * People are kept once (by profile URL), at their closest degree.
 */
export function buildCompanyIndex(rows = []) {
  const best = new Map();
  for (const r of rows) {
    const key = r.profile_url || `id:${r.id}`;
    const prev = best.get(key);
    if (!prev || (r.degree || 9) < (prev.degree || 9)) best.set(key, r);
  }
  const index = new Map();
  for (const r of best.values()) {
    const name = companyOf(r);
    if (!name) continue;
    let co = index.get(name);
    if (!co) {
      co = { name, people: [], d1: 0, d2: 0, d3: 0, S: 0, A: 0, senior: 0, votes: {} };
      index.set(name, co);
    }
    co.people.push(r);
    if (r.degree === 1) co.d1++; else if (r.degree === 2) co.d2++; else co.d3++;
    if (r.tier === 'S') co.S++;
    if (r.tier === 'A') co.A++;
    if (isSenior(r.headline)) co.senior++;
    const ind = industryOf(name, r.headline).key;
    co.votes[ind] = (co.votes[ind] || 0) + 1;
  }
  for (const co of index.values()) {
    // The company name decides when it can; otherwise the most common headline industry.
    const byName = industryOf(co.name, null);
    if (byName !== UNKNOWN_INDUSTRY) co.industry = byName;
    else {
      const [top] = Object.entries(co.votes).filter(([k]) => k !== 'unknown').sort((a, b) => b[1] - a[1]);
      co.industry = top ? industryByKey(top[0]) : UNKNOWN_INDUSTRY;
    }
    delete co.votes;
  }
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
