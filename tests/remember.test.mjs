// Reading a headline or a company name once per piece of text (lib/scoring.js
// rememberByText), and the two reads that use it. Invented people; public companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberByText, readRoles, rolesWithCompanies, cleanCompany, currentCompany } from '../lib/scoring.js';

test('rememberByText: the same text is read once', () => {
  let reads = 0;
  const upper = rememberByText((t) => { reads++; return t.toUpperCase(); });
  assert.equal(upper('acme'), 'ACME');
  assert.equal(upper('acme'), 'ACME');
  assert.equal(upper('globex'), 'GLOBEX');
  assert.equal(reads, 2);
});

test('rememberByText: a null or empty answer is remembered too', () => {
  let reads = 0;
  const none = rememberByText(() => { reads++; return null; });
  assert.equal(none('x'), null);
  assert.equal(none('x'), null);
  assert.equal(reads, 1);
});

test('rememberByText: keeps at most max answers, dropping the oldest first', () => {
  let reads = 0;
  const same = rememberByText((t) => { reads++; return t; }, 2);
  same('a'); same('b'); same('c');   // 'a' is dropped to make room
  assert.equal(reads, 3);
  same('c'); same('b');
  assert.equal(reads, 3);
  same('a');
  assert.equal(reads, 4);
});

test('readRoles: every call gets its own copies, so filling one in changes no other', () => {
  const headline = 'Head of Growth | Speaker';
  const first = readRoles(headline);
  first[0].company = 'Filled In';
  first[0].title.label = 'Changed';
  first.push({ extra: true });
  const again = readRoles(headline);
  assert.notEqual(again[0].company, 'Filled In');
  assert.notEqual(again[0].title.label, 'Changed');
  assert.equal(again.some((r) => r.extra), false);
});

test('rolesWithCompanies: a remembered headline still takes each row\'s own company', () => {
  // Same headline, no company in it: each person's stored company fills it in.
  const a = rolesWithCompanies({ headline: 'Software Engineer', company: 'Globex' });
  const b = rolesWithCompanies({ headline: 'Software Engineer', company: 'Initech' });
  assert.equal(a[0].company, 'Globex');
  assert.equal(b[0].company, 'Initech');
  assert.equal(currentCompany({ headline: 'Software Engineer', company: 'Globex' }), 'Globex');
  assert.equal(currentCompany({ headline: 'Software Engineer' }), null);
});

test('readRoles and cleanCompany: the headline, else the role, and anything empty read alike', () => {
  assert.deepEqual(readRoles('', 'Engineer at Acme'), readRoles('Engineer at Acme'));
  assert.deepEqual(readRoles(null, null), readRoles());
  for (const empty of [undefined, null, '']) assert.equal(cleanCompany(empty), null);
  assert.equal(cleanCompany('Google LLC'), cleanCompany('Google LLC'));
  assert.equal(cleanCompany('Google LLC'), 'Google');
});
