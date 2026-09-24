// How much power a person holds, and why — the one place it is decided.
//
//   power = title × company weight + reach bonus + bridge boost
//
// The core is a PRODUCT, not a sum: a title is worth more at a bigger company,
// and a big company is worth more the higher you sit in it. A VP at Google
// outranks a founder of an unknown startup, who outranks an intern at Google.
// The old model added them (0.5 × seniority + 0.3 × company), which let an
// intern at a famous company score like a director at an unknown one.
//
//   title (0–10)         read from the person's CURRENT role in their headline:
//                        the first part that names a job, skipping "Ex-" and
//                        "Former" parts; student clubs and fraternities don't
//                        count as company titles.
//   company weight       0.45 + 0.055 × company score, so 0.56 (no company)
//                        up to 1.0 (a company scored 10).
//   reach bonus (≤1.5)   real signals only, matched as whole words: investor,
//                        YC, Forbes, audience or revenue in the millions,
//                        TEDx/keynote/patents/awards.
//   bridge boost (≤1)    for a 1st-degree person whose circle is mapped, when
//                        their circle is unusually strong. Recomputed each time,
//                        never ratcheted upward.
//
// Company scores come from, in order: the score you set, a curated list of
// well-known companies, and otherwise how many of your people work there.
// Everything here is a plain function; tests/scoring.test.mjs pins it down.

// Bump when the model changes: the app rescores stored rows once on next load.
export const SCORING_VERSION = 2;

// ── title ────────────────────────────────────────────────────────────────────

export const LEVELS = {
  csuite: { key: 'csuite', label: 'C-Suite / Founder', level: 6, points: 10 },
  owner: { key: 'owner', label: 'Owner / Entrepreneur', level: 5, points: 8 },
  vp: { key: 'vp', label: 'VP / Partner / GM', level: 5, points: 9 },
  director: { key: 'director', label: 'Director / Head', level: 4, points: 7.5 },
  manager: { key: 'manager', label: 'Manager / Lead', level: 3, points: 6.5 },
  senior: { key: 'senior', label: 'Senior IC', level: 2, points: 5 },
  ic: { key: 'ic', label: 'IC / Entry', level: 1, points: 4 },
  unknown: { key: 'unknown', label: 'Title unclear', level: 1, points: 3 },
  intern: { key: 'intern', label: 'Intern', level: 0, points: 2 },
  student: { key: 'student', label: 'Student', level: 0, points: 1 },
};

// Checked in this order within one part of a headline. Earlier rules REMOVE
// their words, so "Vice President" can't also read as "President", "Chief of
// Staff" as a chief, or "Product Owner" as an owner. The highest level found wins.
const TITLE_RULES = [
  [/\b(reporting )?(to|for) (the |our )?(ceo|cto|coo|cfo|cmo|founders?|co-?founders?|president|chair(man)?)\b/g, null],
  [/\bchief of staff\b/g, 'director'],
  [/\b(senior |executive |assistant |associate )?vice[-\s]?president\b|\b(s|e|a)?vp\b/g, 'vp'],
  [/\b(product|process|content|data|feature|service|project|business process) owner\b/g, 'ic'],
  [/\b(client|channel|strategic|business|brand|creative|agency|solutions?|account|community|developer|technology|alliances?|content|media|marketing|talent|partner) partner\b/g, 'senior'],
  [/\bpartner (manager|marketing|development|success)\b/g, 'manager'],
  [/\blead gen(eration)?\b|\bthought leader(ship)?\b/g, null],
  [/\binvestor relations\b/g, 'ic'],
  [/\b(ceo|cto|cfo|coo|cmo|cro|cpo|cio|ciso|cdo|cso)\b|\bchief\s+(\w+\s+){0,3}officer\b|\bchief executive\b|\b(co-?)?founder\b|\bcofounder\b|\bpresident\b|\bchair(man|woman|person)\b|\bexecutive chair\b|\b(general|managing|founding) partner\b/g, 'csuite'],
  [/\b(co-?)?owner\b|\bentrepreneur\b|\bself[-\s]employed\b|\bproprietor\b/g, 'owner'],
  [/\bmanaging director\b|\bgeneral manager\b|\bgm\b|\bcountry (manager|director|lead)\b|\bglobal head\b|\bchief (technologist|scientist|architect|economist|evangelist|strategist|engineer|of \w+)\b|^\s*partner\b|\bpartner (at|@)|\b(venture|senior|equity|operating) partner\b|\bboard (member|director|chair)\b|\bchair of the board\b|\bmember of the board\b|\bboard of directors\b/g, 'vp'],
  [/\b(senior |executive |creative |art |associate )?director\b|\bhead of\b|\bhead\b(?= (coach|chef))|\b(angel |venture )?investor\b|\bprincipal at\b|\b(technical|distinguished|senior) fellow\b|(?<!account |sales |customer )\bexecutive\b(?! (assistant|producer|chef))/g, 'director'],
  [/\bmanager\b|\bmgr\b|\b(team |tech |design |engineering )?lead\b|\bleader\b|\bprincipal\b|\bstaff (engineer|designer|scientist|product|data)\b|\bsupervisor\b|\bsuperintendent\b/g, 'manager'],
  [/\bsenior\b|\bsr\b\.?|\bspecialist\b|\barchitect\b|\bexpert\b|\bexecutive producer\b/g, 'senior'],
  [/\b(engineer|developer|designer|analyst|associate|coordinator|consultant|strategist|recruiter|creator|producer|editor|writer|artist|scientist|researcher|representative|assistant|administrator|technician|officer|agent|teacher|professor|nurse|attorney|lawyer|accountant|marketer|photographer|videographer|freelancer?|contractor|account executive|creative|influencer|coach|trainer|instructor|advisor|adviser|mentor|programmer|animator|illustrator|planner|buyer|broker|realtor|swe|sde|sre|pm|recruiting)\b/g, 'ic'],
];

const INTERN = /\b(intern|internship|trainee|apprentice)\b/;
const STUDENT = /\b(student|undergrad(uate)?|aspiring|phd candidate|recent grad(uate)?|class of 20\d\d|incoming (analyst|intern|associate|swe|engineer)|gpa|freshman|sophomore|b\.?s\.? candidate)\b|^\s*(honors )?(cs|computer science|ms ?cs|mscs|bscs|engineering|finance|marketing|business|economics|accounting|biology|psychology|information technology)\b.*(\s(@|at)\s*)(ucf|uf|university|college)\b/;
const GREEK = '(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)';
const STUDENT_ORG = new RegExp(`\\b(fraternity|sorority|student (government|association|union|org(anization)?|senate)|honor society|campus)\\b|\\b${GREEK}\\s+${GREEK}\\b`);
const SCHOOL_CLUB = /\b(club|chapter|society|association)\b.*\b(ucf|uf|university|college|school|student)\b|\b(ucf|uf|university|college|school|student)\b.*\b(club|chapter|society)\b/;
const FORMER = /^\s*(ex[-\s]|former(ly)?\b|previously\b|prev\b|past\b|retired\b)/i;

/** The parts of a headline, in order: "CEO @ X | Ex-Google | Speaker" → three parts. */
export function headlineParts(headline = '') {
  return String(headline || '').split(/\s*(?:\||•|·|⋅|\/\/| – | — | - |;)\s*/).map((s) => s.trim()).filter(Boolean);
}

function readPart(part) {
  let s = ` ${part.toLowerCase()} `;
  if (INTERN.test(s)) return LEVELS.intern;
  if (STUDENT.test(s)) return LEVELS.student;
  let best = null;
  for (const [re, key] of TITLE_RULES) {
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    s = s.replace(re, ' ');
    if (key && (!best || LEVELS[key].level > best.level || (LEVELS[key].level === best.level && LEVELS[key].points > best.points))) best = LEVELS[key];
  }
  const lower = part.toLowerCase();
  if (best && best.level >= 3 && (STUDENT_ORG.test(lower) || SCHOOL_CLUB.test(lower))) return { ...LEVELS.student, label: 'Student (club role)' };
  return best;
}

/**
 * Every role a headline names: "CEO @ X | Ex-VP at Google | Speaker" gives a
 * current CEO role at X and a former VP role at Google. A part that names only
 * a company ("GTM @ Whatnot") still says they work there.
 */
export function readRoles(headline = '', role = '') {
  const out = [];
  for (const raw of headlineParts(headline || role)) {
    const former = FORMER.test(raw);
    const part = raw.replace(FORMER, '').replace(/^[@\s.:]+/, '');
    let title = readPart(part);
    const company = companyIn(part) || (out.length === 0 && isKnownCompany(part) ? cleanCompany(part) : null);
    if (!title && company) title = { ...LEVELS.ic, label: 'Works there' };
    if (title) out.push({ title, company, former, part });
  }
  return out;
}

/** Is this person a student right now? Then no other title makes them powerful yet. */
export function isStudent(headline = '') {
  return headlineParts(headline).some((p) => !FORMER.test(p) && (STUDENT.test(` ${p.toLowerCase()} `) || INTERN.test(` ${p.toLowerCase()} `)));
}

/** The person's first current title (a quick read; scoring weighs every role). */
export function readTitle(headline = '', role = '') {
  const roles = readRoles(headline, role);
  const r = roles.find((x) => !x.former) || roles[0];
  return r ? { ...r.title, part: r.part } : { ...LEVELS.unknown, part: headlineParts(headline || role)[0] || '' };
}

// ── company ──────────────────────────────────────────────────────────────────

// Well-known companies, scored for what a person there can usually open up.
// These are defaults; a score you set always wins. Aliases are matched from
// the start of the (cleaned) company name, as whole words.
export const KNOWN_COMPANIES = [
  // 10 — the largest platforms and the frontier AI labs
  ['Google', 10, /^(google|alphabet|google deepmind|deepmind)\b/],
  ['Apple', 10, /^apple( inc)?$/],
  ['Microsoft', 10, /^microsoft\b/],
  ['Amazon', 10, /^(amazon|aws|amazon web services)\b/],
  ['Meta', 10, /^(meta|facebook|instagram|whatsapp|reality labs)\b/],
  ['NVIDIA', 10, /^nvidia\b/],
  ['OpenAI', 10, /^(openai|open ai)\b/],
  ['Anthropic', 10, /^anthropic\b/],
  ['Tesla', 10, /^tesla( motors| inc)?$/],
  // 9 — elite tech, finance and consulting; Snap (your home turf)
  ['Snap', 9, /^(snap|snapchat|snap inc|specs)\b(?!dragon)/],
  ['Netflix', 9, /^netflix\b/],
  ['YouTube', 9, /^youtube\b/],
  ['LinkedIn', 9, /^linkedin\b/],
  ['TikTok', 9, /^(tiktok|bytedance)\b/],
  ['SpaceX', 9, /^spacex\b/],
  ['Stripe', 9, /^stripe\b/],
  ['Palantir', 9, /^palantir\b/],
  ['Anduril', 9, /^anduril\b/],
  ['Polymarket', 9, /^polymarket\b/],
  ['Kalshi', 9, /^kalshi\b/],
  ['Coca-Cola', 9, /^(the )?coca[-\s]cola\b/],
  ['Disney', 9, /^(the walt |walt )?disney\b/],
  ['Goldman Sachs', 9, /^goldman( sachs)?\b/],
  ['JPMorgan Chase', 9, /^(jp ?morgan|j\.p\. morgan|jpmorgan chase|chase)\b/],
  ['Morgan Stanley', 9, /^morgan stanley\b/],
  ['BlackRock', 9, /^blackrock\b/],
  ['McKinsey', 9, /^mckinsey\b/],
  ['BCG', 9, /^(bcg|boston consulting group)\b/],
  ['Bain', 9, /^bain( & company| and company| capital)?$/],
  ['Procter & Gamble', 9, /^(p&g|procter)\b/],
  ['Sequoia', 9, /^sequoia( capital)?\b/],
  ['Andreessen Horowitz', 9, /^(a16z|andreessen)\b/],
  ['Y Combinator', 9, /^(y combinator|yc)$/],
  // 8 — major tech, media, consumer, defense, finance
  ['Salesforce', 8, /^salesforce\b/], ['Adobe', 8, /^adobe\b/], ['Oracle', 8, /^oracle\b/], ['IBM', 8, /^ibm\b/],
  ['Uber', 8, /^uber\b/], ['Airbnb', 8, /^airbnb\b/], ['DoorDash', 8, /^doordash\b/], ['Spotify', 8, /^spotify\b/],
  ['Pinterest', 8, /^pinterest\b/], ['Reddit', 8, /^reddit\b/], ['X', 8, /^(x corp|twitter)\b/], ['Roblox', 8, /^roblox\b/],
  ['Shopify', 8, /^shopify\b/], ['Databricks', 8, /^databricks\b/], ['Snowflake', 8, /^snowflake\b/], ['Datadog', 8, /^datadog\b/],
  ['CrowdStrike', 8, /^crowdstrike\b/], ['ServiceNow', 8, /^servicenow\b/], ['Figma', 8, /^figma\b/], ['Canva', 8, /^canva\b/],
  ['Scale AI', 8, /^(scale ai|scale\.ai|scale\.com)$/], ['Intuit', 8, /^intuit\b/], ['Cisco', 8, /^cisco\b/], ['Qualcomm', 8, /^qualcomm\b/], ['AMD', 8, /^amd\b/],
  ['Samsung', 8, /^samsung\b/], ['Sony', 8, /^sony\b/], ['Epic Games', 8, /^epic games\b/], ['Whatnot', 8, /^whatnot\b/],
  ['Coinbase', 8, /^coinbase\b/], ['Robinhood', 8, /^robinhood\b/], ['Block', 8, /^(block|square|cash app)$/],
  ['Visa', 8, /^visa( inc)?$/], ['Mastercard', 8, /^mastercard\b/], ['American Express', 8, /^(american express|amex)\b/],
  ['Capital One', 8, /^capital one\b/], ['BNY', 8, /^(bny|bny mellon|bank of new york)\b/], ['Citi', 8, /^(citi|citigroup|citibank)\b/],
  ['Wells Fargo', 8, /^wells fargo\b/], ['Bank of America', 8, /^(bank of america|merrill)\b/], ['Fidelity', 8, /^fidelity\b/],
  ['Deloitte', 8, /^deloitte\b/], ['PwC', 8, /^(pwc|pricewaterhouse)\b/], ['EY', 8, /^(ey|ernst & young)$/], ['KPMG', 8, /^kpmg\b/],
  ['Accenture', 8, /^accenture\b/], ['Egon Zehnder', 8, /^egon zehnder\b/], ['Heidrick & Struggles', 8, /^heidrick\b/],
  ['Nike', 8, /^nike\b/], ['PepsiCo', 8, /^pepsi(co)?\b/], ['Walmart', 8, /^walmart\b/], ['Starbucks', 8, /^starbucks\b/],
  ['Unilever', 8, /^unilever\b/], ['LVMH', 8, /^lvmh\b/], ["L'Oréal", 8, /^l'?or[eé]al\b/], ['Red Bull', 8, /^red bull\b/],
  ['NBCUniversal', 8, /^(nbcuniversal|nbc universal|nbc)\b/], ['Warner Bros. Discovery', 8, /^(warner|wbd)\b/], ['MrBeast', 8, /^(mrbeast|beast industries)\b/],
  ['Lockheed Martin', 8, /^lockheed\b/], ['Northrop Grumman', 8, /^northrop\b/], ['Boeing', 8, /^boeing\b/], ['RTX', 8, /^(rtx|raytheon)\b/],
  ['General Dynamics', 8, /^general dynamics\b/], ['Blue Origin', 8, /^blue origin\b/], ['Siemens', 8, /^siemens\b/],
  ['Mitsubishi', 8, /^mitsubishi\b/], ['Toyota', 8, /^toyota\b/], ['Johnson & Johnson', 8, /^(johnson & johnson|j&j)\b/],
  ['Pfizer', 8, /^pfizer\b/], ['UnitedHealth', 8, /^(unitedhealth|optum)\b/], ['World Bank', 8, /^world bank\b/],
  ['NASA', 8, /^nasa\b/], ['Stanford University', 8, /^stanford\b/], ['Harvard University', 8, /^harvard\b/], ['MIT', 8, /^(mit|massachusetts institute of technology)$/],
  // 7 — strong, well-known companies
  ['Discord', 7, /^discord\b/], ['Whop', 7, /^whop\b/], ['Hims & Hers', 7, /^hims\b/], ['Paramount', 7, /^paramount\b/],
  ['Madison Square Garden', 7, /^(madison square garden|msg)\b/], ['Fanatics', 7, /^fanatics\b/], ['Nielsen', 7, /^nielsen\b/],
  ['The Trade Desk', 7, /^the trade desk\b/], ['SiriusXM', 7, /^siriusxm\b/], ['Riot Games', 7, /^riot games\b/], ['Twitch', 7, /^twitch\b/],
  ['Electronic Arts', 7, /^(electronic arts|ea)$/], ['Activision Blizzard', 7, /^(activision|blizzard)\b/], ['Lyft', 7, /^lyft\b/],
  ['Instacart', 7, /^instacart\b/], ['Duolingo', 7, /^duolingo\b/], ['Notion', 7, /^notion\b/], ['Vercel', 7, /^vercel\b/],
  ['Intel', 7, /^intel( corporation)?$/], ['Workday', 7, /^workday\b/], ['PayPal', 7, /^paypal\b/], ['Plaid', 7, /^plaid\b/],
  ['Brex', 7, /^brex\b/], ['Ramp', 7, /^ramp$/], ['Mercury', 7, /^mercury$/], ['Chime', 7, /^chime$/], ['Credit Karma', 7, /^credit karma\b/],
  ['Chick-fil-A', 7, /^chick[-\s]fil[-\s]a\b/], ['Target', 7, /^target( corporation)?$/], ['Booz Allen Hamilton', 7, /^booz allen\b/],
  ['L3Harris', 7, /^l3harris\b/], ['Leidos', 7, /^leidos\b/], ['U.S. Space Force', 7, /^(u\.?s\.? )?space force\b/],
  ['WPP', 7, /^wpp\b/], ['Omnicom', 7, /^omnicom\b/], ['Publicis', 7, /^publicis\b/], ['Interpublic', 7, /^(interpublic|ipg)\b/], ['Dentsu', 7, /^dentsu\b/],
  ['Kellanova', 7, /^(kellanova|kellogg)\b/], ['Campbell', 7, /^campbell\b/], ['Goodyear', 7, /^goodyear\b/],
  ['Duke University', 7, /^duke( university)?$/], ['UC Berkeley', 7, /^(uc berkeley|university of california,? berkeley)\b/],
  // 6 — notable
  ['Grindr', 6, /^grindr\b/], ['Genius Sports', 6, /^genius sports\b/], ['Later', 6, /^later$/], ['Hard Rock Digital', 6, /^hard rock\b/],
  ['Vanta', 6, /^vanta\b/], ['Kaseya', 6, /^kaseya\b/], ['Havas', 6, /^havas\b/], ['VaynerMedia', 6, /^vayner/],
  ['AdventHealth', 6, /^adventhealth\b/], ['University of Florida', 6, /^(uf|university of florida)$/], ['The Athletic', 6, /^the athletic\b/],
  // 5 — your local institutions
  ['UCF', 5, /^(ucf|university of central florida)\b/],
];

const JUNK_COMPANY = /^(self[-\s]?employed|freelance|various|multiple|confidential|n\/a|none|tbd|open to work|looking|seeking)$/i;
// "at scale", "at the intersection of…", "at heart": phrases, not employers.
const NOT_A_COMPANY = /^(scale$|heart|large|night|home|work|speed|best|the intersection|intersection|the crossroads|the forefront|the core|every stage|all levels|your service)\b/i;

/** A company name as people write it → one clean, canonical name (or null). */
export function cleanCompany(raw) {
  let s = String(raw || '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}‍]/gu, '')
    .split(/\s*(?:\||•|·| – | — | - |!|\(|\/| {2,})\s*/)[0]
    .split(/\.\s|,\s/)[0]
    .replace(/[\s,.:;'"]+$/, '')
    .replace(/,?\s+(inc|llc|ltd|l\.l\.c|corp|corporation|co|gmbh|plc|pbc)\.?$/i, '')
    .trim();
  if (!s || s.length < 2 || JUNK_COMPANY.test(s) || NOT_A_COMPANY.test(s)) return null;
  if (s.length > 50 || s.split(/\s+/).length > 6 || /\$|\d+%|\d+[kmb]\+/i.test(s)) return null;
  const lower = s.toLowerCase();
  const bare = lower.replace(/^the /, '');
  for (const [name, , alias] of KNOWN_COMPANIES) if (alias.test(lower) || alias.test(bare) || lower === name.toLowerCase()) return name;
  return s;
}

const KNOWN_BY_NAME = new Map(KNOWN_COMPANIES.map(([name, score]) => [name, score]));

const isKnownCompany = (text) => {
  const c = cleanCompany(text);
  return !!c && KNOWN_BY_NAME.has(c);
};

/**
 * Each role with its company filled in where the headline didn't say: a
 * company scan's company, else the stored company (unless that company is
 * only mentioned in an "Ex-" part), goes to the first current role.
 */
export function rolesWithCompanies(row) {
  const roles = readRoles(row?.headline, row?.role);
  const fill = cleanCompany(row?.scanned_company) || (() => {
    const stored = cleanCompany(row?.company);
    return stored && !roles.some((r) => r.former && r.company === stored) ? stored : null;
  })();
  const first = roles.find((r) => !r.former);
  if (fill && first && !first.company) first.company = fill;
  if (fill && !first) roles.unshift({ title: { ...LEVELS.unknown }, company: fill, former: false, part: '' });
  if (!roles.length) roles.push({ title: { ...LEVELS.unknown }, company: null, former: false, part: '' });
  return roles;
}

/** The company a person works at now (their first current role's). */
export function currentCompany(row) {
  return rolesWithCompanies(row).find((r) => !r.former)?.company || null;
}

function companyIn(part = '') {
  const m = String(part).match(/(?:\s(?:at\s+|@\s*)|^@|\s@)(.+)$/i);
  return m ? cleanCompany(m[1]) : null;
}

/**
 * A company's score and where it came from.
 *   yours    you set it
 *   known    the curated list above
 *   network  unknown to the list; nudged up when several of your people work there
 *   default  unknown, and few of your people there
 *   none     no company found for this person
 */
export function companyScore(name, { overrides = new Map(), headcount = 0, industry } = {}) {
  if (!name) return { score: 3, source: 'none' };
  if (overrides.has(name)) return { score: overrides.get(name), source: 'yours' };
  if (KNOWN_BY_NAME.has(name)) return { score: KNOWN_BY_NAME.get(name), source: 'known' };
  if (industry !== 'education' && headcount >= 15) return { score: 6, source: 'network' };
  if (industry !== 'education' && headcount >= 5) return { score: 5, source: 'network' };
  return { score: 4, source: 'default' };
}

// ── reach bonus ──────────────────────────────────────────────────────────────

const BONUSES = [
  [/\b(angel investor|investor|venture capital(ist)?|vc|general partner|limited partner)\b(?! relations)/i, 1, 'investor'],
  [/\by ?combinator\b|\(yc\)|\byc\b ?[wsfx]?\d{0,2}\b/i, 1, 'YC'],
  [/\b30 under 30\b/i, 1, '30 under 30'],
  [/\b\d[\d.,]*\s?(m|b|million|billion)\+?\s*(views|followers|subscribers|impressions|users|downloads|installs|listeners|students|customers|members|reach)\b|\$?\s?\d[\d.,]*\s?(m|b|million|billion)\+?\s*(in )?(sales|revenue|arr|gmv|raised|funding)\b|\braised \$?\s?\d[\d.,]*\s?(m|b|million|billion)\b/i, 0.75, 'reach in the millions'],
  [/\b(tedx?|keynote|patents?|author of|best[-\s]?selling|award[-\s]winning|cannes lions|emmy|grammy|webby)\b/i, 0.5, 'recognition'],
];

/**
 * Bonus points from signals in the headline, capped at 1.5, with the reasons.
 * Headlines are self-written: claims from someone at a company nobody knows
 * (company score 4 or less) count half.
 */
export function reachBonus(headline = '', companyScoreValue = 10) {
  let points = 0;
  const reasons = [];
  for (const [re, p, label] of BONUSES) if (re.test(headline || '')) { points += p; reasons.push(label); }
  points = Math.min(1.5, points);
  if (points && companyScoreValue <= 4) { points /= 2; reasons.push('halved: unknown company'); }
  return { points: round1(points), reasons };
}

// ── putting it together ──────────────────────────────────────────────────────

// S is the top ~3–4%: VP and up at strong companies, founders and C-suite at
// known ones, directors only at 10/10 companies.
export function tierFor(power) {
  if (power >= 7.5) return 'S';
  if (power >= 5.5) return 'A';
  if (power >= 4) return 'B';
  if (power >= 2.5) return 'C';
  return 'D';
}

const round1 = (n) => Math.round(n * 10) / 10;

export const FORMER_WEIGHT = 0.7;
export const STUDENT_CAP = 3;

/**
 * One person's score, before any bridge boost: their strongest role, where a
 * role is worth title × company weight. Former roles count at 70% — an ex-SVP
 * still knows the people an SVP knows. A current student is capped at 3 title
 * points whatever else they list. `companyFor(name)` returns companyScore().
 */
export function scorePerson(row, companyFor = (name) => companyScore(name)) {
  const student = isStudent(row?.headline);
  let best = null;
  for (const role of rolesWithCompanies(row)) {
    const co = companyFor(role.company);
    let points = role.title.points * (role.former ? FORMER_WEIGHT : 1);
    if (student) points = Math.min(points, STUDENT_CAP);
    const core = points * (0.45 + 0.055 * co.score);
    if (!best || core > best.core) best = { role, co, points, core };
  }
  const bonus = reachBonus(row?.headline, best.co.score);
  const power = round1(best.core + bonus.points);
  const title = { ...best.role.title, former: best.role.former, student, points: round1(best.points) };
  if (best.role.former) title.label = `Former ${title.label}`;
  if (student && best.role.title.level > 0) title.label = `Student · ${title.label}`;
  return { title, company: best.role.company, companyScore: best.co.score, companySource: best.co.source, bonus, power, tier: tierFor(power) };
}

/**
 * A 1st-degree person's boost for a strong mapped circle: up to +1 when the
 * share of their circle at A or S is well above normal. Circles under 20
 * people are too small to judge.
 */
export function bridgeBoost(circle = []) {
  const total = circle.length;
  const sCount = circle.filter((p) => p.tier === 'S').length;
  const aCount = circle.filter((p) => p.tier === 'A').length;
  const elitePct = total ? (sCount + aCount) / total : 0;
  const circlePower = sCount * 3 + aCount * 1.5 + elitePct * 10 + Math.log(total + 1) * 1.5;
  const boost = total >= 20 ? Math.max(0, Math.min(1, (elitePct - 0.12) * 5)) : 0;
  const isCatalyst = (sCount >= 5 && elitePct >= 0.25) || circlePower >= 50 || (sCount >= 3 && elitePct >= 0.3);
  return { boost: round1(boost), total, sCount, aCount, elitePct, circlePower, isCatalyst };
}

/** A plain-English line for why someone scores what they do. */
export function explainScore(s, boost = 0) {
  const bits = [`${s.title.label} (${s.title.points})`, `${s.company || 'no company found'} (${s.companyScore}/10${s.companySource === 'yours' ? ', your score' : ''})`];
  if (s.bonus.points) bits.push(`+${s.bonus.points} ${s.bonus.reasons.join(', ')}`);
  if (boost) bits.push(`+${boost} strong circle`);
  return bits.join(' · ');
}

/**
 * Score a whole network. People first, with company scores that can use how
 * many of your people work at each company; then 1st-degree bridges get their
 * circle boost from their scored circle. Returns one result per row id.
 */
export function scoreNetwork(rows = [], { overrides = new Map(), industryOf } = {}) {
  // How many of your people work at each company (currently, once each).
  const headcount = new Map();
  const seen = new Set();
  for (const r of rows) {
    for (const role of rolesWithCompanies(r)) {
      const key = `${role.company}|${r.profile_url || r.id}`;
      if (!role.company || role.former || seen.has(key)) continue;
      seen.add(key);
      headcount.set(role.company, (headcount.get(role.company) || 0) + 1);
    }
  }
  const out = new Map();
  for (const r of rows) {
    const companyFor = (name) => companyScore(name, { overrides, headcount: headcount.get(name) || 0, industry: name ? industryOf?.(name, r.headline) : undefined });
    out.set(r.id, { ...scorePerson(r, companyFor), boost: 0 });
  }
  const circles = new Map();
  for (const r of rows) {
    if (r.degree !== 2 || !r.source_connection_id) continue;
    const list = circles.get(r.source_connection_id) || [];
    list.push(out.get(r.id));
    circles.set(r.source_connection_id, list);
  }
  for (const [bridgeId, circle] of circles) {
    const s = out.get(bridgeId);
    if (!s) continue;
    const b = bridgeBoost(circle);
    s.circle = b;
    s.boost = b.boost;
    s.power = round1(s.power + b.boost);
    s.tier = tierFor(s.power);
  }
  return { scores: out, headcount };
}
