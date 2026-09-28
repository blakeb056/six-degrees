// Kinds of people a review of the power score found it under-rating
// (docs/brain/SCORING.md, "What the review changed"): a title whose company is
// written without "at", managing directors and country heads written short,
// academics, an audience of one's own, a title the rules can't read, and a
// strong circle. And the other way: an award named for a title isn't the title.
// Invented people; public companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTitle, readRoles, scorePerson, scoreNetwork, bridgeBoost, LEVELS } from '../lib/scoring.js';

const key = (h) => readTitle(h).key;
const person = (headline, row = {}) => scorePerson({ headline, ...row });
const best = (h) => person(h).title.key;
const weight = (company) => 0.45 + 0.055 * company;
const round1 = (n) => Math.round(n * 10) / 10;
const GOVERNMENT = ['govLeader', 'govSenior', 'govOfficial', 'judge'];
const MILITARY = ['seniorGeneral', 'general', 'colonel', 'ltColonel', 'major', 'seniorEnlisted', 'nco'];

test('the company after "at" is where they work, not their title; "at" inside a word is a word', () => {
  // A company's words aren't read as a title ("Server at President Hotel" was a C-suite).
  // A job the rules don't list, at a company, "works there": an IC.
  for (const h of ['Server at President Hotel', 'Bartender at Chairman Grill', 'Receptionist at Chief Executive Partners',
    'Driver at Executive Limo Co', 'Associate at Owner Operator Supply']) {
    assert.equal(best(h), 'ic', h);
  }
  // …and a word that starts with "at" is no "at": these read as they always have.
  for (const [h, k] of [['Attorney', 'ic'], ['Staff Attorney', 'ic'], ['Attorney | Northwind', 'ic'], ['Senior Atmospheric Scientist', 'senior'],
    ['Flight Attendant Manager', 'manager']]) {
    assert.equal(best(h), k, h);
  }
  // What they do there still counts when it follows the company ("at Stripe as Head of Growth").
  assert.equal(best('Currently at Stripe as Head of Growth'), 'director');
  // A doctor "MD at" a hospital is a doctor; "MD at" a bank a managing director.
  assert.equal(best('MD at Mayo Clinic'), 'ic');
  assert.equal(best('MD at Goldman Sachs'), 'vp');
});

test('a company named after a title without "at" is where the title is held', () => {
  for (const [h, company] of [
    ['Global Category President | The Coca-Cola Company', 'Coca-Cola'],
    ['Global Category President - Coca-Cola', 'Coca-Cola'],
    ['Corporate VP, Samsung', 'Samsung'],
    ['SVP, Content Strategy | FOX Sports', 'Fox'],
    ['Head of Partnerships | Snap Inc.', 'Snap'],
    ['Associate Professor, UCF', 'University of Central Florida'],
  ]) assert.equal(person(h).company, company, h);
  // The same score as with "at": a president at Coca-Cola is S, not A.
  const bar = person('Global Category President | The Coca-Cola Company');
  assert.equal(bar.power, person('Global Category President at The Coca-Cola Company').power);
  assert.equal(bar.power, round1(10 * weight(9)));
  assert.equal(bar.tier, 'S');
});

test('…only a company the lists know, only for a current title without one, and a company scan\'s company first', () => {
  // Anything can follow a title: a hobby, a show, a region, a team.
  for (const h of ['Founder | Speaker | Dad', 'President, North America', 'Director, Content Strategy', 'CEO | Northwind Studios']) {
    assert.equal(person(h).company, null, h);
  }
  // Not over a company already said, not for a former role, not from a former part.
  assert.equal(person('CEO at Northwind | Coca-Cola').company, 'Northwind');
  assert.deepEqual(readRoles('Advisor | Former VP at Google | Coca-Cola').map((r) => r.company), [null, 'Google']);
  assert.equal(person('Founder | Ex-Coca-Cola').company, null);
  // A founder, an owner or a CEO leads a venture of their own: a big name after
  // the title is an accelerator, an investor, a school or a client.
  for (const h of ['Founder of Northwind | Coca-Cola', 'CEO of Northwind, Coca-Cola', 'Founder | Y Combinator', 'Founder & CEO | Stanford',
    'Owner | Goldman Sachs']) {
    assert.equal(person(h).company, null, h);
  }
  // A program, an award, a membership or a degree is not a job there, and a school
  // after a title that isn't an academic's is where they studied.
  for (const h of ['Head of Growth | AWS Community Builder', 'Director, Microsoft Alliance', 'VP Sales, Oracle Cloud Partner',
    'VP Marketing | Harvard MBA', 'VP Marketing | Harvard', 'Chief of Staff | Stanford GSB', 'Director | MIT', 'CEO | Forbes 30 Under 30']) {
    assert.equal(person(h).company, null, h);
  }
  // …but a partner at a firm is one of its partners.
  assert.equal(person('Managing Partner | Sequoia').company, 'Sequoia');
  // A company scan knows better than a guess from the headline; "at" still wins over both.
  assert.equal(person('Category President | Coca-Cola', { scanned_company: 'Northwind Beverages' }).company, 'Northwind Beverages');
  assert.equal(person('Category President | Coca-Cola', { company: 'Northwind Beverages' }).company, 'Coca-Cola');
  assert.equal(person('President at Coca-Cola', { scanned_company: 'Northwind Beverages' }).company, 'Coca-Cola');
});

test('managing directors and country heads written short are senior', () => {
  for (const h of ['MD at Goldman Sachs', 'MD @ J.P. Morgan', 'MD, Investment Banking at Goldman Sachs',
    'Head of Country, Brazil - Snap', 'Country Head, India at Google']) {
    assert.equal(key(h), 'vp', h);
  }
  assert.equal(person('Head of Country, Brazil - Snap').company, 'Snap');
  // A medical degree is not a managing director.
  for (const h of ['MD, MBA | Physician Executive', 'Physician, MD', 'MD Candidate at Emory University', 'MD/PhD Student', 'Pediatrician | MD']) {
    assert.notEqual(best(h), 'vp', h);
  }
});

test('an award named for a title is not the title', () => {
  for (const [h, k] of [
    ["Account Executive at Oracle | 3x President's Club", 'ic'],
    ['Chairman’s Award winner | Engineer at Northwind', 'ic'],
    ["Chief of Staff, CEO's Office at Northwind", 'director'],
    ["Dean's List | Marketing Coordinator at Northwind", 'ic'],
    ["Chancellor's Fellow | Analyst at Northwind", 'ic'],
  ]) assert.equal(best(h), k, h);
});

test('academic titles, from assistant professor to provost', () => {
  for (const [h, k] of [
    ['Professor (Emeritus)', 'professor'],
    ['Professor Emeritus at Stanford University', 'professor'],
    ['Distinguished Professor at Georgia Tech', 'professor'],
    ['Prof. of Economics at Duke University', 'professor'],
    ['Associate Professor of Biology at Emory University', 'associateProfessor'],
    ['Assistant Professor at the University of Florida', 'assistantProfessor'],
    ['Clinical Assistant Professor at NYU', 'assistantProfessor'],
    ['Adjunct Professor at NYU', 'ic'],
    ['Lecturer in Mathematics at NYU', 'ic'],
    ['Dean, College of Engineering at the University of Florida', 'dean'],
    ['Founding Dean of the School of Design', 'dean'],
    ['Associate Dean for Research at Duke University', 'director'],
    ['Chair, Department of Physics at Emory University', 'director'],
    ['Vice Provost for Research at Duke University', 'vp'],
    ['Provost at Duke University', 'csuite'],
    ['Chancellor at UC Berkeley', 'csuite'],
  ]) assert.equal(key(h), k, h);
  // Points on the same ladder as everyone's: an assistant professor like a senior
  // IC, an associate like a manager, a professor like a director, a dean like a VP.
  assert.deepEqual(['assistantProfessor', 'associateProfessor', 'professor', 'dean'].map((k) => LEVELS[k].points), [5, 6.5, 7.5, 9]);
  // Not a professor: working for one; a company's name is no dean.
  for (const h of ['Research Assistant to Professor Chen at MIT', 'Teaching Assistant for a Professor at NYU', 'Engineer at Dean Foods']) {
    assert.equal(key(h), 'ic', h);
  }
  // A professor emeritus at a top university is A on the fixed scale, not C.
  const emeritus = person('Professor (Emeritus)', { company: 'Stanford University' });
  assert.equal(emeritus.power, round1(7.5 * weight(8)));
  assert.equal(emeritus.tier, 'A');
});

test('an audience of one\'s own counts like a title: 100K+ a manager\'s, 1M+ a director\'s, 10M+ a VP\'s', () => {
  for (const h of ['Creator | 2.5M+ followers | Speaker', 'Content creator with 2.5M+ followers across TikTok and YouTube',
    'Sports media | 1M+ followers', 'Creator · 2,500,000 followers', 'Creator | 2.5 million followers',
    'Podcast host | 1.2M monthly listeners', 'Writer | 1M+ newsletter readers', 'Gaming | 1.5M YouTube subscribers',
    'Comedian | 3M+ on TikTok']) {
    assert.equal(best(h), 'audience1m', h);
  }
  assert.equal(best('Creator | 500K followers'), 'audience100k');
  assert.equal(best('Creator | 12M followers'), 'audience10m');
  assert.deepEqual(['audience100k', 'audience1m', 'audience10m'].map((k) => LEVELS[k].points), [6.5, 7.5, 9]);
  // Not their own audience: views and users are a campaign's or a product's, and a
  // brand grown or accounts managed are someone else's. And under 100K is no title.
  for (const h of ['Creator, 12M+ views', 'Founder | 2M+ users', 'Social Media Manager | Grew our TikTok to 2M followers',
    'Social media | Managed accounts with 10M+ combined followers', 'Creator | 50K followers']) {
    assert.ok(!best(h).startsWith('audience'), h);
  }
  // A 2.5M creator is A on the fixed scale: 7.5 × 0.725, plus the reach bonus, halved.
  const creator = person('Creator | 2.5M+ followers | Speaker');
  assert.equal(creator.power, round1(7.5 * weight(5) + 0.4));
  assert.equal(creator.tier, 'A');
  assert.equal(creator.title.label, 'Audience of 1M+');
  // An audience has no employer: a stored company goes to their title, not to it.
  assert.equal(person('2M followers | Creator', { company: 'Northwind' }).company, null);
  // A VP with an audience still scores as the VP.
  assert.equal(best('VP Marketing at Google | 2M followers'), 'vp');
  // Written out in full, a million is still "reach in the millions".
  assert.deepEqual(person('Creator · 2,500,000 followers').bonus.reasons, ['reach in the millions', 'halved: unknown company']);
});

test('a title the rules can\'t read counts as the most common job, not below it', () => {
  const s = person('Studio / Show');
  assert.equal(s.title.key, 'unknown');
  assert.equal(LEVELS.unknown.points, LEVELS.ic.points);
  assert.equal(s.power, round1(4 * weight(5)));
  assert.equal(s.tier, 'C');
});

test('a strong circle lifts its bridge by its share of strong people, or by how many there are, up to +2', () => {
  // `strong` people at S or A (a third of them S), the rest C.
  const circle = (size, strong) => Array.from({ length: size }, (_, i) => ({ tier: i < strong ? (i % 3 ? 'A' : 'S') : 'C' }));
  // A big circle: its share (12%) says nothing, its 72 strong people do. +1 for every 25, up to +2.
  assert.equal(bridgeBoost(circle(600, 72)).boost, 2);
  assert.equal(bridgeBoost(circle(300, 36)).boost, 1.4);
  // An elite share counts as it did: 40% of 40 is +1.
  assert.equal(bridgeBoost(circle(40, 16)).boost, 1);
  // A small circle's share is too small to judge, but its strong people are there.
  assert.equal(bridgeBoost(circle(10, 10)).boost, 0.4);
  assert.equal(bridgeBoost(circle(300, 0)).boost, 0);
  // A vague title at a big company with 72 strong people in their circle: A, not C.
  const rows = [
    { id: 'b', degree: 1, headline: 'Strategy', company: 'Samsung', profile_url: '/in/b' },
    ...circle(600, 72).map(({ tier }, i) => ({
      id: `p${i}`, degree: 2, source_connection_id: 'b', profile_url: `/in/p${i}`,
      headline: tier === 'C' ? 'Analyst at Northwind' : 'VP at Google',
    })),
  ];
  const b = scoreNetwork(rows).scores.get('b');
  assert.equal(b.boost, 2);
  assert.equal(b.power, round1(round1(4 * weight(8)) + 2));
  assert.equal(b.tier, 'A');
});

// Government and military titles count only where a title is written, at the
// start of a part (lib/scoring.js officeTitle). The cases below include what
// four independent reviews of the first version found: its misses, and the
// staffers, veterans, clubs and companies it read as officials and officers.
test('government titles, from a city councilmember to a senator', () => {
  for (const [h, k] of [
    ['U.S. Senator', 'govLeader'],
    ['Senator, U.S. Senate', 'govLeader'],
    ['Member of Congress', 'govLeader'],
    ['Congresswoman, U.S. House of Representatives', 'govLeader'],
    ['Representative, U.S. House of Representatives', 'govLeader'],
    ["Representative, Texas's 21st Congressional District", 'govLeader'],
    ["U.S. Representative for Florida's 10th District", 'govLeader'],
    ['Governor of Florida', 'govLeader'],
    ['Governor | State of Florida', 'govLeader'],
    ['Mayor of Orlando', 'govLeader'],
    ['County Executive, Montgomery County, Maryland', 'govLeader'],
    ['Secretary of Commerce', 'govLeader'],
    ['Secretary of the Army', 'govLeader'],
    ['Attorney General of Florida', 'govLeader'],
    ['Director of National Intelligence', 'govLeader'],
    ['Deputy Secretary of Defense', 'govSenior'],
    ['Deputy Secretary | U.S. Department of Labor', 'govSenior'],
    ['Under Secretary of State for Economic Affairs', 'govSenior'],
    ['Assistant Secretary of the Army for Acquisition', 'govSenior'],
    ['Lieutenant Governor of Florida', 'govSenior'],
    ['Deputy Mayor for Economic Development', 'govSenior'],
    ['Secretary of State of Colorado', 'govSenior'],
    ['State Senator, Florida Senate', 'govSenior'],
    ['Senator, Texas State Senate', 'govSenior'],
    ['State Representative, Florida House of Representatives', 'govSenior'],
    ['Member of the Maryland House of Delegates', 'govSenior'],
    ['Assemblymember, California State Assembly', 'govSenior'],
    ['Speaker, Tennessee House of Representatives', 'govSenior'],
    ['State Treasurer, Commonwealth of Pennsylvania', 'govSenior'],
    ['Commissioner, Florida Department of Education', 'govSenior'],
    ['Commissioner of Health', 'govSenior'],
    ['U.S. Ambassador to Japan', 'govSenior'],
    ['Ambassador of the United States to the Republic of Chile', 'govSenior'],
    ['Permanent Representative of the United States to the United Nations', 'govSenior'],
    ['Inspector General, Department of Veterans Affairs', 'govSenior'],
    ['Program Executive Officer, PEO STRI', 'govSenior'],
    ['SES Member, U.S. Department of Homeland Security', 'govSenior'],
    ['Administrator, U.S. Small Business Administration', 'govSenior'],
    ['Chair, U.S. Securities and Exchange Commission', 'govSenior'],
    ['District Attorney, Harris County', 'govSenior'],
    ['Associate Attorney General, U.S. Department of Justice', 'govSenior'],
    ['Deputy Attorney General of the United States', 'govSenior'],
    ['Police Chief, City of Orlando', 'govSenior'],
    ['Judge, U.S. District Court', 'judge'],
    ['Circuit Judge, Ninth Judicial Circuit', 'judge'],
    ['Associate Justice, Supreme Court of Florida', 'judge'],
    ['State Supreme Court Justice', 'judge'],
    ['Deputy Assistant Secretary of Defense for Readiness', 'govOfficial'],
    ['Deputy Associate Attorney General, U.S. Department of Justice', 'govOfficial'],
    ['City Council Member, City of Orlando', 'govOfficial'],
    ['Council Member | Austin City Council', 'govOfficial'],
    ['Orange County Commissioner', 'govOfficial'],
    ['Commissioner, Orange County Board of County Commissioners', 'govOfficial'],
    ['Planning Commissioner, City of Irvine', 'govOfficial'],
    ['Mayor Pro Tem, City of Plano', 'govOfficial'],
    ['School Board Member, Broward County Public Schools', 'govOfficial'],
    ['Sheriff, Orange County', 'govOfficial'],
    ['Orange County Sheriff', 'govOfficial'],
    ['SVP & General Counsel at Northwind', 'vp'],
    ['Associate General Counsel at Google', 'director'],
    ['Assistant Attorney General, State of Florida', 'senior'],
    ['Assistant Attorney General at Florida Office of the Attorney General', 'senior'],
    ['Deputy Attorney General, State of California', 'senior'],
    ['Assistant Chief Counsel at U.S. Immigration and Customs Enforcement', 'senior'],
  ]) assert.equal(best(h), k, h);
  // With no company named, a senator is A (10 × 0.725); at the U.S. Senate, which
  // the public dataset scores 7, S, as a C-suite at a company scored 7 is.
  assert.equal(person('U.S. Senator').tier, 'A');
  assert.equal(person('Senator, U.S. Senate').power, round1(10 * weight(7)));
  assert.equal(person('Senator, U.S. Senate').tier, 'S');
});

test('…but not the staff, the candidates, the clubs or the companies with those words', () => {
  for (const h of [
    'Staff Assistant, Office of the Secretary of Defense', 'Policy Analyst, Office of the Secretary of Defense',
    'Special Agent, Office of Inspector General, U.S. Department of Labor', 'Auditor, Office of Inspector General, HHS',
    'Legislative Assistant, Office of Senator Mark Delaney', 'Press Secretary, Office of the Governor', 'Paralegal, Office of the Attorney General',
    'Constituent Services Representative, U.S. House of Representatives', 'Special Assistant to the Under Secretary of Defense',
    'Counsel to the Attorney General', 'Executive Assistant to the Mayor', 'Legislative Aide to a U.S. Senator',
    'Law Clerk to Chief Judge Ivo Brandt', 'Judicial Law Clerk to U.S. District Judge', 'Court Clerk, Las Vegas Justice Court',
    'Restorative Justice Coordinator, Superior Court of California', 'Deputy Sheriff, Orange County Sheriff\'s Office',
    'Crime Analyst at Orange County Sheriff\'s Office', 'Candidate for Attorney General | Attorney', 'Candidate for Mayor',
    'Candidate for Sheriff, Seminole County', 'Elections Specialist at Secretary of State of Colorado',
    'District Governor, Rotary International District 5150', 'Governor, Rotary District 6970', 'JCI Senator | Business Coach',
    'Senator, Associated Students of UCLA', 'SGA Senator | Future Lawyer', 'Secretary-General, Harvard Model United Nations',
    'Secretary-General | SunshineMUN 2026', 'Chief Justice, Honor Council at Washington and Lee', 'Account Manager at Senator International',
    'Ambassador to the Hispanic Chamber of Commerce | Realtor', 'Community Ambassador to the Orlando Tech Scene', 'US Ambassador, Highland Park Whisky',
    'Brand Ambassador at Nike', 'Hackathon Judge | Software Engineer', 'Judge, Court of Master Sommeliers', 'Volunteer Judge, National Moot Court Competition',
    'Chief Judge, Regional Science & Engineering Fair', 'Commissioner, Sunday Night Kickball League', 'Commissioner, Northwind Fantasy Football League',
    'Unit Commissioner, Boy Scouts of America', 'Lawyer | Notary Public | Commissioner for Oaths', 'Paralegal | Commissioner of Oaths',
    'Assistant Secretary of Acme Holdings Inc. | Paralegal', 'Assistant Secretary of the Corporation, Northwind',
    'Secretary of the Board, Northwind Foundation', 'Secretary of the State Republican Party of Florida',
    'Tri-State Representative for Blue Harbor Beverages', 'U.S. Representative, Bavaria Tools GmbH',
    'U.S. Representative for Kessler Industrial Valves GmbH', 'Sales Representative at Oracle', 'State Delegate, Texas PTA | 3rd Grade Teacher',
    'City Supervisor at Lime', 'Forbes Council Member, District Manager at Aramark', 'Parent Advisory Council Member, Seminole County School District',
    "Program Manager, Mayor's Office of Innovation", 'Minister of Music at First Baptist Church',
  ]) assert.ok(!GOVERNMENT.includes(best(h)), `${h} read as ${best(h)}`);
  // A professor who sits in the faculty senate is a professor; a sales manager at Senator International a manager.
  assert.equal(best('Professor of Biology | Faculty Senator'), 'professor');
  assert.equal(best('Account Manager at Senator International'), 'manager');
  // An office named for its head isn't the title, whoever's headline it is: this was a C-suite before.
  assert.equal(best('IT Specialist, Office of the Chief Information Officer, U.S. Department of Energy'), 'senior');
});

test('military ranks, from a senior NCO to a general, and "(Ret.)" is a former role', () => {
  for (const [h, k] of [
    ['General, U.S. Army', 'seniorGeneral'],
    ['Lieutenant General, US Air Force', 'seniorGeneral'],
    ['Lt Gen, USAF', 'seniorGeneral'],
    ['LTG, U.S. Army', 'seniorGeneral'],
    ['Vice Admiral, U.S. Navy', 'seniorGeneral'],
    ['Major General, U.S. Army', 'general'],
    ['Maj Gen, USAF', 'general'],
    ['Brigadier General, Florida National Guard', 'general'],
    ['Rear Admiral, U.S. Coast Guard', 'general'],
    ['RDML, U.S. Navy', 'general'],
    ['Deputy Commanding General, 82nd Airborne Division | U.S. Army', 'general'],
    ['Colonel, U.S. Air Force', 'colonel'],
    ['Colonel | U.S. Air Force', 'colonel'],
    ['COL, U.S. Army', 'colonel'],
    ['Captain, U.S. Navy', 'colonel'],
    ['Captain | U.S. Navy | Naval Aviator', 'colonel'],
    ['Captain, U.S. Naval Reserve', 'colonel'],
    ['Lieutenant Colonel, USMC', 'ltColonel'],
    ['Lt Col USAF', 'ltColonel'],
    ['LTC, U.S. Army', 'ltColonel'],
    ['Commander, U.S. Navy', 'ltColonel'],
    ['Squadron Commander, USAF', 'ltColonel'],
    ['Commanding Officer, 2nd Battalion, 5th Marines | USMC', 'ltColonel'],
    ['Major, U.S. Army', 'major'],
    ['Captain, U.S. Army', 'major'],
    ['CPT, U.S. Army', 'major'],
    ['Captain, USMC | Navy Cross recipient', 'major'],
    ['Lieutenant Commander, USN', 'major'],
    ['Command Sergeant Major, U.S. Army', 'seniorEnlisted'],
    ['Master Chief Petty Officer, U.S. Navy', 'seniorEnlisted'],
    ['Chief Petty Officer, U.S. Navy', 'nco'],
    ['SES, Department of the Army', 'govSenior'],
  ]) assert.equal(best(h), k, h);
  // Where a rank is held: the service after it.
  assert.equal(person('Colonel, U.S. Air Force').company, 'U.S. Air Force');
  assert.equal(person('Colonel, U.S. Air Force').power, round1(7.5 * weight(8)));
  // Retired is former, at 70%, however it's written.
  for (const h of ['Colonel (Ret.), U.S. Army', 'COL (R), U.S. Army', 'Admiral, USN, Ret.', 'Army Colonel, Retired',
    'Colonel, U.S. Army - Retired', 'Retired Major General, US Air Force', 'CSM (Ret.), U.S. Army | Leadership Coach']) {
    assert.equal(person(h).title.former, true, h);
  }
  assert.equal(person('Financial Advisor Serving Federal Employees and the Newly Retired').title.former, false);
});

test('…but not a veteran\'s civilian job, a club\'s rank, a cadet or a company', () => {
  for (const h of [
    'Army Veteran | Store Manager at Dollar General', 'Store Manager at Dollar General | U.S. Army Veteran',
    'General Sales Manager at Lakeland Toyota | Navy Veteran', 'Army Veteran | General Sales Manager at Northwind Ford',
    'Board-Certified General Surgeon | Army Veteran', 'General Engineer, U.S. Army Corps of Engineers', 'Project Manager at a major general contractor',
    'Senior Accountant, General Accounting | Navy Federal Credit Union', 'Attorney, Judge Advocate General Corps, U.S. Navy',
    "Human Resources Specialist, Adjutant General's Corps, U.S. Army", 'Aide-de-Camp to the Commanding General, 82nd Airborne Division, U.S. Army',
    'General Manager at Northwind', 'Engineer at General Dynamics', 'Instructor at General Assembly', 'Gen AI Lead at Northwind', 'Analyst at ADM',
    'Claims Handler, Admiral', 'Sales Manager, Admiral Markets UK', 'Admiral in the Texas Navy | Insurance Agent',
    'Navy Veteran | Captain at Delta Air Lines', 'Captain at Delta Air Lines', 'Charter Boat Captain | USCG Licensed',
    'Operations Lead at Old Navy | Varsity Soccer Captain', "Navy Veteran | Shift Leader at Captain D's",
    'Navy Veteran | Team Captain, Corporate Softball League', 'Team Captain, Northwind Soccer Club', 'Military Spouse | Captain of our home team',
    'Proud Navy Grandma | Retired Teacher | Captain of our pickleball club', 'Cadet Captain, Navy ROTC', 'Economics Major | Army ROTC Cadet',
    'Major Gifts Officer at UCF Foundation', 'Major Events Coordinator | Army Veteran', "Army Veteran | Sales Associate, Major Appliances at Lowe's",
    'Post Commander, American Legion Post 42 | U.S. Army Veteran | Realtor', 'Army Veteran | Commander, VFW Post 4287',
    'Commander of the Order of the British Empire (CBE) | Royal Navy Veteran', 'Colonel, The Salvation Army | Divisional Commander',
    'Captain, The Salvation Army', 'Honorary Tennessee Colonel | Bourbon Distiller', 'Kentucky Colonel | Bourbon enthusiast',
    'LTC Insurance Specialist | Northwind Financial', 'Insurance Agent | Life, Health & LTC', 'Sales Manager at MG Motor UK | Army Veteran',
    'Navy Veteran | BG Staffing Recruiter',
  ]) assert.ok(!MILITARY.includes(best(h)), `${h} read as ${best(h)}`);
  // A veteran's civilian job scores as that job.
  assert.equal(best('Army Veteran | Store Manager at Dollar General'), 'manager');
  assert.equal(best('U.S. Army Veteran | Senior Software Engineer'), 'senior');
});

// A second review round's cases (lib/scoring.js officeTitle): forms of the same
// titles, and more of what isn't one.
test('round two: more ways officials and officers write their titles', () => {
  for (const [h, k] of [
    ['U.S. Secretary of Commerce', 'govLeader'], ['United States Attorney General', 'govLeader'], ['U.S. Trade Representative', 'govLeader'],
    ['Florida Attorney General', 'govLeader'], ['Florida Governor', 'govLeader'], ['Senate Majority Leader', 'govLeader'],
    ['Majority Leader, U.S. Senate', 'govLeader'], ['Member, U.S. House of Representatives', 'govLeader'], ['Governor, U.S. Virgin Islands', 'govLeader'],
    ['Principal Chief, Cherokee Nation', 'govLeader'], ['National Security Advisor', 'govLeader'],
    ['Florida Lieutenant Governor', 'govSenior'], ['New York State Comptroller', 'govSenior'], ['Insurance Commissioner, State of Georgia', 'govSenior'],
    ['Majority Leader, Florida Senate', 'govSenior'], ['President of the Florida Senate', 'govSenior'], ['Secretary of Education, Commonwealth of Virginia', 'govSenior'],
    ['FCC Commissioner', 'govSenior'], ['Commissioner, Internal Revenue Service', 'govSenior'], ['Chair, Nuclear Regulatory Commission', 'govSenior'],
    ['Chair, Florida Public Service Commission', 'govSenior'], ['Governor, Federal Reserve Board', 'govSenior'], ['FBI Director', 'govSenior'],
    ['U.S. Marshal, Middle District of Florida', 'govSenior'], ['U.S. Ambassador to Türkiye', 'govSenior'], ['Ambassador of Japan to the United States', 'govSenior'],
    ['Special Envoy for Climate', 'govSenior'], ['Under-Secretary-General, United Nations', 'govSenior'], ['Tier 3 SES, Department of Defense', 'govSenior'],
    ['Texas House of Representatives | Representative, District 101', 'govSenior'], ['Chief, Miami Police Department', 'govSenior'],
    ['Assistant Attorney General, Antitrust Division, U.S. Department of Justice', 'govSenior'],
    ['Deputy Assistant Attorney General, Criminal Division, U.S. Department of Justice', 'govOfficial'],
    ['Special Agent in Charge, FBI Miami Field Office', 'govOfficial'], ['Suffolk County Legislator', 'govOfficial'],
    ['At-Large Council Member, City of Houston', 'govOfficial'], ['County Administrator, Orange County', 'govOfficial'],
    ['United States District Judge', 'judge'], ['Judge, Ninth Circuit', 'judge'], ['County Court Judge, Orange County, Florida', 'judge'],
    ['Associate Justice, Supreme Judicial Court of Massachusetts', 'judge'], ['Tribal Court Judge, Navajo Nation', 'judge'],
    ['Chief of Staff of the Army', 'seniorGeneral'], ['Commandant of the Marine Corps', 'seniorGeneral'], ['Commander, Seventh Fleet, U.S. Navy', 'seniorGeneral'],
    ['Commander, 3rd Infantry Division | U.S. Army', 'general'], ['Commanding General, 82nd Airborne Division', 'general'],
    ['Commander, Carrier Strike Group 12, U.S. Navy', 'general'], ['Brigadier-General, Canadian Army', 'general'], ['Air Vice-Marshal, Royal Air Force', 'general'],
    ['Lieutenant-Colonel, Canadian Army', 'ltColonel'], ['Lt. Colonel, U.S. Army', 'ltColonel'], ['Battalion Commander, 1st Battalion, 75th Ranger Regiment | U.S. Army', 'ltColonel'],
    ['Commanding Officer, USS Gravely (DDG 107)', 'ltColonel'], ['Garrison Commander, Fort Liberty, U.S. Army', 'colonel'], ['COL | Florida Army National Guard', 'colonel'],
    ['COL, USAR', 'colonel'], ['Group Captain, Royal Air Force', 'colonel'], ['Captain, U.S. Public Health Service', 'colonel'],
    ['Executive Officer, 1st Battalion, 75th Ranger Regiment | U.S. Army', 'major'], ['Lieutenant, U.S. Navy', 'major'], ['USMC Reserve Major', 'major'],
    ['Sergeant Major of the Army', 'seniorEnlisted'], ['SgtMaj, USMC', 'seniorEnlisted'], ['1st Sergeant, USMC', 'nco'], ['SFC, U.S. Army', 'nco'],
    ['O-5, U.S. Navy', 'ltColonel'], ['Chief, Plans and Operations Division, U.S. Army', 'director'], ['Division Chief, Air Force Research Laboratory', 'director'],
  ]) assert.equal(best(h), k, h);
  // A war college's students are serving officers.
  assert.equal(best('Colonel, U.S. Army | Student, U.S. Army War College'), 'colonel');
  // Retired, written every way.
  for (const h of ['Colonel, U.S. Army Retired', 'Colonel, USAF (Retd)', 'Ret. Navy Captain', 'Lt Col | U.S. Air Force (Ret.) | Consultant',
    'Colonel | Retired U.S. Army', 'Retired Judge | Mediator', 'Judge (Ret.) | Mediator & Arbitrator at JAMS']) {
    assert.equal(person(h).title.former, true, h);
  }
  // …but an association of retirees, a registered mark or the letter R aren't retirements.
  for (const h of ['President, Retired Teachers Association of Florida', 'Senior Vice President, Wealth Management, CRPC(R) at Morgan Stanley',
    'VP of Analytics | SQL | R | Tableau']) {
    assert.equal(person(h).title.former, false, h);
  }
  // "Promoted to" is the new title; an assistant to a GC or a VP is the assistant.
  assert.equal(best('Promoted to Vice President at Goldman Sachs'), 'vp');
  assert.equal(best('Executive Assistant to the General Counsel at Google'), 'ic');
  assert.equal(best('Office of Technology Licensing Director at Stanford'), 'director');
});

test('round two: …and more of what isn\'t one', () => {
  for (const h of [
    'Speaker at Soho House', 'Speaker at the White House', 'Speaker | State House Reporter', 'Speaker at General Assembly', 'Speaker | House Flipper | Realtor',
    'Governor, The Florida Bar Board of Governors', 'Governor, Florida District of Circle K International', 'Governor, Florida Boys State',
    'Governor, Loyal Order of Moose Lodge 2032 | Ocala, Florida', 'Governor, Florida Hospital Association',
    'Pediatrician | Delegate, AMA House of Delegates', 'Member of the AMA House of Delegates', 'Delegate, General Assembly, Presbyterian Church (USA)',
    'Senator, Staff Senate at Ohio State University', 'Neurosurgeon | Member of the Congress of Neurological Surgeons',
    'Prime Minister, Northwind High School Model Parliament', 'Attorney General, SGA | Pre-Law', 'Justice, University Supreme Court, University of Florida',
    'Secretary General, ELSA Maastricht', 'Mayor of Fun at Northwind', 'Mayor of Midtown | Realtor at Compass', 'Mayor (Honorary), Studio City',
    'Secretary of State of Mind | Wellness Coach', 'Representative at Congressional Bank', 'PEO Benefits Administration Specialist',
    'State Representative at Northwind Beverages Inc.', 'Florida State Representative, Northwind Pharmaceuticals', 'State Controller, Northwind Home Health',
    'Commissioner of Deeds | Paralegal', 'Commissioner, The Joint Commission', 'Commissioner, Northwind County Special Olympics',
    'Parish Council Member, St. Joseph Catholic Church', 'Ambassador at Embassy Suites by Hilton', 'Ambassador to Brazil, Northwind Coffee Co.',
    'Ambassador to Japan for Northwind Sake', 'Ambassador to the Georgia Aquarium', 'Administrator at U.S. Bank', 'Administrator | FAA Part 107 Drone Pilot',
    'Chair, US Youth Soccer Board', 'Controller, State of the Art Dental', 'US Attorney at Law | Immigration', 'Sheriff, Northwind Cowboy Action Shooting Club',
    'Orange County Supervisor, Northwind Security Services', 'Assistant Secretary of the Vestry, St. Mark\'s Episcopal Church',
  ]) assert.ok(!GOVERNMENT.includes(best(h)), `${h} read as ${best(h)}`);
  for (const h of [
    'Captain, Navy Rugby | Ensign, U.S. Navy', 'Captain, Army West Point Football', 'CPO at Marine Layer', 'Captain at Harbor Marine Towing',
    'Commander, Marine Division at Northwind Yachts', 'Colonel, Honorable Order of Kentucky Colonels', 'Admiral, Great Navy of the State of Nebraska',
    'Commander, Marine Corps League Detachment 708', 'Commander, Navy League Orlando Council', 'Commander, Army and Navy Union',
    'Captain, Military Families Softball Team', 'Captain, Church Army', 'Captain, Brand Army at Northwind', 'Captain, USCG Licensed Master',
    'Master Chief | Halo Cosplayer', 'Warrant Officer, Northwind County Sheriff',
  ]) assert.ok(!MILITARY.includes(best(h)), `${h} read as ${best(h)}`);
});

// A third review round's cases. A government or military title needs its
// organization to be a government's or a service's (lib/scoring.js where()):
// its own part's, the next part's when that is an organization, or the
// headline's first part's. Only a title nobody else holds, or the whole
// headline, counts with none named. And a company's name after "at" stops
// where another title starts, and a retirement is its own role's.
test('round three: what still reads, however the organization is written', () => {
  for (const [h, k] of [
    ['MD at Emory, Pediatrics', 'ic'], ['MD at Stanford, Surgery', 'ic'], ['MD at Northwell, Emergency Medicine', 'ic'],
    ['MD @ UCSF, Oncology', 'ic'], ['MD @ Lazard, Healthcare M&A', 'vp'], ['MD at Northwind Capital, Healthcare Investment Banking', 'vp'],
    ['AT&T Senior Director of Product', 'director'], ['AT&T Retail Sales Manager', 'manager'], ['Ex-AT&T Director | Consultant', 'director'],
    ['At-Large Director, Northwind Credit Union', 'director'], ['At Home Store Manager', 'manager'], ['At Microsoft: Principal PM', 'manager'],
    ['Started at Google in 2015 now Director of Engineering', 'director'], ['Associate at Goldman Sachs (Vice President)', 'vp'], ['Analyst at Goldman Sachs (VP)', 'vp'],
    ['Consultant at Deloitte (Senior Manager)', 'manager'], ['Software Engineer at Google (Tech Lead)', 'manager'], ['Software Engineer at Google and Founder of Northwind', 'csuite'],
    ['Assistant Professor at Emory University and Co-Founder of Northwind Bio', 'csuite'], ['Associate to VP at Morgan Stanley', 'vp'], ['Promoted from Associate to Vice President at JPMorgan', 'vp'],
    ['Promoted from Manager to VP of Sales at Northwind', 'vp'], ['Executive Assistant to the General Manager at Four Seasons', 'ic'], ['EA to the VP of Finance at Northwind', 'ic'],
    ['Attorney, General Counsel\'s Office', 'ic'], ['Staff Attorney, Office of General Counsel of the Navy', 'ic'], ['Legal Assistant, General Counsel', 'ic'],
    ['Attorney, IRS Chief Counsel', 'ic'], ['Attorney & General Counsel', 'vp'], ['SVP, General Counsel & Secretary', 'vp'],
    ['Division Chief Nursing Officer | HCA Healthcare', 'csuite'], ['Business Unit Chief Financial Officer, Siemens', 'csuite'], ['Division Chief Operating Officer at Tenet Healthcare', 'csuite'],
    ['Section Chief of Pediatric Cardiology at Yale School of Medicine', 'director'], ['Division Chief of Cardiology at Emory University', 'director'], ['Mexico City Manager, Uber', 'manager'],
    ['President, Tribe Capital', 'csuite'], ['President, Cherokee Nation Businesses', 'csuite'], ['Chairman, Band of Angels', 'csuite'],
    ['President, Senate Bank', 'csuite'], ['President, Congress Asset Management', 'csuite'], ['President, Legislature Solutions Inc.', 'csuite'],
    ['Mayor of Orlando', 'govLeader'], ['Mayor | City of Orlando', 'govLeader'], ['City of Orlando - Mayor', 'govLeader'],
    ['State of Ohio | Governor', 'govLeader'], ['Florida Supreme Court | Justice', 'judge'], ['Supreme Court of Ohio - Justice', 'judge'],
    ['U.S. District Court for the Southern District of New York | Judge', 'judge'], ['Associate Justice, Massachusetts Appeals Court', 'judge'], ['Immigration Judge, Executive Office for Immigration Review', 'judge'],
    ['U.S. Department of State | Ambassador', 'govSenior'], ['Ambassador, Deputy Permanent Representative to the United Nations', 'govSenior'], ['U.S. Consul General, Lagos', 'govOfficial'],
    ['Commissioner, Florida Public Service Commission', 'govSenior'], ['Commissioner, Nuclear Regulatory Commission', 'govSenior'], ['Commissioner - FCC', 'govSenior'],
    ['Chair, Council of Economic Advisers', 'govSenior'], ['Chief Patrol Agent, U.S. Border Patrol Miami Sector', 'govOfficial'], ['Deputy Under Secretary of Defense | Georgetown University', 'govSenior'],
    ['Regional Administrator, EPA Region 5', 'govOfficial'], ['Special Agent in Charge, FBI Miami Field Office', 'govOfficial'], ['Mayor, City of Winter Park', 'govLeader'],
    ['County Manager | Seminole County', 'govOfficial'], ['City Manager, City of Phoenix', 'govOfficial'], ['Secretary of Defense', 'govLeader'],
    ['Ambassador (Ret.) | Diplomat in Residence', 'govSenior'], ['Commander, Navy Region Southeast', 'general'], ['Commander, Nurse Corps, U.S. Navy', 'ltColonel'],
    ['Lt Col | Acquisition Officer | U.S. Army', 'ltColonel'], ['MAJ | Operations Officer | U.S. Army', 'major'], ['Lt Col | F-35 Pilot | USAF', 'ltColonel'],
    ['Major | Intelligence Officer | USMC', 'major'], ['CDR | Submarine Officer | USN', 'ltColonel'], ['Army Reserve Captain | Intelligence Analyst at Booz Allen Hamilton', 'major'],
  ]) assert.equal(best(h), k, h);
});

test('round three: …and a company, a club, a joke or a second job doesn\'t make a government title', () => {
  for (const h of [
    'Assistant to the President, Northwind University', 'Assistant to the President for Strategic Initiatives, Northwind College', 'Trade Representative, Heineken USA',
    'Trade Representative | E. & J. Gallo', 'US Trade Representative, Northwind Exports', 'National Security Advisor, Northwind Institute',
    'Realtor at Compass | Mayor of Midtown', 'Mayor of LinkedIn', 'Mayor of Flavortown',
    'Barista | Mayor of Downtown Orlando', 'Recruiter | Mayor of Brooklyn', 'Mayor | Northwind Town Hall Podcast',
    'Controller | Texas', 'Auditor, Texas Department of Transportation', 'Treasurer, State of Florida Credit Union',
    'Controller | Georgia | CPA | Mom of 2', 'Texas Controller | Northwind Homes', 'State Controller | Northwind Foods',
    'Auditor, State of Texas', 'State Representative | Florida | Northwind Brands', 'Florida State Representative | Northwind Pharmaceuticals',
    'City Manager, Uber', 'City Manager | Lime', 'Launch City Manager, Bird',
    'County Manager | Northwind Seeds', 'Council Member, Kansas City Tech Council', 'Council Member, City Year',
    'Council Member, Salt Lake City Chamber', 'Guidance Councillor, Kansas City Public Schools', 'Mental Health Councillor, Orange County',
    'Administrator, FAA Part 145 Repair Station', 'Administrator, TSA PreCheck Enrollment Center', 'Administrator | EPA | Environmental Scientist',
    'Administrator, SBA Lending | Northwind Bank', 'SBA Administrator, Northwind Bank', 'GSA Administrator | Northwind Federal Solutions',
    'Regional Administrator, Brookdale Senior Living, Florida', 'Regional Administrator, Texas | Northwind Home Health', 'Associate Administrator, Department of Surgery, Northwind Medical Center',
    'US Attorney | Immigration', 'U.S. Attorney | Licensed in New York', 'US Attorney | Brazilian Lawyer | Cross-border M&A',
    'State Attorney | Northwind Law Firm', 'County Attorney | Northwind Title Co.', 'Former Ambassador | Lululemon | Yoga Instructor',
    'Ex-Ambassador | Red Bull', 'Ambassador to Japan | Northwind Sake', 'Ambassador | Embassy Row Hotel',
    'Ambassador to India | Northwind Yoga Retreats', 'Chief, Nation Builders Coaching', 'Chief | The Growth Tribe',
    'Chief, Band of Brothers Coffee', 'Member, Community Depository Institutions Advisory Council, Federal Reserve Bank of Atlanta', 'Member | Federal Reserve Bank of Atlanta',
    'Analyst at the Federal Reserve Bank of St. Louis | Member, Beta Gamma Sigma', 'Bank Examiner at the Federal Reserve Bank of Richmond | Member', 'Chair, Internal Revenue Service Advisory Council',
    'Legislative Analyst | U.S. Congress | Member', 'Police Chief, Northwind Mall Security', 'Fire Chief, Northwind Chemical Plant',
    'Speaker at Mobile World Congress', 'Speaker at ASCO & ESMO Congress | Medical Oncologist', 'Speaker, World Congress on Pain | Physician',
    'Speaker of the House | Realtor at Northwind Realty', 'Member, Congress for the New Urbanism', 'Member, African National Congress',
    'Representative | Congress Title Co.', 'Member | Congress Street Capital', 'Representative | US Congressional District 7 Sales Territory',
    'Commissioner, Orange County Pickleball League', 'Commissioner, Kansas City Rugby Union', 'Commissioner, Kansas City Sports Commission',
    'Governor for Florida, American College of Physicians', 'Governor of the Florida Chapter, American College of Physicians', 'Governor of the Florida District, Key Club International',
    'Secretary of State | Florida Girls State', 'Secretary of State | YMCA Youth in Government', 'Secretary of Education | Homeschool Mom',
    'Secretary of Labor | Doula', 'Member of Parliament | UK Youth Parliament', 'Member of Parliament | Northwind Student Parliament',
    'Chief Justice | Model Supreme Court | Pre-Law', 'Attorney General, Undergraduate Assembly', 'Chief Justice, Interfraternity Council Judicial Board',
    'Attorney General, Panhellenic Council', 'Justice, Supreme Court of Delta Sigma Phi', 'Assistant Secretary of Northwind Foods | Senior Paralegal',
    'Assistant Secretary of Kroger | Corporate Paralegal', 'PEO Account Manager | U.S. Army Reserve', 'PEO Sales Executive | Air National Guard',
    'Deputy PEO Sales Lead, Northwind HR Solutions', 'Adjutant General, American Legion Department of Florida', 'Inspector General, Scottish Rite of Freemasonry',
    'Inspector General | Northwind Health Plan', 'Postmaster General, Northwind Stamp Collectors', 'Inspector General Counsel',
    'Judge, Southeast Rodeo Circuit', 'Senior Judge, Northwind BBQ Circuit', 'District Judge, Texas FFA',
    'District Judge | 4-H Livestock', 'Former Judge | Startup Pitch Night', 'School Board Member, Northwind Christian Academy',
    'School Board Chair, Northwind Montessori School', 'Delegate, NEA Representative Assembly | Texas', 'Special Envoy | Northwind Crypto',
    'Special Envoy for Web3 | Northwind', 'Consul General | Northwind Travel', 'Candidate for County Commissioner',
    'Senator, Northwind Florida Office',
  ]) assert.ok(!GOVERNMENT.includes(best(h)), `${h} read as ${best(h)}`);
  // A staff member in a general counsel's office isn't the general counsel.
  for (const h of ['Paralegal, General Counsel\'s Office', 'Law Clerk, General Counsel Division']) assert.notEqual(best(h), 'vp', h);
});

test('round three: …nor a rank, with a police, fire, club or civilian employer\'s name', () => {
  for (const h of [
    'Captain | Delta Air Lines | Retired USAF', 'Captain | United Airlines | U.S. Air Force Reserve', 'Captain | Former USAF | Delta Air Lines',
    'Captain, American Airlines Group | U.S. Air Force', 'Captain, Delta Flight Operations | U.S. Air Force', 'Captain | Orange County Fire Rescue | U.S. Army',
    'Captain | Allied Universal Security | U.S. Army', 'General | Northwind Contracting | U.S. Army', 'Captain | Northwind Fishing Charters | U.S. Coast Guard',
    'Master Chief | Northwind Kitchen | U.S. Navy', 'Master Sergeant | Northwind Martial Arts | Army', 'Commander, 3rd Division, Northwind Police',
    'Colonel, 1st Division, Northwind State Police', 'Captain, 1st Battalion, Northwind Fire Department', 'Commander, 77th Street Division, LAPD',
    'Commanding Officer, 1st Division, Los Angeles Fire Department', 'Captain, Engine 12, 3rd Battalion', 'Lieutenant, Engine Company 7 | U.S. Navy',
    'Commander, Patrol Division, Orange County Sheriff\'s Office | U.S. Army', 'Commander, Special Operations Division, Miami-Dade Police | USMC', 'Commander, Security Group, Northwind Casino | U.S. Army',
    'Commander, Air Force Sergeants Association Chapter 1075', 'Commander, U.S. Navy Seabee Veterans of America Island 12', 'Commander, USS Constitution Museum',
    'Captain, USS Midway Museum Docent Program', 'Commander, Northwind Sail & Power Squadron | U.S. Navy (Ret.)', 'Executive Officer, Army Aviation Center Federal Credit Union',
    'Executive Officer, Air Force Aid Society', 'Executive Officer, Army Emergency Relief', 'General, Army of Hope Ministries',
    'General, Army of Darkness Fan Society', 'Captain, Army Navy Surplus Store', 'Captain, Coast Guard Beach Lifeguards',
    'Captain, Navy Blue Cleaning Co.', 'Commander, 5th Street Restaurant Group', 'Captain, Northwind Naval Architects',
    'Captain, 1st Boys Brigade', 'Major, Naval Architecture, University of Michigan', 'Captain, 1st Division Pickleball Squad',
    'Captain, 3rd Wing, Northwind Hospital', 'Sergeant Major, 1st Division Drum Corps', 'Commodore, Naval Academy Sailing Squadron',
    'Major, Army Corps of Engineers Park Ranger',
  ]) assert.ok(!MILITARY.includes(best(h)), `${h} read as ${best(h)}`);
});

test('round three: a retirement is its own role\'s, not a service\'s after a civilian job nor a second role\'s', () => {
  for (const [h, k, former] of [
    ['Program Manager at Lockheed Martin, USN (Ret.)', 'manager', false], ['VP of Sales at Oracle, U.S. Army (Ret.)', 'vp', false],
    ['Program Manager at Leidos (USAF, Ret.)', 'manager', false], ['Realtor at Compass, Firefighter (Ret.)', 'ic', false],
    ['Teacher (Retired), Realtor at Compass', 'ic', false], ['Senior Manager at Deloitte | Navy Veteran | Retired', 'manager', false],
    ['Owner, Northwind Coffee | USMC | Retired', 'owner', false], ['Teacher at Orange County Public Schools (Retired)', 'ic', true],
    ['Nurse, Retired', 'ic', true], ['Colonel | U.S. Army | Retired', 'colonel', true],
  ]) {
    assert.equal(best(h), k, h);
    assert.equal(person(h).title.former, former, h);
  }
});

// A fourth review round's cases (precision first): a title that names its
// government ("County Sheriff", "Mayor of Tampa", "U.S. Secretary of
// Education") reads the other parts as its bio unless they name an employer;
// a bare title ("Mayor", "Police Chief", "Ambassador") needs its government
// named, or to be the whole headline; a rank borrows a service from another
// part only with nothing civilian on its other side, and a short form that is
// also a credential (LTC, CPT, CSM, ADM) only when the whole headline is military.
test('round four: officials and officers, however their bio is written', () => {
  for (const [h, k] of [
    ['Administrator of NASA', 'govSenior'], ['Amb., U.S. Embassy Tokyo', 'govSenior'],
    ['Ambassador to Japan | U.S. Department of State | Model UN Alumni', 'govSenior'], ['Ambassador-at-Large for Global Women\'s Issues', 'govSenior'],
    ['Assistant Secretary for Financial Institutions, U.S. Department of the Treasury', 'govSenior'], ['Assistant Secretary for Health, HHS', 'govSenior'],
    ['Assistant Secretary for Insurance Programs', 'govSenior'], ['Assistant Secretary for Technology Policy, U.S. Department of Commerce', 'govSenior'],
    ['At-Large City Councilmember, Houston', 'govOfficial'], ['Attorney General of Texas | Podcast Host', 'govLeader'],
    ['Brigade Commander, 2nd Brigade Combat Team, 1st Cavalry Division | U.S. Army', 'colonel'], ['Captain | U.S. Navy ⚓', 'colonel'],
    ['Chair of the Federal Trade Commission', 'govSenior'], ['Circuit Judge | Church Deacon', 'judge'],
    ['Circuit Judge | Podcast Host', 'judge'], ['Circuit Judge | Rugby Referee', 'judge'],
    ['City Commissioner, Winter Park, FL', 'govOfficial'], ['City Council Member, Winter Park, FL', 'govOfficial'],
    ['City Councilmember, Orlando', 'govOfficial'], ['City Manager, Winter Park, FL', 'govOfficial'],
    ['Colonel (USAF, Ret.)', 'colonel'], ['Colonel | U.S. Army 🇺🇸', 'colonel'],
    ['Colonel | U.S. Central Command', 'colonel'], ['Colonel, U.S. Army 🇺🇸', 'colonel'],
    ['Commander, Air Combat Command', 'seniorGeneral'], ['Commander, Cyber Protection Team 173, U.S. Army', 'ltColonel'],
    ['Commander, Pacific Air Forces', 'general'], ['Commander, Pacific Air Forces | U.S. Air Force', 'general'],
    ['Commander, U.S. Air Forces in Europe', 'general'], ['Commander, U.S. Indo-Pacific Command', 'seniorGeneral'],
    ['Commander, U.S. Pacific Fleet', 'seniorGeneral'], ['Congressman (R-TX)', 'govLeader'],
    ['Congressman | Media Personality', 'govLeader'], ['Congressman | Pickleball Enthusiast', 'govLeader'],
    ['Congresswoman (D-NY) | U.S. House of Representatives', 'govLeader'], ['Congresswoman, NY-14', 'govLeader'],
    ['Councilmember, Winter Park', 'govOfficial'], ['County Commissioner | Little League Coach', 'govOfficial'],
    ['County Commissioner, Orange County | High School Teacher', 'govOfficial'], ['County Sheriff | Swim Dad', 'govOfficial'],
    ['Del., Maryland House of Delegates', 'govSenior'], ['Deputy Commander, 1st Armored Brigade Combat Team, 3rd Infantry Division', 'ltColonel'],
    ['Deputy Mayor for Public Safety | Coffee Lover', 'govSenior'], ['Deputy Mayor, New York City', 'govSenior'],
    ['Director, FBI', 'govSenior'], ['Former State Senator | Lobbyist', 'govSenior'],
    ['Gov., State of Ohio', 'govLeader'], ['Governor (D) | Commonwealth of Kentucky', 'govLeader'],
    ['Governor of Ohio | Church Deacon', 'govLeader'], ['Governor of Ohio | Homeschool Dad', 'govLeader'],
    ['Governor of the Chickasaw Nation', 'govLeader'], ['Judge 👩‍⚖️ | Ninth Judicial Circuit', 'judge'],
    ['Judge, U.S. District Court | Pre-Law Mentor', 'judge'], ['Lieutenant General', 'seniorGeneral'],
    ['Lieutenant Governor of Ohio | Fitness Coach', 'govSenior'], ['Lt. Gov., State of Ohio', 'govSenior'],
    ['Major General', 'general'], ['Mayor of Orlando | Former Student Government President at UCF', 'govLeader'],
    ['Mayor of Orlando | Husband | Father', 'govLeader'], ['Mayor of Tampa | Former Police Chief', 'govLeader'],
    ['Mayor of Winter Park | Attorney', 'govLeader'], ['Mayor | Oviedo, Florida | Realtor', 'govLeader'],
    ['Mayor | Winter Park, FL', 'govLeader'], ['Mayor, Orlando', 'govLeader'],
    ['Mayor, Winter Park, FL', 'govLeader'], ['Member of Congress, FL-07', 'govLeader'],
    ['Member of Parliament | Former Minister of Health', 'govLeader'], ['Ohio State Treasurer | Financial Planner', 'govSenior'],
    ['Rear Admiral', 'general'], ['Rear Admiral (Upper Half)', 'general'],
    ['Rep., U.S. House of Representatives', 'govLeader'], ['Sen., Florida Senate', 'govSenior'],
    ['Senator | Australian Senate', 'govSenior'], ['Senator | Senate of Puerto Rico', 'govSenior'],
    ['Senator, Senate District 12', 'govSenior'], ['Senator, Senate of Canada', 'govSenior'],
    ['Senator, Senate of the Philippines', 'govSenior'], ['Sheriff of Polk County | Podcast Host', 'govOfficial'],
    ['Sheriff | Orange County, FL', 'govOfficial'], ['State Representative | 45th District | Realtor', 'govSenior'],
    ['State Representative | House District 45 | Realtor', 'govSenior'], ['State Sen., District 12', 'govSenior'],
    ['State Senator', 'govSenior'], ['State Senator | Attorney', 'govSenior'],
    ['State Senator | District 12 | Attorney', 'govSenior'], ['State Senator | Realtor | Veteran', 'govSenior'],
    ['State Senator, Florida Senate | Former High School Teacher', 'govSenior'], ['State Senator, Senate District 14', 'govSenior'],
    ['Surgeon General of Florida | Wellness Advocate', 'govSenior'], ['Treasurer, State of Ohio', 'govSenior'],
    ['U.S. Congressman, Florida', 'govLeader'], ['U.S. Secretary of Education | Former Middle School Teacher', 'govLeader'],
    ['U.S. Sen.', 'govLeader'], ['U.S. Senator | Football Fan', 'govLeader'],
    ['U.S. Senator | Little League Coach', 'govLeader'], ['Under Secretary for Health, U.S. Department of Veterans Affairs', 'govSenior'],
    ['Under Secretary for Science and Technology, DHS', 'govSenior'], ['United States Senator (D-Illinois)', 'govLeader'],
    ['Vice Admiral', 'seniorGeneral'], ['Vice Admiral (Ret.)', 'seniorGeneral'],
    ['Vice Mayor | Winter Park, FL', 'govSenior'],
  ]) assert.equal(best(h), k, h);
});

test('round four: …and ordinary people, clubs, companies and look-alike titles aren\'t', () => {
  for (const h of [
    'ADM | U.S. Navy Reserve | Commodity Trader', 'Account Manager | ADM | Air National Guard', 'Agile Coach | CSM | U.S. Army Reserve',
    'Ambassador at City of Orlando', 'Ambassador to Mexico | Content Creator', 'Ambassador | Government Street Grocery',
    'Ambassador | Texas Department of Agriculture | GO TEXAN', 'Ambassador, Florida Department of Health', 'Assistant Mayor of the Neighborhood | Mail Carrier',
    'Assistant Secretary for Records | Northwind Lodge No. 12', 'Assistant Secretary | Orange County | Northwind PTA', 'Associate Administrator, Government Contracts | Leidos',
    'At-Large', 'Battalion Commander, 1st Battalion | Northwind Military Academy', 'CDC Director | Early Childhood Education',
    'CSM | Army National Guard | HubSpot', 'Captain | Aviation Unit | Northwind Sheriff', 'Captain, 3rd Battalion | Orange County Fire Rescue',
    'Captain, Air Force Falcons Wrestling', 'Captain, Army Esports', 'Captain, Army Wrestling | West Point Class of 2027',
    'Captain, Naval Academy Wrestling', 'Captain, Navy Swimming & Diving', 'Captain, Navy Wrestling 🤼 | Economics Major',
    'Captain, USS Northwind | Sea Scout Ship 42', 'Chair, Florida Blockchain Business Council', 'Chair, U.S. Dairy Export Council',
    'Chargé d', 'Chief Justice | Supreme Court | Northwind University', 'Chief of Police | Northwind Mall Police Department',
    'City Council Member | Northwind Model City Council Program', 'City Manager, Orange County | Bird', 'Colonel, 1st Continental Regiment | Revolutionary War Living History',
    'Commander, 1st Brigade | Texas A&M Corps of Cadets', 'Commander, 5th Group | Northwind Fitness Bootcamp', 'Commanding Officer, USS Northwind Division | U.S. Naval Sea Cadet Corps',
    'Commissioner of Agriculture | Backyard Chicken Farmer', 'Commissioner of Labor | Doula', 'Commissioner | Texas Beef Council',
    'Company Commander, Alpha Company, 1st Battalion | Northwind High School NJROTC', 'Council Member | Florida Hospitality Council', 'Council Member | Ward 3 | Northwind Neighborhood Association',
    'Deputy Mayor of Our Street | Dad', 'Deputy Mayor | Neighborhood Watch', 'Deputy Under Secretary for Fun | Northwind',
    'Ex-Captain, Navy Wrestling | Analyst at Goldman Sachs', 'Former Ambassador, City of Orlando | Realtor', 'Governor | Georgia | Toastmasters',
    'HR Consultant | PEO | Army National Guard', 'Inspector General | Northwind Home Inspections', 'Judge | Orange County | State Fair',
    'Lieutenant Governor | Texas | TX Youth & Government', 'Management Consultant | CMC | U.S. Navy Reserve', 'Mayor | State of Mind Coffee House',
    'Member of the Texas Legislature Internship Program', 'Miami-Dade County Executive | Private Banking | Northwind Trust', 'PEO STRI | U.S. Army | Contractor with Northwind Defense',
    'Personal Trainer • CPT • Army National Guard', 'President, Omaha Community Foundation', 'Regimental Commander, 1st Battalion | The Citadel',
    'Regional Administrator, Government Programs | Northwind Health Plan', 'Salesforce | CSM | Army Reserve', 'School Board Member | Northwind Waldorf',
    'Secretary-General | Model ASEAN', 'Sergeant Major, 5th Georgia Infantry | Civil War Living Historian', 'Speaker | Florida House | Keynote',
    'Special Envoy to the CEO', 'Squadron Commander, 402nd Composite Squadron | CAP', 'State Rep, District 4 | Northwind Wine & Spirits',
    'State Representative, District 7 | Northwind Beverages', 'State Treasurer | Georgia Young Democrats', 'Supreme Court Justice of Hot Takes | Podcaster',
    'U.S. Coast Guard | Captain | Carnival Cruise Line', 'USAF (Ret.) | Captain | Southwest Airlines', 'Under-Secretary-General | Crisis Committees | Gator MUN',
  ]) assert.ok(!GOVERNMENT.includes(best(h)) && !MILITARY.includes(best(h)), `${h} read as ${best(h)}`);
  for (const [h, k] of [
    ['Adjunct Professor at Northwind College | Retired', 'ic'], ['Ambassador | Orlando Police Department', 'unknown'],
    ['Ambassador, Federal Express Customer Service', 'unknown'], ['Ambassador, Orange County Public Schools', 'unknown'],
    ['Attorney | General Counsel, P.C.', 'ic'], ['Business Partner to the General Counsel', 'senior'],
    ['Chair, Georgia Tech Advisory Board', 'unknown'], ['Chair, U.S. Green Building Council', 'unknown'],
    ['Chairman, New York Times Board', 'csuite'], ['Chairwoman, Virginia Credit Union Board', 'csuite'],
    ['Chief | Delaware Valley Community Health', 'unknown'], ['Compliance Manager, Chief Counsel', 'manager'],
    ['Council Member, Florida Realtors Council', 'unknown'], ['Division', 'unknown'],
    ['Engineer at Tesla Co-op Internship', 'intern'], ['Fractional CFO | Retired', 'csuite'],
    ['Judge, Texas Beef Council', 'unknown'], ['Legal Project Manager, General Counsel Org', 'manager'],
    ['MD at Baylor, Pediatrics Chief Resident', 'ic'], ['MD at Emory, Pediatric Surgery Fellow', 'ic'],
    ['MD at Northwind University, Internal Medicine & Pediatrics', 'ic'], ['MD at Yale, Yale New Haven Hospital', 'ic'],
    ['Mayor, Texas Beef Council', 'unknown'], ['PM @ Google x Founder @ Northwind', 'csuite'],
    ['President | Choctaw Community Theater', 'csuite'], ['President, Delaware County Community College', 'csuite'],
    ['President, Laguna Beach Community Foundation', 'csuite'], ['President, Seminole Nation Realty', 'csuite'],
    ['Program Manager, Legal & General Counsel', 'manager'], ['Retired | Investor', 'director'],
    ['Senior Associate at PwC then Manager', 'manager'], ['Volunteer at Habitat for Humanity | Retired', 'ic'],
  ]) assert.equal(best(h), k, h);
});

// Codex's review of #55: other countries' services, municipalities whose names
// hold an organization's word, and a party beside a named office.
test('a named office reads a party as bio; other countries\' services and cities like "League City" are read', () => {
  for (const [h, k] of [
    ['Captain, French Navy', 'colonel'], ['Colonel, German Army', 'colonel'], ['Major, Polish Army', 'major'],
    ['Mayor of Plant City', 'govLeader'], ['Mayor of League City', 'govLeader'], ['Mayor of College Station', 'govLeader'],
    ['Mayor of New York City | Democrat', 'govLeader'], ['County Sheriff | Republican', 'govOfficial'],
  ]) assert.equal(best(h), k, h);
  for (const h of ['Colonel, Swiss Army', 'Mayor of Mortgage Town', 'State Treasurer | Libertarian Party of Florida', 'State Treasurer | Florida Young Republicans']) {
    assert.ok(!GOVERNMENT.includes(best(h)) && !MILITARY.includes(best(h)), `${h} read as ${best(h)}`);
  }
});
