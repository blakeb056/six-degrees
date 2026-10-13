# The Sixgree network file, format 1.0

A network file is how any program hands Sixgree a network to import: an export of your
connections, an add-on that reads your network for you, or a list someone made by hand. It's
one documented, versioned format, so Sixgree never needs to know which program made a file,
and anyone can write one.

Sixgree's own reader and writer are in `lib/network-file.js`; the importer is
`lib/network-import.js`. Where this page and the code disagree, the code is wrong or this page
is stale: fix one of them in the same change.

## At a glance

A network file is a folder:

```
my-network/
  manifest.json          what this is, who made it, and a checksum for every file
  people.jsonl           everyone the file mentions, once each
  connections.jsonl      your own connections (1st degree)
  edges.jsonl            optional: people met through one of your connections (2nd degree)
  circles.jsonl          optional: how far each connection's own list was read
  ties.jsonl             optional: two of your connections who know each other
  company_scans.jsonl    optional: people found at a company (3rd degree)
  photos/                optional: pictures, each named by its own SHA-256
    3f1c…e9.webp
```

`manifest.json` and both `people.jsonl` and `connections.jsonl` are always there, even when
a file has no connections in it yet.

**Left out on purpose:** scores and tiers (Sixgree works them out itself), who introduced whom
and outreach status (they're yours, made in the app), any budget, cooldown or sign-in, and any
id a site uses privately (such as the one it searches someone's connections by).

## Compatibility

- `format` is always `"sixgree.network"`, and `format_version` is `"major.minor"`, now
  `"1.0"`. **Only the format's version is compared, never the app's**, so an older copy of
  Sixgree reads a newer file whenever only the minor number moved.
- **A newer major version is refused**, with "Update Sixgree, then import it again".
- **A newer minor version is read.** Fields and listed files this copy doesn't know are left
  out, counted, and the import says so. A minor version only ever adds; it never removes a
  field or changes what one means.
- **An older major version** is upgraded in memory when the reader knows how, and refused when
  it doesn't. 1.0 is the first version, so there is none yet.
- A field the format doesn't define is left out and counted at any version, never guessed at.

## Text, lines and values

- Every file is UTF-8, with no byte order mark.
- A `.jsonl` file has one JSON object per line. Every line ends with a line break (`\n`, and a
  `\r` before it is allowed), including the last, and no line is blank. One line is at most
  64 KB.
- Field names are `snake_case`.
- A **time** is ISO 8601 with its zone: `2026-10-12T20:30:00Z` or `2026-10-12T16:30:00-04:00`.
- A **date** is a calendar date with no zone: `2026-10-12`.
- A missing field and `null` both mean "not known". **A file never blanks a field**: an empty
  or missing value leaves what Sixgree has alone.

## Who is who: the profile link

A person is their **profile link**: the web address of their own page on the site the network
comes from. It's the key that joins every file together, and the only way Sixgree tells two
people apart.

A link can be written many ways, so every link in a file is read in its **canonical form**,
which is also how Sixgree stores it:

| Rule | Written | Canonical |
|---|---|---|
| https | `http://example.com/people/ada-lovelace` | `https://example.com/people/ada-lovelace/` |
| The host in lower case | `https://EXAMPLE.com/people/ada-lovelace` | `https://example.com/people/ada-lovelace/` |
| No query or fragment | `https://example.com/people/ada-lovelace?from=search#top` | `https://example.com/people/ada-lovelace/` |
| Exactly one `/` at the end | `https://example.com/people/ada-lovelace` or `…/ada-lovelace///` | `https://example.com/people/ada-lovelace/` |
| Escapes in capital hex | `https://example.com/people/jos%c3%a9` | `https://example.com/people/jos%C3%A9/` |
| Other characters escaped as UTF-8 | `https://example.com/people/josé` | `https://example.com/people/jos%C3%A9/` |
| Escaped letters, digits and `-._~` unescaped | `https://example.com/people/ada%2Dlovelace` | `https://example.com/people/ada-lovelace/` |
| The default port dropped | `https://example.com:443/people/ada` | `https://example.com/people/ada/` |

Two things are **kept as written**: the path's upper and lower case (a site may tell people
apart by it), and every path segment. `https://example.com/people/ada/en/` and
`https://example.com/people/ada/` are two different keys, because which part of a path names the
person is the site's business, not this format's. Write the link the site itself uses for the
person's page.

**Two links name the same person when their match keys are equal.** The match key is the
canonical form without its last `/`. So an export's `https://example.com/people/ada-lovelace` and a
stored `https://example.com/people/ada-lovelace/` are the same person, and importing one never adds
them twice.

A link that isn't an `http` or `https` address of a page (no host, a site's front page, a user
name or password in it, a control character) isn't a link, and the file is refused.

**People with no profile link are left out of the file**, and counted in the manifest's
`left_out.no_profile_link`, so the import can say "3 people had no profile link".

## manifest.json

```json
{
  "format": "sixgree.network",
  "format_version": "1.0",
  "producer": { "name": "Connections export", "version": "1.0.0" },
  "generated_at": "2026-10-12T20:30:00.000Z",
  "owner": { "key": "https://example.com/people/you/", "name": "You" },
  "includes": { "second_degree": false, "mutual_counts": false, "photos": false, "experience": false },
  "left_out": { "no_profile_link": 3 },
  "files": {
    "people.jsonl": { "rows": 2, "sha256": "9b1f…" },
    "connections.jsonl": { "rows": 2, "sha256": "4c07…" }
  }
}
```

| Field | | |
|---|---|---|
| `format` | required | `"sixgree.network"` |
| `format_version` | required | `"1.0"` |
| `producer` | required | `name` (text, up to 100 characters) and optional `version`: the program that wrote it |
| `generated_at` | required | a time |
| `owner` | optional | whose network this is: optional `key` (their profile link) and `name`. When the file and Sixgree both know the owner's link and they differ, the import is refused. The owner is never one of their own connections. |
| `includes` | optional | which optional parts are in it: `second_degree`, `mutual_counts`, `photos`, `experience`, each `true` or `false`, and `false` when missing. A part the file has is never marked `false`. |
| `left_out` | optional | counts of what the producer couldn't include: `no_profile_link` |
| `files` | required | every data file in the folder: its `rows` (a `.jsonl` file's line count) and `sha256` (64 lower-case hex characters) |

## people.jsonl

One line per person the file mentions, whatever their degree. Each person appears once.

```json
{"key":"https://example.com/people/ada-lovelace/","name":"Ada Lovelace","role":"Engineer","company":"Analytical Engines"}
```

| Field | | |
|---|---|---|
| `key` | required | their profile link |
| `name` | required | up to 200 characters |
| `headline` | optional | the line under their name, as they wrote it |
| `role` | optional | their current role; read from the headline when missing |
| `company` | optional | their current company; read from the headline when missing |
| `photo` | optional | a picture in `photos/`, by its SHA-256 |
| `experience` | optional | their roles, read from their page ([Experience](#experience)) |
| `mutual_count` | optional | how many connections you and they share: a fact about the two of you, so it's on the person, not on an edge |
| `mutual_count_at` | optional | when that count was read |

Text fields are at most 1,000 characters. Someone with no headline gets "Role at Company" built
from their role and company, as a connections export implies.

## connections.jsonl

Your own connections: one line per person in `people.jsonl` you're connected to.

```json
{"person":"https://example.com/people/ada-lovelace/","connected_date":"2026-09-28","source":"export"}
```

| Field | | |
|---|---|---|
| `person` | required | their profile link, which must be in `people.jsonl` |
| `connected_date` | optional | when you connected: a date |
| `observed_at` | optional | when this was read |
| `source` | required | where it came from: `export` (a site's export of your connections), `scan` (read from the site's pages) or `manual` (typed by a person). It decides precedence ([How an import merges](#how-an-import-merges)). |

A file needn't hold your whole network. One that lists only some connections adds and updates
those, and leaves everyone else as they are.

## edges.jsonl

People you can reach through one of your connections (2nd degree): who sits in whose circle.

```json
{"via":"https://example.com/people/ada-lovelace/","person":"https://example.com/people/alan-turing/","source":"scan","observed_at":"2026-10-12T20:00:00Z","provenance":{"method":"list","run_id":"r1"}}
```

| Field | | |
|---|---|---|
| `via` | required | the connection whose circle they're in. **It must be in `connections.jsonl` in the same file**, so a file stands on its own. |
| `person` | required | in `people.jsonl`, and not one of your connections: two of your connections who know each other are a tie |
| `source` | required | as in `connections.jsonl` |
| `observed_at` | optional | when it was read |
| `provenance` | optional | `method` and `run_id`, each text: how and in which run it was read |

## circles.jsonl

How far each connection's own list was read, one line per connection at most.

```json
{"person":"https://example.com/people/ada-lovelace/","status":"partial","pages":3,"more":true,"total":120,"connections":500,"connections_plus":true,"complete":false,"read_at":"2026-10-12T20:00:00Z"}
```

| Field | | |
|---|---|---|
| `person` | required | one of your connections |
| `status` | required | `read` (all of it), `partial` (some pages), `hidden` (they keep their list private) or `unclear` (the read couldn't tell) |
| `pages` | optional | pages read, from the first; 0 when missing |
| `more` | optional | whether there were more pages after those |
| `total` | optional | how many people the list said it had |
| `connections` | optional | how many connections their page says they have |
| `connections_plus` | optional | `true` when that number is a floor, as in "500+" |
| `complete` | optional | `true` when this read started again from the first page and went to the end. Only then may the import drop the people in that circle it no longer shows. |
| `read_at` | required | when it was read |

## ties.jsonl

Two of your connections who know each other, seen when one turned up in the other's circle.

```json
{"a":"https://example.com/people/ada-lovelace/","b":"https://example.com/people/grace-hopper/","observed_at":"2026-10-12T20:00:00Z"}
```

`a` and `b` are both in `connections.jsonl`, and different people. A pair is one tie whichever
way round it's written.

## company_scans.jsonl

People found by looking through a company (3rd degree).

```json
{"company":"Analytical Engines","person":"https://example.com/people/charles-babbage/","source":"scan","observed_at":"2026-10-12T20:00:00Z"}
```

`company` is required (up to 200 characters). `person` is in `people.jsonl` and is never one of
your connections: nobody is 1st and 3rd degree at once. `source` is required.

## photos/

- Every picture is named by the SHA-256 of its own bytes, then `.webp`, `.png`, `.jpg` or
  `.jpeg`: `photos/3f1c…e9.webp`. That name is its checksum, so photos aren't listed in the
  manifest, and one picture can never quietly attach itself to many people.
- Its first bytes must be the kind its name says (a PNG named `.webp` is refused).
- At most 256 KB, and at most 2,048 pixels either way. Sixgree keeps each as it is and never
  re-encodes it, so a producer should send the size it means to be shown (Sixgree's own
  photos are 96 pixels across).
- **One picture on more than one person is dropped for all of them**: it's nobody's face for
  sure. Logos are shared by design and exempt.
- A `photo` or a logo that names a picture not in `photos/` is refused. A picture nobody
  points at is left out and counted.

## Experience

A person's roles, read from their page. One of three shapes:

```json
{"status":"read","at":"2026-10-12T20:00:00Z","roles":[{"title":"Engineer","company":"Analytical Engines","start":"2024-03","current":true,"logo":"3f1c…e9"}],"card":{"followers":1200,"connections":500,"connections_plus":true}}
{"status":"unreadable","at":"2026-10-12T20:00:00Z","why":"the page changed"}
{"status":"card","at":"2026-10-12T20:00:00Z","card":{"followers":40}}
```

- `read`: at least one role, and at most 30. Each role has a `title` (required), and optional
  `company`, `start` and `end` (a year or a month: `2024` or `2024-03`), `current` (`true` or
  `false`), `company_id` (the site's own id for the company, as text) and `logo` (a picture in
  `photos/`, by its SHA-256). Optional `source` (`data` or `page`: how it was read) and `shown`
  (how many roles the page showed).
- `unreadable`: the page was opened and its roles couldn't be read; `why` says what went wrong.
  It is never written as a `read` with no roles, which would say "no experience".
- `card`: only the top of their page was read: `followers`, `connections` and
  `connections_plus`. A card never replaces a read: it's added to the one Sixgree has.
- Any of the three may carry `card`. `at` is when it was read.

## What a reader checks

Before anything is imported, the whole folder is checked, and the first problem refuses it all.
Nothing is ever half imported.

- `manifest.json` is there, says `"sixgree.network"`, and has a version this copy reads.
- Every file the manifest lists is there, is a plain file (never a link), and matches its
  `sha256` and `rows`.
- **Nothing in the folder is unlisted**, except `photos/` and the `.DS_Store` a Mac's Finder
  leaves in any folder it shows.
- Every line is one JSON object, and every field is the type this page says.
- Every link reads as a profile link, and every reference (`person`, `via`, `a`, `b`) names
  someone in `people.jsonl`.
- No person, connection, edge, circle, tie or company scan is listed twice. Two links with the
  same match key are one person.
- Every photo matches its name, its type and the size limits.

The limits:

| | at most |
|---|---|
| `manifest.json` | 64 KB |
| one `.jsonl` file | 256 MB |
| one line | 64 KB |
| one text field | 1,000 characters (a name, 200) |
| one profile link | 2,048 characters |
| people | 500,000 |
| connections | 50,000 |
| edges | 1,000,000 |
| circles | 50,000 |
| ties | 1,000,000 |
| company scans | 500,000 |
| photos | 500,000, each 256 KB and 2,048 pixels either way |

## How an import merges

**An import always merges: it adds people and brings them up to date, and never removes
anyone.** You start with one file (your connections, say) and build from there, one file at a
time. Starting over is a different thing: restoring a backup, or a fresh start.

**Always:**
- Only the rows of the profile this copy of Sixgree is for. Another profile's rows, and rows
  that belong to no profile, are never read or written.
- People are matched by match key, never by how the link is written.
- Nobody's id changes.
- Never written by an import: scores and tiers (rescored afterwards), who introduced whom,
  outreach status, the company scores you set, your settings and your queue.
- First a backup of your whole network (a `before-import` backup in Settings, kept like the
  others), then the import in one step that either happens whole or not at all, then a rescore
  of everyone, with your company scores and settings. If that rescore fails, the next time the
  network is read it's done then.

**Your connections (1st degree):**
- Someone you already have is brought up to date.
- Someone Sixgree has met through one of your connections, or found at a company, becomes a
  connection, and keeps who introduced them.
- Anyone else is added. With no headline, they get "Role at Company".

**Which source wins:**
- `scan` and `manual` overwrite what Sixgree has.
- `export` fills only what's blank, so an export never overwrites what a scan read. The
  exception is a row only an export could have written: no headline, or exactly
  "Role at Company" built from both. That row takes a newer export's role and company, so
  importing a new export picks up a job change. A headline that is a role alone isn't enough
  to tell, so it's filled where blank only.
- A file never blanks a field.

**The other parts**, as they arrive in Sixgree:
- **2nd degree:** each person in `via`'s circle is added or updated there. One of your own
  connections in a circle is kept as a tie instead.
- **Mutual counts:** the newest count read goes on every copy of the person.
- **3rd degree:** only someone who isn't already 1st or 2nd degree.
- **Ties:** added once, never duplicated.
- **Circles:** the newer read wins, and the pages read are never wound back.
- **Experience:** a newer read replaces an older one; a card is added to a read, never in
  place of it.
- **The one exception to "never removes":** a circle marked `complete` (read again from its
  first page to the end) may drop the people in that circle the file no longer shows. Nobody
  else, and nothing else, is ever removed.

**What this version of Sixgree imports:** your connections and what the file says about them.
A file with any other part (2nd degree, circles, ties, company scans, photos, experience or
mutual counts) is refused whole, naming the parts, rather than imported in part.

## Writing one

- Write the folder under another name, then rename it when every file is in it, so a reader
  never sees half of one. Sixgree's own writer (`writeNetworkFolder`) writes to
  `<name>.partial`, reads the result back through its own checks, and only then renames it.
- Write every link in canonical form, and leave out people with no profile link (count them in
  `left_out`).
- The smallest network file is a manifest, one person and their connection:

```
manifest.json
{"format":"sixgree.network","format_version":"1.0","producer":{"name":"By hand"},
 "generated_at":"2026-10-12T20:30:00Z","includes":{},
 "files":{"people.jsonl":{"rows":1,"sha256":"…"},"connections.jsonl":{"rows":1,"sha256":"…"}}}

people.jsonl
{"key":"https://example.com/people/ada-lovelace/","name":"Ada Lovelace","headline":"Engineer at Analytical Engines"}

connections.jsonl
{"person":"https://example.com/people/ada-lovelace/","source":"manual"}
```
