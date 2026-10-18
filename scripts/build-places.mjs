#!/usr/bin/env node
/**
 * Builds the Map tab's two data files from public sources, offline:
 *
 *   public/geo/world.json   the world's countries, Natural Earth 1:110m (public domain),
 *                           coordinates rounded to 0.01 degrees, Antarctica left out
 *   public/geo/places.json  the gazetteer lib/places.js reads: countries, regions, cities
 *
 *   node scripts/build-places.mjs --world <ne_110m_admin_0_countries.geojson> \
 *     ( --geonames <folder>  |  --ne-places <ne_110m_populated_places_simple.geojson> )
 *
 * --geonames is the real gazetteer: a folder holding GeoNames' cities15000.txt,
 * admin1CodesASCII.txt and countryInfo.txt (https://download.geonames.org/export/dump/,
 * CC BY 4.0, credited in docs/PLACES.md). Every city of 15,000 people or more.
 *
 * --ne-places is the stand-in until then: Natural Earth's 243 populated places
 * (public domain) and the few dozen cities in EXTRA_CITIES below, so the tab
 * and its tests work before GeoNames is fetched.
 *
 * Only the two output files are committed, never the sources. Nothing here goes
 * online: fetch the sources yourself, then point this at them.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { geoArea, geoCentroid } from 'd3';
import { normPlace } from '../lib/places.js';

const OUT_DIR = 'public/geo';
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

// Natural Earth leaves a few countries' ISO codes as -99; these are theirs.
const NE_CODES = { FRA: 'FR', NOR: 'NO', CYN: null, SOL: null, KOS: 'XK' };
// What a country is called on the map and in the app, where the source's name isn't it.
const DISPLAY = { US: 'United States', RU: 'Russia', KR: 'South Korea', KP: 'North Korea', CD: 'Democratic Republic of the Congo', CG: 'Republic of the Congo', CZ: 'Czechia', TR: 'Türkiye', IR: 'Iran', SY: 'Syria', VN: 'Vietnam', LA: 'Laos', TZ: 'Tanzania', BO: 'Bolivia', VE: 'Venezuela', MD: 'Moldova', MK: 'North Macedonia', SZ: 'Eswatini', BN: 'Brunei', TW: 'Taiwan', HK: 'Hong Kong', MO: 'Macao', PS: 'Palestine' };

/**
 * The stand-in's cities beyond Natural Earth's 243: real places, with their
 * centre to about a kilometre and a rounded population. [name, country, region, lat, lon, population].
 * Not used with --geonames, which has all of them and thousands more.
 */
const EXTRA_CITIES = [
  ['Seattle', 'US', 'Washington', 47.61, -122.33, 750000], ['Spokane', 'US', 'Washington', 47.66, -117.43, 230000],
  ['Portland', 'US', 'Oregon', 45.52, -122.68, 650000], ['Portland', 'US', 'Maine', 43.66, -70.26, 68000],
  ['San Diego', 'US', 'California', 32.72, -117.16, 1390000], ['San Jose', 'US', 'California', 37.34, -121.89, 1000000],
  ['Oakland', 'US', 'California', 37.8, -122.27, 430000], ['Sacramento', 'US', 'California', 38.58, -121.49, 525000],
  ['Boston', 'US', 'Massachusetts', 42.36, -71.06, 675000], ['Cambridge', 'US', 'Massachusetts', 42.37, -71.11, 118000],
  ['Philadelphia', 'US', 'Pennsylvania', 39.95, -75.17, 1600000], ['Pittsburgh', 'US', 'Pennsylvania', 40.44, -80.0, 300000],
  ['Austin', 'US', 'Texas', 30.27, -97.74, 960000], ['Dallas', 'US', 'Texas', 32.78, -96.8, 1300000],
  ['Fort Worth', 'US', 'Texas', 32.76, -97.33, 920000], ['San Antonio', 'US', 'Texas', 29.42, -98.49, 1450000],
  ['Phoenix', 'US', 'Arizona', 33.45, -112.07, 1600000], ['Las Vegas', 'US', 'Nevada', 36.17, -115.14, 640000],
  ['Salt Lake City', 'US', 'Utah', 40.76, -111.89, 200000], ['Minneapolis', 'US', 'Minnesota', 44.98, -93.27, 430000],
  ['Saint Paul', 'US', 'Minnesota', 44.95, -93.09, 310000], ['St. Louis', 'US', 'Missouri', 38.63, -90.2, 300000],
  ['Kansas City', 'US', 'Missouri', 39.1, -94.58, 510000], ['Nashville', 'US', 'Tennessee', 36.16, -86.78, 690000],
  ['Charlotte', 'US', 'North Carolina', 35.23, -80.84, 880000], ['Raleigh', 'US', 'North Carolina', 35.78, -78.64, 470000],
  ['Durham', 'US', 'North Carolina', 35.99, -78.9, 280000], ['Chapel Hill', 'US', 'North Carolina', 35.91, -79.06, 61000],
  ['Orlando', 'US', 'Florida', 28.54, -81.38, 310000], ['Tampa', 'US', 'Florida', 27.95, -82.46, 400000],
  ['Fort Lauderdale', 'US', 'Florida', 26.12, -80.14, 180000], ['Jacksonville', 'US', 'Florida', 30.33, -81.66, 950000],
  ['Baltimore', 'US', 'Maryland', 39.29, -76.61, 585000], ['Cleveland', 'US', 'Ohio', 41.5, -81.69, 370000],
  ['Akron', 'US', 'Ohio', 41.08, -81.52, 190000], ['Columbus', 'US', 'Ohio', 39.96, -83.0, 900000],
  ['Detroit', 'US', 'Michigan', 42.33, -83.05, 640000], ['Indianapolis', 'US', 'Indiana', 39.77, -86.16, 880000],
  ['Brooklyn', 'US', 'New York', 40.65, -73.95, 2600000], ['New Orleans', 'US', 'Louisiana', 29.95, -90.07, 380000],
  ['Honolulu', 'US', 'Hawaii', 21.31, -157.86, 350000], ['Boulder', 'US', 'Colorado', 40.01, -105.27, 105000],
  ['Montreal', 'CA', 'Quebec', 45.5, -73.57, 1760000], ['Calgary', 'CA', 'Alberta', 51.05, -114.07, 1300000],
  ['Waterloo', 'CA', 'Ontario', 43.46, -80.52, 120000],
  ['Manchester', 'GB', 'England', 53.48, -2.24, 400000], ['Birmingham', 'GB', 'England', 52.49, -1.89, 1100000],
  ['Cambridge', 'GB', 'England', 52.21, 0.12, 145000], ['Bristol', 'GB', 'England', 51.45, -2.59, 470000],
  ['Edinburgh', 'GB', 'Scotland', 55.95, -3.19, 480000],
  ['Munich', 'DE', 'Bavaria', 48.14, 11.58, 1500000], ['Hamburg', 'DE', 'Hamburg', 53.55, 9.99, 1800000],
  ['Frankfurt am Main', 'DE', 'Hesse', 50.11, 8.68, 750000], ['Barcelona', 'ES', 'Catalonia', 41.39, 2.17, 1600000],
  ['Milan', 'IT', 'Lombardy', 45.46, 9.19, 1350000], ['Zurich', 'CH', 'Zurich', 47.37, 8.54, 410000],
  ['Lyon', 'FR', 'Auvergne-Rhône-Alpes', 45.76, 4.84, 520000], ['Rotterdam', 'NL', 'South Holland', 51.92, 4.48, 650000],
  ['Hyderabad', 'IN', 'Telangana', 17.39, 78.49, 6800000], ['Chennai', 'IN', 'Tamil Nadu', 13.08, 80.27, 4600000],
  ['Pune', 'IN', 'Maharashtra', 18.52, 73.86, 3100000], ['Gurgaon', 'IN', 'Haryana', 28.46, 77.03, 880000],
  ['Shenzhen', 'CN', 'Guangdong', 22.54, 114.06, 12000000],
  ['Brisbane', 'AU', 'Queensland', -27.47, 153.03, 2400000], ['Perth', 'AU', 'Western Australia', -31.95, 115.86, 2000000],
];
// Natural Earth names some capitals' regions after a borough; the region a profile names is these.
const NE_REGION_FIX = { 'London|GB': 'England', 'Toronto|CA': 'Ontario', 'Vancouver|CA': 'British Columbia' };

function args() {
  const a = process.argv.slice(2);
  const get = (flag) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : null);
  return { world: get('--world'), geonames: get('--geonames'), nePlaces: get('--ne-places') };
}

const roundRing = (ring) => {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
};
// A ring rounding leaves with fewer than four points is a speck (or was a
// stray in the source, as one of North Korea's is): it's dropped, and a polygon
// whose outer ring goes goes with it, since d3-geo can't draw either.
const roundPolygon = (poly) => {
  const rings = poly.map(roundRing);
  return rings[0].length < 4 ? null : rings.filter((r) => r.length >= 4);
};
const roundGeometry = (g) => {
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(roundPolygon).filter(Boolean);
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
};

/** A country's middle: the centroid of its largest piece, so France isn't pulled toward French Guiana. */
function middleOf(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  let bestArea = -1;
  for (const coordinates of polys) {
    const g = { type: 'Polygon', coordinates };
    const a = geoArea(g);
    if (a > bestArea) { bestArea = a; best = g; }
  }
  const [lon, lat] = geoCentroid(best);
  return [round(lat), round(lon)];
}

function codeOf(p) {
  if (p.ADM0_A3 in NE_CODES) return NE_CODES[p.ADM0_A3];
  return p.ISO_A2 && p.ISO_A2 !== '-99' ? p.ISO_A2 : null;
}

function readWorld(file) {
  const ne = JSON.parse(readFileSync(file, 'utf8'));
  const features = [];
  const countries = new Map();
  for (const f of ne.features) {
    const p = f.properties;
    if (p.ADM0_A3 === 'ATA') continue;
    const code = codeOf(p);
    features.push({ type: 'Feature', id: code || p.ADM0_A3, properties: { name: p.NAME }, geometry: roundGeometry(f.geometry) });
    if (!code || countries.has(code)) continue;
    const display = DISPLAY[code] || (/\./.test(p.NAME) ? p.NAME_LONG : p.NAME);
    const names = [...new Set([p.NAME, p.NAME_LONG, p.ADMIN, p.FORMAL_EN, p.NAME_SORT, p.NAME_ALT].filter(Boolean))].filter((n) => n !== display);
    const [lat, lon] = middleOf(f.geometry);
    countries.set(code, { code, name: display, lat, lon, names });
  }
  return { world: { type: 'FeatureCollection', features }, countries };
}

/** GeoNames: cities of 15,000 or more, their first-level regions, and every country's name. */
function readGeonames(dir) {
  const lines = (f) => readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const admin1 = new Map(lines('admin1CodesASCII.txt').map((l) => { const c = l.split('\t'); return [c[0], c[1]]; }));
  const names = new Map(lines('countryInfo.txt').map((l) => { const c = l.split('\t'); return [c[0], c[4]]; }));
  const cities = lines('cities15000.txt').map((l) => {
    const c = l.split('\t');
    // Column 17 is the city's IANA time zone ("America/New_York"): kept for the
    // class spec's best-time-to-send, in the recipient's own hours.
    return { name: c[1], cc: c[8], region: admin1.get(`${c[8]}.${c[10]}`) || '', lat: Number(c[4]), lon: Number(c[5]), pop: Number(c[14]) || 0, tz: c[17] || '' };
  });
  return { cities, names, source: 'GeoNames cities15000 (CC BY 4.0) and Natural Earth 1:110m countries (public domain)' };
}

/** The stand-in: Natural Earth's populated places, and EXTRA_CITIES. */
function readStandIn(file) {
  const ne = JSON.parse(readFileSync(file, 'utf8'));
  const cities = [];
  const names = new Map();
  // The same city from both lists once; two cities of one name in one country (Portland, Oregon and Maine) both.
  const add = (c) => {
    const twin = cities.find((o) => o.cc === c.cc && normPlace(o.name) === normPlace(c.name)
      && Math.abs(o.lat - c.lat) < 1 && Math.abs(o.lon - c.lon) < 1);
    if (!twin) cities.push(c);
  };
  for (const f of ne.features) {
    const p = f.properties;
    if (!p.iso_a2 || p.iso_a2 === '-99') continue;
    const region = NE_REGION_FIX[`${p.name}|${p.iso_a2}`] || p.adm1name || '';
    add({ name: p.name, cc: p.iso_a2, region, lat: round(p.latitude), lon: round(p.longitude), pop: p.pop_max || 0 });
    if (p.adm0name && !names.has(p.iso_a2)) names.set(p.iso_a2, p.adm0name);
  }
  for (const [name, cc, region, lat, lon, pop] of EXTRA_CITIES) add({ name, cc, region, lat, lon, pop });
  return { cities, names, source: 'stand-in: Natural Earth 1:110m populated places and countries (public domain), and a few dozen more cities typed in' };
}

function main() {
  const { world: worldFile, geonames, nePlaces } = args();
  if (!worldFile || !(geonames || nePlaces)) {
    console.error('usage: node scripts/build-places.mjs --world <ne_110m_admin_0_countries.geojson> (--geonames <folder> | --ne-places <ne_110m_populated_places_simple.geojson>)');
    process.exit(2);
  }
  for (const f of [worldFile, geonames, nePlaces].filter(Boolean)) {
    if (!existsSync(f)) { console.error(`not found: ${f}`); process.exit(2); }
  }
  const { world, countries } = readWorld(worldFile);
  const { cities, names, source } = geonames ? readGeonames(geonames) : readStandIn(nePlaces);
  cities.sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));

  // Regions: one per country and first-level region, at the middle of its cities, weighted by people.
  const regions = [];
  const regionIndex = new Map();
  const sums = [];
  for (const c of cities) {
    const k = `${c.cc}|${c.region}`;
    if (!regionIndex.has(k)) { regionIndex.set(k, regions.length); regions.push([c.cc, c.region]); sums.push({ w: 0, lat: 0, lon: 0, n: 0 }); }
    const s = sums[regionIndex.get(k)];
    const w = Math.max(c.pop, 1);
    s.w += w; s.lat += c.lat * w; s.lon += c.lon * w; s.n++;
  }
  const regionRows = regions.map(([cc, name], i) => [cc, name, round(sums[i].lat / sums[i].w), round(sums[i].lon / sums[i].w)]);

  // Countries: Natural Earth's shapes and names; one the shapes are too small to
  // hold (Singapore, Hong Kong, Malta) sits at its largest city.
  const biggest = new Map();
  for (const c of cities) if (!biggest.has(c.cc)) biggest.set(c.cc, c);
  for (const [code, name] of names) {
    if (countries.has(code)) {
      const c = countries.get(code);
      if (!DISPLAY[code] && name && name !== c.name) { c.names.push(c.name); c.name = name; }
      continue;
    }
    const top = biggest.get(code);
    if (top) countries.set(code, { code, name: DISPLAY[code] || name, lat: round(top.lat), lon: round(top.lon), names: [] });
  }
  const countryRows = [...countries.values()].sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => [c.code, c.name, c.lat, c.lon, ...[...new Set(c.names)].filter((n) => n !== c.name)]);

  // Time zones: a table of names, each city holding its index (GeoNames only; the stand-in has none).
  const zones = [...new Set(cities.map((c) => c.tz).filter(Boolean))].sort();
  const zoneIndex = new Map(zones.map((z, i) => [z, i]));
  const cityRows = cities.map((c) => {
    const row = [c.name, regionIndex.get(`${c.cc}|${c.region}`), round(c.lat), round(c.lon), c.pop];
    return c.tz && zoneIndex.has(c.tz) ? [...row, zoneIndex.get(c.tz)] : row;
  });
  const places = {
    about: 'The Map tab\'s gazetteer, built by scripts/build-places.mjs. Rows: countries [code, name, lat, lon, ...other names]; regions [code, name, lat, lon]; cities [name, region, lat, lon, population, zone?], zone an index into zones (IANA names). Credits: docs/PLACES.md.',
    source,
    countries: countryRows,
    regions: regionRows,
    cities: cityRows,
    ...(zones.length ? { zones } : {}),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const worldText = JSON.stringify(world);
  const placesText = JSON.stringify(places);
  writeFileSync(path.join(OUT_DIR, 'world.json'), worldText);
  writeFileSync(path.join(OUT_DIR, 'places.json'), placesText);
  console.log(`wrote ${OUT_DIR}/world.json  (${Math.round(worldText.length / 1024)} KB, ${world.features.length} countries)`);
  console.log(`wrote ${OUT_DIR}/places.json (${Math.round(placesText.length / 1024)} KB: ${countryRows.length} countries, ${regionRows.length} regions, ${cityRows.length} cities, ${zones.length} time zones)`);
  console.log(`  source: ${source}`);
}

main();
