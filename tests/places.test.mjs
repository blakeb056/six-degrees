import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { makeGazetteer, placeFor, placePeople, normPlace, areaVariants, bestTier, nearestDegree, mixOf } from '../lib/places.js';
import { MODES, MODE_KEYS, FIRST_VIEW } from '../lib/app-tabs.js';

// The Map tab: location text to a point on the map, offline (lib/places.js).

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// A small gazetteer in the shipped file's shape, so these hold whatever the real one holds.
const FIXTURE = {
  countries: [
    ['US', 'United States', 39.8, -98.6, 'United States of America'], ['GB', 'United Kingdom', 54, -2],
    ['DE', 'Germany', 51.1, 10.4], ['IN', 'India', 22, 79], ['SG', 'Singapore', 1.29, 103.85],
    ['GE', 'Georgia', 42.3, 43.4], ['CA', 'Canada', 56, -106],
  ],
  regions: [
    ['US', 'Washington', 47.4, -120.5], ['US', 'Pennsylvania', 40.9, -77.8], ['US', 'California', 37, -120],
    ['US', 'New York', 42.9, -75.5], ['US', 'District of Columbia', 38.9, -77.03], ['US', 'Texas', 31, -99],
    ['US', 'Ohio', 40.3, -82.8], ['US', 'Oregon', 44, -120.5], ['US', 'Maine', 45.3, -69.2],
    ['GB', 'England', 52.3, -1.5], ['DE', 'Berlin', 52.52, 13.4], ['IN', 'Karnataka', 15, 76],
    ['SG', '', 1.29, 103.85], ['US', 'Georgia', 32.7, -83.4], ['CA', 'Ontario', 50, -85],
    ['US', 'Illinois', 40, -89], ['US', 'Florida', 28, -82], ['US', 'Massachusetts', 42.3, -71.8],
  ],
  cities: [
    ['Seattle', 0, 47.61, -122.33, 750000], ['Philadelphia', 1, 39.95, -75.17, 1600000],
    ['San Francisco', 2, 37.77, -122.42, 870000], ['San Jose', 2, 37.34, -121.89, 1000000],
    ['New York City', 3, 40.71, -74.01, 8800000], ['Washington, D.C.', 4, 38.9, -77.04, 690000],
    ['Dallas', 5, 32.78, -96.8, 1300000], ['Fort Worth', 5, 32.76, -97.33, 920000],
    ['Cleveland', 6, 41.5, -81.69, 370000], ['Akron', 6, 41.08, -81.52, 190000],
    ['Portland', 7, 45.52, -122.68, 650000], ['Portland', 8, 43.66, -70.26, 68000],
    ['London', 9, 51.51, -0.13, 8900000], ['Berlin', 10, 52.52, 13.4, 3600000],
    ['Bengaluru', 11, 12.97, 77.59, 8400000], ['Singapore', 12, 1.29, 103.85, 5600000],
    ['Atlanta', 13, 33.75, -84.39, 500000], ['Toronto', 14, 43.65, -79.38, 2800000],
    ['Chicago', 15, 41.88, -87.63, 2700000], ['Tampa', 16, 27.95, -82.46, 400000],
    ['Springfield', 17, 42.1, -72.59, 155000], ['St. Louis', 15, 38.63, -90.2, 300000],
  ],
};
const gaz = () => makeGazetteer(FIXTURE);
const where = (g, text) => {
  const p = placeFor(g, text);
  return p.status === 'placed' ? `${p.kind}:${p.label}${p.approx ? ' ~' : ''}${p.rough ? ' rough' : ''}` : p.status;
};

test('names are compared without case, accents or punctuation, and Saint is St', () => {
  assert.equal(normPlace('  São Paulo '), 'sao paulo');
  assert.equal(normPlace('Washington, D.C.'), 'washington dc');
  assert.equal(normPlace('Saint Louis'), normPlace('St. Louis'));
  assert.equal(normPlace('Île-de-France'), 'ile de france');
  assert.equal(normPlace('Türkiye'), 'turkiye');
});

test('the platform\'s metro forms come apart into the city they are named for', () => {
  assert.deepEqual(areaVariants('Greater Seattle Area'), { variants: ['greater seattle area', 'seattle'], metro: true });
  assert.deepEqual(areaVariants('San Francisco Bay Area').variants, ['san francisco bay area', 'san francisco bay', 'san francisco']);
  assert.deepEqual(areaVariants('Dallas-Fort Worth Metroplex').variants, ['dallas fort worth metroplex', 'dallas fort worth', 'dallas', 'fort worth']);
  assert.deepEqual(areaVariants('Cleveland/Akron').variants, ['cleveland akron', 'cleveland', 'akron']);
  assert.equal(areaVariants('Seattle').metro, false);
});

test('City, Region, Country, and the shorter ways profiles write it', () => {
  const g = gaz();
  assert.equal(where(g, 'Seattle, Washington, United States'), 'city:Seattle, Washington, United States');
  assert.equal(where(g, 'Philadelphia, Pennsylvania, United States'), 'city:Philadelphia, Pennsylvania, United States');
  assert.equal(where(g, 'London, England, United Kingdom'), 'city:London, England, United Kingdom');
  assert.equal(where(g, 'London, United Kingdom'), 'city:London, England, United Kingdom');
  assert.equal(where(g, 'Bengaluru, Karnataka, India'), 'city:Bengaluru, Karnataka, India');
  assert.equal(where(g, 'Berlin, Berlin, Germany'), 'city:Berlin, Germany');
  assert.equal(where(g, 'Toronto, Ontario, Canada'), 'city:Toronto, Ontario, Canada');
  // A two-letter state or province, or a region with no country.
  assert.equal(where(g, 'Seattle, WA'), 'city:Seattle, Washington, United States');
  assert.equal(where(g, 'Toronto, ON'), 'city:Toronto, Ontario, Canada');
  assert.equal(where(g, 'Dallas, Texas'), 'city:Dallas, Texas, United States');
  // The region picks between two cities of one name; the country's largest without one.
  assert.equal(where(g, 'Portland, Maine, United States'), 'city:Portland, Maine, United States');
  assert.equal(where(g, 'Portland, Oregon, United States'), 'city:Portland, Oregon, United States');
  assert.equal(where(g, 'Portland, United States'), 'city:Portland, Oregon, United States');
  // Georgia the state, not the country, when the country is said.
  assert.equal(where(g, 'Atlanta, Georgia, United States'), 'city:Atlanta, Georgia, United States');
  // Washington, D.C. keeps its comma; the state is the state.
  assert.equal(where(g, 'Washington, D.C., United States'), 'city:Washington, D.C., District of Columbia, United States');
  assert.equal(where(g, 'Washington, District of Columbia, United States'), 'city:Washington, D.C., District of Columbia, United States');
  assert.equal(where(g, 'Washington, United States'), 'region:Washington, United States ~');
  // Case, accents and spacing don't matter.
  assert.equal(where(g, '  seattle ,  washington ,  UNITED STATES '), 'city:Seattle, Washington, United States');
  assert.equal(where(g, 'St Louis, Illinois, USA'), 'city:St. Louis, Illinois, United States');
});

test('the platform\'s Area forms: Greater X, X Area, Metropolitan Area, Bay Area, Metroplex', () => {
  const g = gaz();
  const cases = {
    'Greater Seattle Area': 'city:Seattle, Washington, United States',
    'Greater Philadelphia': 'city:Philadelphia, Pennsylvania, United States',
    'London Area, United Kingdom': 'city:London, England, United Kingdom',
    'San Francisco Bay Area': 'city:San Francisco, California, United States',
    'New York City Metropolitan Area': 'city:New York City, New York, United States',
    'Dallas-Fort Worth Metroplex': 'city:Dallas, Texas, United States',
    'Greater Tampa Bay Area': 'city:Tampa, Florida, United States',
    'Cleveland/Akron, Ohio Area': 'city:Cleveland, Ohio, United States',
    'Portland, Oregon Metropolitan Area': 'city:Portland, Oregon, United States',
    'Washington DC-Baltimore Area': 'city:Washington, D.C., District of Columbia, United States',
    'Greater Chicago Area': 'city:Chicago, Illinois, United States',
    'Greater Bengaluru Area': 'city:Bengaluru, Karnataka, India',
    'Greater Toronto Area, Canada': 'city:Toronto, Ontario, Canada',
    'Bay Area': 'city:San Francisco, California, United States',
    'New York, New York, United States': 'city:New York City, New York, United States',
    'New York, United States': 'city:New York City, New York, United States',
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(where(g, text), want, text);
});

test('a country or a region alone goes to its middle, marked approximate', () => {
  const g = gaz();
  const germany = placeFor(g, 'Germany');
  assert.deepEqual([germany.kind, germany.approx, germany.lat, germany.lon], ['country', true, 51.1, 10.4]);
  assert.equal(where(g, 'United States'), 'country:United States ~');
  assert.equal(where(g, 'USA'), 'country:United States ~');
  assert.equal(where(g, 'United States of America'), 'country:United States ~');
  assert.equal(where(g, 'UK'), 'country:United Kingdom ~');
  assert.equal(where(g, 'Georgia'), 'country:Georgia ~');
  assert.equal(where(g, 'Singapore'), 'country:Singapore ~');
  assert.equal(where(g, 'Singapore, Singapore'), 'city:Singapore');
  assert.equal(where(g, 'Texas'), 'region:Texas, United States ~');
  assert.equal(where(g, 'England, United Kingdom'), 'region:England, United Kingdom ~');
});

test('a city it doesn\'t have goes to the region or country named, marked rough; nothing else is guessed', () => {
  const g = gaz();
  assert.equal(where(g, 'Springfield, Illinois, United States'), 'region:Illinois, United States ~ rough');
  assert.equal(where(g, 'Smallville, Kansas, United States'), 'country:United States ~ rough');
  assert.equal(where(g, 'Bonn, Germany'), 'country:Germany ~ rough');
  for (const text of ['Remote', 'Planet Earth', 'Worldwide', 'Atlantis, Ocean', '東京', ',,', 'Tokyo, Japan']) {
    assert.equal(placeFor(g, text).status, 'unmatched', text);
  }
  for (const text of ['', '   ', null, undefined, 42]) assert.equal(placeFor(g, text).status, 'none');
});

test('everyone by place: one dot per place, the rest counted', () => {
  const g = gaz();
  const people = [
    { id: 'a', tier: 'B', degree: 2, location: 'Seattle, Washington, United States' },
    { id: 'b', tier: 'S', degree: 1, location: 'Greater Seattle Area' },
    { id: 'c', tier: 'C', degree: 2, location: 'Seattle, WA' },
    { id: 'd', tier: 'A', degree: 3, location: 'Germany' },
    { id: 'e', tier: 'D', degree: 1, location: '' },
    { id: 'f', tier: 'D', degree: 1 },
    { id: 'g', tier: 'B', degree: 2, location: 'Remote' },
    { id: 'h', tier: 'B', degree: 2, location: 'Remote' },
    { id: 'i', tier: 'B', degree: 2, location: 'Planet Earth' },
    { id: 'j', tier: 'C', degree: 1, location: 'Springfield, Illinois, United States' },
  ];
  const w = placePeople(g, people);
  assert.equal(w.placed, 5);
  assert.deepEqual(w.places.map((p) => [p.label, p.count]), [
    ['Seattle, Washington, United States', 3], ['Germany', 1], ['Illinois, United States', 1],
  ]);
  const seattle = w.places[0];
  assert.deepEqual(seattle.people.map((p) => p.id), ['a', 'b', 'c']);
  assert.equal(bestTier(seattle.people), 'S');
  assert.equal(nearestDegree(seattle.people), 1);
  assert.equal(w.places[1].approx, true);
  assert.deepEqual(w.none.map((p) => p.id), ['e', 'f']);
  assert.deepEqual(w.unmatched.map((u) => [u.text, u.count]), [['Remote', 2], ['Planet Earth', 1]]);
  assert.deepEqual(w.rough.map((u) => [u.text, u.count]), [['Springfield, Illinois, United States', 1]]);
  // Each text is worked out once.
  assert.ok(g.cache.has('Remote') && g.cache.size <= 8);
  assert.equal(bestTier([{ tier: null }, { tier: 'C' }]), 'C');
  assert.equal(bestTier([]), 'D');
  assert.equal(nearestDegree([{ degree: 3 }, { degree: 2 }]), 2);
  // A dot is drawn as its mix: tiers S to D, degrees 1st to 3rd, the empty ones left out.
  assert.deepEqual(mixOf(seattle.people, 'tier'), [['S', 1], ['B', 1], ['C', 1]]);
  assert.deepEqual(mixOf(seattle.people, 'degree'), [[1, 1], [2, 2]]);
  assert.deepEqual(mixOf([{ tier: null, degree: 5 }, { tier: 'X' }], 'tier'), [['D', 2]]);
  assert.deepEqual(mixOf([{ degree: 5 }, {}], 'degree'), [[1, 1], [3, 1]]);
});

// What ships: public/geo, built by scripts/build-places.mjs.
const shipped = JSON.parse(read('../public/geo/places.json'));
const world = JSON.parse(read('../public/geo/world.json'));

test('the shipped gazetteer and world are small, offline files the matcher reads', () => {
  for (const f of ['../public/geo/places.json', '../public/geo/world.json']) {
    assert.ok(statSync(new URL(f, import.meta.url)).size < 4 * 1024 * 1024, `${f} stays a few MB at most`);
  }
  assert.equal(world.type, 'FeatureCollection');
  assert.ok(world.features.length > 150);
  assert.ok(!world.features.some((f) => f.id === 'AQ' || f.properties?.name === 'Antarctica'));
  // Every ring is one d3-geo can draw: a speck left by rounding broke the whole map.
  const rings = world.features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flat());
  assert.deepEqual(rings.filter((r) => r.length < 4), []);
  assert.ok(shipped.countries.length > 190 && shipped.cities.length > 250);
  assert.match(shipped.source, /Natural Earth/);
  const g = makeGazetteer(shipped);
  const cases = [
    'Seattle, Washington, United States', 'Greater Seattle Area', 'Greater Philadelphia', 'London Area, United Kingdom',
    'San Francisco Bay Area', 'New York City Metropolitan Area', 'Dallas-Fort Worth Metroplex', 'Washington DC-Baltimore Area',
    'London, England, United Kingdom', 'Bengaluru, Karnataka, India', 'Toronto, Ontario, Canada', 'Greater Paris Metropolitan Region',
    'São Paulo, São Paulo, Brazil', 'Tel Aviv-Yafo, Tel Aviv District, Israel', 'Mexico City, Mexico',
  ];
  for (const text of cases) assert.equal(placeFor(g, text).kind, 'city', text);
  assert.equal(placeFor(g, 'Germany').kind, 'country');
  assert.equal(placeFor(g, 'Hong Kong SAR').kind, 'country');
  assert.equal(placeFor(g, 'Remote').status, 'unmatched');
});

test('the sample network has invented locations, and the Map tab shows it', () => {
  const sample = JSON.parse(read('../public/demo-data.json'));
  assert.equal(sample.meta.synthetic, true);
  const everyone = [...sample.degree1, ...sample.degree2];
  const w = placePeople(makeGazetteer(shipped), everyone);
  assert.ok(w.places.length >= 30, 'people in many places');
  assert.ok(w.placed > everyone.length * 0.8);
  assert.ok(w.none.length > 0, 'some without a location yet, as a network mid-scan has');
  assert.deepEqual(w.unmatched.map((u) => u.text).sort(), ['Planet Earth', 'Remote'], 'only the two that name no place');
  assert.deepEqual(w.rough, []);
});

test('Map is a tab of the map page, for your own network, a CSV and the sample alike', () => {
  assert.deepEqual(MODE_KEYS, ['network', 'degrees', 'separation', 'map']);
  assert.equal(MODES.find((m) => m.key === 'map').label, 'Map');
  assert.equal(FIRST_VIEW.map, 'worldmap');
  // The tab row draws every mode, whatever the network: only pages are filtered (own, scanner).
  const tabs = read('../app/components/AppTabs.js');
  assert.match(tabs, /import \{ MODES \} from '\.\.\/\.\.\/lib\/app-tabs'/);
  const modeLine = tabs.split('\n').find((l) => l.includes('MODES.map('));
  assert.ok(modeLine && !/IS_DEMO|csvMode|filter/.test(modeLine));
  // The view is registered for the tab, and a link from another page opens it (/?mode=map).
  assert.match(read('../app/components/views.js'), /worldmap: \{ component: WorldMap, +modes: \['map'\]/);
  const page = read('../app/page.js');
  assert.match(page, /const linkedMode = MODE_KEYS\.includes\(params\.get\('mode'\)\)/);
  assert.match(page, /map: MAP_GRID/);
  // Nothing online: the map reads this app's own files.
  const view = read('../app/components/WorldMap.js');
  const fetched = [...view.matchAll(/fetch\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(fetched, ['/geo/places.json', '/geo/world.json']);
  assert.doesNotMatch(view, /https?:\/\//);
});

// Phase 0 of the class spec: each city's time zone, kept from GeoNames' column 17
// (scripts/build-places.mjs), for best-time-to-send in the recipient's own hours.
test('a city carries its time zone when the gazetteer has zones, and none when it doesn’t', async () => {
  const { makeGazetteer, placeFor } = await import('../lib/places.js');
  const data = {
    countries: [['US', 'United States', 39.8, -98.6]],
    regions: [['US', 'Florida', 28.1, -81.6]],
    cities: [['Orlando', 0, 28.54, -81.38, 310000, 0], ['Tampa', 0, 27.95, -82.46, 400000]],
    zones: ['America/New_York'],
  };
  const gaz = makeGazetteer(data);
  assert.equal(placeFor(gaz, 'Orlando, Florida, United States').tz, 'America/New_York');
  assert.equal(placeFor(gaz, 'Tampa, Florida, United States').tz, null);
  assert.equal(placeFor(makeGazetteer({ ...data, zones: undefined }), 'Orlando, Florida').tz, null);
  const build = readFileSync(new URL('../scripts/build-places.mjs', import.meta.url), 'utf8');
  assert.match(build, /tz: c\[17\]/);
});
