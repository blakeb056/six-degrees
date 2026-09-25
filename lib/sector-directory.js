// The sector directory: the most common sectors people work in, each with the
// words that mark a company or a headline as that sector. Settings → Your
// sector picks from it (lib/sector-focus.js), and scoring leans toward the
// companies it places (lib/scoring.js companyScore).
//
// It is a list, not a model: the same words match the same way on every
// computer, every time, with no AI and nothing sent anywhere. Anyone can
// improve it: docs/brain/SCORING.md, "How to add or fix a sector". Every
// sector has examples it must match and must not, in
// tests/sector-directory.test.mjs.
//
// Each sector:
//   key        Saved in people's settings: never rename or remove one.
//   label      What the page shows.
//   group      The broad industry it sits under (lib/companies.js INDUSTRIES).
//              It takes that industry's colour; Paths' colours don't change.
//   kind       'industry' or 'function'. In an industry sector, people's jobs
//              say where they work: a dentist works at a dental practice, a
//              realtor at a real estate firm. A function sector is work every
//              kind of company has people for (recruiting, marketing,
//              accounting, law, software): a recruiter works at a staffing
//              agency and at Acme Widgets alike, so a job never places a
//              company in a function sector from a headline (roles, below).
//   words      Whole words or phrases, any case, that mark a company's name or
//              someone's headline as this sector: in an industry sector, job
//              titles, credentials and kinds of business; in a function
//              sector, kinds of business only (staffing agency, law firm, CPA
//              firm, SaaS). "dentist(s)" means dentist and dentists.
//              Precision over recall: a word that means something else in
//              another field lifts the wrong people, while a missing word
//              only means no lean. So no words every field uses (manager,
//              director, engineer, analyst, sales, associate, partner,
//              agent, broker, producer, consultant...; the tests refuse them).
//   roles      A function sector's jobs: titles and the names of the work
//              (recruiter, recruiting, attorney, accountant, tax, JavaScript).
//              They count in a company's name ("Acme Recruiting", "Smith
//              CPA", "Jones Law Group") and never in a headline: "Recruiter at
//              Acme Widgets" doesn't make Acme a recruiting firm. (An industry
//              sector keeps its job titles in words, where they count
//              everywhere; roles it lists would count the same way.)
//   names      Optional. Words that count in a company's name only: "AI" in
//              "Quillon AI" says what the company is, in a headline it is as
//              often a buzzword.
//   companies  Well-known companies, matched from the start of the name as
//              whole words: "aspen dental" is also Aspen Dental Management.
//              End one with $ to match the whole name only: "box$" is Box,
//              not Box Hill Hospital. A leading "the" is ignored.
//   not        Optional. Phrases that cancel this sector's words where they
//              appear: in a company's name, or in the part of a headline
//              that is being read for that company. "food bank" isn't banking.
//
// How a company matches is under the list (sectorMatcher).

import { INDUSTRIES, UNKNOWN_INDUSTRY } from './companies.js';
import { headlineParts, cleanCompany } from './scoring.js';

// Parts of a headline that say someone is a fan, not in the business.
const HOBBY = ['fan(s)', 'enthusiast(s)', 'lover(s)', 'junkie(s)', 'nerd(s)', 'buff(s)', 'addict(s)', 'hobbyist(s)', 'geek(s)',
  'aficionado(s)'];

export const DIRECTORY = [
  // ── Tech, Software & AI ───────────────────────────────────────────────────
  {
    key: 'software', label: 'Software & SaaS', group: 'tech', kind: 'function',
    // Banks, shops and hospitals all employ software engineers: a company is
    // in software when it sells software.
    words: [
      'saas', 'b2b saas', 'paas', 'iaas', 'software as a service', 'software company', 'software companies', 'software startup(s)',
      'software firm(s)', 'software vendor(s)', 'dev shop(s)',
    ],
    roles: [
      'software engineer(s)', 'software developer(s)', 'software engineering', 'swe', 'sde',
      'full stack', 'fullstack', 'front end developer(s)', 'frontend developer(s)', 'front end engineer(s)', 'frontend engineer(s)',
      'back end developer(s)', 'backend developer(s)', 'back end engineer(s)', 'backend engineer(s)', 'web developer(s)',
      'mobile developer(s)', 'ios developer(s)', 'ios engineer(s)', 'android developer(s)', 'android engineer(s)', 'app developer(s)',
      'devops', 'site reliability', 'sre', 'platform engineering', 'cloud engineer(s)', 'cloud architect(s)', 'solutions architect(s)',
      'developer relations', 'devrel', 'developer advocate(s)', 'qa engineer(s)', 'sdet', 'test automation',
      'javascript', 'typescript', 'kubernetes', 'open source',
    ],
    // In a headline "software" is as often part of a job title.
    names: ['software'],
    companies: [
      'microsoft', 'google', 'alphabet$', 'meta$', 'meta platforms', 'facebook', 'instagram', 'whatsapp', 'apple$', 'aws$',
      'amazon web services', 'linkedin', 'salesforce', 'oracle', 'adobe', 'sap$', 'servicenow', 'workday', 'atlassian', 'hubspot',
      'zoom$', 'zoom video', 'slack$', 'dropbox', 'box$', 'twilio', 'datadog', 'mongodb', 'github', 'gitlab', 'autodesk', 'intuit',
      'docusign', 'zendesk', 'asana$', 'notion$', 'notion labs', 'figma', 'canva', 'airtable', 'monday com', 'squarespace', 'wix$',
      'wix com', 'webflow', 'vercel', 'netlify', 'red hat', 'vmware', 'citrix', 'jetbrains', 'postman$', 'confluent', 'hashicorp',
      'new relic', 'pagerduty', 'freshworks', 'zoho', 'calendly', 'clickup', 'smartsheet', 'retool', 'supabase', 'replit', 'procore',
      'veeva', 'epic systems', 'klaviyo', 'rippling', 'gusto$', 'deel$', 'discord',
    ],
  },
  {
    key: 'ai-data', label: 'AI & Data', group: 'tech', kind: 'function',
    // Data scientists and ML engineers work at banks and retailers too, and
    // "AI" is in every other headline: a company is in AI when it is an AI
    // company.
    words: ['ai lab(s)', 'ai research lab(s)', 'ai startup(s)', 'ai company', 'ai companies'],
    roles: [
      'artificial intelligence', 'machine learning', 'deep learning', 'reinforcement learning', 'generative ai', 'gen ai', 'genai',
      'llm(s)', 'large language model(s)', 'nlp', 'natural language processing', 'computer vision', 'applied ai', 'head of ai',
      'ai engineer(s)', 'ai engineering', 'ai researcher(s)', 'ai research', 'ai scientist(s)',
      'ml engineer(s)', 'ml engineering', 'ml researcher(s)', 'ml scientist(s)', 'ml infrastructure', 'ml platform', 'mlops',
      'machine learning engineer(s)', 'data science', 'data scientist(s)', 'data engineer(s)', 'data engineering', 'data analytics',
      'data analyst(s)', 'analytics engineer(s)', 'big data', 'business intelligence', 'data warehouse', 'data warehousing',
      'data governance', 'data platform(s)',
    ],
    names: ['ai'],
    companies: [
      'openai', 'open ai', 'anthropic', 'deepmind', 'google deepmind', 'cohere$', 'mistral$', 'hugging face', 'huggingface',
      'databricks', 'snowflake$', 'palantir', 'nvidia', 'perplexity$', 'xai$', 'midjourney', 'runway ml', 'runwayml', 'datarobot',
      'dataiku', 'alteryx', 'tableau', 'fivetran', 'dbt labs', 'weights & biases', 'labelbox', 'groq$', 'cerebras',
    ],
    // "NLP" is also a coaching method, and an LLM also a law degree.
    not: ['neuro linguistic programming', 'nlp practitioner(s)', 'nlp coach', 'nlp coaches', 'llm in tax', 'llm in taxation', 'llm taxation'],
  },
  {
    key: 'cybersecurity', label: 'Cybersecurity', group: 'tech', kind: 'function',
    // Every bank and hospital has a security team: a company is in
    // cybersecurity when security is what it sells.
    words: [
      'cybersecurity company', 'cybersecurity companies', 'cybersecurity firm(s)', 'cybersecurity startup(s)', 'cybersecurity vendor(s)',
      'cyber security firm(s)', 'managed security', 'mssp(s)',
    ],
    roles: [
      'cybersecurity', 'cyber security', 'cyber', 'infosec', 'information security', 'security engineer(s)', 'security analyst(s)',
      'security architect(s)', 'security researcher(s)', 'security operations', 'soc analyst(s)', 'penetration tester(s)',
      'penetration testing', 'pentester(s)', 'pen tester(s)', 'red team', 'blue team', 'appsec', 'application security', 'cloud security',
      'network security', 'threat intelligence', 'threat hunter(s)', 'incident response', 'vulnerability management',
      'vulnerability research', 'vulnerability researcher(s)', 'malware', 'ciso', 'zero trust', 'osint', 'dfir', 'cissp', 'oscp', 'ceh',
      'comptia security', 'bug bounty', 'ethical hacker(s)', 'ethical hacking', 'devsecops', 'secops',
    ],
    companies: [
      'crowdstrike', 'palo alto networks', 'fortinet', 'okta', 'zscaler', 'sentinelone', 'cloudflare', 'proofpoint', 'rapid7', 'tenable',
      'qualys', 'splunk', 'mandiant', 'cyberark', 'check point software', 'sophos', 'darktrace', 'wiz$', 'snyk', 'vanta$', 'drata',
      '1password', 'lastpass', 'arctic wolf', 'huntress', 'mcafee', 'gen digital', 'trend micro', 'kaspersky', 'abnormal security',
      'knowbe4', 'secureworks', 'recorded future', 'bishop fox', 'trail of bits', 'hackerone', 'bugcrowd', 'cisa$',
    ],
    not: ['cyber monday'],
  },
  {
    key: 'telecom', label: 'Telecom', group: 'tech', kind: 'industry',
    words: [
      'telecom', 'telecoms', 'telecommunication(s)', 'telco(s)', 'wireless carrier(s)', 'mobile network(s)', '5g', 'broadband',
      'fiber optic(s)', 'fiber network(s)', 'rf engineer(s)', 'cell tower(s)', 'voip', 'unified communications', 'satellite communications',
    ],
    companies: [
      'at&t', 'verizon', 't mobile', 'tmobile', 'sprint$', 'comcast', 'xfinity', 'charter communications', 'spectrum$',
      'cox communications', 'lumen$', 'lumen technologies', 'centurylink', 'frontier communications', 'dish network', 'ericsson', 'nokia',
      'cisco', 'juniper networks', 'qualcomm', 'american tower', 'crown castle', 'vodafone', 'telefonica', 'bt group',
      'deutsche telekom', 'rogers communications', 'bell canada', 'telus', 'starlink', 'viasat', 'iridium',
    ],
  },

  // ── Finance, VC & Crypto ──────────────────────────────────────────────────
  {
    key: 'fintech', label: 'Fintech & Payments', group: 'finance', kind: 'industry',
    words: [
      'fintech', 'fin tech', 'payments', 'payment processing', 'merchant services', 'digital banking', 'neobank(s)', 'embedded finance',
      'insurtech', 'regtech', 'wealthtech', 'buy now pay later', 'bnpl', 'card issuing', 'open banking', 'digital wallet(s)',
      'mobile payments',
    ],
    names: ['pay'],
    companies: [
      'stripe', 'paypal', 'venmo', 'square$', 'block$', 'cash app', 'plaid$', 'brex', 'ramp$', 'mercury$', 'chime$', 'affirm$',
      'klarna', 'afterpay', 'marqeta', 'adyen', 'checkout com', 'sofi$', 'wise$', 'revolut', 'n26', 'nubank', 'monzo', 'bill com',
      'expensify', 'carta$', 'fiserv', 'fis$', 'global payments', 'worldpay', 'visa$', 'mastercard', 'american express', 'amex$',
      'discover financial', 'green dot', 'melio', 'payoneer', 'remitly', 'western union', 'moneygram', 'zelle', 'shift4', 'nuvei',
      'paysafe', 'lithic', 'synctera', 'modern treasury', 'rapyd', 'dwolla', 'credit karma', 'nerdwallet', 'kalshi',
    ],
    not: ['pay per click', 'pay it forward'],
  },
  {
    key: 'banking', label: 'Banking & Lending', group: 'finance', kind: 'industry',
    words: [
      'bank', 'banking', 'banker(s)', 'investment banking', 'investment banker(s)', 'commercial banking', 'commercial banker(s)',
      'retail banking', 'community bank(s)', 'credit union(s)', 'bank teller(s)', 'loan officer(s)', 'mortgage(s)', 'mortgage lender(s)',
      'mortgage lending', 'mortgage broker(s)', 'mortgage advisor(s)', 'mortgage underwriter(s)', 'lending', 'lender(s)',
      'loan processor(s)', 'loan originator(s)', 'credit analyst(s)', 'nmls',
    ],
    companies: [
      'jpmorgan', 'jp morgan', 'j p morgan', 'chase$', 'chase bank', 'bank of america', 'wells fargo', 'citi$', 'citibank', 'citigroup',
      'goldman sachs', 'morgan stanley', 'us bancorp', 'pnc', 'truist', 'capital one', 'td bank', 'td securities', 'hsbc', 'barclays',
      'santander', 'bny', 'state street', 'fifth third', 'keybank', 'ally$', 'ally financial', 'navy federal', 'rocket mortgage',
      'rocket companies', 'quicken loans', 'united wholesale mortgage', 'lendingtree', 'lendingclub', 'upstart$', 'lazard', 'evercore',
      'jefferies', 'moelis', 'houlihan lokey', 'piper sandler', 'rbc', 'royal bank of canada', 'bmo', 'scotiabank', 'ubs$',
      'credit suisse', 'deutsche bank', 'bnp paribas', 'mufg', 'societe generale', 'nomura', 'federal reserve', 'fdic$',
      'freddie mac', 'fannie mae',
    ],
    // Coldwell Banker sells houses; the other banks keep no money.
    not: ['coldwell banker', 'bankers life', 'food bank(s)', 'blood bank(s)', 'data bank(s)', 'sperm bank(s)', 'seed bank(s)',
      'memory bank(s)', 'piggy bank(s)', 'question bank(s)', 'image bank(s)', 'time bank(s)', 'west bank', 'left bank', 'river bank(s)'],
  },
  {
    key: 'vc-pe', label: 'Venture Capital & Private Equity', group: 'finance', kind: 'industry',
    words: [
      'venture capital', 'venture capitalist(s)', 'vc', 'vcs', 'vc fund(s)', 'venture fund(s)', 'venture partner(s)', 'private equity',
      'growth equity', 'pe fund(s)', 'buyout(s)', 'leveraged buyout(s)', 'lbo', 'fund of funds', 'search fund(s)', 'venture studio(s)',
    ],
    companies: [
      'sequoia$', 'sequoia capital', 'andreessen horowitz', 'a16z', 'accel$', 'accel partners', 'kleiner perkins', 'greylock',
      'lightspeed venture', 'general catalyst', 'founders fund', 'y combinator', 'yc$', 'techstars', '500 startups', 'first round capital',
      'insight partners', 'tiger global', 'thrive capital', 'khosla ventures', 'bessemer venture', 'ggv capital', 'nea$',
      'new enterprise associates', 'battery ventures', 'union square ventures', 'softbank vision fund', 'blackstone', 'kkr$',
      'kohlberg kravis roberts', 'carlyle group', 'apollo global', 'tpg$', 'tpg capital', 'bain capital', 'warburg pincus',
      'vista equity', 'thoma bravo', 'silver lake', 'advent international', 'hellman & friedman', 'general atlantic', 'ares management',
      'blue owl', 'cvc capital', 'permira', 'l catterton', 'leonard green', 'clayton dubilier',
    ],
    // A startup that says who backs it doesn't work in venture capital.
    not: ['vc backed', 'venture backed', 'pe backed', 'backed by'],
  },
  {
    key: 'wealth', label: 'Wealth & Asset Management', group: 'finance', kind: 'industry',
    words: [
      'wealth management', 'wealth manager(s)', 'wealth advisor(s)', 'private wealth', 'private banking', 'financial advisor(s)',
      'financial adviser(s)', 'financial planner(s)', 'financial planning', 'certified financial planner(s)', 'cfp', 'chfc',
      'registered investment advisor(s)', 'investment advisor(s)', 'asset management', 'investment management', 'portfolio manager(s)',
      'portfolio management', 'hedge fund(s)', 'family office(s)', 'retirement planning', 'cfa', 'cfa charterholder(s)',
      'equity research', 'investment research', 'trader(s)', 'quantitative trader(s)', 'quant trader(s)', 'trading desk', 'prop trading',
      'proprietary trading', 'equities', 'fixed income', 'derivatives', 'securities', 'finra', 'series 7', 'series 65', 'series 66',
    ],
    companies: [
      'blackrock', 'vanguard$', 'vanguard group', 'fidelity$', 'fidelity investments', 'charles schwab', 'schwab$', 'edward jones',
      'merrill$', 'merrill lynch', 'ameriprise', 'raymond james', 'lpl financial', 'northwestern mutual', 'pimco', 't rowe price',
      'franklin templeton', 'invesco', 'capital group', 'wellington management', 'nuveen', 'bridgewater', 'citadel$',
      'citadel securities', 'two sigma', 'de shaw', 'd e shaw', 'renaissance technologies', 'millennium management', 'point72',
      'jane street', 'hudson river trading', 'jump trading', 'optiver', 'susquehanna', 'virtu financial', 'drw$', 'aqr', 'man group',
      'elliott management', 'pershing square', 'robinhood', 'wealthfront', 'betterment', 'stifel',
    ],
    not: ['trader joe(s)', 'securities law', 'securities litigation', 'securities attorney(s)', 'securities lawyer(s)', 'social security'],
  },
  {
    key: 'insurance', label: 'Insurance', group: 'finance', kind: 'industry',
    words: [
      'insurance', 'insurer(s)', 'insurtech', 'reinsurance', 'insurance underwriter(s)', 'claims adjuster(s)', 'insurance adjuster(s)',
      'public adjuster(s)', 'actuary', 'actuaries', 'actuarial', 'p&c', 'property and casualty', 'annuity', 'annuities', 'cpcu',
      'title insurance',
    ],
    companies: [
      'state farm', 'allstate', 'geico', 'progressive$', 'liberty mutual', 'nationwide$', 'usaa', 'farmers insurance', 'travelers$',
      'hartford$', 'chubb', 'aig$', 'american international group', 'metlife', 'prudential', 'new york life', 'northwestern mutual',
      'massmutual', 'mass mutual', 'aflac', 'oscar health', 'root insurance', 'humana', 'unitedhealth', 'aetna', 'cigna', 'anthem$', 'anthem blue cross',
      'elevance', 'centene', 'molina healthcare', 'blue cross', 'bcbs', 'florida blue', 'marsh$', 'marsh mclennan', 'aon$',
      'willis towers watson', 'wtw$', 'gallagher$', 'arthur j gallagher', 'brown & brown', 'lockton', 'hub international', 'swiss re',
      'munich re', 'assurant', 'erie insurance', 'american family insurance', 'primerica', 'globe life', 'mutual of omaha',
      'guardian life', 'lincoln financial', 'transamerica', 'john hancock', 'pacific life', 'protective life', 'unum',
    ],
  },
  {
    key: 'accounting', label: 'Accounting & Tax', group: 'finance', kind: 'function',
    // Every company has an accountant: a company is in accounting when it is
    // an accounting firm.
    words: [
      'accounting firm(s)', 'cpa firm(s)', 'public accounting', 'tax preparation', 'external audit', 'audit & assurance', 'big four',
      'big 4',
    ],
    roles: [
      'accounting', 'accountant(s)', 'cpa', 'cpas', 'certified public accountant(s)', 'chartered accountant(s)', 'acca', 'tax',
      'tax preparer(s)', 'tax advisor(s)', 'enrolled agent(s)', 'bookkeeper(s)', 'bookkeeping', 'auditor(s)', 'internal audit',
      'accounts payable', 'accounts receivable', 'financial controller(s)', 'corporate controller(s)', 'fractional cfo(s)',
      'forensic accounting', 'forensic accountant(s)', 'quickbooks',
    ],
    companies: [
      'deloitte', 'pwc$', 'pricewaterhousecoopers', 'ey$', 'ernst & young', 'kpmg', 'grant thornton', 'bdo$', 'bdo usa', 'rsm$',
      'rsm us', 'crowe$', 'baker tilly', 'cliftonlarsonallen', 'moss adams', 'cbiz', 'marcum$', 'eisneramper', 'cherry bekaert',
      'plante moran', 'h&r block', 'jackson hewitt', 'liberty tax',
    ],
  },
  {
    key: 'crypto', label: 'Crypto & Web3', group: 'finance', kind: 'industry',
    words: [
      'crypto', 'cryptocurrency', 'cryptocurrencies', 'blockchain', 'web3', 'web 3', 'defi', 'nft(s)', 'bitcoin', 'ethereum', 'solana',
      'stablecoin(s)', 'digital asset(s)', 'smart contract(s)', 'dapp(s)', 'on chain', 'onchain', 'crypto exchange(s)',
    ],
    companies: [
      'coinbase', 'binance', 'kraken$', 'ripple$', 'chainalysis', 'consensys', 'opensea', 'uniswap', 'polygon labs', 'fireblocks',
      'anchorage digital', 'paxos', 'bitgo', 'crypto com', 'ledger$', 'metamask', 'polymarket', 'tether$', 'galaxy digital',
      'grayscale investments', 'blockchain com', 'bitpay', 'moonpay', 'dydx', 'aave', 'chainlink labs', 'mysten labs',
    ],
    not: ['digital asset management'],
  },

  // ── Healthcare & Biotech ──────────────────────────────────────────────────
  {
    key: 'hospitals', label: 'Hospitals & Clinics', group: 'health', kind: 'industry',
    words: [
      'hospital(s)', 'clinic(s)', 'medical center(s)', 'health system(s)', 'healthcare system(s)', 'urgent care', 'emergency room',
      'emergency department', 'emergency medicine', 'physician(s)', 'doctor(s)', 'surgeon(s)', 'surgery', 'nurse(s)', 'nursing',
      'registered nurse(s)', 'rn', 'bsn', 'lpn', 'certified nursing assistant(s)', 'nurse practitioner(s)', 'physician assistant(s)',
      'pa c', 'medical assistant(s)', 'patient care', 'hospitalist(s)', 'pediatrician(s)', 'cardiologist(s)', 'oncologist(s)',
      'radiologist(s)', 'anesthesiologist(s)', 'dermatologist(s)', 'neurologist(s)', 'obgyn', 'ob gyn', 'family medicine',
      'internal medicine', 'primary care', 'pediatrics', 'oncology', 'cardiology', 'radiology', 'paramedic(s)', 'emt(s)',
      'respiratory therapist(s)', 'physical therapist(s)', 'physical therapy', 'occupational therapist(s)', 'occupational therapy',
      'speech language pathologist(s)', 'radiologic technologist(s)', 'sonographer(s)', 'phlebotomist(s)', 'pharmacist(s)',
      'pharmacy', 'home health', 'hospice', 'nursing home(s)', 'assisted living', 'senior living', 'skilled nursing',
      'healthcare administration', 'hospital administrator(s)', 'medical practice(s)', 'medical group(s)', 'telehealth', 'telemedicine',
      'concierge medicine', 'chiropractor(s)', 'chiropractic', 'optometrist(s)', 'optometry', 'ophthalmologist(s)', 'podiatrist(s)',
      'medical billing', 'medical coding', 'medical coder(s)', 'revenue cycle',
    ],
    companies: [
      'kaiser permanente', 'hca$', 'hca healthcare', 'tenet healthcare', 'commonspirit', 'ascension$', 'ascension health', 'adventhealth',
      'advent health', 'orlando health', 'baptist health', 'atrium health', 'intermountain health', 'intermountain healthcare', 'providence health', 'trinity health',
      'sutter health', 'banner health', 'northwell', 'mass general', 'massachusetts general', 'mount sinai', 'nyu langone',
      'johns hopkins medicine', 'ucla health', 'stanford health', 'memorial sloan kettering', 'md anderson', 'dana farber', 'geisinger',
      'ochsner', 'emory healthcare', 'cedars sinai', 'city of hope', 'one medical', 'oak street health', 'carbon health', 'teladoc',
      'amwell', 'davita', 'fresenius', 'lifepoint health', 'universal health services',
    ],
    // Animal hospitals are veterinary; a legal clinic is law.
    not: ['animal hospital(s)', 'animal clinic(s)', 'pet hospital(s)', 'veterinary', 'veterinarian(s)', 'legal clinic(s)', 'law clinic(s)',
      'doctor of philosophy', 'computer doctor(s)', 'script doctor(s)', 'tree surgery'],
  },
  {
    key: 'dental', label: 'Dental', group: 'health', kind: 'industry',
    words: [
      'dental', 'dentist(s)', 'dentistry', 'dds', 'dmd', 'orthodontist(s)', 'orthodontic(s)', 'orthodontia', 'periodontist(s)',
      'periodontics', 'periodontal', 'endodontist(s)', 'endodontics', 'prosthodontist(s)', 'prosthodontics', 'pedodontist(s)',
      'pediatric dentist(s)', 'oral surgeon(s)', 'oral surgery', 'oral and maxillofacial', 'maxillofacial', 'dental hygienist(s)', 'rdh',
      'dental assistant(s)', 'dso', 'dsos', 'dental support organization(s)', 'invisalign',
    ],
    companies: [
      'align technology', 'henry schein', 'dentsply', 'smile direct club', 'smiledirectclub', 'clearchoice', 'sonrava', 'envista$', 'envista holdings',
      'straumann', 'ivoclar', 'nobel biocare', 'great expressions', 'smile brands', 'bright now', 'affordable dentures',
    ],
  },
  {
    key: 'pharma-biotech', label: 'Pharma & Biotech', group: 'health', kind: 'industry',
    words: [
      'pharma', 'pharmaceutical(s)', 'biotech', 'biotechnology', 'biopharma', 'biopharmaceutical(s)', 'therapeutics', 'bioscience(s)',
      'biologics', 'drug discovery', 'drug development', 'clinical trial(s)', 'clinical research', 'clinical research associate(s)',
      'medical science liaison(s)', 'pharmaceutical sales', 'pharma sales', 'regulatory affairs', 'pharmacovigilance', 'drug safety',
      'gene therapy', 'cell therapy', 'genomics', 'bioinformatics', 'molecular biology', 'immunology', 'vaccine(s)', 'life sciences',
      'antibody', 'antibodies', 'crispr', 'mrna', 'biostatistics', 'biostatistician(s)', 'medicinal chemistry',
    ],
    companies: [
      'pfizer', 'moderna', 'johnson & johnson', 'j&j', 'janssen', 'merck', 'msd$', 'abbvie', 'bristol myers squibb', 'eli lilly',
      'lilly$', 'novartis', 'roche$', 'roche diagnostics', 'genentech', 'astrazeneca', 'gsk$', 'glaxosmithkline', 'sanofi', 'novo nordisk',
      'bayer', 'amgen', 'gilead', 'regeneron', 'vertex pharmaceuticals', 'biogen', 'takeda', 'boehringer ingelheim', 'viatris',
      'mylan', 'biontech', 'illumina', 'thermo fisher', 'iqvia', 'syneos', 'parexel', 'charles river laboratories', 'catalent', 'lonza',
      'danaher', 'alnylam', 'incyte', 'seagen', 'bluebird bio', 'intellia', 'editas', 'insitro', '23andme', 'ginkgo bioworks', 'zoetis',
    ],
  },
  {
    key: 'medical-devices', label: 'Medical Devices', group: 'health', kind: 'industry',
    words: [
      'medical device(s)', 'medical technology', 'medtech', 'med tech', 'medical equipment', 'durable medical equipment',
      'surgical robotics', 'surgical device(s)', 'orthopedic implant(s)', 'medical diagnostics', 'in vitro diagnostics',
      'medical imaging', 'biomedical engineer(s)', 'biomedical engineering', 'regulatory affairs', 'medical device sales', '510 k',
    ],
    companies: [
      'medtronic', 'stryker', 'boston scientific', 'abbott$', 'abbott laboratories', 'abbott diagnostics', 'becton dickinson',
      'baxter international', 'baxter healthcare', 'zimmer biomet', 'smith & nephew',
      'edwards lifesciences', 'intuitive surgical', 'ge healthcare', 'philips healthcare', 'siemens healthineers', 'hologic', 'dexcom',
      'insulet', 'resmed', 'masimo', 'teleflex', 'hillrom', 'hill rom', 'steris', 'conmed', 'globus medical', 'nuvasive',
      'integra lifesciences', 'penumbra$', 'abiomed', 'karl storz', 'arthrex', 'exactech', 'butterfly network', 'outset medical',
      'shockwave medical', 'inari medical', 'axonics', 'tandem diabetes', 'varian',
    ],
  },
  {
    key: 'mental-health', label: 'Mental Health', group: 'health', kind: 'industry',
    words: [
      'mental health', 'behavioral health', 'psychologist(s)', 'psychiatrist(s)', 'psychiatry', 'psychiatric', 'psychotherapist(s)',
      'psychotherapy', 'therapist(s)', 'lmft', 'lcsw', 'lpc', 'lmhc', 'lcpc', 'lpcc', 'psyd', 'licensed clinical social worker(s)',
      'clinical social worker(s)', 'licensed professional counselor(s)', 'marriage and family therapist(s)', 'mental health counselor(s)',
      'addiction counselor(s)', 'addiction treatment', 'addiction medicine', 'substance abuse', 'behavioral therapist(s)',
      'aba therapist(s)', 'applied behavior analysis', 'bcba', 'eating disorder(s)', 'emdr', 'cognitive behavioral therapy',
      'teletherapy', 'online therapy',
    ],
    companies: [
      'betterhelp', 'talkspace', 'headspace', 'lyra health', 'spring health', 'modern health', 'acadia healthcare', 'nami$',
      'national alliance on mental illness', 'the jed foundation', 'crisis text line',
    ],
    // A therapist of the body is not a therapist of the mind.
    not: ['physical therapist(s)', 'physical therapy', 'occupational therapist(s)', 'occupational therapy', 'respiratory therapist(s)',
      'respiratory therapy', 'massage therapist(s)', 'massage therapy', 'speech therapist(s)', 'speech therapy', 'radiation therapist(s)',
      'radiation therapy', 'infusion therapy'],
  },
  {
    key: 'fitness-wellness', label: 'Fitness & Wellness', group: 'health', kind: 'industry',
    words: [
      'fitness', 'gym(s)', 'personal trainer(s)', 'personal training', 'fitness coach', 'fitness coaches', 'strength and conditioning',
      'crossfit', 'pilates', 'yoga', 'yoga teacher(s)', 'yoga instructor(s)', 'wellness', 'massage therapist(s)', 'massage therapy',
      'nutritionist(s)', 'dietitian(s)', 'registered dietitian(s)', 'health coach', 'health coaches', 'wellness coach', 'wellness coaches',
      'meditation', 'mindfulness', 'group fitness', 'fitness instructor(s)', 'bodybuilding', 'athletic trainer(s)',
    ],
    companies: [
      'planet fitness', 'la fitness', 'equinox$', 'equinox fitness', 'orangetheory', 'orange theory', 'f45', 'crunch fitness', 'anytime fitness', 'golds gym',
      '24 hour fitness', 'life time fitness', 'soulcycle', 'peloton', 'barrys bootcamp', 'corepower yoga', 'club pilates',
      'xponential fitness', 'whoop$', 'oura$', 'strava', 'myfitnesspal', 'noom$', 'weightwatchers', 'ww international', 'beachbody',
      'hydrow', 'tonal$', 'classpass', 'mindbody', 'ymca',
    ],
    not: ['corporate wellness', 'employee wellness', 'financial wellness', ...HOBBY],
  },

  // ── Education ─────────────────────────────────────────────────────────────
  {
    key: 'k12', label: 'K-12 Education', group: 'education', kind: 'industry',
    words: [
      'k 12', 'k12', 'elementary school(s)', 'middle school(s)', 'high school(s)', 'junior high', 'primary school(s)',
      'secondary school(s)', 'public school(s)', 'charter school(s)', 'private school(s)', 'school district(s)',
      'independent school district', 'isd', 'montessori', 'preschool(s)', 'pre k', 'prek', 'kindergarten', 'early childhood', 'teacher(s)',
      'substitute teacher(s)', 'assistant principal(s)', 'vice principal(s)', 'school principal(s)', 'head of school', 'headmaster',
      'superintendent of schools', 'school superintendent(s)', 'school board', 'guidance counselor(s)', 'school counselor(s)',
      'school psychologist(s)', 'school nurse(s)', 'special education', 'special ed', 'ese teacher(s)', 'sped', 'paraprofessional(s)',
      'homeschool', 'tutor(s)', 'tutoring',
    ],
    companies: [
      'teach for america', 'kipp', 'success academy', 'idea public schools', 'khan academy', 'kumon', 'sylvan learning', 'mathnasium',
      'huntington learning', 'varsity tutors', 'connections academy', 'kindercare', 'bright horizons', 'learning care group',
    ],
    not: ['yoga teacher(s)', 'dance teacher(s)', 'piano teacher(s)'],
  },
  {
    key: 'higher-ed', label: 'Higher Education', group: 'education', kind: 'industry',
    words: [
      'university', 'universities', 'universidad', 'college', 'colleges', 'community college(s)', 'higher education', 'higher ed',
      'academia', 'professor(s)', 'assistant professor(s)', 'associate professor(s)', 'adjunct professor(s)', 'adjunct faculty',
      'adjunct instructor(s)', 'lecturer(s)', 'senior lecturer(s)', 'faculty member(s)', 'postdoc(s)', 'postdoctoral', 'post doctoral',
      'phd candidate(s)', 'phd student(s)', 'doctoral candidate(s)', 'doctoral student(s)', 'graduate student(s)', 'grad student(s)',
      'graduate assistant(s)', 'graduate research assistant(s)', 'research assistant(s)', 'graduate teaching assistant(s)', 'provost',
      'dean of', 'associate dean(s)', 'assistant dean(s)', 'registrar', 'bursar', 'financial aid', 'admissions counselor(s)',
      'college admissions', 'university admissions', 'student affairs', 'residence life', 'academic advisor(s)', 'academic advising',
      'career services', 'alumni relations', 'tenure track', 'tenured', 'chancellor', 'vice chancellor', 'undergraduate', 'undergrad',
      'mba candidate(s)', 'mba student(s)', 'business school(s)', 'school of business', 'law school(s)', 'school of law',
      'medical school(s)', 'school of medicine', 'graduate school(s)', 'school of management',
    ],
    companies: [
      'mit$', 'massachusetts institute of technology', 'caltech', 'california institute of technology', 'georgia tech',
      'georgia institute of technology', 'virginia tech', 'texas a&m', 'ucla$', 'usc$', 'nyu$', 'ucf$', 'uf$', 'fsu$', 'usf$',
      'uc berkeley', 'uc davis', 'uc san diego', 'ucsd$', 'uc irvine', 'ucsb$', 'purdue$', 'purdue global', 'rutgers', 'cornell$', 'yale$', 'princeton$',
      'harvard$', 'harvard business school', 'harvard law school', 'harvard medical school', 'harvard kennedy school', 'stanford$',
      'stanford gsb', 'penn state', 'ohio state$', 'arizona state$', 'asu$', 'georgetown$', 'vanderbilt$', 'emory$', 'tulane$',
      'wharton$', 'wharton school', 'kellogg school of management', 'insead', 'london business school', 'columbia business school',
      'mit sloan', 'duke$', 'coursera', 'edx$',
    ],
    // "College Park" is a place; a credit union named after a university is a bank.
    not: ['college park', 'college hunks', 'credit union(s)'],
  },

  // ── Marketing, Media & Creator ────────────────────────────────────────────
  {
    key: 'marketing-advertising', label: 'Marketing & Advertising', group: 'media', kind: 'function',
    // Every company markets itself: a company is in marketing when it is an
    // agency or sells marketing tools.
    words: [
      'ad agency', 'ad agencies', 'advertising agency', 'advertising agencies', 'digital agency', 'digital agencies', 'creative agency',
      'creative agencies', 'marketing agency', 'marketing agencies', 'marketing firm(s)', 'media agency', 'media agencies', 'martech',
      'adtech', 'ad tech',
    ],
    roles: [
      'marketing', 'marketer(s)', 'advertising', 'branding', 'brand strategy', 'brand strategist(s)', 'brand manager(s)',
      'brand marketing', 'copywriter(s)', 'copywriting', 'seo', 'sem', 'ppc', 'search engine optimization', 'paid media', 'paid social',
      'paid search', 'performance marketing', 'growth marketing', 'digital marketing', 'content marketing', 'email marketing',
      'social media marketing', 'social media manager(s)', 'influencer marketing', 'affiliate marketing', 'demand generation',
      'demand gen', 'lifecycle marketing', 'product marketing', 'marketing operations', 'marketing ops', 'media buyer(s)',
      'media buying', 'media planner(s)', 'media planning', 'programmatic', 'ad operations', 'ad ops', 'market research',
    ],
    companies: [
      'wpp$', 'omnicom', 'publicis', 'interpublic', 'ipg$', 'ipg mediabrands', 'dentsu', 'havas', 'ogilvy', 'bbdo', 'tbwa', 'mccann$', 'mccann worldgroup',
      'leo burnett', 'saatchi', 'grey group', 'droga5', 'wieden & kennedy', 'r ga', 'vaynermedia', 'vayner media', 'vaynerx',
      'the trade desk', 'mediamonks', 'media monks', 'monks$', 'accenture song', 'deloitte digital', 'razorfish', 'digitas',
      'wunderman thompson', 'vml', 'vmly&r', 'groupm', 'group m', 'mindshare$', 'mindshare worldwide', 'wavemaker', 'horizon media', 'starcom', 'spark foundry',
      'kantar', 'nielsen$', 'nielsen holdings', 'nielseniq', 'ipsos', 'semrush', 'criteo', 'taboola', 'outbrain', 'applovin', 'integral ad science', 'doubleverify',
      'magnite', 'pubmatic', '72andsunny', 'crispin porter', 'goodby silverstein', 'isobar', 'iprospect', 'merkle$', 'acxiom',
    ],
  },
  {
    key: 'pr-comms', label: 'PR & Communications', group: 'media', kind: 'function',
    // Most companies have a communications team: a company is in PR when it
    // is a PR or communications agency.
    words: [
      'pr agency', 'pr agencies', 'pr firm(s)', 'public relations agency', 'public relations agencies', 'public relations firm(s)',
      'communications agency', 'communications agencies', 'communications firm(s)',
    ],
    roles: [
      'public relations', 'pr manager(s)', 'pr director(s)', 'pr specialist(s)', 'pr lead',
      'pr strategist(s)', 'pr professional(s)', 'pr executive(s)', 'pr comms', 'pr communications', 'comms', 'corporate communications',
      'strategic communications', 'internal communications', 'external communications', 'crisis communications',
      'marketing communications', 'communications manager(s)', 'communications director(s)', 'director of communications',
      'head of communications', 'communications specialist(s)', 'communications coordinator(s)', 'communications lead',
      'communications strategist(s)', 'vp communications', 'vp of communications', 'media relations', 'press secretary', 'spokesperson',
      'spokeswoman', 'spokesman', 'publicist(s)',
    ],
    names: ['pr'],
    companies: [
      'edelman$', 'weber shandwick', 'fleishmanhillard', 'fleishman hillard', 'ketchum$', 'burson', 'bcw$', 'hill & knowlton',
      'brunswick group', 'finsbury', 'teneo$', 'golin$', 'porter novelli', 'ruder finn', 'apco worldwide', 'sard verbinnen', 'kekst',
      'mww$', 'praytell', 'prosek', 'zeno group', 'allison worldwide', 'cision', 'meltwater', 'muck rack', 'pr newswire', 'business wire',
    ],
  },
  {
    key: 'media-publishing', label: 'Media & Publishing', group: 'media', kind: 'industry',
    words: [
      'journalist(s)', 'journalism', 'reporter(s)', 'editor(s)', 'editor in chief', 'managing editor(s)', 'copy editor(s)', 'news',
      'newsroom(s)', 'newspaper(s)', 'magazine(s)', 'publishing', 'publisher(s)', 'book publishing', 'broadcast journalist(s)',
      'news anchor(s)', 'correspondent(s)', 'columnist(s)', 'staff writer(s)', 'freelance writer(s)', 'podcast(s)',
    ],
    companies: [
      'new york times', 'nyt$', 'washington post', 'wall street journal', 'wsj$', 'dow jones', 'news corp', 'gannett', 'usa today',
      'tribune', 'hearst', 'conde nast', 'axel springer', 'politico', 'axios', 'the atlantic', 'vox media', 'buzzfeed', 'vice media',
      'bustle', 'the athletic', 'bloomberg', 'reuters', 'thomson reuters', 'associated press', 'cnn$', 'fox news', 'msnbc', 'nbc news',
      'cbs news', 'abc news', 'npr$', 'national public radio', 'bbc', 'the guardian', 'the economist', 'financial times', 'forbes$',
      'forbes media', 'fortune$', 'business insider', 'insider$', 'techcrunch', 'the verge', 'wired$', 'penguin random house',
      'harpercollins', 'simon & schuster', 'hachette', 'macmillan publishers', 'macmillan learning', 'scholastic', 'mcgraw hill', 'pearson$', 'wiley$', 'john wiley',
      'elsevier', 'springer nature', 'sinclair broadcast', 'nexstar', 'tegna', 'iheartmedia', 'audacy',
    ],
    not: ['video editor(s)', 'photo editor(s)', 'film editor(s)'],
  },
  {
    key: 'creator-economy', label: 'Creator Economy', group: 'media', kind: 'industry',
    words: [
      'content creator(s)', 'creator economy', 'digital creator(s)', 'ugc', 'ugc creator(s)', 'influencer(s)', 'youtuber(s)',
      'tiktoker(s)', 'streamer(s)', 'podcast(s)', 'podcaster(s)', 'podcast host(s)', 'podcasting', 'blogger(s)', 'vlogger(s)',
      'creator partnership(s)', 'influencer marketing', 'content creation',
    ],
    companies: [
      'youtube', 'tiktok', 'bytedance', 'instagram', 'snapchat', 'snap$', 'snap inc', 'patreon', 'substack', 'twitch$', 'linktree',
      'kajabi', 'teachable', 'cameo$', 'whop$', 'beehiiv', 'convertkit', 'jellysmack', 'dude perfect', 'mrbeast', 'beast industries',
      'fourthwall', 'captiv8', 'creatoriq', 'ltk$', 'rewardstyle',
    ],
  },

  // ── Entertainment & Gaming ────────────────────────────────────────────────
  {
    key: 'film-tv-music', label: 'Film, TV & Music', group: 'entertainment', kind: 'industry',
    words: [
      'film', 'films', 'filmmaker(s)', 'filmmaking', 'film production', 'movie(s)', 'motion picture(s)', 'cinematographer(s)',
      'cinematography', 'screenwriter(s)', 'screenwriting', 'showrunner(s)', 'tv', 'television', 'broadcasting', 'post production',
      'vfx', 'visual effects', 'animator(s)', 'animation studio(s)', 'music', 'musician(s)', 'songwriter(s)', 'record label(s)',
      'recording artist(s)', 'recording studio(s)', 'music producer(s)', 'audio engineer(s)', 'sound engineer(s)', 'dj', 'djs',
      'actor(s)', 'actress', 'actresses', 'casting director(s)', 'talent agency', 'hollywood', 'production company', 'production companies',
      'theatre', 'theater', 'broadway', 'performing arts', 'live music', 'music festival(s)', 'orchestra', 'symphony', 'opera',
      'video editor(s)', 'film editor(s)',
    ],
    names: ['records', 'pictures'],
    companies: [
      'netflix', 'disney', 'walt disney', 'pixar', 'lucasfilm', 'marvel', 'warner bros', 'warner music', 'wbd$', 'hbo', 'paramount',
      'nbcuniversal', 'nbc universal', 'universal music', 'umg$', 'sony pictures', 'sony music', 'lionsgate', 'mgm$',
      'metro goldwyn mayer', 'a24', 'blumhouse', 'legendary entertainment', 'dreamworks', 'fox$', 'fox corporation',
      'fox entertainment', '20th century', 'amc networks', 'regal cinemas', 'cinemark', 'imax', 'roku', 'hulu', 'peacock$', 'spotify',
      'soundcloud', 'siriusxm', 'sirius xm', 'live nation', 'ticketmaster', 'aeg$', 'aeg presents', 'caa$', 'creative artists agency',
      'wme$', 'william morris endeavor', 'uta$', 'united talent agency', 'def jam', 'interscope', 'bmg$', 'ascap', 'recording academy',
      'viacom', 'cbs$', 'cbs studios', 'showtime', 'starz', 'a&e networks', 'univision', 'telemundo', 'tubi$', 'crunchyroll',
      'illumination entertainment', 'skydance',
    ],
    not: ['home theater', 'home theatre', 'operating theatre', 'medical records', 'window film', 'window tint', 'plastic film',
      'threat actor(s)', 'bad actor(s)', ...HOBBY],
  },
  {
    key: 'gaming-esports', label: 'Gaming & Esports', group: 'entertainment', kind: 'industry',
    words: [
      'gaming', 'video game(s)', 'videogame(s)', 'game developer(s)', 'game development', 'game designer(s)', 'game design',
      'game studio(s)', 'game artist(s)', 'game producer(s)', 'gameplay', 'esports', 'e sports', 'esport', 'unreal engine',
      'unity developer(s)', 'level designer(s)', 'game engine(s)', 'indie game(s)', 'mobile games', 'mobile gaming', 'pro gamer(s)',
      'professional gamer(s)', 'twitch streamer(s)',
    ],
    companies: [
      'electronic arts', 'ea$', 'ea sports', 'activision', 'blizzard entertainment', 'riot games', 'epic games', 'valve$', 'valve corporation',
      'ubisoft', 'nintendo', 'playstation', 'sony interactive entertainment', 'xbox', 'take two', 'rockstar games', '2k$', '2k games',
      'bungie', 'bethesda softworks', 'bethesda game studios', 'zynga', 'roblox', 'unity$', 'unity technologies', 'supercell',
      'king digital', 'niantic', 'square enix', 'bandai namco', 'sega', 'capcom', 'konami', 'nexon', 'netease games', 'tencent games',
      'scopely', 'playtika', 'jam city', 'moon active', 'twitch$', 'faze clan', 'team liquid', '100 thieves', 'cloud9', 'optic gaming',
      'dreamhack', 'gamestop', 'mojang', 'insomniac games', 'naughty dog', 'respawn entertainment',
    ],
    // Casino "gaming" is gambling.
    not: ['casino(s)', 'sportsbook(s)', 'sports betting', 'igaming', 'gaming commission', 'gaming control', 'slot machine(s)', ...HOBBY],
  },
  {
    key: 'sports', label: 'Sports', group: 'entertainment', kind: 'industry',
    words: [
      'sports', 'athlete(s)', 'athletics', 'athletic director(s)', 'athletic trainer(s)', 'professional athlete(s)', 'pro athlete(s)',
      'nfl', 'nba', 'mlb', 'nhl', 'wnba', 'ncaa', 'nwsl', 'pga', 'lpga', 'nascar', 'ufc', 'wwe', 'fifa', 'olympic(s)', 'olympian(s)',
      'football', 'basketball', 'baseball', 'soccer', 'hockey', 'golf', 'tennis', 'volleyball', 'lacrosse', 'softball', 'wrestling',
      'rugby', 'boxing', 'mma', 'track and field', 'head coach', 'head coaches', 'assistant coach', 'assistant coaches',
      'sports marketing', 'sports medicine', 'sports management', 'sports business', 'sports betting', 'sportsbook(s)', 'fantasy sports',
      'stadium(s)', 'sports broadcaster(s)', 'sportscaster(s)',
    ],
    companies: [
      'national football league', 'national basketball association', 'major league baseball', 'national hockey league',
      'major league soccer', 'espn', 'fox sports', 'nbc sports', 'cbs sports', 'turner sports', 'dazn', 'the athletic', 'bleacher report',
      'barstool sports', 'draftkings', 'fanduel', 'fanatics', 'img academy', 'wasserman$', 'wasserman media', 'excel sports', 'klutch sports',
      'genius sports', 'sportradar', 'hudl', 'special olympics',
      // NFL
      'arizona cardinals', 'atlanta falcons', 'baltimore ravens', 'buffalo bills', 'carolina panthers', 'chicago bears',
      'cincinnati bengals', 'cleveland browns', 'dallas cowboys', 'denver broncos', 'detroit lions', 'green bay packers',
      'houston texans', 'indianapolis colts', 'jacksonville jaguars', 'kansas city chiefs', 'las vegas raiders', 'los angeles chargers',
      'los angeles rams', 'miami dolphins', 'minnesota vikings', 'new england patriots', 'new orleans saints', 'new york giants',
      'new york jets', 'philadelphia eagles', 'pittsburgh steelers', 'san francisco 49ers', 'seattle seahawks', 'tampa bay buccaneers',
      'tennessee titans', 'washington commanders',
      // NBA
      'atlanta hawks', 'boston celtics', 'brooklyn nets', 'charlotte hornets', 'chicago bulls', 'cleveland cavaliers', 'dallas mavericks',
      'denver nuggets', 'detroit pistons', 'golden state warriors', 'houston rockets', 'indiana pacers', 'la clippers',
      'los angeles clippers', 'los angeles lakers', 'memphis grizzlies', 'miami heat', 'milwaukee bucks', 'minnesota timberwolves',
      'new orleans pelicans', 'new york knicks', 'oklahoma city thunder', 'orlando magic', 'philadelphia 76ers', 'phoenix suns',
      'portland trail blazers', 'sacramento kings', 'san antonio spurs', 'toronto raptors', 'utah jazz', 'washington wizards',
      // MLB
      'arizona diamondbacks', 'atlanta braves', 'baltimore orioles', 'boston red sox', 'chicago cubs', 'chicago white sox',
      'cincinnati reds', 'cleveland guardians', 'colorado rockies', 'detroit tigers', 'houston astros', 'kansas city royals',
      'los angeles angels', 'los angeles dodgers', 'miami marlins', 'milwaukee brewers', 'minnesota twins', 'new york mets',
      'new york yankees', 'oakland athletics', 'philadelphia phillies', 'pittsburgh pirates', 'san diego padres', 'san francisco giants',
      'seattle mariners', 'st louis cardinals', 'tampa bay rays', 'texas rangers baseball', 'toronto blue jays', 'washington nationals',
      // NHL
      'anaheim ducks', 'boston bruins', 'buffalo sabres', 'calgary flames', 'carolina hurricanes', 'chicago blackhawks',
      'colorado avalanche', 'columbus blue jackets', 'dallas stars', 'detroit red wings', 'edmonton oilers', 'florida panthers',
      'los angeles kings', 'minnesota wild', 'montreal canadiens', 'nashville predators', 'new jersey devils', 'new york islanders',
      'new york rangers', 'ottawa senators', 'philadelphia flyers', 'pittsburgh penguins', 'san jose sharks', 'seattle kraken',
      'st louis blues', 'tampa bay lightning', 'toronto maple leafs', 'utah mammoth', 'utah hockey club', 'vancouver canucks',
      'vegas golden knights', 'washington capitals', 'winnipeg jets',
      // MLS
      'atlanta united fc', 'austin fc', 'charlotte fc', 'chicago fire fc', 'fc cincinnati', 'colorado rapids', 'columbus crew',
      'dc united', 'd c united', 'fc dallas', 'houston dynamo', 'inter miami', 'la galaxy', 'lafc', 'los angeles fc',
      'minnesota united fc', 'cf montreal', 'nashville sc', 'new england revolution', 'new york city fc', 'new york red bulls',
      'orlando city sc', 'orlando city soccer', 'philadelphia union$', 'portland timbers', 'real salt lake', 'san diego fc',
      'san jose earthquakes', 'seattle sounders', 'sporting kansas city', 'st louis city sc', 'toronto fc', 'vancouver whitecaps',
    ],
    // A fan or a sports parent isn't in the business, and an ex-player's new company isn't a team.
    not: ['cricket wireless', 'alumni', 'alum', 'veteran(s)', 'soccer mom(s)', 'hockey mom(s)', 'baseball mom(s)', 'football mom(s)',
      'sports mom(s)', 'soccer dad(s)', 'hockey dad(s)', 'sports dad(s)', ...HOBBY],
  },

  // ── Retail, Consumer & Hospitality ────────────────────────────────────────
  {
    key: 'ecommerce-retail', label: 'E-commerce & Retail', group: 'consumer', kind: 'industry',
    words: [
      'e commerce', 'ecommerce', 'ecom', 'online store(s)', 'online retail', 'online retailer(s)', 'retail', 'retailer(s)',
      'amazon seller(s)', 'amazon fba', 'fba', 'dtc', 'd2c', 'direct to consumer', 'marketplace seller(s)', 'store manager(s)',
      'retail associate(s)', 'merchandising', 'merchandiser(s)', 'visual merchandiser(s)', 'retail buyer(s)', 'category manager(s)',
      'omnichannel', 'loss prevention', 'cashier(s)', 'grocery', 'supermarket(s)', 'convenience store(s)', 'department store(s)',
    ],
    companies: [
      'amazon$', 'amazon com', 'walmart', 'target$', 'target corporation', 'costco', 'home depot', 'lowes$', 'best buy', 'kroger',
      'publix', 'albertsons', 'safeway', 'whole foods', 'trader joes', 'aldi$', 'walgreens', 'cvs$', 'cvs pharmacy', 'macys',
      'nordstrom', 'kohls', 'tj maxx', 'tjx', 'ross stores', 'dollar general', 'dollar tree', 'family dollar', 'ikea', 'wayfair', 'etsy',
      'ebay', 'shopify', 'chewy', 'instacart', 'temu$', 'shein', 'alibaba', 'zappos', 'sephora', 'ulta', 'bath & body works',
      'victorias secret', 'gap$', 'gap inc', 'old navy', 'banana republic', 'h&m', 'zara$', 'inditex', 'uniqlo', 'petsmart', 'petco',
      'dicks sporting goods', 'academy sports', 'bjs wholesale', 'sams club', 'meijer', 'h e b', 'heb$', 'wegmans', 'winn dixie',
      '7 eleven', 'wawa$', 'sheetz', 'circle k', 'office depot', 'whatnot', 'poshmark', 'depop', 'stockx', 'bigcommerce', 'woocommerce',
    ],
    not: ['retail banking', 'retail bank(s)', 'retail investor(s)', 'retail real estate'],
  },
  {
    key: 'consumer-goods', label: 'Consumer Goods', group: 'consumer', kind: 'industry',
    words: [
      'cpg', 'consumer goods', 'consumer packaged goods', 'consumer products', 'fmcg', 'packaged food(s)', 'beverage brand(s)',
      'beverage company', 'brewery', 'breweries', 'winery', 'wineries', 'distillery', 'distilleries', 'craft beer', 'cosmetics', 'skincare',
      'skin care', 'beauty brand(s)', 'fragrance(s)', 'apparel', 'fashion', 'fashion brand(s)', 'fashion designer(s)', 'footwear',
      'jewelry', 'jewellery', 'consumer electronics', 'toy company', 'toys', 'home goods', 'household products', 'personal care',
      'pet food', 'confectionery', 'dtc brand(s)',
    ],
    companies: [
      'procter & gamble', 'p&g', 'unilever', 'nestle', 'pepsico', 'pepsi', 'coca cola', 'kraft heinz', 'general mills', 'kelloggs',
      'kellanova', 'mondelez', 'mars$', 'mars wrigley', 'hershey$', 'hershey company', 'colgate palmolive', 'kimberly clark', 'clorox', 'church & dwight',
      'estee lauder', 'loreal', 'lvmh', 'kering', 'nike', 'adidas', 'puma$', 'under armour', 'lululemon', 'new balance', 'levi strauss',
      'levis$', 'ralph lauren', 'tapestry$', 'michael kors', 'pvh$', 'tommy hilfiger', 'calvin klein', 'hanesbrands', 'vf corporation',
      'the north face', 'patagonia', 'yeti$', 'kenvue', 'haleon', 'reckitt', 'henkel', 'beiersdorf', 'shiseido', 'coty$', 'revlon',
      'elf beauty', 'glossier', 'fenty', 'rare beauty', 'olaplex', 'anheuser busch', 'ab inbev', 'molson coors', 'constellation brands',
      'diageo', 'pernod ricard', 'bacardi', 'brown forman', 'boston beer', 'heineken', 'red bull', 'monster beverage', 'celsius holdings',
      'keurig dr pepper', 'tyson foods', 'conagra', 'campbell soup', 'hormel', 'smucker', 'j m smucker', 'post holdings', 'danone',
      'chobani', 'hasbro', 'mattel', 'lego', 'spin master', 'funko', 'dyson$', 'whirlpool', 'sharkninja', 'newell brands', 'energizer',
      'duracell', 'gillette', 'dollar shave club', 'warby parker', 'allbirds',
    ],
    not: ['personal care aide(s)', 'personal care assistant(s)'],
  },
  {
    key: 'restaurants', label: 'Restaurants & Food Service', group: 'consumer', kind: 'industry',
    words: [
      'restaurant(s)', 'restaurateur(s)', 'chef(s)', 'sous chef(s)', 'executive chef(s)', 'head chef(s)', 'pastry chef(s)', 'line cook(s)',
      'culinary', 'catering', 'caterer(s)', 'food service', 'foodservice', 'food truck(s)', 'bakery', 'bakeries', 'pastry', 'cafe(s)',
      'coffee shop(s)', 'barista(s)', 'bartender(s)', 'bartending', 'mixologist(s)', 'sommelier(s)', 'waiter(s)', 'waitress',
      'waitresses', 'front of house', 'back of house', 'qsr', 'quick service restaurant(s)', 'fast casual', 'fast food', 'pizzeria',
      'diner', 'bistro', 'brewpub', 'taproom', 'grill', 'steakhouse', 'tavern', 'eatery', 'bbq', 'sushi', 'taqueria',
    ],
    companies: [
      'mcdonalds', 'starbucks', 'chick fil a', 'chipotle', 'taco bell', 'yum brands', 'kfc$', 'pizza hut', 'dominos', 'papa johns',
      'subway$', 'wendys', 'burger king', 'restaurant brands international', 'popeyes', 'tim hortons', 'dunkin', 'panera', 'darden',
      'olive garden', 'bloomin brands', 'outback steakhouse', 'texas roadhouse', 'cheesecake factory', 'chilis', 'brinker',
      'applebees', 'dine brands', 'ihop$', 'dennys', 'cracker barrel', 'red lobster', 'shake shack', 'sweetgreen', 'cava group',
      'wingstop', 'raising canes', 'five guys', 'in n out', 'jersey mikes', 'jimmy johns', 'firehouse subs', 'zaxbys', 'sysco',
      'us foods', 'aramark', 'compass group', 'sodexo', 'gordon food service', 'doordash', 'uber eats', 'grubhub', 'opentable',
      'first watch', 'buffalo wild wings', 'dave & busters',
    ],
  },
  {
    key: 'hospitality-travel', label: 'Hospitality & Travel', group: 'consumer', kind: 'industry',
    words: [
      'hospitality', 'hotel(s)', 'hotelier(s)', 'resort(s)', 'motel(s)', 'inn', 'lodging', 'vacation rental(s)', 'short term rental(s)',
      'airbnb host(s)', 'travel', 'travel agent(s)', 'travel agency', 'travel agencies', 'travel advisor(s)', 'tourism', 'tour operator(s)',
      'tour guide(s)', 'cruise', 'cruises', 'cruise line(s)', 'airline(s)', 'flight attendant(s)', 'airline pilot(s)',
      'commercial pilot(s)', 'concierge', 'guest services', 'guest experience', 'event planner(s)', 'event planning',
      'wedding planner(s)', 'venue(s)', 'theme park(s)', 'amusement park(s)', 'casino(s)', 'bed and breakfast', 'b&b', 'hostel(s)',
      'timeshare(s)',
    ],
    companies: [
      'marriott', 'hilton$', 'hilton hotels', 'hilton worldwide', 'hilton grand vacations', 'hyatt', 'ihg$', 'intercontinental hotels',
      'wyndham', 'choice hotels', 'best western', 'accor$', 'four seasons', 'ritz carlton', 'mgm resorts', 'caesars', 'wynn',
      'las vegas sands', 'hard rock', 'airbnb', 'vrbo', 'expedia', 'booking com', 'booking holdings', 'priceline', 'kayak$', 'tripadvisor',
      'navan$', 'delta air lines', 'delta airlines', 'american airlines', 'united airlines', 'southwest airlines', 'jetblue',
      'alaska airlines', 'spirit airlines', 'frontier airlines', 'allegiant', 'hawaiian airlines', 'lufthansa', 'british airways',
      'emirates$', 'qatar airways', 'air canada', 'carnival$', 'carnival cruise',
      'carnival corporation', 'royal caribbean', 'norwegian cruise line', 'disney parks',
      'walt disney world', 'universal orlando', 'universal destinations', 'universal parks', 'seaworld', 'united parks', 'six flags',
      'cedar fair', 'legoland', 'great wolf lodge', 'omni hotels', 'loews hotels', 'kimpton', 'vacasa', 'evolve vacation', 'hertz',
      'enterprise rent a car', 'enterprise mobility', 'avis', 'aimbridge', 'highgate hotels', 'sabre$',
    ],
    // A travel nurse works in a hospital, and concierge medicine is a clinic.
    not: ['travel nurse(s)', 'travel nursing', 'travel therapist(s)', 'travel rn', 'travel healthcare', 'concierge medicine',
      'concierge doctor(s)', ...HOBBY],
  },

  // ── Manufacturing, Energy & Logistics ─────────────────────────────────────
  {
    key: 'logistics', label: 'Logistics & Supply Chain', group: 'industry', kind: 'industry',
    words: [
      'logistics', 'supply chain', 'freight', 'freight broker(s)', 'freight brokerage', 'trucking', 'truck driver(s)', 'cdl',
      'truck dispatcher(s)', 'freight dispatcher(s)', 'fleet manager(s)', 'shipping', 'warehouse', 'warehouses', 'warehousing',
      'distribution center(s)', 'fulfillment', 'fulfillment center(s)', 'order fulfillment', 'last mile', '3pl',
      'third party logistics', 'procurement', 'strategic sourcing', 'supply planning', 'demand planning', 'demand planner(s)',
      'inventory management', 'transportation management', 'freight forwarding', 'freight forwarder(s)', 'customs broker(s)',
      'customs brokerage', 'import export', 'maritime', 'rail freight', 'railroad(s)', 'courier(s)', 'delivery driver(s)', 'forklift',
      'material handler(s)', 'logistician(s)',
    ],
    companies: [
      'fedex', 'ups$', 'united parcel service', 'usps$', 'united states postal service', 'dhl', 'xpo', 'ch robinson', 'c h robinson',
      'j b hunt', 'jb hunt', 'schneider national', 'werner enterprises', 'knight swift', 'old dominion freight', 'ryder',
      'penske logistics', 'penske truck', 'maersk', 'flexport', 'uber freight', 'project44', 'fourkites', 'samsara$',
      'manhattan associates', 'blue yonder', 'kinaxis', 'expeditors', 'kuehne nagel', 'db schenker', 'geodis', 'ceva logistics', 'gxo',
      'union pacific', 'bnsf', 'csx$', 'norfolk southern', 'landstar', 'echo global logistics', 'coyote logistics', 'tql$',
      'total quality logistics', 'estes express', 'saia$', 'shipbob', 'shipmonk', 'ontrac', 'lasership',
    ],
    not: ['data warehouse(s)', 'data warehousing'],
  },
  {
    key: 'manufacturing', label: 'Manufacturing', group: 'industry', kind: 'industry',
    words: [
      'manufacturing', 'manufacturer(s)', 'factory worker(s)', 'factory manager(s)', 'factory floor', 'plant manager(s)',
      'production supervisor(s)', 'machinist(s)', 'cnc', 'cnc machinist(s)', 'cnc programmer(s)', 'welder(s)', 'welding',
      'fabrication', 'fabricator(s)', 'metal fabrication', 'assembly line', 'industrial engineer(s)', 'manufacturing engineer(s)',
      'process engineer(s)', 'lean manufacturing', 'injection molding', 'plastics', 'machining', 'industrial automation', 'tool and die',
      'chemical company', 'chemical manufacturing', 'specialty chemicals', 'industrial manufacturing', 'steel', 'aluminum',
      'semiconductor manufacturing', 'oem',
    ],
    companies: [
      'general electric', 'ge$', 'honeywell', '3m$', '3m company', 'siemens', 'caterpillar', 'john deere', 'deere & company',
      'emerson electric', 'emerson$', 'rockwell automation', 'parker hannifin', 'eaton$', 'eaton corporation', 'illinois tool works',
      'itw$', 'dover corporation', 'cummins$', 'cummins inc', 'paccar', 'dow$', 'dow chemical', 'dupont$', 'dupont de nemours', 'basf', 'lyondellbasell', 'eastman chemical',
      'celanese', 'nucor', 'us steel', 'united states steel', 'alcoa', 'jabil', 'flex$', 'foxconn', 'hon hai', 'tsmc$',
      'taiwan semiconductor', 'applied materials', 'lam research', 'asml', 'corning', 'owens corning', 'ppg', 'sherwin williams',
      'kohler$', 'stanley black & decker', 'milwaukee tool', 'bosch', 'abb$', 'schneider electric', 'mitsubishi electric',
      'mitsubishi heavy', 'hitachi', 'komatsu', 'trane', 'carrier global', 'lennox$', 'lennox international', 'johnson controls', 'westinghouse',
    ],
  },
  {
    key: 'energy', label: 'Energy & Utilities', group: 'industry', kind: 'industry',
    words: [
      'energy', 'utilities', 'utility company', 'utility companies', 'electric utility', 'power plant(s)', 'power generation',
      'power grid', 'transmission and distribution', 'oil and gas', 'oil', 'petroleum', 'natural gas', 'lng', 'drilling', 'refinery',
      'refineries', 'oil pipeline(s)', 'gas pipeline(s)', 'renewable energy', 'renewables', 'solar', 'solar panel(s)', 'photovoltaic',
      'wind energy', 'wind power', 'wind farm(s)', 'offshore wind', 'hydroelectric', 'hydrogen', 'nuclear energy', 'nuclear power',
      'nuclear plant(s)', 'geothermal', 'battery storage', 'energy storage', 'ev charging', 'lineman', 'linemen', 'lineworker(s)',
      'energy efficiency', 'cleantech', 'clean energy', 'carbon capture', 'petroleum engineer(s)', 'reservoir engineer(s)', 'landman',
      'roughneck(s)',
    ],
    companies: [
      'exxonmobil', 'exxon', 'chevron', 'shell$', 'shell plc', 'shell oil', 'bp$', 'conocophillips', 'occidental petroleum',
      'marathon petroleum', 'valero', 'phillips 66', 'halliburton', 'schlumberger', 'slb$', 'baker hughes', 'kinder morgan',
      'enterprise products', 'florida power & light', 'fpl$', 'southern company', 'georgia power', 'pg&e', 'pacific gas and electric',
      'con edison', 'consolidated edison', 'edison international', 'southern california edison', 'entergy', 'aep$',
      'american electric power', 'exelon', 'sunrun', 'sunpower', 'sunnova', 'enphase', 'orsted', 'ørsted', 'vestas', 'siemens gamesa',
      'ge vernova', 'brookfield renewable', 'invenergy', 'avangrid', 'tampa electric', 'orlando utilities commission', 'mitsubishi power',
      'plug power',
    ],
    // Energy drinks, olive oil and "energy healing" aren't energy.
    not: ['energy drink(s)', 'monster energy', 'energy healer(s)', 'energy healing', 'energy work', 'positive energy', 'high energy',
      'olive oil', 'essential oil(s)', 'oil painting(s)', 'oil painter(s)', 'offensive lineman', 'defensive lineman'],
  },
  {
    key: 'automotive', label: 'Automotive', group: 'industry', kind: 'industry',
    words: [
      'automotive', 'dealership(s)', 'car dealership(s)', 'auto dealership(s)', 'auto dealer(s)', 'car dealer(s)', 'car sales',
      'auto sales', 'automobile(s)', 'auto parts', 'auto repair', 'auto body', 'collision repair', 'automotive technician(s)',
      'auto mechanic(s)', 'car mechanic(s)', 'diesel mechanic(s)', 'service advisor(s)', 'f&i', 'electric vehicle(s)',
      'autonomous vehicle(s)', 'autonomous driving', 'self driving', 'adas', 'motorsport(s)', 'car wash', 'car washes', 'tire', 'tires',
      'ev charging',
    ],
    companies: [
      'tesla', 'ford$', 'ford motor', 'general motors', 'stellantis', 'chrysler', 'jeep$', 'toyota', 'honda', 'nissan', 'hyundai', 'kia$',
      'kia motors', 'bmw', 'mercedes benz', 'volkswagen', 'audi$', 'porsche', 'volvo', 'subaru', 'mazda', 'mitsubishi motors', 'rivian',
      'lucid motors', 'lucid group', 'polestar', 'waymo', 'cruise automation', 'zoox', 'aurora innovation', 'carvana', 'carmax',
      'autonation', 'penske automotive', 'lithia', 'autozone', 'pep boys', 'goodyear', 'bridgestone', 'michelin', 'firestone$', 'firestone complete auto care',
      'magna international', 'aptiv', 'borgwarner', 'lear corporation', 'denso', 'harley davidson', 'polaris industries', 'cars com',
      'autotrader', 'truecar', 'copart', 'manheim',
    ],
  },

  // ── Government, Defense & Aerospace ───────────────────────────────────────
  {
    key: 'aerospace-defense', label: 'Aerospace & Defense', group: 'defense', kind: 'industry',
    words: [
      'aerospace', 'aerospace engineer(s)', 'aerospace engineering', 'defense', 'defence', 'defense contractor(s)', 'defense industry',
      'department of defense', 'dod', 'avionics', 'aviation', 'aircraft', 'aircraft mechanic(s)', 'a&p mechanic(s)', 'airframe',
      'propulsion', 'rocketry', 'spacecraft', 'satellite(s)', 'space industry', 'space systems', 'launch vehicle(s)', 'missile(s)',
      'munitions', 'weapons systems', 'uav', 'uavs', 'unmanned aircraft', 'unmanned aerial', 'counter uas', 'security clearance',
      'top secret', 'ts sci', 'secret clearance', 'itar', 'flight test', 'flight software', 'astronaut(s)',
    ],
    companies: [
      'lockheed', 'northrop grumman', 'boeing', 'raytheon', 'rtx$', 'general dynamics', 'l3harris', 'l3 harris', 'bae systems',
      'leidos', 'saic$', 'science applications international', 'booz allen', 'caci', 'mantech', 'parsons corporation',
      'huntington ingalls', 'textron', 'bell textron', 'sikorsky', 'pratt & whitney', 'spacex', 'blue origin', 'rocket lab',
      'relativity space', 'sierra space', 'axiom space', 'anduril', 'shield ai', 'palantir', 'kratos', 'aerovironment', 'elbit', 'thales',
      'airbus', 'embraer', 'bombardier', 'gulfstream', 'cessna', 'spirit aerosystems', 'nasa$', 'national aeronautics and space administration',
      'jpl$', 'jet propulsion laboratory', 'sandia', 'los alamos', 'lawrence livermore', 'mitre$', 'darpa', 'navair', 'navsea',
      'united launch alliance', 'maxar', 'planet labs', 'curtiss wright', 'heico', 'transdigm', 'hexcel',
    ],
    // A defense attorney is a lawyer, and a satellite office is just an office.
    not: ['defense attorney(s)', 'defense lawyer(s)', 'criminal defense', 'defense counsel', 'self defense', 'insurance defense',
      'dui defense', 'legal defense', 'defense litigation', 'public defender(s)', 'satellite office(s)', 'satellite campus',
      'satellite location(s)'],
  },
  {
    key: 'military', label: 'Military', group: 'defense', kind: 'industry',
    words: [
      'military', 'army', 'navy', 'air force', 'marine corps', 'usmc', 'marines', 'coast guard', 'uscg', 'national guard',
      'army national guard', 'air national guard', 'space force', 'armed forces', 'active duty', 'soldier(s)', 'airman', 'airmen',
      'infantry', 'infantryman', 'paratrooper(s)', 'special forces', 'green beret(s)', 'navy seal(s)', 'army ranger(s)',
      'commissioned officer(s)', 'noncommissioned officer(s)', 'nco', 'army officer(s)', 'naval officer(s)', 'navy officer(s)',
      'air force officer(s)', 'marine officer(s)', 'drill sergeant(s)', 'sergeant major', 'platoon', 'battalion', 'squadron',
      'reservist(s)', 'army reserve', 'navy reserve', 'air force reserve', 'rotc', 'cadet(s)', 'west point', 'naval academy',
      'air force academy', 'military intelligence',
    ],
    companies: [
      'us army', 'u s army', 'united states army', 'us navy', 'u s navy', 'united states navy', 'us air force', 'u s air force',
      'united states air force', 'usaf$', 'us marine corps', 'united states marine corps', 'us coast guard', 'united states coast guard',
      'us space force', 'u s space force', 'united states space force', 'british army', 'royal navy', 'royal air force', 'raf$',
      'royal marines', 'canadian armed forces', 'nato$',
    ],
    // Veterans work somewhere else now; the rest only borrow the words.
    not: ['veteran(s)', 'military spouse(s)', 'salvation army', 'old navy', 'navy federal', 'navy blue', 'navy pier', 'army of',
      'swiss army', 'battalion chief(s)'],
  },
  {
    key: 'government', label: 'Government & Public Sector', group: 'defense', kind: 'industry',
    words: [
      'government', 'federal government', 'state government', 'local government', 'public sector', 'public servant(s)',
      'civil servant(s)', 'civil service', 'municipal', 'municipality', 'municipalities', 'city council', 'council member(s)',
      'councilmember(s)', 'councilwoman', 'councilman', 'city manager(s)', 'county manager(s)', 'county commissioner(s)',
      'county commission', 'board of county commissioners', 'mayor', 'mayors office', 'legislator(s)', 'legislature', 'legislative',
      'state senator(s)', 'state representative(s)', 'congressman', 'congresswoman', 'congressional', 'member of congress',
      'house of representatives', 'white house', 'governors office', 'office of the governor', 'lieutenant governor',
      'federal agency', 'state agency', 'government agency', 'government agencies', 'police', 'police officer(s)',
      'police department(s)', 'sheriff', 'sheriffs office', 'deputy sheriff(s)', 'law enforcement', 'state trooper(s)',
      'highway patrol', 'firefighter(s)', 'fire department(s)', 'fire rescue', 'fire chief(s)', 'battalion chief(s)', 'public safety',
      '911 dispatcher(s)', 'emergency management', 'corrections officer(s)', 'correctional officer(s)', 'department of corrections',
      'probation officer(s)', 'parole officer(s)', 'postal service', 'veterans affairs', 'foreign service', 'foreign service officer(s)',
      'diplomat(s)', 'embassy', 'consulate', 'city planner(s)', 'urban planning', 'public administration', 'public policy',
      'federal employee(s)', 'state employee(s)', 'public works', 'parks and recreation',
    ],
    companies: [
      'city of', 'county of', 'town of', 'township of', 'village of', 'borough of', 'commonwealth of', 'government of',
      'usps$', 'united states postal service', 'internal revenue service', 'irs$', 'fbi$', 'federal bureau of investigation', 'cia$',
      'central intelligence agency', 'nsa$', 'national security agency', 'department of homeland security', 'dhs$', 'fema$', 'tsa$',
      'transportation security administration', 'us department of', 'u s department of', 'united states department of',
      'department of veterans affairs', 'social security administration', 'us census bureau', 'census bureau', 'gao$',
      'government accountability office', 'us senate', 'u s senate', 'united states senate', 'gsa$', 'general services administration',
      'epa$', 'environmental protection agency', 'fda$', 'food and drug administration', 'cdc$', 'centers for disease control',
      'nih$', 'national institutes of health', 'securities and exchange commission', 'ftc$', 'federal trade commission', 'fcc$',
      'federal communications commission', 'state department', 'department of state', 'united nations', 'european commission',
      'state of alabama', 'state of alaska', 'state of arizona', 'state of arkansas', 'state of california', 'state of colorado',
      'state of connecticut', 'state of delaware', 'state of florida', 'state of georgia', 'state of hawaii', 'state of idaho',
      'state of illinois', 'state of indiana', 'state of iowa', 'state of kansas', 'state of kentucky', 'state of louisiana',
      'state of maine', 'state of maryland', 'state of massachusetts', 'state of michigan', 'state of minnesota', 'state of mississippi',
      'state of missouri', 'state of montana', 'state of nebraska', 'state of nevada', 'state of new hampshire', 'state of new jersey',
      'state of new mexico', 'state of new york', 'state of north carolina', 'state of north dakota', 'state of ohio',
      'state of oklahoma', 'state of oregon', 'state of pennsylvania', 'state of rhode island', 'state of south carolina',
      'state of south dakota', 'state of tennessee', 'state of texas', 'state of utah', 'state of vermont', 'state of virginia',
      'state of washington', 'state of west virginia', 'state of wisconsin', 'state of wyoming',
    ],
    not: ['student government', 'city of hope'],
  },

  // ── Consulting, Legal & Services ──────────────────────────────────────────
  {
    key: 'legal', label: 'Legal', group: 'consulting', kind: 'function',
    // Companies of every kind have lawyers: a company is in legal when it is a
    // law firm, a legal service or a bar.
    words: [
      'law firm(s)', 'law office(s)', 'law group', 'legal services', 'attorney at law', 'attorneys at law', 'legaltech', 'legal tech',
      'bar association',
    ],
    roles: [
      'law', 'lawyer(s)', 'attorney(s)', 'legal', 'esq', 'esquire', 'paralegal(s)', 'legal assistant(s)', 'legal secretary',
      'litigator(s)', 'litigation', 'counsel', 'of counsel', 'legal counsel', 'associate attorney(s)', 'juris doctor', 'jd candidate(s)',
      'law student(s)', 'law clerk(s)', 'judicial clerk(s)', 'circuit judge(s)', 'district judge(s)', 'federal judge(s)', 'magistrate(s)',
      'district attorney(s)', 'public defender(s)', 'prosecutor(s)', 'e discovery', 'ediscovery', 'intellectual property',
      'patent attorney(s)', 'patent agent(s)', 'notary public', 'mediator(s)', 'arbitrator(s)', 'arbitration',
    ],
    companies: [
      'kirkland & ellis', 'latham & watkins', 'skadden', 'baker mckenzie', 'dla piper', 'sidley austin', 'white & case', 'jones day',
      'sullivan & cromwell', 'cravath', 'wachtell', 'davis polk', 'gibson dunn', 'paul weiss', 'simpson thacher', 'cooley$',
      'cooley llp', 'wilson sonsini', 'goodwin procter', 'ropes & gray', 'morgan lewis', 'morgan & morgan', 'greenberg traurig',
      'holland & knight', 'akerman llp', 'shutts & bowen', 'gunster', 'hogan lovells', 'norton rose fulbright', 'clifford chance',
      'freshfields', 'linklaters', 'allen & overy', 'a&o shearman', 'mayer brown', 'king & spalding', 'orrick', 'perkins coie',
      'fenwick & west', 'quinn emanuel', 'williams & connolly', 'weil gotshal', 'proskauer', 'debevoise', 'milbank',
      'covington & burling', 'arnold & porter', 'mcdermott will', 'fish & richardson', 'foley & lardner', 'bryan cave', 'littler',
      'jackson lewis', 'ogletree', 'fisher phillips', 'legalzoom', 'rocket lawyer', 'clio$', 'lexisnexis', 'westlaw',
    ],
    // In-house lawyers work for companies in every sector, and the police enforce the law.
    not: ['law enforcement', 'general counsel', 'in house counsel', 'corporate counsel', 'chief legal officer(s)'],
  },
  {
    key: 'management-consulting', label: 'Management Consulting', group: 'consulting', kind: 'function',
    // Consultants work inside companies too: a company is in consulting when
    // consulting is what it sells.
    words: ['management consulting', 'strategy consulting', 'business consulting', 'operations consulting', 'mbb', 'big four', 'big 4'],
    roles: ['management consultant(s)', 'strategy consultant(s)'],
    companies: [
      'mckinsey', 'boston consulting group', 'bcg$', 'bcg x', 'bain$', 'bain & company', 'deloitte', 'accenture', 'pwc$',
      'pricewaterhousecoopers', 'ey$', 'ey parthenon', 'ernst & young', 'kpmg', 'oliver wyman', 'kearney$', 'a t kearney',
      'roland berger', 'l e k consulting', 'lek consulting', 'booz allen hamilton', 'capgemini', 'ibm consulting', 'huron consulting',
      'alvarez & marsal', 'fti consulting', 'guidehouse', 'protiviti', 'west monroe partners', 'slalom', 'zs associates', 'gartner',
      'simon kucher', 'putnam associates', 'charles river associates', 'cornerstone research', 'analysis group', 'navigant', 'ankura',
      'the bridgespan group', 'dalberg',
    ],
  },
  {
    key: 'hr-recruiting', label: 'HR & Recruiting', group: 'consulting', kind: 'function',
    // Every company hires: a company is in recruiting when it is a staffing
    // agency, a search firm or an HR service.
    words: [
      'staffing agency', 'staffing agencies', 'staffing firm(s)', 'staffing company', 'staffing companies', 'recruitment agency',
      'recruitment agencies', 'recruiting agency', 'recruiting agencies', 'recruiting firm(s)', 'executive search', 'peo',
      'professional employer organization', 'rpo', 'recruitment process outsourcing', 'workforce solutions', 'hr tech', 'hrtech',
      'hr consulting',
    ],
    roles: [
      'human resources', 'human resource', 'hr', 'hris', 'hrbp', 'hr business partner(s)', 'people operations', 'people ops',
      'people & culture', 'talent acquisition', 'talent management', 'recruiter(s)', 'recruiting', 'recruitment', 'technical recruiter(s)',
      'headhunter(s)', 'staffing', 'talent sourcing', 'sourcer(s)', 'employer branding', 'compensation and benefits', 'total rewards',
      'benefits administration', 'payroll', 'hr consultant(s)', 'shrm', 'shrm cp', 'shrm scp', 'sphr', 'phr', 'learning and development',
      'l&d', 'organizational development', 'dei', 'diversity equity and inclusion', 'employee relations', 'labor relations',
    ],
    companies: [
      'robert half', 'randstad', 'adecco', 'manpowergroup', 'manpower$', 'kelly services', 'kforce', 'insight global', 'teksystems',
      'aerotek', 'allegis', 'korn ferry', 'spencer stuart', 'heidrick', 'egon zehnder', 'russell reynolds', 'michael page', 'pagegroup',
      'express employment', 'aya healthcare', 'amn healthcare', 'cross country healthcare', 'indeed$', 'glassdoor', 'ziprecruiter',
      'adp$', 'automatic data processing', 'paychex', 'paylocity', 'paycom', 'paycor', 'ukg$', 'justworks', 'trinet', 'insperity',
      'bamboohr', 'greenhouse software', 'culture amp', 'hirevue', 'cielo talent', 'alexander mann', 'hudson rpo', 'workday',
    ],
    not: ['24 hr'],
  },

  // ── Real Estate & Construction ────────────────────────────────────────────
  {
    key: 'real-estate', label: 'Real Estate', group: 'realestate', kind: 'industry',
    words: [
      'real estate', 'realtor(s)', 'realty', 'real estate agent(s)', 'property management', 'property manager(s)',
      'commercial real estate', 'cre', 'residential real estate', 'real estate investor(s)', 'real estate investing',
      'real estate investment(s)', 'reit(s)', 'leasing agent(s)', 'leasing consultant(s)', 'leasing specialist(s)', 'apartment leasing',
      'listing agent(s)', 'buyers agent(s)', 'title company', 'title insurance', 'escrow', 'land acquisition', 'real estate developer(s)',
      'real estate development', 'property development', 'property developer(s)', 'multifamily', 'multi family', 'investment property',
      'rental property', 'rental properties', 'home inspector(s)',
    ],
    names: ['properties'],
    companies: [
      'keller williams', 'coldwell banker', 're max', 'remax', 'century 21', 'compass$', 'redfin', 'zillow', 'opendoor', 'offerpad',
      'berkshire hathaway homeservices', 'howard hanna', 'douglas elliman', 'corcoran$', 'corcoran group', 'cbre', 'jll$',
      'jones lang lasalle', 'cushman & wakefield', 'colliers', 'newmark', 'marcus & millichap', 'eastdil', 'prologis',
      'simon property group', 'greystar', 'equity residential', 'avalonbay', 'camden property', 'invitation homes',
      'american homes 4 rent', 'costar', 'loopnet', 'apartments com', 'realpage', 'yardi', 'appfolio', 'wework', 'regus', 'iwg$',
      'first american', 'fidelity national financial', 'fidelity national title', 'old republic title', 'stewart title',
    ],
  },
  {
    key: 'construction-trades', label: 'Construction & Trades', group: 'realestate', kind: 'industry',
    words: [
      'construction', 'general contractor(s)', 'roofing contractor(s)', 'building contractor(s)', 'licensed contractor(s)',
      'electrical contractor(s)', 'plumbing contractor(s)', 'hvac contractor(s)', 'home builder(s)', 'homebuilder(s)',
      'custom home builder(s)', 'construction superintendent(s)', 'site superintendent(s)', 'project superintendent(s)',
      'general superintendent(s)', 'foreman', 'foremen', 'carpenter(s)', 'carpentry', 'electrician(s)', 'plumber(s)', 'plumbing', 'hvac',
      'roofer(s)', 'roofing', 'masonry', 'drywall', 'concrete', 'excavation', 'paving', 'landscaping', 'landscaper(s)',
      'landscape architect(s)', 'painting contractor(s)', 'handyman', 'remodeling', 'renovation(s)', 'home improvement', 'cabinetry',
      'flooring', 'estimator(s)', 'preconstruction', 'civil engineer(s)', 'civil engineering', 'structural engineer(s)',
      'structural engineering', 'architecture firm(s)', 'architectural', 'licensed architect(s)', 'registered architect(s)', 'bim',
      'journeyman', 'journeymen', 'ironworker(s)', 'welder(s)', 'heavy equipment operator(s)', 'crane operator(s)',
      'building inspector(s)',
    ],
    names: ['builders', 'contractors', 'contracting'],
    companies: [
      'bechtel', 'fluor', 'kiewit', 'skanska', 'whiting turner', 'gilbane', 'mortenson', 'mccarthy building', 'hensel phelps', 'aecom',
      'jacobs$', 'jacobs engineering', 'stantec', 'wsp$', 'wsp global', 'kimley horn', 'gensler', 'hok$', 'perkins&will',
      'perkins and will', 'skidmore owings', 'lennar', 'dr horton', 'd r horton', 'pulte', 'pultegroup', 'toll brothers', 'nvr$',
      'kb home', 'taylor morrison', 'meritage homes', 'david weekley homes', 'm i homes', 'ashton woods', 'vulcan materials',
      'martin marietta', 'cemex', 'summit materials', 'quikrete', 'united rentals', 'sunbelt rentals', 'herc rentals', 'angi$',
      'homeadvisor', 'thumbtack', 'emcor', 'quanta services', 'mastec', 'dycom', 'comfort systems', 'roto rooter', 'mr rooter',
    ],
    // Builders of brands and teams, and contractors to the government, aren't in construction.
    not: ['concrete results', 'under construction', 'brand builder(s)', 'team builder(s)', 'community builder(s)',
      'government contractor(s)', 'defense contractor(s)', 'independent contractor(s)', 'government contracting'],
  },

  // ── Nonprofit & Community ─────────────────────────────────────────────────
  {
    key: 'charities', label: 'Nonprofits & Charities', group: 'nonprofit', kind: 'industry',
    words: [
      'nonprofit(s)', 'non profit(s)', 'not for profit', 'not for profits', '501 c 3', '501c3', 'ngo', 'ngos', 'charity', 'charities',
      'charitable', 'philanthropy', 'philanthropies', 'philanthropic', 'humanitarian', 'grant writer(s)', 'grant writing',
      'grants manager(s)', 'major gifts', 'annual giving', 'planned giving', 'donor relations', 'volunteer coordinator(s)',
      'volunteer management', 'food bank(s)', 'food pantry', 'homeless shelter(s)', 'community organizer(s)', 'community foundation(s)',
      'social services',
    ],
    names: ['foundation'],
    companies: [
      'american red cross', 'red cross', 'united way', 'habitat for humanity', 'salvation army', 'goodwill$', 'goodwill industries', 'ymca', 'ywca',
      'boys & girls club', 'big brothers big sisters', 'make a wish', 'feeding america', 'meals on wheels', 'unicef', 'save the children',
      'world vision', 'doctors without borders', 'medecins sans frontieres', 'oxfam', 'world wildlife fund', 'the nature conservancy',
      'sierra club', 'american cancer society', 'american heart association', 'alzheimers association', 'march of dimes',
      'susan g komen', 'teach for america', 'americorps', 'peace corps', 'kiva$', 'givedirectly', 'wikimedia', 'aclu$',
      'american civil liberties union', 'amnesty international', 'human rights watch', 'special olympics', 'national urban league',
      'naacp', 'junior achievement', 'city year',
    ],
    // Companies named "Foundation" that aren't charities.
    not: ['foundation medicine', 'foundation capital', 'foundation building', 'foundation financial', 'foundation repair',
      'foundation model(s)'],
  },
  {
    key: 'faith', label: 'Faith & Ministry', group: 'nonprofit', kind: 'industry',
    words: [
      'church', 'churches', 'ministry', 'ministries', 'pastor(s)', 'senior pastor(s)', 'associate pastor(s)', 'youth pastor(s)',
      'worship leader(s)', 'worship pastor(s)', 'chaplain(s)', 'missionary', 'missionaries', 'ordained minister(s)', 'youth minister(s)',
      'priest(s)', 'deacon(s)', 'diocese', 'archdiocese', 'parish', 'parishes', 'synagogue(s)', 'rabbi(s)', 'mosque(s)', 'imam(s)',
      'seminary', 'seminarian(s)', 'theology', 'faith based', 'christian ministry',
    ],
    companies: [
      'the church of jesus christ', 'hillsong', 'cru$', 'campus crusade', 'young life', 'fellowship of christian athletes',
      'intervarsity', 'samaritans purse', 'compassion international', 'focus on the family', 'world relief', 'catholic relief services',
      'lutheran services',
    ],
    // A government ministry isn't a church.
    not: ['ministry of', 'ministries of'],
  },
];

// ── compiled once, when this file loads ─────────────────────────────────────

// Bump when how matching works changes (this file's code, not its lists): the
// version below then changes, and scores stamped with it are redone.
// 2: a function sector's roles count in a company's name only.
const MATCHING = 2;

// "Ex-", "Former", "Retired" parts of a headline say where someone was, the
// way lib/scoring.js reads them.
const FORMER = /^\s*(ex[-\s]|former(ly)?\b|previously\b|prev\b|past\b|retired\b)/i;
// "at Quillon", "@ Quillon": the company a part of a headline names, as
// lib/scoring.js finds it.
const AT = /(?:\s(?:at\s+|@\s*)|^@|\s@)(.+)$/i;
// After these, a headline says who someone works for, not what they do:
// "Marketing for dentists" is marketing, not dental.
const STOP = new Set(['for', 'helping', 'helps', 'serving', 'serves', 'supporting', 'empowering']);
// A name that says one of these only matches an education sector's companies.
const SCHOOL = new Set(['school', 'college', 'university', 'universidad']);

const APOSTROPHES = /['‘’ʼ]/g;
const ASCII = /^[\x00-\x7f]*$/;
const TOKENS_ASCII = /[a-z0-9]+(?:&[a-z0-9]+)*/g;
const TOKENS_ANY = /[\p{L}\p{N}]+(?:&[\p{L}\p{N}]+)*/gu;
const MARKS = /\p{M}+/gu;

/**
 * Text → the lowercase whole words every word, name and headline is compared
 * by. Accents and apostrophes go ("Nestlé" nestle, "McDonald's" mcdonalds);
 * other punctuation separates ("e-commerce" is e commerce, "RE/MAX" re max);
 * & joins only inside a word ("AT&T", "P&C"). "and" and a lone & are
 * dropped, so "Oil & Gas" and "oil and gas" are the same.
 */
export function wordsOf(text) {
  let s = String(text ?? '').toLowerCase().replace(APOSTROPHES, '');
  let re = TOKENS_ASCII;
  if (!ASCII.test(s)) {
    s = s.normalize('NFKD').replace(MARKS, '');
    re = TOKENS_ANY;
  }
  const out = [];
  for (const t of s.match(re) || []) if (t !== 'and') out.push(t);
  return out;
}

const variants = (w) => (w.endsWith('(s)') ? [w.slice(0, -3), `${w.slice(0, -3)}s`] : [w]);

const N = DIRECTORY.length;
const KEYS = DIRECTORY.map((s) => s.key);
const INDEX = new Map(KEYS.map((k, i) => [k, i]));
const EDUCATION = DIRECTORY.map((s) => s.group === 'education');

// Phrase (words joined by one space) → the sectors it marks.
const WORDS = new Map();
const NAME_WORDS = new Map();
const NOT = new Map();
// Every phrase's leading words, so a scan stops as soon as nothing can follow.
const LEADS = new Set();
// First word of a company pattern → [{ words, exact, sector }].
const PATTERNS = new Map();
let LONGEST = 1;

function index(map, list, i) {
  for (const w of list || []) {
    for (const v of variants(w)) {
      const words = wordsOf(v);
      if (!words.length) continue;
      const key = words.join(' ');
      const at = map.get(key) || [];
      if (!at.includes(i)) at.push(i);
      map.set(key, at);
      for (let n = 1; n < words.length; n++) LEADS.add(words.slice(0, n).join(' '));
      LONGEST = Math.max(LONGEST, words.length);
    }
  }
}

DIRECTORY.forEach((s, i) => {
  index(WORDS, s.words, i);
  index(NAME_WORDS, s.names, i);
  // A function sector's roles are jobs every kind of company has: they say
  // what a company is in its name ("Acme Recruiting"), never in a headline.
  index(s.kind === 'function' ? NAME_WORDS : WORDS, s.roles, i);
  index(NOT, s.not, i);
  for (const c of s.companies || []) {
    const exact = c.endsWith('$');
    let words = wordsOf(exact ? c.slice(0, -1) : c);
    if (words[0] === 'the') words = words.slice(1);
    if (!words.length) continue;
    const at = PATTERNS.get(words[0]) || [];
    at.push({ words, exact, sector: i });
    PATTERNS.set(words[0], at);
  }
});

const EMPTY = Object.freeze([]);

/**
 * Scan words for the list's phrases. Word hits count before `stop` (a
 * headline's "for", "helping"...); a phrase that cancels a sector counts
 * anywhere. `hits` and `vetoes` collect sector indexes.
 */
function scan(words, stop, withNames, hits, vetoes) {
  for (let i = 0; i < words.length; i++) {
    let phrase = words[i];
    for (let n = 1; ; n++) {
      if (i < stop) {
        const w = WORDS.get(phrase);
        if (w) for (const s of w) hits.add(s);
        if (withNames) {
          const nw = NAME_WORDS.get(phrase);
          if (nw) for (const s of nw) hits.add(s);
        }
      }
      const no = NOT.get(phrase);
      if (no) for (const s of no) vetoes.add(s);
      if (n >= LONGEST || i + n >= words.length || !LEADS.has(phrase)) break;
      phrase += ` ${words[i + n]}`;
    }
  }
}

/** Sector indexes found, less those cancelled, in the directory's order. */
function settle(hits, vetoes) {
  if (!hits.size) return EMPTY;
  const out = [];
  for (const s of hits) if (!vetoes.has(s)) out.push(s);
  return out.length ? out.sort((a, b) => a - b) : EMPTY;
}

/** The sectors a company's name places it in: its words, and the companies lists. */
function nameSectors(name) {
  const words = wordsOf(name);
  if (!words.length) return EMPTY;
  const hits = new Set();
  const vetoes = new Set();
  scan(words, words.length, true, hits, vetoes);
  // Aliases match from the start of a name, so a school's name could read as
  // another company's: "Chase College of Law" is not Chase the bank.
  const school = words.some((w) => SCHOOL.has(w));
  const start = words[0] === 'the' ? 1 : 0;
  for (const p of PATTERNS.get(words[start]) || []) {
    if (school && !EDUCATION[p.sector]) continue;
    const left = words.length - start;
    if (left < p.words.length || (p.exact && left !== p.words.length)) continue;
    let same = true;
    for (let k = 1; k < p.words.length && same; k++) same = words[start + k] === p.words[k];
    if (same) hits.add(p.sector);
  }
  return settle(hits, vetoes);
}

/**
 * A headline read once: its current parts ("Ex-" parts dropped), each with
 * the company it names (cleaned the way scoring cleans it, or null), and the
 * sectors its words say and cancel. `first` is the first part that names a
 * company, or -1. `clean` memoizes lib/scoring.js cleanCompany.
 */
function readHeadline(headline, clean) {
  const parts = [];
  let first = -1;
  for (const text of headlineParts(headline)) {
    if (FORMER.test(text)) continue;
    const at = AT.exec(text);
    const company = at ? clean(at[1]) : null;
    const words = wordsOf(text);
    let stop = words.length;
    for (let i = 0; i < words.length; i++) if (STOP.has(words[i])) { stop = i; break; }
    const hits = new Set();
    const vetoes = new Set();
    scan(words, stop, false, hits, vetoes);
    if (company && first < 0) first = parts.length;
    parts.push({ company, hits, vetoes });
  }
  return { parts, first };
}

/**
 * What a read headline says about one company its person works at. A part
 * that names a company counts for that company only: "Founder at Quillon |
 * Host at The Growth Podcast" doesn't make Quillon a podcast. The parts
 * before the first one that names a company describe the role there
 * ("Dentist | Owner at Smith Family Practice"); the parts after it are side
 * notes and don't count. When no part names a company, or not this one (it
 * came from a company scan), the leading parts are all there is, so they count.
 */
function sectorsAt(read, company) {
  const { parts, first } = read;
  const named = first >= 0 && parts.some((p) => p.company === company);
  const lead = first < 0 || !named || parts[first].company === company;
  const hits = new Set();
  const vetoes = new Set();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const counts = first < 0 || (lead && i < first) || (named && p.company === company);
    if (!counts) continue;
    for (const s of p.hits) hits.add(s);
    for (const s of p.vetoes) vetoes.add(s);
  }
  return settle(hits, vetoes);
}

const keysOf = (ids) => (ids.length ? ids.map((i) => KEYS[i]) : EMPTY);

/** The sectors a company's name alone places it in (keys, in the directory's order). */
export const sectorsInName = (name) => keysOf(nameSectors(name));

/**
 * The sectors a headline says someone works in (keys, in the directory's
 * order): at `company` if given, else across all its current parts.
 */
export function sectorsInHeadline(headline, company) {
  const read = readHeadline(headline, cleanCompany);
  return keysOf(sectorsAt(company === undefined ? { parts: read.parts, first: -1 } : read, company));
}

/**
 * A company's sectors, for one read of the network: pass the result to
 * lib/scoring.js readNetwork as `sectorsOf`, the way lib/companies.js
 * industryKeyOf is passed as `industryOf`. A company matches a sector when
 *   - its name has one of the sector's words (or names, or a function
 *     sector's roles: "Acme Recruiting"), or is one of its companies, or
 *   - at least half of its people here, and at least one, say one of the
 *     sector's words in what their headline says about this company
 *     (sectorsAt). For a one-person company, that person decides. A function
 *     sector's roles don't count here: "Recruiter at Acme Widgets" says what
 *     the person does, not what Acme is.
 * A company can match several sectors. `headlines` are those of the people
 * who work there now, one each (networkCompanies collects them). Each
 * headline is read once per matcher, however many companies it names.
 * @returns (name, headlines) → sector keys, in the directory's order
 */
export function sectorMatcher() {
  const cleaned = new Map();
  const clean = (text) => {
    if (!cleaned.has(text)) cleaned.set(text, cleanCompany(text));
    return cleaned.get(text);
  };
  const reads = new Map();
  const readOf = (h) => {
    let read = reads.get(h);
    if (!read) {
      read = readHeadline(h, clean);
      reads.set(h, read);
    }
    return read;
  };
  return function sectorsOf(name, headlines = []) {
    const byName = nameSectors(name);
    let counts = null;
    for (const h of headlines) {
      if (!h) continue;
      const ids = sectorsAt(readOf(h), name);
      if (!ids.length) continue;
      counts ||= new Uint32Array(N);
      for (const i of ids) counts[i]++;
    }
    if (!counts) return keysOf(byName);
    const out = [];
    for (let i = 0; i < N; i++) {
      if (byName.includes(i) || (counts[i] >= 1 && counts[i] * 2 >= headlines.length)) out.push(KEYS[i]);
    }
    return out.length ? out : EMPTY;
  };
}

// ── the directory as the page and the setting see it ───────────────────────

const GROUP = new Map(INDUSTRIES.map((g) => [g.key, g]));

/**
 * Everything Settings → Your sector can pick, in the order a choice is stored:
 * each broad industry, then its sectors.
 */
export const SECTOR_KEYS = Object.freeze(INDUSTRIES.flatMap((g) => [g.key, ...DIRECTORY.filter((s) => s.group === g.key).map((s) => s.key)]));

const BY_KEY = new Map([
  ...INDUSTRIES.map((g) => [g.key, Object.freeze({ key: g.key, label: g.label, color: g.color, group: g.key, kind: 'industry' })]),
  ...DIRECTORY.map((s) => [s.key, Object.freeze({
    key: s.key, label: s.label, color: GROUP.get(s.group)?.color || UNKNOWN_INDUSTRY.color, group: s.group, kind: s.kind,
  })]),
]);

/**
 * A pick's label and colour, for a broad industry or a directory sector, with
 * the industry it sits under and its kind: 'function' for a directory sector
 * of work every company has (HR & Recruiting, Legal…), else 'industry'.
 */
export function sectorByKey(key) {
  return BY_KEY.get(key) || { key, label: UNKNOWN_INDUSTRY.label, color: UNKNOWN_INDUSTRY.color, group: null, kind: null };
}

/** A pick's label, or nothing for a key that isn't one. */
export const sectorLabel = (key) => BY_KEY.get(key)?.label;

/** Is this a sector from the directory (rather than a broad industry)? */
export const isDirectoryKey = (key) => INDEX.has(key);

/**
 * The directory sectors most of your people work in, worked out locally from
 * the rows and their read (lib/scoring.js readNetwork with a sectorMatcher):
 * how many people (each once) work now at a company that matches, and how
 * many such companies there are. The biggest first; ties in the directory's
 * order. Sectors nobody matches are left out.
 * @returns [{ key, label, group, people, companies }]
 */
export function suggestSectors(rows = [], read, { limit = 5 } = {}) {
  if (!read) return [];
  const people = KEYS.map(() => new Set());
  const companies = new Uint32Array(N);
  for (const c of read.companies.values()) {
    if (!c.headcount || !c.sectors?.length) continue;
    for (const k of c.sectors) companies[INDEX.get(k)]++;
  }
  for (const r of rows) {
    const who = r.profile_url || `id:${r.id}`;
    for (const role of read.people.get(r)?.roles || []) {
      if (role.former || !role.company) continue;
      for (const k of read.companies.get(role.company)?.sectors || EMPTY) people[INDEX.get(k)].add(who);
    }
  }
  return DIRECTORY
    .map((s, i) => ({ key: s.key, label: s.label, group: s.group, people: people[i].size, companies: companies[i] }))
    .filter((s) => s.people > 0)
    .sort((a, b) => b.people - a.people || b.companies - a.companies || INDEX.get(a.key) - INDEX.get(b.key))
    .slice(0, limit);
}

// ── the version ─────────────────────────────────────────────────────────────

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Worked out from the list itself (and MATCHING), so any edit changes it and
 * nobody has to remember to bump it. A sector focus that picks from the
 * directory is stamped with it (lib/sector-focus.js focusFingerprint), so
 * scores computed with an older list are redone on the next load.
 */
export const DIRECTORY_VERSION = fnv1a(JSON.stringify([MATCHING, [...STOP], [...SCHOOL], DIRECTORY]));

for (const s of DIRECTORY) {
  for (const list of [s.words, s.roles, s.names, s.companies, s.not]) if (list) Object.freeze(list);
  Object.freeze(s);
}
Object.freeze(DIRECTORY);
