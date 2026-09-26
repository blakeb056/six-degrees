// The curated company list (lib/scoring.js KNOWN_COMPANIES): every name reads
// as itself, every company added from the sources in docs/brain/SCORING.md
// reads from the ways people write it, no two entries claim one name, names
// that only start like a listed company stay their own, and the written rule
// and scale still head the list. Public companies and invented ones; no people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_COMPANIES, cleanCompany, companyScore, knownIndustry, currentCompany, scoreNetwork, scorePerson } from '../lib/scoring.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = new Map(KNOWN_COMPANIES.map(([name, score, alias, industry]) => [name, { score, alias, industry }]));
const scorePersonAt = (headline) => scorePerson({ headline }).companyScore;

// The entries whose alias claims a name as cleanCompany() reads it: lowercase,
// with or without a leading "the", and a name that says it is a school only
// against schools (lib/scoring.js SCHOOL_NAME). Every entry is asked, not just
// the first that answers, so an overlap shows even where list order hides it.
const SCHOOL_NAME = /\b(school|college|university)\b/;
function claims(name) {
  const lower = name.toLowerCase();
  const bare = lower.replace(/^the /, '');
  const school = SCHOOL_NAME.test(lower);
  return KNOWN_COMPANIES
    .filter(([n, , alias, industry]) => (!school || industry === 'education') && (alias.test(lower) || alias.test(bare) || lower === n.toLowerCase()))
    .map(([n]) => n);
}

// Each addition and the ways its name is written, as they read once trimmed
// (no "Inc." or trailing punctuation; WRITTEN below has those).
const SPELLINGS = {
  // Private equity
  Blackstone: ['Blackstone', 'The Blackstone Group', 'Blackstone Group'],
  KKR: ['KKR', 'KKR &', 'Kohlberg Kravis Roberts'],
  'Apollo Global Management': ['Apollo Global Management', 'Apollo Global', 'Apollo Management'],
  // Health
  'CVS Health': ['CVS', 'CVS Health', 'CVS Pharmacy', 'CVS Caremark', 'CVSHealth'],
  Aetna: ['Aetna', 'Aetna Better Health'],
  Cigna: ['Cigna', 'The Cigna Group', 'Cigna Healthcare'],
  Humana: ['Humana', 'Humana Military'],
  'Elevance Health': ['Elevance Health', 'Elevance', 'Anthem', 'Anthem Blue Cross', 'Anthem Blue Cross and Blue Shield', 'Anthem Blue Cross Blue Shield'],
  'HCA Healthcare': ['HCA Healthcare', 'HCA', 'HCA Florida Healthcare', 'HCA Houston Healthcare'],
  'Kaiser Permanente': ['Kaiser Permanente', 'Kaiser', 'Kaiser Foundation Health Plan', 'Kaiser Foundation Hospitals'],
  Merck: ['Merck', 'Merck &', 'Merck Sharp & Dohme', 'Merck Animal Health'],
  AbbVie: ['AbbVie'],
  'Eli Lilly': ['Eli Lilly', 'Eli Lilly and Company', 'Lilly', 'Lilly USA'],
  'Bristol Myers Squibb': ['Bristol Myers Squibb', 'Bristol-Myers Squibb'],
  AstraZeneca: ['AstraZeneca'],
  Bayer: ['Bayer', 'Bayer U.S', 'Bayer Crop Science', 'Bayer Pharmaceuticals'],
  'Mayo Clinic': ['Mayo Clinic', 'Mayo Clinic Health System', 'Mayo Clinic Arizona'],
  'Cleveland Clinic': ['Cleveland Clinic', 'Cleveland Clinic Florida'],
  'Johns Hopkins Medicine': ['Johns Hopkins Medicine', 'The Johns Hopkins Hospital', 'Johns Hopkins Health System', 'Johns Hopkins HealthCare',
    "Johns Hopkins All Children's Hospital", 'Johns Hopkins Bayview Medical Center'],
  // Retail, food, hotels
  Costco: ['Costco', 'Costco Wholesale'],
  IKEA: ['IKEA', 'IKEA US', 'IKEA Retail'],
  Aldi: ['Aldi', 'ALDI US', 'Aldi Süd'],
  '7-Eleven': ['7-Eleven', '7 Eleven', '7Eleven'],
  'The Home Depot': ['The Home Depot', 'Home Depot'],
  Kroger: ['Kroger', 'The Kroger'],
  Walgreens: ['Walgreens', 'Walgreen', 'Walgreens Boots Alliance'],
  "Lowe's": ["Lowe's", 'Lowes', 'Lowe’s', "Lowe's Companies", "Lowe's Home Improvement"],
  Albertsons: ['Albertsons', 'Albertsons Companies'],
  TJX: ['TJX', 'The TJX Companies', 'TJ Maxx', 'TJMaxx'],
  'Dollar General': ['Dollar General'],
  'Dollar Tree': ['Dollar Tree', 'Dollar Tree Stores'],
  'Tyson Foods': ['Tyson Foods', 'Tyson'],
  'Nestlé': ['Nestlé', 'Nestle', 'Nestlé USA', 'Nestlé Purina PetCare'],
  'Anheuser-Busch': ['Anheuser-Busch', 'Anheuser Busch', 'AB InBev', 'Anheuser-Busch InBev'],
  Mars: ['Mars', 'Mars Wrigley', 'Mars Petcare'],
  "McDonald's": ["McDonald's", 'McDonalds', 'McDonald’s', "McDonald's USA"],
  Chipotle: ['Chipotle', 'Chipotle Mexican Grill'],
  'Kraft Heinz': ['Kraft Heinz', 'The Kraft Heinz Company', 'Kraft Foods'],
  'General Mills': ['General Mills'],
  Marriott: ['Marriott', 'Marriott International', 'Marriott Hotels & Resorts'],
  Hilton: ['Hilton', 'Hilton Worldwide', 'Hilton Hotels & Resorts'],
  // Automakers
  'General Motors': ['General Motors', 'General Motors Company', 'General Motors Financial'],
  Ford: ['Ford', 'Ford Motor', 'Ford Motor Company', 'Ford Motor Credit Company'],
  Volkswagen: ['Volkswagen', 'VW', 'Volkswagen Group of America', 'Volkswagen of America'],
  'Mercedes-Benz': ['Mercedes-Benz', 'Mercedes Benz', 'Mercedes-Benz USA', 'Mercedes-Benz Group'],
  BMW: ['BMW', 'BMW Group', 'BMW of North America', 'BMW Manufacturing'],
  Honda: ['Honda', 'American Honda', 'American Honda Motor', 'Honda North America', 'Honda Aircraft Company'],
  Hyundai: ['Hyundai', 'Hyundai Motor America', 'Hyundai Motor Company'],
  Nissan: ['Nissan', 'Nissan North America', 'Nissan Motor Corporation'],
  Kia: ['Kia', 'Kia America', 'Kia Motors', 'Kia Georgia'],
  // Airlines, telecoms, energy, shipping
  'Delta Air Lines': ['Delta Air Lines', 'Delta Airlines'],
  'United Airlines': ['United Airlines', 'United Airlines Holdings'],
  'American Airlines': ['American Airlines', 'American Airlines Group'],
  'Southwest Airlines': ['Southwest Airlines'],
  Verizon: ['Verizon', 'Verizon Wireless', 'Verizon Business'],
  'AT&T': ['AT&T', 'AT & T', 'AT&T Mobility'],
  'T-Mobile': ['T-Mobile', 'T Mobile', 'TMobile', 'T-Mobile US'],
  Comcast: ['Comcast', 'Comcast Cable', 'Comcast Business', 'Xfinity'],
  ExxonMobil: ['ExxonMobil', 'Exxon Mobil', 'Exxon'],
  Chevron: ['Chevron', 'Chevron U.S.A'],
  ConocoPhillips: ['ConocoPhillips'],
  Shell: ['Shell', 'Shell Oil Company', 'Shell USA'],
  BP: ['BP', 'BP America', 'British Petroleum'],
  UPS: ['UPS', 'United Parcel Service', 'UPS Supply Chain Solutions'],
  FedEx: ['FedEx', 'FedEx Express', 'FedEx Ground', 'FedEx Freight', 'Federal Express'],
  'Union Pacific': ['Union Pacific', 'Union Pacific Railroad'],
  DHL: ['DHL', 'DHL Express', 'DHL Supply Chain', 'DHL eCommerce'],
  // Insurance and mortgage finance
  'Berkshire Hathaway': ['Berkshire Hathaway'],
  GEICO: ['GEICO', 'Geico Insurance', 'Government Employees Insurance Company'],
  'State Farm': ['State Farm', 'State Farm Insurance', 'State Farm Agent', 'State Farm Mutual Automobile Insurance Company'],
  Allstate: ['Allstate', 'The Allstate', 'Allstate Insurance'],
  MetLife: ['MetLife'],
  Progressive: ['Progressive', 'Progressive Insurance', 'The Progressive'],
  'Prudential Financial': ['Prudential', 'Prudential Financial'],
  'New York Life': ['New York Life', 'New York Life Insurance Company'],
  Nationwide: ['Nationwide', 'Nationwide Insurance', 'Nationwide Mutual Insurance Company'],
  'Liberty Mutual': ['Liberty Mutual', 'Liberty Mutual Insurance'],
  USAA: ['USAA'],
  Travelers: ['Travelers', 'The Travelers Companies', 'Travelers Insurance'],
  'Fannie Mae': ['Fannie Mae'],
  'Freddie Mac': ['Freddie Mac'],
  // Computers and machinery
  Dell: ['Dell', 'Dell Technologies', 'Dell EMC'],
  HP: ['HP', 'Hewlett-Packard', 'Hewlett Packard'],
  Caterpillar: ['Caterpillar'],
  'John Deere': ['John Deere', 'Deere & Company', 'Deere'],
  // Law
  'Kirkland & Ellis': ['Kirkland & Ellis', 'Kirkland & Ellis LLP', 'Kirkland and Ellis'],
  'Latham & Watkins': ['Latham & Watkins', 'Latham & Watkins LLP'],
  'DLA Piper': ['DLA Piper', 'DLA Piper LLP'],
  'Baker McKenzie': ['Baker McKenzie', 'Baker & McKenzie'],
  Skadden: ['Skadden', 'Skadden Arps'],
  'Gibson Dunn': ['Gibson Dunn', 'Gibson Dunn & Crutcher LLP'],
  'Sidley Austin': ['Sidley Austin', 'Sidley', 'Sidley Austin LLP'],
  'White & Case': ['White & Case', 'White & Case LLP'],
  'Ropes & Gray': ['Ropes & Gray', 'Ropes & Gray LLP'],
  // Media
  Fox: ['Fox', 'Fox News', 'Fox News Channel', 'Fox Sports', 'Fox Entertainment', 'Fox Television Stations'],
  'The New York Times': ['The New York Times', 'New York Times', 'NYT', 'The New York Times Company'],
  Bloomberg: ['Bloomberg', 'Bloomberg LP', 'Bloomberg L.P', 'Bloomberg News', 'Bloomberg Industry Group'],
  // Universities
  'Princeton University': ['Princeton', 'Princeton University'],
  'Yale University': ['Yale', 'Yale University', 'Yale School of Management', 'Yale Law School', 'Yale University School of Medicine'],
  Caltech: ['Caltech', 'California Institute of Technology'],
  'Johns Hopkins University': ['Johns Hopkins', 'Johns Hopkins University', 'JHU', 'Johns Hopkins Carey Business School',
    'Johns Hopkins SAIS', 'Johns Hopkins School of Medicine'],
  'Northwestern University': ['Northwestern', 'Northwestern University'],
  'University of Pennsylvania': ['University of Pennsylvania', 'UPenn', 'Penn'],
  'Cornell University': ['Cornell', 'Cornell University', 'Cornell Tech'],
  'University of Chicago': ['University of Chicago', 'UChicago', 'University of Chicago Law School'],
  'Brown University': ['Brown', 'Brown University'],
  'Columbia University': ['Columbia University', 'Columbia Business School', 'Columbia Law School'],
  'Dartmouth College': ['Dartmouth', 'Dartmouth College'],
  UCLA: ['UCLA', 'University of California Los Angeles', 'UCLA Anderson School of Management'],
  'Rice University': ['Rice University'],
  'University of Notre Dame': ['University of Notre Dame', 'Notre Dame'],
  'Vanderbilt University': ['Vanderbilt', 'Vanderbilt University'],
};

// Entries from before the additions whose aliases were closed (September
// 2026) because other companies start with the same word: the forms their own
// companies use, which must still read as them.
const CLOSED = {
  Google: ['Google', 'Google LLC', 'Google Cloud', 'Google DeepMind', 'DeepMind', 'Alphabet'],
  Meta: ['Meta', 'Meta Platforms', 'Facebook', 'Instagram', 'WhatsApp', 'Reality Labs'],
  Amazon: ['Amazon', 'AWS', 'Amazon Web Services', 'Amazon Robotics'],
  'Coca-Cola': ['Coca-Cola', 'Coca Cola', 'The Coca-Cola Company', 'Coca-Cola North America'],
  'Goldman Sachs': ['Goldman Sachs', 'Goldman', 'Goldman Sachs Asset Management', 'Goldman Sachs Bank USA'],
  'JPMorgan Chase': ['JPMorgan Chase', 'JPMorgan', 'JP Morgan', 'Chase', 'Chase Bank', 'JPMorgan Chase & Co'],
  Sequoia: ['Sequoia', 'Sequoia Capital'],
  Adobe: ['Adobe', 'Adobe Systems'],
  Oracle: ['Oracle', 'Oracle America', 'Oracle Health', 'Oracle NetSuite', 'Oracle Cloud Infrastructure'],
  Uber: ['Uber', 'Uber Technologies', 'Uber Eats'],
  Snap: ['Snap', 'Snap Inc', 'Snapchat', 'Snapchat 👻'],
  Snowflake: ['Snowflake', 'Snowflake Computing'],
  'Capital One': ['Capital One', 'Capital One Financial', 'Capital One Bank'],
  Citi: ['Citi', 'Citigroup', 'Citibank', 'Citi Private Bank'],
  'Wells Fargo': ['Wells Fargo', 'Wells Fargo Advisors', 'Wells Fargo Bank'],
  'Bank of America': ['Bank of America', 'Merrill', 'Merrill Lynch', 'Merrill Lynch Wealth Management', 'Merrill Edge', 'Bank of America Merrill Lynch'],
  Fidelity: ['Fidelity', 'Fidelity Investments', 'Fidelity Institutional', 'Fidelity Management & Research Company'],
  PepsiCo: ['PepsiCo', 'Pepsi', 'Pepsi Beverages Company', 'PepsiCo Foods North America'],
  'Red Bull': ['Red Bull', 'Red Bull North America', 'Red Bull Racing'],
  'Warner Bros. Discovery': ['Warner Bros. Discovery', 'Warner Bros', 'Warner Brothers', 'Warner Bros Games', 'WarnerMedia', 'Warner Media', 'WBD'],
  Siemens: ['Siemens', 'Siemens USA', 'Siemens Digital Industries Software'],
  Mitsubishi: ['Mitsubishi', 'Mitsubishi Corporation', 'Mitsubishi Heavy Industries', 'Mitsubishi Electric', 'Mitsubishi Motors'],
  Toyota: ['Toyota', 'Toyota Motor North America', 'Toyota Motor Manufacturing Kentucky', 'Toyota Financial Services', 'Toyota Research Institute'],
  'Johnson & Johnson': ['Johnson & Johnson', 'Johnson and Johnson', 'J&J', 'Johnson & Johnson MedTech'],
  UnitedHealth: ['UnitedHealth', 'UnitedHealth Group', 'UnitedHealthcare', 'United Healthcare', 'Optum', 'OptumRx'],
  NASA: ['NASA', 'NASA Goddard Space Flight Center'],
  'Stanford University': ['Stanford', 'Stanford University', 'Stanford GSB', 'Stanford Graduate School of Business', 'Stanford Law School',
    'Stanford University School of Medicine', 'Stanford Doerr School of Sustainability'],
  'Harvard University': ['Harvard', 'Harvard University', 'Harvard Business School', 'Harvard Kennedy School', 'Harvard Medical School',
    'Harvard Law School', 'Harvard College', 'Harvard Graduate School of Design', 'Harvard School of Public Health'],
  Merck: ['Merck', 'Merck & Co', 'Merck Animal Health'],
  Paramount: ['Paramount', 'Paramount Global', 'Paramount Pictures', 'Paramount+', 'Paramount Skydance'],
  Nielsen: ['Nielsen', 'The Nielsen Company', 'Nielsen Holdings'],
  SiriusXM: ['SiriusXM', 'Sirius XM'],
  'Activision Blizzard': ['Activision', 'Activision Blizzard', 'Blizzard', 'Blizzard Entertainment'],
  MrBeast: ['MrBeast', 'Beast Industries'],
  Kellanova: ['Kellanova', "Kellogg's", 'Kellogg Company'],
  Campbell: ['Campbell', "Campbell's", 'Campbell Soup Company'],
  'Princeton University': ['Princeton', 'Princeton University', 'Princeton School of Architecture'],
  'Yale University': ['Yale', 'Yale College'],
  'Northwestern University': ['Northwestern', 'Northwestern University', 'Northwestern Feinberg School of Medicine'],
  'University of Pennsylvania': ['University of Pennsylvania School of Nursing'],
  'Cornell University': ['Cornell Law School'],
  'University of Chicago': ['University of Chicago Law School'],
  'Brown University': ['Brown School of Engineering'],
  'Columbia University': ['Columbia Journalism School'],
  'Rice University': ['Rice University School of Engineering'],
  'University of Notre Dame': ['Notre Dame University'],
  'Vanderbilt University': ['Vanderbilt', 'Vanderbilt University', 'Vanderbilt Law School', 'Vanderbilt Owen Graduate School of Management'],
};

// As people type them into LinkedIn, suffixes and all.
const WRITTEN = [
  ['Costco Wholesale Corporation', 'Costco'], ['The Home Depot, Inc.', 'The Home Depot'], ['The Kroger Co.', 'Kroger'],
  ['Walgreen Co.', 'Walgreens'], ["Lowe's Companies, Inc.", "Lowe's"], ['Tyson Foods, Inc.', 'Tyson Foods'],
  ['Exxon Mobil Corporation', 'ExxonMobil'], ['Chevron U.S.A. Inc.', 'Chevron'], ['Ford Motor Co.', 'Ford'],
  ['American Honda Motor Co., Inc.', 'Honda'], ['BMW Manufacturing Co., LLC', 'BMW'], ['Delta Air Lines, Inc.', 'Delta Air Lines'],
  ['AT&T Inc.', 'AT&T'], ['FedEx Corporation', 'FedEx'], ['United Parcel Service, Inc.', 'UPS'],
  ['Merck & Co., Inc.', 'Merck'], ['Kaiser Permanente, Northern California', 'Kaiser Permanente'], ['Aetna, a CVS Health Company', 'Aetna'],
  ['Anthem, Inc.', 'Elevance Health'], ['HP Inc.', 'HP'], ['Berkshire Hathaway Inc.', 'Berkshire Hathaway'],
  ['The Travelers Companies, Inc.', 'Travelers'], ['Prudential Financial, Inc.', 'Prudential Financial'],
  ['Skadden, Arps, Slate, Meagher & Flom LLP', 'Skadden'], ['KKR & Co. Inc.', 'KKR'], ['Apollo Global Management, Inc.', 'Apollo Global Management'],
  ['Fox Corporation', 'Fox'], ['Bloomberg L.P.', 'Bloomberg'], ['Mars, Incorporated', 'Mars'], ['7-Eleven, Inc.', '7-Eleven'],
  ['Nestlé 🍫', 'Nestlé'], ['Yale University | New Haven', 'Yale University'],
];

// Names that only start like a listed company, or share a word with one: a
// general manager, a franchise, a dealership, a venue, another company.
const NOT_LISTED = [
  'GM', 'General Manager', 'General Atlantic', 'General Catalyst',
  'The UPS Store', 'Ups and Downs Bakery',
  'Delta', 'Delta Dental', 'Delta Sigma Pi', 'Delta Faucet Company', 'United', 'United Wholesale Mortgage', 'American Family Insurance', 'Southwest Gas',
  'Ford Foundation', 'Ford & Harrison LLP', 'Ford Models',
  'Honda of Northwind', 'BMW of Northwind', 'Kia of Northwind', 'Mercedes-Benz of Northwind', 'Volkswagen of Northwind', 'Nissan of Northwind',
  'Hyundai Heavy Industries',
  'Apollo', 'Apollo.io', 'Apollo Hospitals', 'Apollo Education Group', 'Blackstone Products', 'Blackstone Valley Tech',
  "Kirkland's", 'Kirkland Signature', 'Latham Pool Products', 'Gibson Brands', 'Baker Tilly', 'White Castle',
  'Kaiser Aluminum', 'Kaiser Family Foundation', 'Anthem Sports & Entertainment', 'Merck KGaA', 'Merck Group', 'Lilly Pulitzer', 'Lilly Endowment',
  'Mayo Clinic Alix School of Medicine', 'Cleveland Clinic Lerner College of Medicine', 'Johns Hopkins Applied Physics Laboratory',
  'Lowes Foods', 'Chevron Phillips Chemical', 'Hewlett Packard Enterprise', 'Dell Medical School', "Dell Children's Medical Center",
  "Nationwide Children's Hospital", 'Progressive Leasing', 'Travelers Aid Society', 'Prudential Center',
  'Hilton Grand Vacations', 'Hilton Garden Inn', 'Hilton Head Island Realty', 'Marriott Vacations Worldwide', 'Marriott School of Business',
  'Fox Rothschild', 'Fox Chase Cancer Center', 'Fox Factory', 'Bloomberg Philanthropies', 'Berkshire Hathaway HomeServices', 'Berkshire Hathaway Energy', 'Shell Point',
  'State Farm Arena', 'State Farm Stadium', 'AT&T Stadium', 'AT&T Center', 'T-Mobile Arena', 'T-Mobile Park', 'MetLife Stadium', 'FedEx Field',
  'American Airlines Center', 'Allstate Arena', 'Kroger Field', 'Verizon Center', 'Kia Forum',
  'Northwestern Mutual', 'Northwestern Medicine', 'Northwestern College', 'Penn State', 'Penn State University', 'Penn Mutual', 'Penn Medicine',
  'Columbia', 'Columbia Sportswear', 'Columbia Records', 'Columbia College Chicago', 'Columbia Southern University',
  'Notre Dame College', 'Notre Dame de Namur University', 'Yale New Haven Health', 'Yale Appliance', 'Cornell Capital', 'Cornell College',
  'Brown & Brown', 'Brown Brothers Harriman', 'Brown Mackie College', 'Rice', 'Dartmouth Health', 'UCLA Health', 'Vanderbilt Health',
  'Princeton Plasma Physics Laboratory', 'Princeton Day School', 'University of Illinois Chicago', 'Chicago State University', 'California Institute of the Arts',
  'Mars Hill University',
  // Entries from before the additions, closed in September 2026: a company
  // that shares a name, a spun-off or separately run one, a bottler, a
  // dealership, a school's hospital, a venue, and a word.
  'Snap-on', 'Snap-on Incorporated', 'Snap Finance', 'Snap One', 'Snap Fitness', 'Snap Kitchen', 'Specs', 'Specs Optical',
  'SPECS Surface Nano Analysis', 'Specs Engineering',
  'Harvard Pilgrim Health Care', 'Harvard Maintenance', 'Harvard Bioscience', 'Harvard Elementary School', 'Harvard Club of Boston',
  'Stanford Health Care', "Stanford Children's Health", 'Stanford Medicine', 'Stanford Research Systems', 'Stanford Middle School',
  'Vanderbilt University Medical Center', 'Brown University Health', 'University of Pennsylvania Health System', 'University of Chicago Medicine',
  'Columbia University Irving Medical Center', 'University of Notre Dame Australia', 'Princeton High School', 'Yale Elementary School',
  'Kellogg Brown & Root', 'Fidelity National Financial', 'Fidelity National Information Services', 'FIS', 'Fidelity Bank',
  'Warner Music Group', 'Warner Robins', 'Warner Norcross + Judd', 'Warner Chilcott', 'J&J Snack Foods', 'Toyota of Orlando', 'Toyota of Northwind',
  'Toyota Tsusho America', 'Coca-Cola Consolidated', 'Coca-Cola Beverages Florida', 'Coca-Cola Bottling Co. United', 'Pepsi Bottling Ventures',
  'Citi Trends', 'Citi Field', 'Merrill Gardens', 'Merck Millipore', 'Campbell Clinic', 'Campbell Scientific',
  'Paramount Residential Mortgage Group', 'Paramount Group', 'Nielsen Norman Group', 'NielsenIQ', 'Chase Brass', 'Chase Design Studio',
  'Goldman Properties', 'Sequoia Health', 'Sequoia Consulting Group', 'Adobe Dental', 'Adobe Realty', 'Uber Freight', 'Oracle Elevator',
  'Siemens Energy', 'Siemens Healthineers', 'Siemens Gamesa', 'Mitsubishi UFJ Financial Group', 'Mitsubishi UFJ Trust and Banking',
  'Mitsubishi HC Capital', 'Mitsubishi Estate', 'Red Bull Arena', 'Capital One Arena', 'Wells Fargo Center',
  'Bank of America Stadium', 'AT&T Performing Arts Center', 'NASA Federal Credit Union', 'Meta Financial Group', 'Meta Materials',
  'Alphabet Soup Marketing', 'Amazon Conservation Association', 'Blizzard Snow Removal', 'MrBeast Burger', 'Snowflake Bakery',
];

test('every name on the list reads as itself, with its score and industry', () => {
  const names = KNOWN_COMPANIES.map(([name]) => name);
  assert.equal(new Set(names).size, names.length, 'no name twice');
  for (const [name, score, , industry] of KNOWN_COMPANIES) {
    // One letter is too short for cleanCompany to keep; "Twitter" and "X Corp" stand for it.
    if (name === 'X') continue;
    assert.equal(cleanCompany(name), name, name);
    assert.deepEqual(companyScore(name), { score, source: 'known' }, name);
    assert.equal(knownIndustry(name), industry, name);
  }
});

test('each company added from the sources reads from the ways its name is written', () => {
  assert.equal(Object.keys(SPELLINGS).length, 112, 'every addition has spellings here');
  for (const [name, spellings] of Object.entries(SPELLINGS)) {
    assert.ok(LIST.has(name), `${name} is on the list`);
    for (const s of spellings) assert.equal(cleanCompany(s), name, s);
  }
  for (const [written, name] of WRITTEN) assert.equal(cleanCompany(written), name, written);
});

test('no two entries claim one name: every listed name and spelling has one entry', () => {
  for (const [name] of KNOWN_COMPANIES) assert.deepEqual(claims(name), [name], name);
  for (const [name, spellings] of Object.entries(SPELLINGS)) {
    for (const s of spellings) assert.deepEqual(claims(s), [name], s);
  }
});

test('a name that only starts like a listed company keeps its own', () => {
  for (const n of NOT_LISTED) {
    const c = cleanCompany(n);
    assert.ok(!c || !LIST.has(c), `${n} read as ${c}`);
  }
});

test('entries closed because other companies share their first word still read in their own forms', () => {
  for (const [name, spellings] of Object.entries(CLOSED)) {
    assert.ok(LIST.has(name), `${name} is on the list`);
    for (const s of spellings) assert.equal(cleanCompany(s), name, s);
  }
  // …and a person there reads as working there, at its score.
  assert.deepEqual([currentCompany({ headline: 'Engineer at Snap Inc.' }), scorePersonAt('Director at Snap Inc.')], ['Snap', 8]);
  assert.deepEqual([currentCompany({ headline: 'Territory Manager at Snap-on' }), scorePersonAt('Territory Manager at Snap-on')], ['Snap-on', 4]);
  assert.deepEqual([currentCompany({ headline: 'Salesperson at Toyota of Orlando' }), scorePersonAt('Salesperson at Toyota of Orlando')], ['Toyota of Orlando', 4]);
});

test('a credential, a program or gig work on a listed company\'s platform is not a job there', () => {
  // As the first part of a headline, a listed company's name reads as the
  // person's employer; these aren't.
  for (const n of ['AWS Certified Solutions Architect', 'Google Developer Expert', 'Google Developer Groups', 'Google Premier Partner',
    'Google Alum', 'Meta Alumni', 'Microsoft MVP', 'Microsoft Certified Trainer', 'Microsoft for Startups', 'Salesforce Developer',
    'Salesforce Certified Administrator', 'Salesforce Consultant', 'Workday Consultant', 'Shopify Partner', 'Shopify Expert', 'Uber Driver',
    'Lyft Driver', 'DoorDash Dasher', 'Instacart Shopper', 'Airbnb Superhost', 'Airbnb Host', 'Twitch Streamer', 'Twitch Affiliate',
    'TikTok Creator', 'TikTok Shop Seller', 'YouTube Creator', 'Amazon Seller', 'Amazon FBA', 'Amazon Influencer', 'LinkedIn Top Voice',
    'LinkedIn Learning Instructor', 'Roblox Developer', 'Canva Creator', 'Discord Moderator', 'Nike Athlete', 'Red Bull Athlete',
    'Coca-Cola Scholar', 'Goldman Sachs 10,000 Small Businesses', 'Disney Fan', 'Tesla Enthusiast', "McDonald's Franchisee"]) {
    const c = cleanCompany(n);
    assert.ok(!LIST.has(c), `${n} read as ${c}`);
  }
  const at = (h) => currentCompany({ headline: h });
  // It read as a current role at Amazon (10): 5.0 for a senior IC anywhere.
  const aws = scorePerson({ headline: 'AWS Certified Solutions Architect | DevOps Engineer at Northwind Labs' });
  assert.deepEqual([aws.company, aws.companyScore, aws.tier], [null, 3, 'C']);
  assert.equal(at('LinkedIn Top Voice | Marketing Specialist at Pinecrest Foods'), 'Pinecrest Foods');
  assert.equal(at('Google Alum | Founder at Quillon'), 'Quillon');
  assert.equal(at('Uber Driver'), null);
  // Staff still read as staff, the firm's partners and consultants too.
  assert.equal(at('Driver at Uber'), 'Uber');
  assert.equal(at('Starbucks Partner'), 'Starbucks');
  assert.equal(at('Deloitte Consultant'), 'Deloitte');
  assert.equal(at('Partner at KKR'), 'KKR');
  assert.equal(cleanCompany('Uber Eats'), 'Uber');
  assert.equal(cleanCompany('TikTok Shop'), 'TikTok');
});

test('in a headline: "GM" is a title, "at home" is not a company, and Home Depot is one', () => {
  assert.equal(currentCompany({ headline: 'GM | Hospitality leader' }), null);
  assert.equal(currentCompany({ headline: 'GM at Northwind Grill' }), 'Northwind Grill');
  assert.equal(currentCompany({ headline: 'Stay at home mom | Former nurse' }), null);
  assert.equal(currentCompany({ headline: 'Sales Associate at Home Depot' }), 'The Home Depot');
  assert.equal(currentCompany({ headline: 'Registered Nurse at Kaiser' }), 'Kaiser Permanente');
  assert.equal(currentCompany({ headline: 'State Farm Agent' }), 'State Farm');
  assert.equal(currentCompany({ headline: 'Flight Attendant at Delta Dental' }), 'Delta Dental');
  assert.equal(cleanCompany('home'), null);
});

test('every alias matches from the start of a name', () => {
  // Each alternative at the top level of the pattern, outside groups and classes.
  const branches = (source) => {
    const out = [];
    let depth = 0;
    let inClass = false;
    let start = 0;
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '\\') { i++; continue; }
      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') inClass = true;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === '|' && depth === 0) { out.push(source.slice(start, i)); start = i + 1; }
    }
    return [...out, source.slice(start)];
  };
  for (const [name, , alias] of KNOWN_COMPANIES) {
    assert.ok(!alias.flags.includes('g') && !alias.flags.includes('y'), `${name}: a stateful flag would make test() skip matches`);
    for (const b of branches(alias.source)) assert.ok(b.startsWith('^'), `${name}: ${b}`);
  }
});

test('the written rule and the scale still head the list', () => {
  const src = readFileSync(path.join(ROOT, 'lib/scoring.js'), 'utf8');
  const head = src.slice(src.indexOf('// ── company ──'), src.indexOf('export const KNOWN_COMPANIES = ['))
    .split('\n').map((line) => line.replace(/^\/\/\s*(- )?/, '')).join(' ');
  for (const words of [
    'most US professionals would recognise it', 'a household-name brand;', 'a Fortune 500 company, or a public company as large;',
    'a top global VC, private equity, consulting, law or accounting firm;', 'a frontier AI lab;', 'a top national university.',
    '10 the largest tech platforms and the frontier AI labs, 9 elite (the most sought-after employers), 8 major, 7 well-known.',
    'Nothing on the list is below 7.', 'When in doubt, a company stays off', 'from named sources',
  ]) assert.ok(head.includes(words), words);
  for (const [name, score] of KNOWN_COMPANIES) assert.ok(Number.isInteger(score) && score >= 7 && score <= 10, `${name} is ${score}`);
});

test('additions score like their peers already on the list', () => {
  const s = (name) => LIST.get(name).score;
  // Private equity with Bain Capital; the largest law firms with the Big Four.
  for (const n of ['Blackstone', 'KKR', 'Apollo Global Management']) assert.equal(s(n), s('Bain Capital'), n);
  for (const n of ['Kirkland & Ellis', 'Latham & Watkins', 'Skadden', 'Ropes & Gray']) assert.equal(s(n), s('Deloitte'), n);
  // Universities by rank: the top five with Harvard, Stanford and MIT, 6 to 20 with Duke and UC Berkeley.
  for (const n of ['Princeton University', 'Yale University']) assert.equal(s(n), s('Harvard University'), n);
  for (const n of ['Caltech', 'Johns Hopkins University', 'University of Pennsylvania', 'UCLA', 'Vanderbilt University']) assert.equal(s(n), s('Duke University'), n);
  // The size of the Fortune 100 is 8, as for Walmart, UnitedHealth and Pfizer; smaller household names 7.
  for (const n of ['Costco', 'CVS Health', 'Ford', 'UPS', 'State Farm', 'Verizon', 'ExxonMobil', 'Kaiser Permanente']) assert.equal(s(n), s('Walmart'), n);
  for (const n of ['Mayo Clinic', 'Chipotle', 'Marriott', 'GEICO', 'The New York Times']) assert.equal(s(n), 7, n);
  // Smaller than the Fortune 100, but a restaurant company like Starbucks.
  assert.equal(s("McDonald's"), s('Starbucks'));
});

test('no company in the invented sample network reads as a listed one, so the list leaves its company scores alone', () => {
  const sample = JSON.parse(readFileSync(path.join(ROOT, 'public/demo-data.json'), 'utf8'));
  const rows = [...sample.degree1, ...sample.degree2];
  const companies = new Set(rows.map((r) => r.company).filter(Boolean));
  assert.ok(companies.size >= 15, 'read the sample');
  for (const c of companies) assert.equal(cleanCompany(c), c, c);
  // Scored with its own company scores, as scripts/gen-synthetic.mjs scores
  // it, every company score is the one the sample was built with.
  const overrides = new Map(rows.filter((r) => r.company).map((r) => [r.company, r.company_prestige_score]));
  const { scores } = scoreNetwork(rows, { overrides });
  for (const r of rows) assert.equal(scores.get(r.id).companyScore, r.company_prestige_score, r.id);
});
