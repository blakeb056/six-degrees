import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, NETWORK_GRID, DEGREES_GRID, makeGrid, shows, showing, showingIn,
  toggleCell, toggleTier, toggleDegree, showAllTiers, gridCounts,
  toggleTiers, showsDegree, sameGrid,
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

// Blake, 2026-10-12: "the user can click above where it says tiers, it can be toggled
// off or on and turns off all the tiering and leaves the user to pick which degree
// they want or not like usual".
test('Tiers off: every tier is in, at the degrees picked, whatever their tier', () => {
  const picked = toggleTier(toggleCell(NETWORK_GRID, 'S', 2, counts), 'C', counts);   // S at 1st and 2nd, C hidden
  const off = toggleTiers(picked);
  assert.equal(off.tiersOff, true);
  // Every degree a tier on screen showed: S's 2nd is everyone's 2nd now, and C is back in.
  assert.deepEqual(off.flat, [1, 2]);
  assert.equal(shows(off, 'C', 1), true);
  assert.equal(shows(off, 'A', 2), true);
  assert.equal(shows(off, undefined, 2), true);
  assert.equal(shows(off, 'S', 3), false);
  assert.equal(showingIn(off, counts, 'A'), 220);
  assert.equal(showing(off, counts), 450);
  // Nobody who was on screen goes when tiers turn off.
  assert.ok(showing(off, counts) >= showing(picked, counts));
});

test('with tiers off a degree switches like usual, and the last one on can\'t be', () => {
  const off = toggleTiers(NETWORK_GRID);
  assert.deepEqual(off.flat, [1]);
  const three = toggleDegree(off, 3, counts);
  assert.deepEqual(three.flat, [1, 3]);
  assert.equal(shows(three, 'S', 3), true);           // nobody in S at 3rd, but the degree is on for all
  assert.equal(showing(three, counts), 155);
  assert.deepEqual(toggleDegree(three, 3, counts).flat, [1]);
  assert.equal(toggleDegree(off, 1, counts), off);    // the last people on screen stay
  assert.equal(toggleDegree(off, 5, counts), off);    // nobody at 5th: nothing to switch
  assert.deepEqual(toggleDegree(off, 2).flat, [1, 2]);   // the legend under the map passes no counts
});

test('Tiers on again: the tier rows exactly as they were, whatever was picked meanwhile', () => {
  const picked = toggleTier(toggleCell(NETWORK_GRID, 'A', 3, counts), 'D', counts);
  const off = toggleDegree(toggleTiers(picked), 2, counts);
  const on = toggleTiers(off);
  assert.deepEqual(on, picked);
  assert.equal('tiersOff' in on || 'flat' in on, false);
  // The grid it was given is never changed.
  assert.equal(picked.tiersOff, undefined);
  assert.deepEqual(NETWORK_GRID.degrees.S, [1]);
});

test('a degree is on screen at any tier: the legend under the map', () => {
  assert.equal(showsDegree(NETWORK_GRID, 1), true);
  assert.equal(showsDegree(NETWORK_GRID, 2), false);
  assert.equal(showsDegree(toggleCell(NETWORK_GRID, 'B', 2, counts), 2), true);
  const off = toggleTiers(makeGrid([1, 3]));
  assert.equal(showsDegree(off, 3), true);
  assert.equal(showsDegree(toggleDegree(off, 3), 3), false);
});

test('Degrees and the Wi-Fi fan start with every degree and the tiers off', () => {
  const g = makeGrid([1, 2, 3], { tiersOff: true });
  assert.equal(g.tiersOff, true);
  assert.deepEqual(g.flat, [1, 2, 3]);
  assert.ok(TIERS.every((t) => [1, 2, 3].every((d) => shows(g, t, d))));
  // Tiers back on there: every tier at every degree, not an empty grid.
  assert.deepEqual(toggleTiers(g), makeGrid([1, 2, 3]));
  assert.equal(sameGrid(g, makeGrid([1, 2, 3], { tiersOff: true })), true);
  assert.equal(sameGrid(g, makeGrid([1, 2, 3])), false);
});

import { degreeOn, bandChips, toggleBand } from '../lib/tier-grid.js';

// Blake, 2026-10-15: "the tier and degree filter doesn't respond". The chips under the map
// lit a degree when any tier showed it (showsDegree), and a tap with no counts turned it on
// for every tier: with one tier off at the 2nd, tapping a lit 2nd put more people on.
test('REGRESSION: a lit degree chip under the map goes off when tapped, whatever the tiers show', () => {
  const partly = toggleDegree(toggleCell(NETWORK_GRID, 'S', 2, counts), 2, counts);   // every tier with people at 2nd
  const bOff = toggleCell(partly, 'A', 2, counts);                                      // A's 2nd off again: only S shows it
  assert.equal(showsDegree(bOff, 2), true);              // what the old chip lit
  assert.equal(degreeOn(bOff, 2, counts), false);        // the rule a tap follows: not every tier shows it
  for (const grid of [partly, toggleTiers(partly)]) {
    assert.equal(degreeOn(grid, 2, counts), true);
    const tapped = toggleBand(grid, { kind: 'degree', key: 2 }, counts);
    assert.equal(degreeOn(tapped, 2, counts), false);
    assert.ok(showing(tapped, counts) < showing(grid, counts), 'a lit chip tapped takes people off');
  }
});

test('degreeOn ignores tiers with nobody at that degree, and lights nothing nobody is at', () => {
  const two = toggleDegree(NETWORK_GRID, 2, counts);     // on for S and A, the tiers with people there
  assert.equal(degreeOn(two, 2, counts), true);
  assert.equal(degreeOn(two, 4, counts), false);
  assert.equal(degreeOn(toggleTier(two, 'A', counts), 2, counts), true);   // a hidden tier doesn't count
});

test('the chips under the map: tiers while Tiers is on, degrees while it is off, one tap each', () => {
  const grid = makeGrid([1, 2, 3]);
  const tiers = bandChips(grid, counts);
  assert.equal(tiers.by, 'tier');
  assert.deepEqual(tiers.chips.map((c) => [c.label, c.count, c.on]), [['S', 110, true], ['A', 225, true], ['B', 30, true], ['C', 40, true], ['D', 50, true]]);
  const noA = toggleBand(grid, tiers.chips[1], counts);
  assert.equal(shows(noA, 'A', 1), false);
  assert.equal(bandChips(noA, counts).chips[1].on, false);
  assert.deepEqual(toggleBand(noA, bandChips(noA, counts).chips[1], counts).hidden, []);

  const off = toggleTiers(grid);
  const degrees = bandChips(off, counts);
  assert.equal(degrees.by, 'degree');
  // The 1st to the 3rd always, and further only when someone is there; a degree with nobody is never lit.
  assert.deepEqual(degrees.chips.map((c) => [c.label, c.count, c.on]), [['1st', 150, true], ['2nd', 300, true], ['3rd', 5, true]]);
  assert.equal(bandChips(toggleTiers(makeGrid([1, 2, 3, 4])), { ...counts, B: { 1: 30, 4: 2 } }).chips.length, 4);
  assert.equal(bandChips(toggleTiers(grid), { S: { 1: 1 } }).chips[2].on, false);
  const no2 = toggleBand(off, degrees.chips[1], counts);
  assert.deepEqual(no2.flat, [1, 3]);
  // The last people on screen stay, from a chip as from the grid.
  const only1 = toggleBand(toggleBand(no2, { kind: 'degree', key: 3 }, counts), { kind: 'degree', key: 1 }, counts);
  assert.deepEqual(only1.flat, [1]);
});
