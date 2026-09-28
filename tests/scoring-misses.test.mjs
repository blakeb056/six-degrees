// Kinds of people a review of the power score found it under-rating
// (docs/brain/SCORING.md, "What the review changed"): a title whose company is
// written without "at", managing directors and country heads written short,
// academics, an audience of one's own, and a title the rules can't read. And
// the other way: an award named for a title isn't the title.
// Invented people; public companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTitle, readRoles, scorePerson, LEVELS } from '../lib/scoring.js';

const key = (h) => readTitle(h).key;
const person = (headline, row = {}) => scorePerson({ headline, ...row });
const best = (h) => person(h).title.key;
const weight = (company) => 0.45 + 0.055 * company;
const round1 = (n) => Math.round(n * 10) / 10;

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
