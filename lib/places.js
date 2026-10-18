// Where people are, for the Map tab (Blake, 2026-10-14: "then we will have a
// map section that's part of the geo location").
//
// A person's `location` is the text their profile shows: "Seattle, Washington,
// United States", "Greater Philadelphia", "London Area, United Kingdom", "San
// Francisco Bay Area", or a country alone. This turns that text into a point
// on the map with a gazetteer that ships inside the app (public/geo/places.json,
// built by scripts/build-places.mjs). Nothing is looked up online: the app
// never goes online unasked.
//
// What it matches, in order (docs/PLACES.md has the whole story):
//   1. "City, Region, Country", and "City, Country", "City, Region";
//   2. the platform's own forms: "Greater X", "X Area", "X Metropolitan Area",
//      "X Metroplex", "X Bay Area", "A-B Area" (the first of the two cities);
//   3. a region or a country alone, at its middle, marked approximate.
// A city the gazetteer doesn't have, in a region or country it does, is placed
// at that region or country, marked approximate, and counted as rough. Text
// that names nothing it knows is counted and listed, never guessed.
//
// Plain functions, no React, so tests/places.test.mjs runs them as they are.

/** Lower case, no accents or punctuation, "Saint" as "St": the form every name is compared in. */
export function normPlace(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.'\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bsainte\b/g, 'ste')
    .trim();
}

// Other names for a country, beyond the gazetteer's own. England, Scotland,
// Wales and Northern Ireland count as the United Kingdom, so "London, England"
// finds London and "Scotland" alone lands on the UK, marked approximate.
const COUNTRY_ALIASES = {
  US: ['USA', 'U.S.', 'U.S.A.', 'US', 'United States', 'United States of America', 'America'],
  GB: ['UK', 'U.K.', 'United Kingdom', 'Great Britain', 'Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  AE: ['UAE', 'U.A.E.', 'United Arab Emirates'],
  KR: ['South Korea', 'Korea', 'Republic of Korea', 'Korea, Republic of'],
  KP: ['North Korea'],
  CZ: ['Czechia', 'Czech Republic'],
  TR: ['Turkey', 'T\u00fcrkiye', 'Turkiye'],
  NL: ['Netherlands', 'The Netherlands', 'Holland'],
  RU: ['Russia', 'Russian Federation'],
  VN: ['Vietnam', 'Viet Nam'],
  HK: ['Hong Kong', 'Hong Kong SAR'],
  MO: ['Macau', 'Macao', 'Macao SAR', 'Macau SAR'],
  TW: ['Taiwan'],
  CN: ['China', "People's Republic of China", 'Mainland China'],
  CI: ["C\u00f4te d'Ivoire", 'Cote dIvoire', 'Ivory Coast'],
  CD: ['Democratic Republic of the Congo', 'DR Congo', 'DRC', 'Congo (DRC)'],
  CG: ['Republic of the Congo', 'Congo'],
  IR: ['Iran'],
  SY: ['Syria'],
  LA: ['Laos'],
  MK: ['North Macedonia', 'Macedonia'],
  SZ: ['Eswatini', 'Swaziland'],
  MM: ['Myanmar', 'Burma'],
  PS: ['Palestine', 'Palestinian Territories', 'State of Palestine'],
  TZ: ['Tanzania'],
  BO: ['Bolivia'],
  VE: ['Venezuela'],
  MD: ['Moldova'],
  BA: ['Bosnia and Herzegovina', 'Bosnia'],
  DO: ['Dominican Republic'],
  CF: ['Central African Republic'],
  GQ: ['Equatorial Guinea'],
  SS: ['South Sudan'],
  TL: ['Timor-Leste', 'East Timor'],
  CV: ['Cape Verde', 'Cabo Verde'],
  BN: ['Brunei'],
  VA: ['Vatican City', 'Holy See'],
};

// Two-letter states and provinces, for "Seattle, WA" and "Toronto, ON".
const REGION_ABBR = {
  US: {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
    DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  },
  CA: {
    AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
    NS: 'Nova Scotia', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan',
  },
};

// Other names for a city: the platform's nicknames for a metro, and the names a
// city goes by in its own language or went by before. Each is tried after the
// name as written, and every name it lists is tried in turn.
const CITY_ALIASES = {
  'bay area': ['san francisco'],
  'sf bay': ['san francisco'],
  'sf': ['san francisco'],
  'silicon valley': ['san jose'],
  'twin cities': ['minneapolis'],
  'research triangle': ['raleigh'],
  'gta': ['toronto'],
  'nyc': ['new york city', 'new york'],
  'new york city': ['new york'],
  'new york': ['new york city'],
  'dfw': ['dallas'],
  'washington': ['washington dc'],
  'washington dc': ['washington'],
  'bengaluru': ['bangalore'],
  'bangalore': ['bengaluru'],
  'gurugram': ['gurgaon'],
  'gurgaon': ['gurugram'],
  'bombay': ['mumbai'],
  'madras': ['chennai'],
  'calcutta': ['kolkata'],
  'saigon': ['ho chi minh city'],
  'munchen': ['munich'],
  'koln': ['cologne'],
  'wien': ['vienna'],
  'praha': ['prague'],
  'roma': ['rome'],
  'milano': ['milan'],
  'torino': ['turin'],
  'napoli': ['naples'],
  'firenze': ['florence'],
  'lisboa': ['lisbon'],
  'warszawa': ['warsaw'],
  'krakow': ['krakow', 'cracow'],
  'geneve': ['geneva'],
  'bruxelles': ['brussels'],
  'brussel': ['brussels'],
  'den haag': ['the hague'],
  's gravenhage': ['the hague'],
  'kobenhavn': ['copenhagen'],
  'goteborg': ['gothenburg'],
  'tel aviv yafo': ['tel aviv'],
  'tel aviv': ['tel aviv yafo'],
  'frankfurt': ['frankfurt am main'],
  'mexico city': ['mexico city', 'ciudad de mexico'],
  'cdmx': ['mexico city'],
};

// The platform's metro forms, taken off a place before it is looked up as a city.
const AREA_PREFIX = /^greater\s+/i;
const AREA_SUFFIX = /\s+(metropolitan area|metropolitan region|metro area|metroplex|metro|area|region)$/i;

/**
 * The names to try for one comma-separated part, in order, and whether it was
 * written as a metro ("Greater X", "X Area"): the part as written, then without
 * the metro words, without a trailing "Bay" (San Francisco Bay, Tampa Bay), and
 * each city of "A-B" or "A/B" (Dallas-Fort Worth, Cleveland/Akron).
 */
export function areaVariants(part) {
  const raw = String(part ?? '').trim();
  let core = raw;
  let metro = false;
  for (let i = 0; i < 3; i++) {
    const next = core.replace(AREA_PREFIX, '').replace(AREA_SUFFIX, '').trim();
    if (next === core || !next) break;
    core = next;
    metro = true;
  }
  const out = [];
  const add = (text) => {
    const n = normPlace(text);
    if (n && !out.includes(n)) out.push(n);
  };
  add(raw);
  add(core);
  if (/\s+bay$/i.test(core)) add(core.replace(/\s+bay$/i, ''));
  const pieces = core.split(/\s*[-\u2013/]\s*/).filter(Boolean);
  if (pieces.length > 1) {
    for (const piece of pieces) {
      add(piece);
      if (/\s+bay$/i.test(piece)) add(piece.replace(/\s+bay$/i, ''));
    }
  }
  return { variants: out, metro };
}

const byPop = (a, b) => b.pop - a.pop;

/**
 * The lookups for a gazetteer file (public/geo/places.json): `countries` rows are
 * [code, name, lat, lon, ...other names], `regions` [code, name, lat, lon],
 * `cities` [name, region index, lat, lon, population]. Built once; placeFor
 * keeps its answers on it, so each distinct text is worked out once.
 */
export function makeGazetteer(data = {}) {
  const countries = new Map();
  const countryByName = new Map();
  const nameCountry = (name, code) => {
    const n = normPlace(name);
    if (n && !countryByName.has(n)) countryByName.set(n, code);
  };
  for (const [code, name, lat, lon, ...alt] of data.countries || []) {
    countries.set(code, { code, name, lat, lon });
    nameCountry(name, code);
  }
  // The gazetteer's own names first, then the aliases, then the other names it
  // lists (so "Georgia" stays the country, and "Congo" the Republic of the Congo).
  for (const [code, names] of Object.entries(COUNTRY_ALIASES)) {
    if (countries.has(code)) for (const name of names) nameCountry(name, code);
  }
  for (const [code, , , , ...alt] of data.countries || []) for (const name of alt) nameCountry(name, code);

  const regions = (data.regions || []).map(([cc, name, lat, lon], i) => ({ i, cc, name, lat, lon, pop: 0 }));
  // A city's time zone, when the file has them (scripts/build-places.mjs keeps GeoNames' column 17): an index into `zones`.
  const zones = Array.isArray(data.zones) ? data.zones : [];
  const cities = (data.cities || []).map(([name, r, lat, lon, pop, z], i) => {
    const region = regions[r] || null;
    return { i, name, region, cc: region?.cc || null, lat, lon, pop: Number(pop) || 0, tz: Number.isInteger(z) ? zones[z] || null : null };
  });
  for (const c of cities) if (c.region) c.region.pop += c.pop;

  const regionByName = new Map();
  const nameRegion = (name, region) => {
    const n = normPlace(name);
    if (!n) return;
    const list = regionByName.get(n) || [];
    if (!list.includes(region)) list.push(region);
    regionByName.set(n, list);
  };
  for (const r of regions) {
    if (!r.name) continue;
    nameRegion(r.name, r);
    const abbr = REGION_ABBR[r.cc];
    if (abbr) {
      for (const [short, full] of Object.entries(abbr)) if (normPlace(full) === normPlace(r.name)) nameRegion(short, r);
    }
  }
  for (const list of regionByName.values()) list.sort(byPop);

  const cityByName = new Map();
  for (const c of cities) {
    const n = normPlace(c.name);
    if (!n) continue;
    const list = cityByName.get(n) || [];
    list.push(c);
    cityByName.set(n, list);
  }
  for (const list of cityByName.values()) list.sort(byPop);

  return { countries, countryByName, regions, regionByName, cities, cityByName, cache: new Map(), source: data.source || null };
}

/** The country a part names, as its code, or null. */
function countryOf(gaz, part) {
  return gaz.countryByName.get(normPlace(part)) || null;
}

/** The regions a part names (metro words taken off: "Ohio Area" is Ohio), largest first, in one country if given. */
function regionsOf(gaz, part, cc) {
  const found = [];
  for (const n of areaVariants(part).variants.slice(0, 2)) {
    for (const r of gaz.regionByName.get(n) || []) {
      if ((!cc || r.cc === cc) && !found.includes(r)) found.push(r);
    }
  }
  return found.sort(byPop);
}

/**
 * The most populous city a part names, in that country when it's known. With a
 * region it knows, only a city in that region: "Springfield, Illinois" is never
 * the Springfield in Massachusetts.
 */
function cityOf(gaz, part, cc, region) {
  for (const n of areaVariants(part).variants) {
    let found = [];
    for (const name of [n, ...(CITY_ALIASES[n] || [])]) {
      for (const c of gaz.cityByName.get(name) || []) if (!found.includes(c)) found.push(c);
    }
    if (cc) found = found.filter((c) => c.cc === cc);
    if (region) found = found.filter((c) => c.region === region);
    if (!found.length) continue;
    return found.sort(byPop)[0];
  }
  return null;
}

const countryName = (gaz, cc) => gaz.countries.get(cc)?.name || cc;

function cityPlace(gaz, c) {
  const country = countryName(gaz, c.cc);
  const region = c.region?.name && normPlace(c.region.name) !== normPlace(c.name) && normPlace(c.region.name) !== normPlace(country)
    ? c.region.name : null;
  // A city-state is named once: "Singapore", not "Singapore, Singapore".
  const nation = normPlace(country) === normPlace(c.name) ? null : country;
  return {
    status: 'placed', key: `c:${c.i}`, kind: 'city', approx: false, name: c.name,
    label: [c.name, region, nation].filter(Boolean).join(', '), cc: c.cc, lat: c.lat, lon: c.lon, tz: c.tz || null,
  };
}

function regionPlace(gaz, r, rough) {
  return {
    status: 'placed', key: `r:${r.i}`, kind: 'region', approx: true, rough, name: r.name,
    label: `${r.name}, ${countryName(gaz, r.cc)}`, cc: r.cc, lat: r.lat, lon: r.lon,
  };
}

function countryPlace(gaz, cc, rough) {
  const c = gaz.countries.get(cc);
  if (!c || !Number.isFinite(c.lat)) return null;
  return {
    status: 'placed', key: `n:${cc}`, kind: 'country', approx: true, rough, name: c.name,
    label: c.name, cc, lat: c.lat, lon: c.lon,
  };
}

const NONE = Object.freeze({ status: 'none' });

function resolve(gaz, text) {
  // "Washington, D.C." is one place with a comma in it.
  const cleaned = text.replace(/,\s*D\.?\s?C\.?(?=\s*(,|$|-|\u2013|\s+area\b))/gi, ' DC');
  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  const unmatched = { status: 'unmatched', text };
  if (!parts.length) return unmatched;

  // The country, from the end; failing that, a region ("Seattle, WA", "Austin, Texas").
  let cc = countryOf(gaz, parts[parts.length - 1]);
  let rest = cc ? parts.slice(0, -1) : parts;
  let region = null;
  if (!cc && parts.length > 1) {
    region = regionsOf(gaz, parts[parts.length - 1], null)[0] || null;
    if (region) { cc = region.cc; rest = parts.slice(0, -1); }
  }
  // A country alone: at its middle, marked approximate.
  if (!rest.length) return countryPlace(gaz, cc, false) || unmatched;
  if (!region && rest.length > 1) region = regionsOf(gaz, rest[rest.length - 1], cc)[0] || null;

  if (rest.length === 1 && !region) {
    const part = rest[0];
    if (!cc) {
      const own = countryOf(gaz, part);
      if (own) return countryPlace(gaz, own, false) || unmatched;
    }
    const city = cityOf(gaz, part, cc, null);
    // "Greater X", "X Area": the city it's named for.
    if (city && areaVariants(part).metro) return cityPlace(gaz, city);
    const regions = regionsOf(gaz, part, cc);
    if (regions.length) {
      // A city that shares its region's name (Berlin, Hamburg, New York) is the city.
      if (city && regions.includes(city.region)) return cityPlace(gaz, city);
      return regionPlace(gaz, regions[0], false);
    }
    if (city) return cityPlace(gaz, city);
    return cc ? countryPlace(gaz, cc, true) || unmatched : unmatched;
  }

  const city = cityOf(gaz, rest[0], cc, region);
  if (city) return cityPlace(gaz, city);
  // A city the gazetteer doesn't have: its region or country, marked rough.
  if (region) return regionPlace(gaz, region, true);
  if (cc) return countryPlace(gaz, cc, true) || unmatched;
  return unmatched;
}

/**
 * Where one location text is: { status: 'none' } for no text, { status:
 * 'unmatched', text } for text it can't place, or { status: 'placed', key,
 * kind: 'city' | 'region' | 'country', approx, rough, name, label, cc, lat, lon, tz? }: a city's `tz` is its
 * IANA time zone when the gazetteer carries zones, else null.
 * `approx`: placed at a region's or a country's middle. `rough`: the text named
 * a city the gazetteer doesn't have, so it went to the region or country instead.
 */
export function placeFor(gaz, location) {
  const text = typeof location === 'string' ? location.trim() : '';
  if (!text) return NONE;
  const hit = gaz.cache.get(text);
  if (hit) return hit;
  const found = resolve(gaz, text);
  gaz.cache.set(text, found);
  return found;
}

const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];

/** The strongest tier among some people (no tier counts as D, as the map draws it). */
export function bestTier(people = []) {
  let best = 4;
  for (const p of people) {
    const i = TIER_ORDER.indexOf(p?.tier);
    best = Math.min(best, i < 0 ? 4 : i);
    if (best === 0) break;
  }
  return TIER_ORDER[best];
}

/** The nearest degree among some people. */
export function nearestDegree(people = []) {
  let best = Infinity;
  for (const p of people) {
    const d = Number(p?.degree) || 1;
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : 1;
}

/**
 * How many people of each tier (S to D, no tier as D), or at each degree (1st,
 * 2nd, 3rd and past it as 3rd), are in a list: [[tier or degree, count]], in
 * that order, leaving out the empty ones. A dot on the map is drawn as this mix.
 */
export function mixOf(people = [], by = 'tier') {
  const keys = by === 'degree' ? [1, 2, 3] : TIER_ORDER;
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const p of people) {
    const k = by === 'degree'
      ? Math.min(3, Math.max(1, Number(p?.degree) || 1))
      : (TIER_ORDER.includes(p?.tier) ? p.tier : 'D');
    counts.set(k, counts.get(k) + 1);
  }
  return [...counts].filter(([, n]) => n > 0);
}

/**
 * Everyone, by place. `places`: one per point on the map, most people first,
 * each with its `people`. `none`: the people with no location yet. `unmatched`:
 * [{ text, count, people }] for text that names nothing the gazetteer knows,
 * most first. `rough`: the same for text placed at a region or country because
 * its city isn't in the gazetteer. `placed`: how many people are on the map.
 */
export function placePeople(gaz, rows = []) {
  const byKey = new Map();
  const unmatched = new Map();
  const rough = new Map();
  const none = [];
  let placed = 0;
  const tally = (map, text, row) => {
    const entry = map.get(text) || { text, count: 0, people: [] };
    entry.count++;
    entry.people.push(row);
    map.set(text, entry);
  };
  for (const row of rows || []) {
    const text = typeof row?.location === 'string' ? row.location.trim() : '';
    const found = placeFor(gaz, text);
    if (found.status === 'none') { none.push(row); continue; }
    if (found.status === 'unmatched') { tally(unmatched, text, row); continue; }
    let place = byKey.get(found.key);
    if (!place) {
      const { status: _s, rough: _r, ...where } = found;
      place = { ...where, people: [] };
      byKey.set(found.key, place);
    }
    place.people.push(row);
    placed++;
    if (found.rough) tally(rough, text, row);
  }
  const most = (a, b) => b.count - a.count || a.text.localeCompare(b.text);
  const places = [...byKey.values()]
    .map((p) => ({ ...p, count: p.people.length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { places, none, unmatched: [...unmatched.values()].sort(most), rough: [...rough.values()].sort(most), placed };
}
