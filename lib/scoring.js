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
//   company weight       0.45 + 0.055 × company score, so 0.615 when no company
//                        is found (score 3) up to 1.0 (a company scored 10);
//                        0.505 is the floor, for a company you score 1.
//   reach bonus (≤1.5)   real signals only, matched as whole words: investor,
//                        YC, Forbes, audience or revenue in the millions,
//                        TEDx/keynote/patents/awards. Halved at a company
//                        scored 4 or less, judged before any sector lean.
//   bridge boost (≤1)    for a 1st-degree person whose circle is mapped, when
//                        their circle is unusually strong. Recomputed each time,
//                        never ratcheted upward.
//
// Company scores come from, in order: the score you set, a curated list of
// well-known companies, and otherwise how many of your people work there.
// If you picked sectors in Settings, a company in one of them gets +1 or +2
// on top (never above 10, never on a score you set). That is worked out fresh
// on every rescore and never written into your company scores.
// Everything here is a plain function; tests/scoring.test.mjs pins it down.

// Bump when the model changes: the app rescores stored rows once on next load.
// 3: one industry per company (not per person), and the sector lean.
export const SCORING_VERSION = 3;

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
// These are the defaults for everyone who runs the app, so one written rule
// decides who is on the list, not anyone's own ties to a company. A company is
// on it only if most US professionals would recognise it:
//   - a household-name brand;
//   - a Fortune 500 company, or a public company as large;
//   - a top global VC, private equity, consulting, law or accounting firm;
//   - a frontier AI lab;
//   - a top national university.
// Scores follow one scale: 10 the largest tech platforms and the frontier AI
// labs, 9 elite (the most sought-after employers), 8 major, 7 well-known.
// Nothing on the list is below 7. Regional picks, picks from one person's
// career or network, and small startups are not on it: they are estimated
// from the network like any other company (4, or 5–6 when many of the
// network's people work there), and anyone can score them on Paths → Scores,
// where a score set always wins. When in doubt, a company stays off: the
// estimate is the neutral default. docs/brain/SCORING.md has the rule and
// what applying it changed; lib/legacy-scores.js keeps the old scores, for
// the one-time offer to keep them (never for scoring).
//
// Aliases are matched from the start of the (cleaned) company name, as whole
// words.
//
// The last field is the company's industry, one of lib/companies.js's
// INDUSTRIES keys (this file imports nothing, so they are plain strings;
// tests/companies.test.mjs checks each one). Most of these names carry no
// industry word, so without it Adobe, Pfizer or MIT would take whatever their
// people's headlines happen to say. Where a name does say something
// (Snap → media, Tesla → industry), the field agrees with it.
export const KNOWN_COMPANIES = [
  // 10 — the largest tech platforms and the frontier AI labs
  ['Google', 10, /^(google|alphabet|google deepmind|deepmind)\b/, 'tech'],
  ['Apple', 10, /^apple( inc)?$/, 'tech'],
  ['Microsoft', 10, /^microsoft\b/, 'tech'],
  ['Amazon', 10, /^(amazon|aws|amazon web services)\b/, 'tech'],
  ['Meta', 10, /^(meta|facebook|instagram|whatsapp|reality labs)\b/, 'tech'],
  ['NVIDIA', 10, /^nvidia\b/, 'tech'],
  ['OpenAI', 10, /^(openai|open ai)\b/, 'tech'],
  ['Anthropic', 10, /^anthropic\b/, 'tech'],
  ['Tesla', 10, /^tesla( motors| inc)?$/, 'industry'],
  // 9 — elite: the most sought-after employers in tech, finance, consulting,
  // investing and consumer brands
  ['Netflix', 9, /^netflix\b/, 'entertainment'],
  ['YouTube', 9, /^youtube\b/, 'media'],
  ['LinkedIn', 9, /^linkedin\b/, 'tech'],
  ['TikTok', 9, /^(tiktok|bytedance)\b/, 'media'],
  ['SpaceX', 9, /^spacex\b/, 'defense'],
  ['Stripe', 9, /^stripe\b/, 'finance'],
  ['Palantir', 9, /^palantir\b/, 'tech'],
  ['Coca-Cola', 9, /^(the )?coca[-\s]cola\b/, 'consumer'],
  ['Disney', 9, /^(the walt |walt )?disney\b/, 'entertainment'],
  ['Goldman Sachs', 9, /^goldman( sachs)?\b/, 'finance'],
  ['JPMorgan Chase', 9, /^(jp ?morgan|j\.p\. morgan|jpmorgan chase|chase)\b/, 'finance'],
  ['Morgan Stanley', 9, /^morgan stanley\b/, 'finance'],
  ['BlackRock', 9, /^blackrock\b/, 'finance'],
  ['McKinsey', 9, /^mckinsey\b/, 'consulting'],
  ['BCG', 9, /^(bcg|boston consulting group)\b/, 'consulting'],
  ['Bain', 9, /^bain( & company| and company)?$/, 'consulting'],
  // A private equity firm, not Bain & Company: its own entry (so its own
  // industry), at the 9 it had when it was an alias of Bain.
  ['Bain Capital', 9, /^bain capital$/, 'finance'],
  ['Procter & Gamble', 9, /^(p&g|procter)\b/, 'consumer'],
  ['Sequoia', 9, /^sequoia( capital)?\b/, 'finance'],
  ['Andreessen Horowitz', 9, /^(a16z|andreessen)\b/, 'finance'],
  ['Y Combinator', 9, /^(y combinator|yc)$/, 'finance'],
  // 8 — major companies and institutions
  ['Salesforce', 8, /^salesforce\b/, 'tech'], ['Adobe', 8, /^adobe\b/, 'tech'], ['Oracle', 8, /^oracle\b/, 'tech'], ['IBM', 8, /^ibm\b/, 'tech'],
  ['Uber', 8, /^uber\b/, 'tech'], ['Airbnb', 8, /^airbnb\b/, 'tech'], ['DoorDash', 8, /^doordash\b/, 'tech'], ['Spotify', 8, /^spotify\b/, 'entertainment'],
  ['Snap', 8, /^(snap|snapchat|snap inc|specs)\b(?!dragon)/, 'media'], ['Pinterest', 8, /^pinterest\b/, 'media'], ['Reddit', 8, /^reddit\b/, 'media'], ['X', 8, /^(x corp|twitter)\b/, 'media'],
  ['Roblox', 8, /^roblox\b/, 'entertainment'], ['Shopify', 8, /^shopify\b/, 'consumer'], ['Snowflake', 8, /^snowflake\b/, 'tech'], ['Datadog', 8, /^datadog\b/, 'tech'],
  ['CrowdStrike', 8, /^crowdstrike\b/, 'tech'], ['ServiceNow', 8, /^servicenow\b/, 'tech'], ['Canva', 8, /^canva\b/, 'tech'],
  ['Intuit', 8, /^intuit\b/, 'tech'], ['Cisco', 8, /^cisco\b/, 'tech'], ['Qualcomm', 8, /^qualcomm\b/, 'tech'], ['AMD', 8, /^amd\b/, 'tech'],
  ['Samsung', 8, /^samsung\b/, 'tech'], ['Sony', 8, /^sony\b/, 'entertainment'], ['Epic Games', 8, /^epic games\b/, 'entertainment'],
  ['Coinbase', 8, /^coinbase\b/, 'finance'], ['Robinhood', 8, /^robinhood\b/, 'finance'], ['Block', 8, /^(block|square|cash app)$/, 'finance'],
  ['Visa', 8, /^visa( inc)?$/, 'finance'], ['Mastercard', 8, /^mastercard\b/, 'finance'], ['American Express', 8, /^(american express|amex)\b/, 'finance'],
  ['Capital One', 8, /^capital one\b/, 'finance'], ['BNY', 8, /^(bny|bny mellon|bank of new york)\b/, 'finance'], ['Citi', 8, /^(citi|citigroup|citibank)\b/, 'finance'],
  ['Wells Fargo', 8, /^wells fargo\b/, 'finance'], ['Bank of America', 8, /^(bank of america|merrill)\b/, 'finance'], ['Fidelity', 8, /^fidelity\b/, 'finance'],
  ['Deloitte', 8, /^deloitte\b/, 'consulting'], ['PwC', 8, /^(pwc|pricewaterhouse)\b/, 'consulting'], ['EY', 8, /^(ey|ernst & young)$/, 'consulting'], ['KPMG', 8, /^kpmg\b/, 'consulting'],
  ['Accenture', 8, /^accenture\b/, 'consulting'],
  ['Nike', 8, /^nike\b/, 'consumer'], ['PepsiCo', 8, /^pepsi(co)?\b/, 'consumer'], ['Walmart', 8, /^walmart\b/, 'consumer'], ['Starbucks', 8, /^starbucks\b/, 'consumer'],
  ['Unilever', 8, /^unilever\b/, 'consumer'], ['LVMH', 8, /^lvmh\b/, 'consumer'], ["L'Oréal", 8, /^l'?or[eé]al\b/, 'consumer'], ['Red Bull', 8, /^red bull\b/, 'consumer'],
  ['NBCUniversal', 8, /^(nbcuniversal|nbc universal|nbc)\b/, 'entertainment'], ['Warner Bros. Discovery', 8, /^(warner|wbd)\b/, 'entertainment'],
  ['Lockheed Martin', 8, /^lockheed\b/, 'defense'], ['Northrop Grumman', 8, /^northrop\b/, 'defense'], ['Boeing', 8, /^boeing\b/, 'defense'], ['RTX', 8, /^(rtx|raytheon)\b/, 'defense'],
  ['General Dynamics', 8, /^general dynamics\b/, 'defense'], ['Blue Origin', 8, /^blue origin\b/, 'defense'], ['Siemens', 8, /^siemens\b/, 'industry'],
  ['Mitsubishi', 8, /^mitsubishi\b/, 'industry'], ['Toyota', 8, /^toyota\b/, 'industry'], ['Johnson & Johnson', 8, /^(johnson & johnson|j&j)\b/, 'health'],
  ['Pfizer', 8, /^pfizer\b/, 'health'], ['UnitedHealth', 8, /^(unitedhealth|optum)\b/, 'health'], ['World Bank', 8, /^world bank\b/, 'finance'],
  ['NASA', 8, /^nasa\b/, 'defense'], ['Stanford University', 8, /^stanford\b/, 'education'], ['Harvard University', 8, /^harvard\b/, 'education'], ['MIT', 8, /^(mit|massachusetts institute of technology)$/, 'education'],
  // 7 — well-known companies and universities
  ['Discord', 7, /^discord\b/, 'tech'], ['Paramount', 7, /^paramount\b/, 'entertainment'], ['Madison Square Garden', 7, /^(madison square garden|msg)\b/, 'entertainment'],
  ['Fanatics', 7, /^fanatics\b/, 'consumer'], ['Nielsen', 7, /^nielsen\b/, 'media'], ['The Trade Desk', 7, /^the trade desk\b/, 'media'], ['SiriusXM', 7, /^siriusxm\b/, 'entertainment'],
  ['Twitch', 7, /^twitch\b/, 'entertainment'], ['Electronic Arts', 7, /^(electronic arts|ea)$/, 'entertainment'], ['Activision Blizzard', 7, /^(activision|blizzard)\b/, 'entertainment'],
  ['MrBeast', 7, /^(mrbeast|beast industries)\b/, 'media'], ['Lyft', 7, /^lyft\b/, 'tech'], ['Instacart', 7, /^instacart\b/, 'tech'], ['Duolingo', 7, /^duolingo\b/, 'tech'],
  ['Intel', 7, /^intel( corporation)?$/, 'tech'], ['Workday', 7, /^workday\b/, 'tech'], ['PayPal', 7, /^paypal\b/, 'finance'], ['Credit Karma', 7, /^credit karma\b/, 'finance'],
  ['Chick-fil-A', 7, /^chick[-\s]fil[-\s]a\b/, 'consumer'], ['Target', 7, /^target( corporation)?$/, 'consumer'], ['Booz Allen Hamilton', 7, /^booz allen\b/, 'defense'],
  ['L3Harris', 7, /^l3harris\b/, 'defense'], ['Leidos', 7, /^leidos\b/, 'defense'],
  ['WPP', 7, /^wpp\b/, 'media'], ['Omnicom', 7, /^omnicom\b/, 'media'], ['Publicis', 7, /^publicis\b/, 'media'], ['Interpublic', 7, /^(interpublic|ipg)\b/, 'media'], ['Dentsu', 7, /^dentsu\b/, 'media'],
  ['Kellanova', 7, /^(kellanova|kellogg)\b/, 'consumer'], ['Campbell', 7, /^campbell\b/, 'consumer'], ['Goodyear', 7, /^goodyear\b/, 'industry'],
  ['Duke University', 7, /^duke( university)?$/, 'education'], ['UC Berkeley', 7, /^(uc berkeley|university of california,? berkeley)\b/, 'education'],
];

const JUNK_COMPANY = /^(self[-\s]?employed|freelance|various|multiple|confidential|n\/a|none|tbd|open to work|looking|seeking)$/i;
// "at scale", "at the intersection of…", "at heart": phrases, not employers.
const NOT_A_COMPANY = /^(scale$|heart|large|night|home|work|speed|best|the intersection|intersection|the crossroads|the forefront|the core|every stage|all levels|your service)\b/i;
// A name that says it is a school only matches a school on the list: the
// aliases match from the start of a name, so "Kellogg School of Management"
// read as Kellanova, "Warner University" as Warner Bros., "Campbell
// University" as Campbell's and "Chase College of Law" as JPMorgan Chase.
const SCHOOL_NAME = /\b(school|college|university)\b/;

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
  const school = SCHOOL_NAME.test(lower);
  for (const [name, , alias, industry] of KNOWN_COMPANIES) {
    if (school && industry !== 'education') continue;
    if (alias.test(lower) || alias.test(bare) || lower === name.toLowerCase()) return name;
  }
  return s;
}

const KNOWN_BY_NAME = new Map(KNOWN_COMPANIES.map(([name, score]) => [name, score]));
const KNOWN_INDUSTRY = new Map(KNOWN_COMPANIES.map(([name, , , industry]) => [name, industry]));

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

// ── industry ─────────────────────────────────────────────────────────────────

export const UNCLEAR = 'unknown';

/** The curated list's industry for a company, by its name or any alias of it. */
export function knownIndustry(name) {
  if (!name) return null;
  return KNOWN_INDUSTRY.get(name) || KNOWN_INDUSTRY.get(cleanCompany(name)) || null;
}

/** The answer most of them give, ignoring "unclear"; a tie stays unclear. */
function mostSaid(answers = []) {
  const counts = new Map();
  for (const a of answers) if (a && a !== UNCLEAR) counts.set(a, (counts.get(a) || 0) + 1);
  let best = UNCLEAR;
  let top = 0;
  let tied = false;
  for (const [key, n] of counts) {
    if (n > top) { best = key; top = n; tied = false; } else if (n === top) tied = true;
  }
  return tied ? UNCLEAR : best;
}

/**
 * One industry per company, so its colour in Paths, its row in Scores and any
 * sector lean agree. In order: the curated list's own industry; what the name
 * says; otherwise what most of the people who work there now say in their
 * headlines. A tie stays unclear rather than guessed, which also keeps the
 * answer the same whichever order the rows arrive in (the server and Paths
 * read them in different orders).
 *
 * `industryOf(company, headline)` returns an industry key; it is
 * lib/companies.js's inference, passed in so this file needs no imports.
 * Without it only the curated list can answer.
 */
export function companyIndustry(name, { industryOf, headlines = [] } = {}) {
  if (!name) return UNCLEAR;
  const known = knownIndustry(name);
  if (known) return known;
  if (!industryOf) return UNCLEAR;
  const byName = industryOf(name, null);
  if (byName && byName !== UNCLEAR) return byName;
  return mostSaid(headlines.map((h) => industryOf(null, h)));
}

/**
 * Per company, from the people who work there now (each person once): how
 * many there are, and the company's one industry. `rolesOf` lets a caller
 * that also reads each row's roles (Paths) parse every headline once.
 * @returns { headcount: Map name → n, industries: Map name → industry key }
 */
export function networkCompanies(rows = [], { industryOf, rolesOf = rolesWithCompanies } = {}) {
  const at = new Map();
  const seen = new Set();
  for (const r of rows) {
    for (const role of rolesOf(r)) {
      const key = `${role.company}|${r.profile_url || r.id}`;
      if (!role.company || role.former || seen.has(key)) continue;
      seen.add(key);
      const c = at.get(role.company) || { n: 0, headlines: [] };
      c.n++;
      c.headlines.push(r.headline);
      at.set(role.company, c);
    }
  }
  const headcount = new Map();
  const industries = new Map();
  for (const [name, c] of at) {
    headcount.set(name, c.n);
    industries.set(name, companyIndustry(name, { industryOf, headlines: c.headlines }));
  }
  return { headcount, industries };
}

// ── your sector ──────────────────────────────────────────────────────────────

// Points a company in one of your sectors gets on top of its score (Settings →
// Your sector). A point of company score is worth 0.055 × title points: +0.55
// for a founder, +0.41 for a director, +0.22 for an IC.
export const SECTOR_BONUS = { lean: 1, strong: 2 };

/**
 * A company score leaned toward your sectors: `focus` is { sectors: [industry
 * keys], strength: 'lean' | 'strong' } as saved in Settings. Capped at 10. The
 * extra fields appear only when the score actually moved, so everything that
 * reads a plain { score, source } keeps working.
 */
function leanToward(base, industry, focus) {
  const bonus = SECTOR_BONUS[focus?.strength] || 0;
  if (!bonus || !industry || !Array.isArray(focus.sectors) || !focus.sectors.includes(industry)) return base;
  const score = Math.min(10, base.score + bonus);
  if (score === base.score) return base;
  return { ...base, score, base: base.score, sector: industry, sectorBonus: score - base.score };
}

/**
 * A company's score and where it came from.
 *   yours    you set it
 *   known    the curated list above
 *   network  unknown to the list; nudged up when several of your people work there
 *   default  unknown, and few of your people there
 *   none     no company found for this person
 * With a sector focus, a company in one of your sectors gets +1 or +2 on top
 * ({ base, sector, sectorBonus } say so). A score you set is never changed.
 * `industry` is the company's one industry (companyIndustry); a curated
 * company's own is used when none is given.
 */
export function companyScore(name, { overrides = new Map(), headcount = 0, industry, focus } = {}) {
  if (!name) return { score: 3, source: 'none' };
  if (overrides.has(name)) return { score: overrides.get(name), source: 'yours' };
  const ind = industry ?? KNOWN_INDUSTRY.get(name);
  let base;
  if (KNOWN_BY_NAME.has(name)) base = { score: KNOWN_BY_NAME.get(name), source: 'known' };
  else if (ind !== 'education' && headcount >= 15) base = { score: 6, source: 'network' };
  else if (ind !== 'education' && headcount >= 5) base = { score: 5, source: 'network' };
  else base = { score: 4, source: 'default' };
  return focus ? leanToward(base, ind, focus) : base;
}

// ── reach bonus ──────────────────────────────────────────────────────────────

const BONUSES = [
  [/\b(angel investor|investor|venture capital(ist)?|vc|general partner|limited partner)\b(?! relations)/i, 1, 'investor'],
  [/\by ?combinator\b|\(yc\)|\byc\b ?[wsfx]?\d{0,2}\b/i, 1, 'YC'],
  [/\b30 under 30\b/i, 1, '30 under 30'],
  [/\b\d[\d.,]*\s?(m|b|million|billion)\+?\s*(views|followers|subscribers|impressions|users|downloads|installs|listeners|students|customers|members|reach)\b|\$?\s?\d[\d.,]*\s?(m|b|million|billion)\+?\s*(in )?(sales|revenue|arr|gmv|raised|funding)\b|\braised \$?\s?\d[\d.,]*\s?(m|b|million|billion)\b/i, 0.75, 'reach in the millions'],
  [/\b(tedx?|keynote|patents?|author of|best[-\s]?selling|award[-\s]winning|cannes lions|emmy|grammy|webby)\b/i, 0.5, 'recognition'],
];

/** The headline's reach signals before any halving: points (capped at 1.5) and reasons. */
function readReach(headline = '') {
  let points = 0;
  const reasons = [];
  for (const [re, p, label] of BONUSES) if (re.test(headline || '')) { points += p; reasons.push(label); }
  return { points: Math.min(1.5, points), reasons };
}

/**
 * Bonus points from signals in the headline, capped at 1.5, with the reasons.
 * Headlines are self-written: claims from someone at a company nobody knows
 * (company score 4 or less) count half. `found` is the headline's readReach(),
 * when it has been read already.
 */
export function reachBonus(headline = '', companyScoreValue = 10, found = readReach(headline)) {
  let { points } = found;
  const reasons = [...found.reasons];
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
 * What scoring reads from one person's row: every role with its company,
 * whether they are a student now, and the headline's reach signals. Reading
 * headlines is most of the work, so a network read once (readNetwork) can be
 * scored several ways: Settings' preview scores it with two sector focuses.
 */
export function readPerson(row) {
  return { roles: rolesWithCompanies(row), student: isStudent(row?.headline), reach: readReach(row?.headline) };
}

/**
 * One person's score, before any bridge boost: their strongest role, where a
 * role is worth title × company weight. Former roles count at 70% — an ex-SVP
 * still knows the people an SVP knows. A current student is capped at 3 title
 * points whatever else they list. `companyFor(name)` returns companyScore();
 * `read` is the row's readPerson(), when it has been read already.
 */
export function scorePerson(row, companyFor = (name) => companyScore(name), read = readPerson(row)) {
  const { roles, student, reach } = read;
  let best = null;
  for (const role of roles) {
    const co = companyFor(role.company);
    let points = role.title.points * (role.former ? FORMER_WEIGHT : 1);
    if (student) points = Math.min(points, STUDENT_CAP);
    const core = points * (0.45 + 0.055 * co.score);
    if (!best || core > best.core) best = { role, co, points, core };
  }
  // Halved or not by the company's own score, before any sector lean: that you
  // like a sector says nothing about whether a self-written claim is true.
  const bonus = reachBonus(row?.headline, best.co.base ?? best.co.score, reach);
  const power = round1(best.core + bonus.points);
  const title = { ...best.role.title, former: best.role.former, student, points: round1(best.points) };
  if (best.role.former) title.label = `Former ${title.label}`;
  if (student && best.role.title.level > 0) title.label = `Student · ${title.label}`;
  const out = { title, company: best.role.company, companyScore: best.co.score, companySource: best.co.source, bonus, power, tier: tierFor(power) };
  // Only when your sector moved the company's score, so explainScore can show it.
  if (best.co.sectorBonus) out.companySector = { key: best.co.sector, base: best.co.base, bonus: best.co.sectorBonus };
  return out;
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

/**
 * A plain-English line for why someone scores what they do, e.g.
 * "VP / Partner / GM (9) · Snap (10/10: 9 + 1 your sector) · +0.7 strong circle".
 */
export function explainScore(s, boost = 0) {
  const co = s.companySector
    ? `${s.company} (${s.companyScore}/10: ${s.companySector.base} + ${s.companySector.bonus} your sector)`
    : `${s.company || 'no company found'} (${s.companyScore}/10${s.companySource === 'yours' ? ', your score' : ''})`;
  const bits = [`${s.title.label} (${s.title.points})`, co];
  if (s.bonus.points) bits.push(`+${s.bonus.points} ${s.bonus.reasons.join(', ')}`);
  if (boost) bits.push(`+${boost} strong circle`);
  return bits.join(' · ');
}

/**
 * A network read once, to be scored any number of ways: each row's
 * readPerson(), and every company anyone names (in a current role or a former
 * one) with what its score depends on besides your own choices: how many of
 * your people work there now, and its one industry. Pass it to scoreNetwork()
 * with the same rows.
 * @returns { people: Map row → readPerson, headcount, industries, companies: Map name → { headcount, industry } }
 */
export function readNetwork(rows = [], { industryOf } = {}) {
  const people = new Map();
  for (const r of rows) people.set(r, readPerson(r));
  const { headcount, industries } = networkCompanies(rows, { industryOf, rolesOf: (r) => people.get(r).roles });
  const companies = new Map();
  for (const [name, n] of headcount) companies.set(name, { headcount: n, industry: industries.get(name) });
  // A company only in someone's former roles has no current people to count or
  // ask; its name (or the curated list) is all there is to go on.
  for (const { roles } of people.values()) {
    for (const { company } of roles) {
      if (company && !companies.has(company)) companies.set(company, { headcount: 0, industry: companyIndustry(company, { industryOf }) });
    }
  }
  return { people, headcount, industries, companies };
}

/**
 * Score a whole network. People first, with company scores that can use how
 * many of your people work at each company and each company's one industry;
 * then 1st-degree bridges get their circle boost from their scored circle.
 * `focus` is the sector focus from Settings, or nothing. `read` is
 * readNetwork() of these rows, when they have been read already. Returns one
 * result per row id, plus the per-company facts it used and each company's
 * score (companyScore(), by name).
 */
export function scoreNetwork(rows = [], { overrides = new Map(), industryOf, focus, read = readNetwork(rows, { industryOf }) } = {}) {
  // Each company is scored once; everyone there shares the answer.
  const companyScores = new Map();
  const companyFor = (name) => {
    if (!companyScores.has(name)) {
      const c = name ? read.companies.get(name) : null;
      companyScores.set(name, companyScore(name, { overrides, headcount: c?.headcount || 0, industry: c?.industry, focus }));
    }
    return companyScores.get(name);
  };
  const out = new Map();
  for (const r of rows) out.set(r.id, { ...scorePerson(r, companyFor, read.people.get(r)), boost: 0 });
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
  return { scores: out, headcount: read.headcount, industries: read.industries, companyScores };
}
