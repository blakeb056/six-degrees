import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, NETWORK_GRID, DEGREES_GRID, makeGrid, shows, showing, showingIn,
  toggleCell, toggleTier, toggleDegree, showAllTiers, gridCounts,
} from '../lib/tier-grid.js';

const counts = { S: { 1: 10, 2: 100 }, A: { 1: 20, 2: 200, 3: 5 }, B: { 1: 30 }, C: { 1: 40 }, D: { 1: 50 } };

test('the grid starts with your connections in Network Circle and everything in Degrees', () => {
  assert.ok(TIERS.every((t) => shows(NETWORK_GRID, t, 1) && !shows(NETWORK_GRID, t, 2)));
  assert.ok(TIERS.every((t) => [1, 2, 3, 4, 5, 6].every((d) => shows(DEGREES_GRID, t, d))));
  assert.equal(showing(NETWORK_GRID, counts), 150);
  // Someone with no tier is drawn with D, so D's dots decide.
  assert.equal(shows(NETWORK_GRID, undefined, 1), true);
  assert.equal(shows(toggleTier(NETWORK_GRID, 'D', counts), null, 1), false);
});

test('a dot switches one degree for one tier, and leaves the rest alone', () => {
  const g = toggleCell(NETWORK_GRID, 'S', 2, counts);
  assert.equal(shows(g, 'S', 2), true);
  assert.equal(shows(g, 'A', 2), false);
  assert.equal(showingIn(g, counts, 'S'), 110);
  const back = toggleCell(g, 'S', 2, counts);
  assert.deepEqual(back.degrees.S, [1]);
  // The grid it was given is never changed.
  assert.deepEqual(NETWORK_GRID.degrees.S, [1]);
});

test('a tier switches off and comes back with the degrees it had', () => {
  const picked = toggleCell(NETWORK_GRID, 'A', 3, counts);
  const off = toggleTier(picked, 'A', counts);
  assert.equal(shows(off, 'A', 1), false);
  assert.equal(showingIn(off, counts, 'A'), 0);
  const on = toggleTier(off, 'A', counts);
  assert.deepEqual(on.degrees.A, [1, 3]);
  assert.equal(shows(on, 'A', 3), true);
  // A dot tapped in a tier that's off switches the tier on with it.
  const viaDot = toggleCell(off, 'A', 2, counts);
  assert.deepEqual(viaDot.hidden, []);
  assert.deepEqual(viaDot.degrees.A, [1, 2, 3]);
  assert.deepEqual(showAllTiers(off).hidden, []);
});

test('a degree switches for every tier with people there', () => {
  const two = toggleDegree(NETWORK_GRID, 2, counts);
  assert.equal(shows(two, 'S', 2), true);
  assert.equal(shows(two, 'A', 2), true);
  assert.equal(shows(two, 'B', 2), false);   // nobody in B at 2nd degree
  assert.equal(showing(two, counts), 450);
  const none = toggleDegree(two, 2, counts);
  assert.equal(showing(none, counts), 150);
  // Nobody anywhere at 5th degree: nothing changes.
  assert.equal(toggleDegree(NETWORK_GRID, 5, counts), NETWORK_GRID);
});

test('the last people on screen can\'t be switched off', () => {
  const onlyS = ['A', 'B', 'C', 'D'].reduce((g, t) => toggleTier(g, t, counts), NETWORK_GRID);
  assert.equal(showing(onlyS, counts), 10);
  assert.equal(toggleTier(onlyS, 'S', counts), onlyS);
  assert.equal(toggleCell(onlyS, 'S', 1, counts), onlyS);
  assert.equal(toggleDegree(onlyS, 1, counts), onlyS);
  // A tier brought back with no degrees of its own takes what the others show.
  const empty = { hidden: ['B'], degrees: { ...makeGrid([1, 2]).degrees, B: [] } };
  assert.deepEqual(toggleTier(empty, 'B', counts).degrees.B, [1, 2]);
});

test('counts by tier and degree, for the dots', () => {
  const c = gridCounts({ 1: [{ tier: 'S' }, { tier: 'S' }, { tier: 'B' }, {}], 2: [{ tier: 'S' }, { tier: 'X' }] });
  assert.equal(c.S[1], 2);
  assert.equal(c.B[1], 1);
  assert.equal(c.D[1], 1);
  assert.equal(c.S[2], 1);
  assert.equal(c.D[2], 1);
  assert.equal(c.A[1], undefined);
});
