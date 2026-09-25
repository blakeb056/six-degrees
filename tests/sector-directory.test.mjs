// The sector directory (lib/sector-directory.js): the list itself, how a name
// or a headline matches it, how a company matches from its people, and the
// suggestions Settings makes from your network. The setting around it is in
// sector.test.mjs, the lean in scoring.test.mjs.
// Invented people and companies; public companies where the list names them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRIES } from '../lib/companies.js';
import { industryKeyOf } from '../lib/companies.js';
import { readNetwork } from '../lib/scoring.js';
import {
  DIRECTORY, DIRECTORY_VERSION, SECTOR_KEYS, wordsOf, sectorsInName, sectorsInHeadline, sectorMatcher, suggestSectors,
  sectorByKey, sectorLabel, isDirectoryKey,
} from '../lib/sector-directory.js';

const GROUP_KEYS = INDUSTRIES.map((g) => g.key);

// Words every field uses: as a whole word on their own they would place
// anyone anywhere. Phrases that contain them ("oral surgeon", "wealth
// manager") are fine.
const GENERIC = new Set([
  'manager', 'director', 'engineer', 'analyst', 'sales', 'associate', 'partner', 'agent', 'broker', 'producer', 'consultant',
  'founder', 'cofounder', 'owner', 'ceo', 'president', 'executive', 'officer', 'specialist', 'coordinator', 'advisor', 'coach',
  'trainer', 'developer', 'designer', 'tech', 'technology', 'data', 'operations', 'strategy', 'growth', 'product', 'services',
  'solutions', 'startup', 'business', 'leader', 'lead', 'head', 'student', 'intern', 'creator', 'author', 'speaker', 'investor',
  'veteran', 'volunteer', 'media', 'design', 'content', 'marketing manager',
]);

// ── the list ────────────────────────────────────────────────────────────────

test('the directory: about forty sectors, each under one of the twelve industries, with keys that never collide', () => {
  assert.ok(DIRECTORY.length >= 30 && DIRECTORY.length <= 50, `${DIRECTORY.length} sectors`);
  const keys = DIRECTORY.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
  assert.equal(new Set(DIRECTORY.map((s) => s.label)).size, keys.length, 'labels are unique');
  for (const s of DIRECTORY) {
    assert.match(s.key, /^[a-z0-9]+(-[a-z0-9]+)*$/, s.key);
    assert.ok(!GROUP_KEYS.includes(s.key), `${s.key} is also an industry's key`);
    assert.ok(GROUP_KEYS.includes(s.group), `${s.key}: no industry called ${s.group}`);
    assert.ok(s.label && s.words.length && s.companies.length, `${s.key} has a label, words and companies`);
  }
  // Every industry has at least one narrower sector to expand to.
  for (const g of GROUP_KEYS) assert.ok(DIRECTORY.some((s) => s.group === g), g);
  assert.ok(Object.isFrozen(DIRECTORY) && DIRECTORY.every((s) => Object.isFrozen(s) && Object.isFrozen(s.words) && (!s.roles || Object.isFrozen(s.roles))),
    'nobody can change it at run time');
});

test('each sector is an industry or a function, and a function sector keeps its jobs apart from its kinds of firm', () => {
  // Work every kind of company has people for: a recruiter, a marketer, an
  // accountant, a lawyer, a consultant, an engineer or a data scientist works
  // at a firm in that line and at Acme Widgets alike.
  const functions = ['software', 'ai-data', 'cybersecurity', 'accounting', 'marketing-advertising', 'pr-comms', 'legal',
    'management-consulting', 'hr-recruiting'];
  assert.deepEqual(DIRECTORY.filter((s) => s.kind === 'function').map((s) => s.key).sort(), [...functions].sort());
  for (const s of DIRECTORY) {
    assert.ok(['industry', 'function'].includes(s.kind), `${s.key}: kind is industry or function`);
    // An industry sector keeps its job titles in words: a dentist works in dental.
    if (s.kind === 'industry') assert.equal(s.roles, undefined, `${s.key} lists its jobs in words`);
    else assert.ok(s.words.length && s.roles.length, `${s.key} has kinds of firm and jobs`);
  }
  assert.equal(sectorByKey('hr-recruiting').kind, 'function');
  assert.equal(sectorByKey('dental').kind, 'industry');
});

test('the directory: every word is a real whole-word phrase, and none is a word every field uses', () => {
  for (const s of DIRECTORY) {
    const seen = new Set();
    for (const [field, list] of [['words', s.words], ['roles', s.roles || []], ['names', s.names || []], ['not', s.not || []]]) {
      for (const w of list) {
        assert.ok(!/[()]/.test(w.replace(/\(s\)$/, '')), `${s.key}.${field}: "(s)" goes at the end only: ${w}`);
        assert.ok(!w.includes('$'), `${s.key}.${field}: "$" is for companies: ${w}`);
        for (const v of w.endsWith('(s)') ? [w.slice(0, -3), `${w.slice(0, -3)}s`] : [w]) {
          const phrase = wordsOf(v).join(' ');
          assert.ok(phrase, `${s.key}.${field}: "${w}" has no words`);
          if (field !== 'not') {
            assert.ok(!GENERIC.has(phrase), `${s.key}.${field}: "${phrase}" is used in every field`);
            assert.ok(!seen.has(phrase), `${s.key}: "${phrase}" is listed twice`);
            seen.add(phrase);
          }
        }
      }
    }
    // A sector that cancelled its own word could never match it.
    const words = new Set([...s.words, ...(s.roles || [])].flatMap((w) => (w.endsWith('(s)') ? [w.slice(0, -3), `${w.slice(0, -3)}s`] : [w])).map((w) => wordsOf(w).join(' ')));
    for (const n of s.not || []) assert.ok(!words.has(wordsOf(n.replace(/\(s\)$/, '')).join(' ')), `${s.key} cancels its own word "${n}"`);
    for (const c of s.companies) {
      assert.ok(!/\$./.test(c), `${s.key}.companies: "$" goes at the end only: ${c}`);
      assert.ok(wordsOf(c.replace(/\$$/, '')).length, `${s.key}.companies: "${c}" has no words`);
    }
  }
});

test('the version comes from the list itself', () => {
  assert.match(DIRECTORY_VERSION, /^[0-9a-f]{8}$/);
});

test('picks are the twelve industries, each followed by its sectors, and each has a label and colour', () => {
  assert.equal(SECTOR_KEYS.length, GROUP_KEYS.length + DIRECTORY.length);
  assert.deepEqual(SECTOR_KEYS.filter((k) => GROUP_KEYS.includes(k)), GROUP_KEYS);
  assert.deepEqual(SECTOR_KEYS.slice(SECTOR_KEYS.indexOf('health'), SECTOR_KEYS.indexOf('health') + 3), ['health', 'hospitals', 'dental']);
  const health = INDUSTRIES.find((g) => g.key === 'health');
  assert.deepEqual(sectorByKey('dental'), { key: 'dental', label: 'Dental', color: health.color, group: 'health', kind: 'industry' });
  assert.deepEqual(sectorByKey('health'), { key: 'health', label: health.label, color: health.color, group: 'health', kind: 'industry' });
  assert.equal(sectorByKey('astrology').label, 'Unclear');
  assert.equal(sectorLabel('real-estate'), 'Real Estate');
  assert.equal(sectorLabel('nope'), undefined);
  assert.ok(isDirectoryKey('dental') && !isDirectoryKey('health') && !isDirectoryKey('nope'));
});

// ── examples: every sector matches some and not others ─────────────────────

// A string is a headline (read whole); "company: …" is a company's name; a
// pair is [headline, the company it's read for].
const EXAMPLES = {
  software: {
    yes: ['B2B SaaS founder', 'Founder at a software startup', 'company: Quillon Software', 'company: Quillon DevOps', 'company: Atlassian'],
    no: ['Senior Software Engineer at Quillon', 'Full-stack developer', ['Software Engineer at Chase', 'JPMorgan Chase'], 'Real estate developer',
      'Nail tech at Quillon Salon', 'company: Boxwood Designs', 'company: Apple Hospitality REIT'],
  },
  'ai-data': {
    yes: ['Founder of an AI startup', 'Research scientist at an AI lab', 'company: Quillon AI', 'company: Quillon Machine Learning',
      'company: Anthropic'],
    no: ['Machine Learning Engineer', 'Data Scientist at Quillon', ['Data Analyst at Pinecrest Foods', 'Pinecrest Foods'],
      'Marketing Director | AI enthusiast', 'NLP Practitioner and life coach', 'Attorney | LLM in Taxation', 'company: Snowflake Bakery'],
  },
  cybersecurity: {
    yes: ['Founder, cybersecurity startup', 'MSSP owner', 'company: Quillon Cyber', 'company: CrowdStrike'],
    no: ['SOC Analyst', 'CISSP | Security Engineer', ['Penetration Tester at Chase', 'JPMorgan Chase'], 'Security Guard at Quillon Mall',
      'Cyber Monday deals lead'],
  },
  telecom: {
    yes: ['RF Engineer at Quillon Wireless', '5G network planner', 'company: Verizon', 'company: AT&T'],
    no: ['company: Spectrum Health', 'Telecommuting advocate'],
  },
  fintech: {
    yes: ['Payments Product Lead at Quillon', 'Fintech founder', 'company: Quillon Pay', 'company: Stripe'],
    no: ['company: Pay Per Click Pros', 'company: Plaid Pantry'],
  },
  banking: {
    yes: ['Mortgage Loan Officer | NMLS 123456', 'Investment Banker at Quillon Partners', 'company: First National Bank of Quillon', 'company: Chase'],
    no: ['company: Banksy Studio', 'Volunteer at the Food Bank', 'company: Chase College of Law', 'company: Chase Design Studio'],
  },
  'vc-pe': {
    yes: ['Partner at Quillon Ventures | Venture Capital', 'Private Equity Associate', 'company: Andreessen Horowitz', 'company: Sequoia Capital'],
    no: ['Founder at Quillon (VC-backed)', 'Angel investor', 'company: Bain & Company'],
  },
  wealth: {
    yes: ['Financial Advisor at Edward Jones', 'CFP | Wealth Manager', 'Equity Trader', 'company: BlackRock'],
    no: ["Crew Member at Trader Joe's", 'Securities Attorney at Quillon Law'],
  },
  insurance: {
    yes: ['Insurance Agent at Quillon Insurance Group', 'Actuarial Analyst', 'Claims Adjuster', 'company: State Farm'],
    no: ["company: Nationwide Children's Hospital", 'Mortgage Underwriter'],
  },
  accounting: {
    yes: ['Audit Senior | Big 4', 'Partner at a CPA firm', 'company: Smith CPA', 'company: Quillon Accounting', 'company: Grant Thornton'],
    no: ['Staff Accountant', 'CPA | Tax Manager at Quillon & Co', 'Bookkeeper', ['Accountant at Pinecrest Foods', 'Pinecrest Foods'],
      'Taxi driver', 'Air Traffic Controller'],
  },
  crypto: {
    yes: ['Blockchain Developer', 'Web3 founder', 'DeFi researcher', 'company: Coinbase'],
    no: ['Digital Asset Management specialist', 'Cryptography professor'],
  },
  hospitals: {
    yes: ['Registered Nurse at Orlando Health', 'Pediatrician', 'company: Quillon Medical Center', 'company: Mayo Clinic', 'company: City of Hope'],
    no: ['Veterinarian at Quillon Animal Hospital', 'company: Quillon Legal Clinic', 'Hospitality manager'],
  },
  dental: {
    yes: ['Dentist | Owner at Smith Family Practice', 'Orthodontist', 'VP Operations | DSO Growth', 'Dental Hygienist, RDH',
      'company: Smith Family Dental', 'company: Henry Schein'],
    no: ['Incidental findings reviewer', 'Marketing for dentists', 'DSOx platform lead', ['Engineer at Quillon | Ex-Dentist', 'Quillon']],
  },
  'pharma-biotech': {
    yes: ['Clinical Research Associate', 'Pharmaceutical Sales Representative', 'company: Quillon Therapeutics', 'company: Pfizer'],
    no: ['Pharmacist at Walgreens', 'company: Roche Bros Supermarkets', 'company: Teva Naot Sandals'],
  },
  'medical-devices': {
    yes: ['Medical Device Sales at Stryker', 'Biomedical Engineer', 'MedTech founder', 'company: Medtronic'],
    no: ['Device repair technician', 'company: Abbott Road Bakery'],
  },
  'mental-health': {
    yes: ['Licensed Therapist | LMFT', 'Psychologist', 'Behavioral Health Counselor', 'company: BetterHelp'],
    no: ['Physical Therapist at Quillon Rehab', 'Massage Therapist'],
  },
  'fitness-wellness': {
    yes: ['Personal Trainer', 'Yoga Instructor', 'company: Quillon Fitness', 'company: Planet Fitness'],
    no: ['Corporate Wellness program lead', 'Fitness enthusiast | Engineer', 'company: Equinox Gold Mining'],
  },
  k12: {
    yes: ['Teacher at Lincoln Elementary School', '5th Grade Teacher', 'Special Education paraprofessional', 'company: Orange County Public Schools'],
    no: ['Yoga Teacher', 'Principal at Quillon Consulting'],
  },
  'higher-ed': {
    yes: ['Assistant Professor of Biology', 'PhD Candidate', 'company: University of Central Florida', 'company: MIT'],
    no: ['company: University Federal Credit Union', 'company: College Park Realty', 'company: Purdue Pharma'],
  },
  'marketing-advertising': {
    yes: ['Account Director at a creative agency', 'Founder | Digital marketing agency', 'company: Quillon Marketing Agency',
      'company: Quillon SEO', 'company: Ogilvy'],
    no: ['Digital Marketing Manager', 'SEO Specialist', ['Marketing Manager at Bright Smiles Dental', 'Bright Smiles Dental'],
      'Account Executive at Quillon', 'Brand ambassador', 'company: McCann Construction'],
  },
  'pr-comms': {
    yes: ['Founder of a boutique PR firm', 'Account Director at a PR agency', 'company: Quillon PR', 'company: Quillon Comms', 'company: Edelman'],
    no: ['Public Relations Manager', 'Director of Communications', 'company: Charter Communications', 'Unified Communications Engineer',
      'company: Edelman Financial Engines'],
  },
  'media-publishing': {
    yes: ['Journalist at the Orlando Sentinel', 'Managing Editor', 'company: Quillon Publishing', 'company: The New York Times'],
    no: ['Video Editor at Quillon Films', 'Newsletter writer', 'company: Macmillan Cancer Support'],
  },
  'creator-economy': {
    yes: ['Content Creator', 'YouTuber', 'UGC creator', 'company: Patreon', ['Founder at Quillon | Host at The Growth Podcast', 'The Growth Podcast']],
    no: [['Founder at Quillon | Podcaster', 'Quillon'], ['Founder at Quillon | Host at The Growth Podcast', 'Quillon'], 'Creator of Quillon'],
  },
  'film-tv-music': {
    yes: ['Filmmaker', 'Music Producer at Quillon Records', 'company: Quillon Pictures', 'company: Netflix'],
    no: ['Threat actor researcher at Quillon', 'Music lover | Accountant', 'Home theater installer', 'company: Illumination Lighting'],
  },
  'gaming-esports': {
    yes: ['Game Designer at Quillon Games', 'Esports Manager', 'Gaming studio founder', 'company: Riot Games'],
    no: ['Gaming Commission investigator', 'Casino gaming floor supervisor', 'company: Blizzard Snow Removal'],
  },
  sports: {
    yes: ["Head Coach, Women's Soccer", 'Sports Marketing Manager', 'company: Orlando Magic', 'company: ESPN'],
    no: ['Soccer mom | Nurse', 'Football fan | Engineer', 'NFL alumni | Financial Advisor', 'company: Wasserman Law'],
  },
  'ecommerce-retail': {
    yes: ['E-commerce Manager', 'Store Manager at Target', 'Amazon FBA seller', 'company: Walmart'],
    no: ['Retail Banking Officer', 'company: Target Hospitality'],
  },
  'consumer-goods': {
    yes: ['CPG sales lead', 'Fashion designer', 'company: Quillon Apparel', 'company: Procter & Gamble'],
    no: ['Personal Care Aide', 'company: Hershey Medical Center', 'company: Mars Hill Church'],
  },
  restaurants: {
    yes: ['Executive Chef', 'Bartender', 'company: Quillon Bistro', 'company: Chick-fil-A'],
    no: ['Cook County Clerk', 'Server Engineer'],
  },
  'hospitality-travel': {
    yes: ['Hotel General Manager', 'Travel Advisor', 'Flight Attendant at Delta', 'company: Marriott'],
    no: ['Travel Nurse at Quillon Health', 'Concierge Medicine physician', 'company: Hilton Head Island Realty'],
  },
  logistics: {
    yes: ['Freight Broker', 'Supply Chain Manager', 'CDL Truck Driver', 'company: FedEx'],
    no: ['Data Warehouse Architect', 'Relationship Manager'],
  },
  manufacturing: {
    yes: ['CNC Machinist', 'Plant Manager at Quillon Plastics', 'company: Quillon Manufacturing', 'company: Caterpillar'],
    no: ['company: The Cheesecake Factory', 'company: Idea Factory Studio', 'company: Dupont Circle Realty'],
  },
  energy: {
    yes: ['Petroleum Engineer', 'Solar sales lead', 'company: Quillon Solar', 'company: Duke Energy'],
    no: ['company: Monster Energy', 'Essential oils educator', 'High-energy sales leader'],
  },
  automotive: {
    yes: ['Service Advisor at Toyota of Orlando', 'Automotive Technician', 'company: Toyota of Orlando', 'company: Tesla'],
    no: ['company: Ford Foundation', 'EV/EBITDA modeling', 'company: Firestone Walker Brewing'],
  },
  'aerospace-defense': {
    yes: ['Aerospace Engineer', 'TS/SCI cleared systems lead', 'Avionics technician', 'company: Lockheed Martin'],
    no: ['Criminal Defense Attorney', 'company: Rocket Mortgage', 'Satellite Office Manager'],
  },
  military: {
    yes: ['Captain, US Army', 'Active Duty Air Force', 'Army National Guard officer', 'company: United States Marine Corps'],
    no: ['Army Veteran | Project Manager at Quillon', 'company: Old Navy', 'company: Salvation Army', 'Battalion Chief, Orange County Fire Rescue'],
  },
  government: {
    yes: ['Police Officer at Orlando Police Department', 'Legislative Aide', 'company: City of Orlando', 'company: State of Florida'],
    no: ['company: State of Mind Media', 'company: City of Hope', 'Student Government President'],
  },
  legal: {
    yes: [['Attorney | Partner at Jones Law Group', 'Jones Law Group'], 'Associate at a law firm', 'company: Quillon Law Group',
      'company: Smith Legal', 'company: Kirkland & Ellis'],
    no: ['Attorney at Smith & Jones', 'Paralegal', 'company: Lawson Group', ['General Counsel at Quillon', 'Quillon'], 'Law Enforcement Officer'],
  },
  'management-consulting': {
    yes: ['Associate | Management Consulting', 'Strategy consulting at Quillon Advisors', 'company: McKinsey & Company',
      'company: Bain & Company'],
    no: ['Management Consultant', 'Strategy Consultant at Quillon Advisors', 'company: Bain Capital', 'IT Consultant',
      'Customer Engagement Manager'],
  },
  'hr-recruiting': {
    yes: ['Owner of a staffing agency', 'Executive Search Partner', 'company: Quillon Staffing', 'company: Acme Recruiting',
      'company: Robert Half'],
    no: ['Technical Recruiter', 'HR Business Partner', ['Recruiter at Acme Widgets', 'Acme Widgets'], 'company: 24 Hr Fitness Club',
      'Talent show host'],
  },
  'real-estate': {
    yes: ['Realtor at Keller Williams', 'Property Manager', 'company: Smith Real Estate Group', 'company: Quillon Properties'],
    no: ['Intellectual Property Attorney', 'Real-time systems engineer'],
  },
  'construction-trades': {
    yes: ['General Contractor', 'Electrician', 'company: Quillon Builders', 'company: Quillon Construction'],
    no: ['company: Brand Builders Group', 'Independent Contractor | Designer', 'Concrete results for your brand'],
  },
  charities: {
    yes: ['Grant Writer', 'Program Director at a nonprofit', 'company: Quillon Community Foundation', 'company: Habitat for Humanity'],
    no: ['company: Foundation Medicine', 'Fundraising for our Series A', 'company: Goodwill Realty'],
  },
  faith: {
    yes: ['Senior Pastor at Grace Church', 'Youth Minister', 'Chaplain', 'company: First Baptist Church of Orlando'],
    no: ['company: Ministry of Defence', 'Tech Evangelist'],
  },
};

const sectorsOfExample = (ex) => {
  if (Array.isArray(ex)) return sectorsInHeadline(ex[0], ex[1]);
  if (ex.startsWith('company: ')) return sectorsInName(ex.slice(9));
  return sectorsInHeadline(ex);
};

test('every sector has examples it matches and examples it must not', () => {
  assert.deepEqual(Object.keys(EXAMPLES).sort(), DIRECTORY.map((s) => s.key).sort(), 'one entry per sector, no strays');
  for (const [key, { yes, no }] of Object.entries(EXAMPLES)) {
    assert.ok(yes.length >= 1 && no.length >= 1, `${key} needs both kinds of example`);
    for (const ex of yes) assert.ok(sectorsOfExample(ex).includes(key), `${key} should match ${JSON.stringify(ex)} (got ${sectorsOfExample(ex).join(', ') || 'nothing'})`);
    for (const ex of no) assert.ok(!sectorsOfExample(ex).includes(key), `${key} should not match ${JSON.stringify(ex)}`);
  }
});

// ── whole words, and the traps ──────────────────────────────────────────────

test('whole words only: "incidental" isn\'t dental, "Banksy" isn\'t banking, "Lawson" isn\'t legal', () => {
  assert.deepEqual(sectorsInHeadline('Incidental findings reviewer'), []);
  assert.deepEqual(sectorsInHeadline('Transcendental meditation guide'), ['fitness-wellness']);   // meditation, not dental
  assert.deepEqual(sectorsInName('Banksy Prints'), []);
  assert.deepEqual(sectorsInName('Lawson Group'), []);
  assert.deepEqual(sectorsInName('Lawson Law Group'), ['legal']);
  // DSO only as a whole word, plural included.
  assert.deepEqual(sectorsInHeadline('DSO operations lead'), ['dental']);
  assert.deepEqual(sectorsInHeadline('Growing DSOs across Florida'), ['dental']);
  assert.deepEqual(sectorsInHeadline('ADSO coordinator'), []);
  assert.deepEqual(sectorsInHeadline('DSOx platform lead'), []);
  // A realtor, and a real estate firm, both match.
  assert.deepEqual(sectorsInHeadline('Realtor at Keller Williams', 'Keller Williams'), ['real-estate']);
  assert.deepEqual(sectorsInHeadline('REALTOR®'), ['real-estate']);
  assert.deepEqual(sectorsInName('Smith Real Estate Group'), ['real-estate']);
  assert.deepEqual(sectorsInName('Keller Williams Realty'), ['real-estate']);
});

test('text is compared by its words: case, accents, apostrophes and punctuation don\'t matter', () => {
  assert.deepEqual(wordsOf("McDonald's Nestlé L'Oréal"), ['mcdonalds', 'nestle', 'loreal']);
  assert.deepEqual(wordsOf('E-commerce | RE/MAX | K-12'), ['e', 'commerce', 're', 'max', 'k', '12']);
  assert.deepEqual(wordsOf('AT&T, P&C and Oil & Gas'), ['at&t', 'p&c', 'oil', 'gas']);
  assert.deepEqual(wordsOf(null), []);
  assert.deepEqual(sectorsInHeadline('ORTHODONTIST'), ['dental']);
  assert.deepEqual(sectorsInHeadline('Oil and Gas'), sectorsInHeadline('oil & gas'));
  assert.deepEqual(sectorsInName('Ørsted'), ['energy']);
  assert.deepEqual(sectorsInName("McDonald's"), ['restaurants']);
});

test('companies match from the start of the name as whole words, or the whole name when it ends with $', () => {
  assert.deepEqual(sectorsInName('Aspen Dental Management'), ['dental']);            // a word
  assert.deepEqual(sectorsInName('Henry Schein One'), ['dental']);                   // from the start
  assert.deepEqual(sectorsInName('The Home Depot'), ['ecommerce-retail']);           // "the" is ignored
  assert.deepEqual(sectorsInName('Box'), ['software']);                              // box$
  assert.deepEqual(sectorsInName('Box Hill Hospital'), ['hospitals']);               // …not Box's
  assert.deepEqual(sectorsInName('Intuitive Surgical'), ['medical-devices']);        // "intuit" is a whole word
  // A school only matches education's companies: "Chase College of Law" is not Chase
  // the bank, though its words still say law.
  assert.deepEqual(sectorsInName('Chase College of Law'), ['higher-ed', 'legal']);
  assert.deepEqual(sectorsInName('Chase'), ['banking']);
  assert.deepEqual(sectorsInName('Darden School of Business'), ['higher-ed']);
  assert.deepEqual(sectorsInName('Darden Restaurants'), ['restaurants']);
});

test('a headline counts what it says now, and not who someone serves', () => {
  // "Ex-" parts are where someone was.
  assert.deepEqual(sectorsInHeadline('Engineer at Quillon | Ex-Dentist'), []);
  assert.deepEqual(sectorsInHeadline('Former Realtor | Barista'), ['restaurants']);
  // After "for", "helping", "serving": who they work for, not what they do.
  assert.deepEqual(sectorsInHeadline('Mortgage lender for dentists'), ['banking']);
  assert.deepEqual(sectorsInHeadline('Helping dentists grow with SEO'), []);
  assert.deepEqual(sectorsInHeadline('SaaS for restaurants'), ['software']);
  assert.deepEqual(sectorsInHeadline('Director at a not-for-profit'), ['charities']);   // the phrase itself has "for"
  // A phrase that cancels a sector cancels it for the text it's in.
  assert.deepEqual(sectorsInHeadline('Volunteer at the Food Bank'), ['charities']);
  assert.deepEqual(sectorsInHeadline('Criminal Defense Law Firm'), ['legal']);
});

test('a part of a headline that names a company counts for that company; side notes don\'t count', () => {
  const two = 'Founder at Quillon | Host at The Growth Podcast';
  assert.deepEqual(sectorsInHeadline(two, 'Quillon'), []);
  assert.deepEqual(sectorsInHeadline(two, 'The Growth Podcast'), ['media-publishing', 'creator-economy']);
  // The parts before the first company describe that role…
  assert.deepEqual(sectorsInHeadline('Dentist | Owner at Smith Family Practice', 'Smith Family Practice'), ['dental']);
  // …and what comes after it is a side note.
  assert.deepEqual(sectorsInHeadline('Dental Hygienist at Quillon | Soccer mom | Podcaster', 'Quillon'), ['dental']);
  assert.deepEqual(sectorsInHeadline('Orthodontist at Bright Smiles | Founder at SmileTech', 'SmileTech'), []);
  // A company the headline doesn't name (a company scan) gets the leading parts.
  assert.deepEqual(sectorsInHeadline('Registered Nurse | Volunteer at Second Harvest', 'Orlando Health'), ['hospitals']);
  // With no company named at all, everything current counts.
  assert.deepEqual(sectorsInHeadline('Registered Nurse | BSN', 'Orlando Health'), ['hospitals']);
});

// ── a company, from its name and its people ─────────────────────────────────

test('a company matches when at least half of its people say so, and a one-person company\'s person decides', () => {
  const at = (company, ...titles) => titles.map((t) => (t ? `${t} at ${company}` : t));
  const m = sectorMatcher();
  // One person: they decide.
  assert.deepEqual(m('Smith Family Practice', ['Dentist | Owner at Smith Family Practice']), ['dental']);
  assert.deepEqual(m('Quillon', at('Quillon', 'Engineer')), []);
  // Two people, one says so: half is enough. (Names are as scoring cleans them:
  // "Bright Smiles Co" is Bright Smiles.)
  assert.deepEqual(m('Bright Smiles', at('Bright Smiles Co', 'Orthodontist', 'Office Manager')), ['dental']);
  // Three people, one says so: not half.
  assert.deepEqual(m('Northwind', at('Northwind', 'Dentist', 'Engineer', 'Designer')), []);
  assert.deepEqual(m('Northwind', at('Northwind', 'Dentist', 'Dental Hygienist', 'Designer')), ['dental']);
  // Someone with no headline is still one of its people.
  assert.deepEqual(m('Northwind', [...at('Northwind', 'Dentist'), '', null]), []);
  // The name decides on its own, whatever the people say; one realtor of three isn't half.
  assert.deepEqual(m('Smith Family Dental', at('Smith Family Dental', 'Engineer', 'Designer', 'Realtor')), ['dental']);
  // Nobody at all: only the name.
  assert.deepEqual(m('Smith Family Dental', []), ['dental']);
  assert.deepEqual(m('Northwind', []), []);
  // A company can match several sectors.
  assert.deepEqual(m('Quillon', at('Quillon', 'Oral Surgeon | Hospital attending')), ['hospitals', 'dental']);
});

test('a job never places a company in a function sector; its name, or a kind of firm, does', () => {
  const m = sectorMatcher();
  // One person each. A job every kind of company has says what they do, not what the company is.
  assert.deepEqual(m('Acme Widgets', ['Recruiter at Acme Widgets']), []);
  assert.deepEqual(m('Bright Smiles Dental', ['Marketing Manager at Bright Smiles Dental']), ['dental']);
  assert.deepEqual(m('JPMorgan Chase', ['Software Engineer at Chase']), ['banking']);
  assert.deepEqual(m('Pinecrest Foods', ['Accountant at Pinecrest Foods']), []);
  // A company's name may use a job or a kind of firm: "Recruiter at Acme Staffing"
  // matches by the name, since the headline alone says only what the person does.
  assert.deepEqual(m('Acme Staffing', ['Recruiter at Acme Staffing']), ['hr-recruiting']);
  assert.deepEqual(sectorsInHeadline('Recruiter at Acme Staffing', 'Acme Staffing'), []);
  assert.deepEqual(m('Smith CPA', ['Accountant at Smith CPA']), ['accounting']);
  assert.deepEqual(m('Jones Law Group', ['Attorney | Partner at Jones Law Group']), ['legal']);
  // A kind of firm in a headline counts, like an industry's words.
  assert.deepEqual(m('Quillon', ['Staffing agency owner at Quillon']), ['hr-recruiting']);
  assert.deepEqual(m('Quillon', ['Founder at Quillon | B2B SaaS']), []);        // a side note after the company
  assert.deepEqual(m('Quillon', ['B2B SaaS | Founder at Quillon']), ['software']);
  // An industry sector keeps its jobs: a dentist works in dental, a realtor in real estate.
  assert.deepEqual(m('Smith Family Practice', ['Dentist | Owner at Smith Family Practice']), ['dental']);
  assert.deepEqual(m('Quillon Homes', ['Realtor at Quillon Homes']), ['real-estate']);
});

test('the same headline is read once however many companies ask', () => {
  const m = sectorMatcher();
  const h = 'Dentist at Bright Smiles Co | Advisor at Quillon Dental Labs';
  assert.deepEqual(m('Bright Smiles', [h]), ['dental']);
  assert.deepEqual(m('Quillon Dental Labs', [h]), ['dental']);   // by its name
  assert.deepEqual(m('Quillon', ['Advisor at Quillon | Dentist']), []);   // a side note after the company
});

// ── suggestions from your network ───────────────────────────────────────────

test('suggestions: the sectors most of your people work in, each person once, with their companies', () => {
  const p = (id, headline, extra = {}) => ({ id, profile_url: `/in/${id}`, degree: 1, headline, ...extra });
  const rows = [
    p('a', 'Dentist | Owner at Smith Family Practice'),
    p('b', 'Orthodontist at Bright Smiles Co'),
    p('c', 'Office Manager at Bright Smiles Co'),                        // at a dental company, so counted
    p('c2', 'Office Manager at Bright Smiles Co', { profile_url: '/in/c', degree: 2 }),   // the same person again
    p('d', 'Founder at Smith Family Dental | Advisor at Bright Smiles Co'),   // two dental companies, one person
    p('i', 'Dental Hygienist at Bright Smiles Co'),                      // 2 of Bright Smiles' 4 say dental
    p('e', 'Realtor at Keller Williams'),
    p('f', 'Realtor at Coldwell Banker'),
    p('g', 'Software Engineer at Quillon'),                              // a job, so Quillon isn't software
    p('h', 'Designer | Ex-Hygienist at Smith Dental Studio'),            // a former employer isn't counted
  ];
  const read = readNetwork(rows, { industryOf: industryKeyOf, sectorsOf: sectorMatcher() });
  const top = suggestSectors(rows, read);
  assert.deepEqual(top.map((s) => [s.key, s.people, s.companies]), [
    ['dental', 5, 3],          // a, b, c, d, i at Smith Family Practice, Bright Smiles, Smith Family Dental
    ['real-estate', 2, 2],     // Coldwell Banker is real estate, not banking
  ]);
  assert.deepEqual(top[0], { key: 'dental', label: 'Dental', group: 'health', people: 5, companies: 3 });
  assert.deepEqual(suggestSectors(rows, read, { limit: 1 }).map((s) => s.key), ['dental']);
  assert.deepEqual(suggestSectors([], readNetwork([], { sectorsOf: sectorMatcher() })), []);
  assert.deepEqual(suggestSectors(rows, undefined), []);
});
