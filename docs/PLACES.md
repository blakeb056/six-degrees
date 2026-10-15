# Places: how the Map tab finds where people are

The Map tab draws your network on a world map, one dot per place. A person's
place comes from the location text their profile shows, matched against a
gazetteer that ships inside the app. **Nothing is looked up online**: the map,
the places and the matching are all files in this app (`public/geo/`), read by
`lib/places.js`.

## What it matches

Each location is split at its commas and read from the end.

1. **The country**, from the last part: its name, or a common other name
   (`USA`, `UK`, `UAE`, `Türkiye`, `Hong Kong SAR`; England, Scotland, Wales and
   Northern Ireland count as the United Kingdom). Failing that, the last part
   may be a state or region (`Seattle, WA`, `Austin, Texas`), which gives the country.
2. **City, Region, Country** (`Seattle, Washington, United States`): the city of
   that name in that region. A known region is strict: `Springfield, Illinois` is
   never the Springfield in Massachusetts. A region the gazetteer doesn't know
   (`Dublin, County Dublin, Ireland`) is ignored, and the country's largest city
   of that name is used.
3. **The platform's metro forms**, with the metro words taken off:
   `Greater Seattle Area`, `Greater Philadelphia`, `London Area, United Kingdom`,
   `New York City Metropolitan Area`, `Greater Paris Metropolitan Region`,
   `Dallas-Fort Worth Metroplex`, `San Francisco Bay Area` (and `Tampa Bay`), and
   `A-B` or `A/B` (`Washington DC-Baltimore Area`, `Cleveland/Akron, Ohio Area`),
   which go to the first city of the two. Without a country, the most populous
   city of that name wins. A few nicknames and older names are known too
   (`Bay Area`, `Bengaluru`/`Bangalore`, `Gurugram`/`Gurgaon`, `München`).
4. **A country alone** (`Germany`), or **a region alone** (`Texas`,
   `Washington, United States`), goes to its middle, **marked approximate**: its
   dot has a dashed ring. A city that shares its region's name stays the city
   (`Berlin, Germany`, `New York, United States`).
5. **A city the gazetteer doesn't have**, in a region or country it does
   (`Smallville, Kansas, United States`), goes to that region or country, marked
   approximate, and is listed under *placed by region or country only*.
6. **Anything else is counted and listed, never guessed**: `Remote`,
   `Planet Earth`, a place name in another script. The panel at the bottom left
   says how many people have no location yet, and lists the locations it didn't
   recognise with how many people each.

Names are compared without case, accents or punctuation, and `Saint` reads as
`St`. Each distinct text is worked out once.

## The data, and its credits

| File | What | Source | Licence |
|---|---|---|---|
| `public/geo/world.json` | The countries' outlines, 1:110m, Antarctica left out, coordinates rounded to 0.01° | [Natural Earth](https://www.naturalearthdata.com/) Admin 0 Countries | Public domain |
| `public/geo/places.json` | Countries (with their middles), first-level regions, cities | [GeoNames](https://www.geonames.org/) `cities15000`, `admin1CodesASCII`, `countryInfo`, and Natural Earth | GeoNames: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); Natural Earth: public domain |

`scripts/build-places.mjs` builds both from the downloaded sources, offline, and
only its two output files are committed. A region's middle is the average of its
cities, weighted by how many people live in each; a country's is the centre of
its largest piece of land (so France sits in France, not between it and French
Guiana), or its largest city when it's too small for the 1:110m outlines
(Singapore, Hong Kong, Malta).

```bash
node scripts/build-places.mjs --world ne_110m_admin_0_countries.geojson --geonames <folder with the three GeoNames files>
```

`places.json` is built from GeoNames' `cities15000` (every city of 15,000
people or more, about 34,000) since 2.3.0, and the Map credits GeoNames at its
bottom right, as CC BY 4.0 asks. Without the GeoNames files the script can
still build a **stand-in** with `--ne-places ne_110m_populated_places_simple.geojson`:
Natural Earth's 243 populated places (public domain) and a few dozen more
cities typed into the script. Its `source` field says which it is.

## The sample network

The people in `public/demo-data.json` are invented, and so are their locations:
`scripts/gen-synthetic.mjs` gives each one a plausible place from a fixed,
weighted list, written the ways profiles write them, with about one in ten left
blank and two that name no place, so every part of the tab has something to
show. `node scripts/gen-synthetic.mjs --locations-only` adds them to the file
without drawing the rest of the sample again.
