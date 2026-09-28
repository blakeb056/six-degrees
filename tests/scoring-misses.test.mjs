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
