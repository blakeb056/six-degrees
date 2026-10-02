// Network Circle's degree filter: everyone the app knows, by degree, each once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleByDegree } from '../lib/degrees.js';

const url = (s) => `https://www.linkedin.com/in/${s}`;

test('each person counts once, at the nearest degree they are found', () => {
  const d1 = [{ id: 'a', profile_url: url('ada'), tier: 'S' }, { id: 'b', profile_url: url('ben'), tier: 'A' }];
  const d2 = [
    { id: 'x1', degree: 2, profile_url: url('cy'), tier: 'B', source_connection_id: 'a' },
    { id: 'x2', degree: 2, profile_url: url('cy/'), tier: 'B', source_connection_id: 'b' },   // the same person, another circle
    { id: 'x3', degree: 2, profile_url: url('ben'), tier: 'A', source_connection_id: 'a' },   // already a connection
  ];
  const d3 = [{ id: 'z1', profile_url: url('cy'), tier: 'B' }, { id: 'z2', profile_url: url('dee'), tier: 'C' }];
  const by = peopleByDegree(d1, d2, d3);
  assert.deepEqual(by[1].map((r) => r.id), ['a', 'b']);
  assert.deepEqual(by[2].map((r) => r.id), ['x1']);
  assert.deepEqual(by[3].map((r) => [r.id, r.degree]), [['z2', 3]]);
  assert.equal(by[1][0].degree, 1, 'rows carry the degree they are drawn at');
});

test('nothing loaded, nothing to draw', () => {
  assert.deepEqual(peopleByDegree(), { 1: [], 2: [], 3: [] });
});
