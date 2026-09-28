// The public company dataset (lib/scoring.js COMPANY_DATA): organizations the
// curated list leaves off, scored 6 to 8 from public facts, each with its
// source. Every entry reads as itself and from the ways people write it; no
// name is claimed by two entries across both lists; names that only look like
// an entry (a venue, a union, a namesake, a hospital) stay their own; and names
// written in styled letters, full-width bars or with a logo glyph read as the
// plain name. Public organizations and invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_COMPANIES, COMPANY_DATA, cleanCompany, companyScore, knownIndustry, currentCompany, scorePerson } from '../lib/scoring.js';
import { INDUSTRIES } from '../lib/companies.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = new Map(COMPANY_DATA.map(([name, score, alias, industry, source]) => [name, { score, alias, industry, source }]));
const BOTH = [...KNOWN_COMPANIES, ...COMPANY_DATA];

// Every entry of either list that claims a name as cleanCompany() reads it.
const SCHOOL_NAME = /\b(school|college|university)\b/;
function claims(name) {
  const lower = name.normalize('NFKC').toLowerCase();
  const bare = lower.replace(/^the /, '');
  const school = SCHOOL_NAME.test(lower);
  return BOTH
    .filter(([n, , alias, industry]) => (!school || industry === 'education') && (alias.test(lower) || alias.test(bare) || lower === n.toLowerCase()))
    .map(([n]) => n);
}

// Each entry and ways its name is written. (A comma ends a name as cleanCompany()
// reads it, so "University of California, Irvine" can't be one of them.)
const SPELLINGS = {
  Anduril: ['Anduril', 'Anduril Industries'],
  CoreWeave: ['CoreWeave', 'CoreWeave, Inc.'],
  'GE Vernova': ['GE Vernova', 'GE Gas Power', 'GE Renewable Energy', 'GE Grid Solutions'],
  LSEG: ['LSEG', 'London Stock Exchange Group', 'London Stock Exchange', 'Refinitiv', 'FTSE Russell'],
  MLB: ['MLB', 'Major League Baseball', 'MLB Network', 'MLB Advanced Media', 'MLB Network & NHL Network'],
  'Raymond James': ['Raymond James', 'Raymond James Financial', 'Raymond James & Associates'],
  'Siemens Energy': ['Siemens Energy', 'Siemens Energy AG', 'Siemens Gamesa'],
  'Simon Property Group': ['Simon Property Group', 'Simon Property', 'Simon Premium Outlets'],
  'U.S. Department of the Treasury': ['U.S. Department of the Treasury', 'US Department of the Treasury', 'Department of the Treasury', 'U.S. Treasury', 'US Treasury', 'treasury.gov'],
  'Universal Orlando': ['Universal Orlando', 'Universal Orlando Resort', 'Universal Studios Florida', 'Universal Epic Universe', "Universal's Islands of Adventure", 'Epic Universe'],
  'Universal Pictures': ['Universal Pictures', 'Universal Pictures International', 'Universal Filmed Entertainment Group'],
  AdventHealth: ['AdventHealth', 'Advent Health', 'AdventHealth Orlando', 'Florida Hospital'],
  AFRL: ['AFRL', 'Air Force Research Laboratory', 'Air Force Research Lab', 'U.S. Air Force Research Laboratory', 'AFOSR'],
  'AmTrust Financial': ['AmTrust', 'AmTrust Financial', 'AmTrust Financial Services', 'AmTrust North America'],
  'B&Q': ['B&Q', 'B & Q'],
  'Black & Veatch': ['Black & Veatch', 'Black and Veatch'],
  'CBS Sports': ['CBS Sports', 'CBS Sports Network', 'CBS Sports Digital', 'CBSSports.com'],
  'DISH Network': ['DISH', 'DISH Network', 'DISH & Sling TV', 'Sling TV'],
  EliseAI: ['EliseAI', 'Elise AI', 'MeetElise'],
  fal: ['fal', 'fal.ai', 'Fal AI'],
  Genpact: ['Genpact', 'Genpact India'],
  'Hotwire Communications': ['Hotwire Communications'],
  IMAX: ['IMAX', 'IMAX Corporation'],
  Lionsgate: ['Lionsgate', 'Lions Gate', 'Lionsgate Studios', 'Lions Gate Entertainment'],
  'Magnolia Network': ['Magnolia Network'],
  'NiCE Cognigy': ['NiCE Cognigy', 'Cognigy', 'Cognigy.AI'],
  'NSWC Dahlgren': ['Naval Surface Warfare Center Dahlgren Division', 'NSWC Dahlgren', 'NSWCDD'],
  'Orlando Health': ['Orlando Health', 'Orlando Regional Medical Center'],
  Polymarket: ['Polymarket', 'Polymarket US'],
  Roku: ['Roku', 'Roku, Inc.'],
  TEKsystems: ['TEKsystems', 'TEK Systems'],
  Temenos: ['Temenos', 'Temenos AG'],
  'Tufts University': ['Tufts', 'Tufts University', 'Tufts University School of Medicine'],
  'UC Irvine': ['UC Irvine', 'UCI', 'University of California Irvine'],
  'UC San Diego': ['UC San Diego', 'UCSD', 'University of California San Diego'],
  'UC Santa Barbara': ['UC Santa Barbara', 'UCSB', 'University of California Santa Barbara'],
  'Under Armour': ['Under Armour', 'Under Armour, Inc.', 'UnderArmour', 'Under Armor'],
  'University of Florida': ['UF', 'University of Florida', 'the University of Florida', "UF '28"],
  Vanta: ['Vanta'],
  'Versant Media': ['Versant Media', 'Versant Media Group'],
  Whatnot: ['Whatnot'],
  WWE: ['WWE', 'World Wrestling Entertainment'],
  'A-LIGN': ['A-LIGN', 'A LIGN'],
  'Aleph Group': ['Aleph Group', 'Aleph Holdings'],
  Angi: ['Angi', 'ANGI Homeservices', "Angie's List", 'HomeAdvisor'],
  Anomaly: ['Anomaly', 'Anomaly NYC', 'Anomaly London'],
  Astrion: ['Astrion'],
  Babylist: ['Babylist'],
  'D&AD': ['D&AD', 'Design and Art Direction'],
  'Even Realities': ['Even Realities'],
  Focusrite: ['Focusrite', 'Focusrite plc'],
  'Freedom Mortgage': ['Freedom Mortgage', 'Freedom Mortgage Corporation'],
  'Hard Rock Digital': ['Hard Rock Digital', 'Hard Rock Bet'],
  Kurdistan24: ['Kurdistan24', 'Kurdistan 24'],
  Later: ['Later', 'Later.com'],
  'National Trust for Scotland': ['National Trust for Scotland', 'The National Trust for Scotland'],
  'NewDay USA': ['NewDay USA', 'New Day USA', 'NewDay Financial'],
  'SRM Institute of Science and Technology': ['SRMIST', 'SRM Institute of Science and Technology', 'SRM University'],
  ThreatLocker: ['ThreatLocker', 'Threat Locker'],
  'University of Central Florida': ['UCF', 'University of Central Florida', 'the University of Central Florida', 'UCF ’26', 'UCF ‘26', 'UCF College of Business'],
  'University of Minnesota': ['University of Minnesota', 'UMN', 'University of Minnesota Twin Cities', 'University of Minnesota-Twin Cities'],
  'University of South Florida': ['University of South Florida', 'USF', 'USF Health', 'USF St. Petersburg'],
  Voloridge: ['Voloridge', 'Voloridge Investment Management'],
  'Wales Millennium Centre': ['Wales Millennium Centre', 'Wales Millennium Center'],
};

// Names that only look like an entry: a venue, a union, a namesake, a hospital,
// a sister campus, another company with the same first word.
const THEIR_OWN = [
  'Raymond James Stadium', 'Simon', 'Simon & Schuster', 'Simon-Kucher', 'Simon Business School',
  'LSE', 'London School of Economics', 'MLB Players Association', 'MLBPA', 'MLB The Show',
  'Hotwire', 'Hotwire.com', 'Hotwire PR', 'Sling', 'Versant', 'Versant Power', 'Versant Health',
  'Tufts Medical Center', 'Tufts Medicine', 'UCI Health', 'UC Irvine Health', 'UC San Diego Health', 'UCSF', 'UC Santa Cruz',
  'University of California', 'AdventHealth University', 'Adventist Health', 'Lions Gate Hospital', 'Freedom Mortgage Pavilion',
  'Freedom Debt Relief', 'National Trust', 'National Trust for Historic Preservation', 'SRM University AP',
  'University of Minnesota Duluth', 'University of San Francisco', 'US Foods', 'Hard Rock Cafe', 'Hard Rock International',
  'Hard Rock Hotel & Casino', 'AmTrust Bank', 'Orlando Magic', 'Orlando VA Healthcare System', 'Magnolia Pictures',
  'Magnolia Bakery', 'Magnolia Market', 'GE Aerospace', 'GE HealthCare', 'Universal Music Group', 'Universal Studios Hollywood',
  'Universal Studios Japan', 'HM Treasury', 'Treasury', 'Treasury Wine Estates', 'Air Force',
  'Naval Surface Warfare Center Carderock Division', 'Aleph', 'Aleph Farms', 'Aleph Alpha', 'Anomaly Six', 'Align Technology',
  'ANGI Energy Systems', 'Even Financial', 'Kurdistan Regional Government', 'NewDay', 'Later Media', 'Whatnot Antiques',
  'Vantage Data Centers', 'Specs',
];

test('every entry reads as itself, at its score, with an industry and a source', () => {
  const keys = new Set(INDUSTRIES.map((i) => i.key));
  const names = COMPANY_DATA.map(([name]) => name);
  assert.equal(new Set(names).size, names.length, 'no name twice');
  for (const [name, score, alias, industry, source] of COMPANY_DATA) {
    assert.ok(Number.isInteger(score) && score >= 6 && score <= 8, `${name} is ${score}`);
    assert.ok(alias instanceof RegExp && alias.source.startsWith('^') && !alias.flags.includes('g'), `${name}: ${alias}`);
    assert.ok(keys.has(industry), `${name}: ${industry}`);
    assert.ok(typeof source === 'string' && source.length > 8, `${name} says where its facts come from`);
    assert.equal(cleanCompany(name), name, name);
    assert.deepEqual(companyScore(name), { score, source: 'data' }, name);
    assert.equal(knownIndustry(name), industry, name);
  }
});

test('each entry reads from the ways its name is written', () => {
  assert.equal(Object.keys(SPELLINGS).length, COMPANY_DATA.length, 'every entry has spellings here');
  for (const [name, spellings] of Object.entries(SPELLINGS)) {
    assert.ok(DATA.has(name), `${name} is in the dataset`);
    for (const s of spellings) assert.equal(cleanCompany(s), name, s);
  }
});

test('no name is claimed by two entries, across both lists', () => {
  for (const [name] of BOTH) assert.deepEqual(claims(name), [name], name);
  for (const [name, spellings] of Object.entries(SPELLINGS)) {
    for (const s of spellings) {
      const c = claims(s.replace(/\s+['’‘]\d{2}$/, ''));
      assert.ok(c.length <= 1 && (c.length === 0 || c[0] === name), `${s}: ${c.join(', ')}`);
    }
  }
});

test('a name that only looks like an entry keeps its own', () => {
  for (const n of THEIR_OWN) {
    const c = cleanCompany(n);
    assert.ok(!c || !DATA.has(c), `${n} read as ${c}`);
  }
});

test('the curated list comes first, and the dataset sits between it and the network\'s estimate', () => {
  assert.deepEqual(companyScore('Google'), { score: 10, source: 'known' });
  assert.deepEqual(companyScore('Anduril'), { score: 8, source: 'data' });
  // Your own score beats both; many of your people don't move a fact.
  assert.deepEqual(companyScore('Anduril', { overrides: new Map([['Anduril', 9]]) }), { score: 9, source: 'yours' });
  assert.deepEqual(companyScore('Anduril', { headcount: 40 }), { score: 8, source: 'data' });
  assert.deepEqual(companyScore('Acme Robotics', { headcount: 40 }), { score: 6, source: 'network' });
  // In a headline, as for any company.
  const s = scorePerson({ headline: 'Director of Engineering at Anduril Industries' });
  assert.deepEqual([s.company, s.companyScore, s.companySource], ['Anduril', 8, 'data']);
});

test('styled letters, full-width bars and logo glyphs read as the plain name', () => {
  assert.equal(cleanCompany('𝗠𝗶𝗰𝗿𝗼𝘀𝗼𝗳𝘁'), 'Microsoft');
  assert.equal(cleanCompany('Apple '), 'Apple');
  assert.equal(cleanCompany('Snapchat｜ex-L\'Oréal｜ex-J&J'), 'Snap');
  assert.equal(cleanCompany('Meta Superintelligence Labs'), 'Meta');
  assert.equal(cleanCompany('Snapchat MENA Region'), 'Snap');
  assert.equal(cleanCompany('Snap Specs'), 'Snap');
  // …and in a whole headline, the title as well as the company.
  const p = scorePerson({ headline: '𝗖𝗘𝗢 at 𝗔𝗻𝗱𝘂𝗿𝗶𝗹 ｜ Builder' });
  assert.equal(currentCompany({ headline: '𝗖𝗘𝗢 at 𝗔𝗻𝗱𝘂𝗿𝗶𝗹 ｜ Builder' }), 'Anduril');
  assert.equal(p.title.level, scorePerson({ headline: 'CEO at Anduril' }).title.level);
});

test('the dataset\'s rule is written above it, and it never speaks for one person', () => {
  const src = readFileSync(path.join(ROOT, 'lib/scoring.js'), 'utf8');
  const start = src.indexOf('// ── the public company dataset');
  const end = src.indexOf('\n];\n', src.indexOf('export const COMPANY_DATA = ['));
  assert.ok(start > 0 && end > start, 'found the dataset');
  const text = src.slice(start, end);
  for (const words of ['from public facts', 'Never from anyone\'s scan', 'Organizations only', 'a personal brand is never listed']) {
    assert.ok(text.includes(words), words);
  }
  const comments = text.split('\n').map((line) => line.split('//')[1]).filter(Boolean);
  for (const c of comments) assert.doesNotMatch(c, /\byou(r|rs|'re)?\b/i, c.trim());
});

// Words that are many companies' first word, first names and job titles. An
// alias that matches one alone would score strangers' employers (or a title
// read as a company) as that entry.
const COMMON = [
  'united', 'national', 'american', 'america', 'general', 'global', 'international', 'first', 'southern', 'northern', 'western',
  'eastern', 'pacific', 'atlantic', 'central', 'midwest', 'principal', 'discover', 'progressive', 'target', 'ally', 'dominion',
  'express', 'capital', 'continental', 'liberty', 'freedom', 'pioneer', 'summit', 'apex', 'alpha', 'delta', 'omega', 'prime',
  'premier', 'advanced', 'applied', 'integrated', 'universal', 'standard', 'sterling', 'heritage', 'legacy', 'guardian', 'patriot',
  'eagle', 'phoenix', 'titan', 'atlas', 'mercury', 'apollo', 'orion', 'horizon', 'frontier', 'pinnacle', 'keystone', 'cornerstone',
  'anchor', 'harbor', 'bridge', 'beacon', 'compass', 'catalyst', 'momentum', 'insight', 'vision', 'genesis', 'spark', 'pulse', 'nova',
  'citizen', 'citizens', 'community', 'state', 'federal', 'county', 'city', 'energy', 'health', 'healthcare', 'medical', 'bank',
  'insurance', 'financial', 'services', 'group', 'holdings', 'partners', 'solutions', 'systems', 'technologies', 'labs', 'studio',
  'media', 'digital', 'foods', 'motors', 'airlines', 'army', 'navy', 'air force', 'marines', 'treasury', 'labor', 'commerce',
  'justice', 'defense', 'interior', 'education', 'transportation', 'agriculture', 'va', 'doe', 'dot', 'ed', 'fed', 'census', 'usc',
  'uw', 'osu', 'unc', 'um', 'msu', 'miami', 'georgia', 'michigan', 'texas', 'california', 'florida', 'penn', 'ohio', 'washington',
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles', 'mary', 'patricia', 'jennifer',
  'linda', 'elizabeth', 'susan', 'jessica', 'sarah', 'karen', 'simon', 'paul', 'mark', 'george', 'kelly', 'morgan', 'jordan',
  'director', 'manager', 'engineer', 'president', 'founder', 'partner', 'consultant', 'analyst', 'associate', 'lead', 'head',
  'chief', 'officer', 'specialist', 'coordinator', 'student', 'intern', 'freelance', 'self-employed', 'retired', 'owner', 'investor',
  'advisor', 'stealth', 'stealth startup', 'startup', 'company', 'confidential', 'later on', 'whatnot else',
];

test('no dataset name matches a common word, a first name or a job title alone', () => {
  for (const [name, , alias] of COMPANY_DATA) {
    for (const w of COMMON) assert.ok(!alias.test(w), `${name} would claim "${w}"`);
  }
});
