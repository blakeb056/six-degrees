# Scoring

How a headline becomes a power score and a tier. **One implementation:
`lib/scoring.js`**, whose header explains the model, with `tests/scoring.test.mjs`
pinning it down. Everything scores through it:

| Caller | When |
|---|---|
| `lib/rpc.js` `rescoreAll()` | After every import (`score_new_connections`), when a company score changes, when *Your sector* or *Tiers* changes in Settings, and once on the first load after the stored scores go stale (`SCORING_VERSION`, the curated list, the industries' words and scoring's rule tables, the sector focus they were computed with, the sector directory's version included, or the tier scale no longer matches; all four stamped in `app_meta`). It reads the rows with `readForScoring()`: each company's industry and where it came from, its sectors from the directory and the industries those sit under |
| `lib/csv.js` `scoreRecord()` | CSV imports, in the browser, from the export's bare position and company |
| `lib/companies.js` | Paths reads titles, companies and each company's industry through the same functions, so Paths and the score never disagree |
| `lib/sector-focus.js` `previewSectorFocus()` | Scores → Your sector, before saving: reads the network once (`readForScoring()`, as a save does) and scores it twice in memory (saved focus, new focus), then counts what moves. Writes nothing. A save counts with the same function (`rescoreAll({compareWith})`), so the two say the same |
| `lib/legacy-offer.js` `legacyOffer()` | The Scores tab's one-time offer to keep the curated list's old scores: compares each company's built-in score now (`companyScore()`) with the one the old list gave it. Writes nothing until it's answered |
| `app/queue/page.js`, `app/components/Sidebar.js` | The Queue's order (+1 at a top company) and the person panel's notes ("At Google (10/10)", "Former Adobe (8/10)") read the scores the model stored: `rowCompanyScore()`, `topCompanies()`, `TOP_COMPANY` (8). Of two roles alike, the panel names the one the stored working (`score_why`) names, since your own score or your sector can make either the stronger. Until September 2026 each kept its own list of one person's favourite names, matched anywhere in the headline |
| `app/api/company-scores/route.js` | The Scores tab: each company scored from the same read as rescoring, through `companyScoreIn()` |

Until 0.1.10 there were three scorers that disagreed. The hosted era's SQL scorers
(`scripts/score_new_connections.sql`, `scripts/score-connections.sql`) were kept for history
until September 2026, when they were deleted: nothing read them, but the first shipped inside
every Mac app and npm package, headed "CANONICAL SCORER", with the old list's personal
picks. Git history keeps both. `rpc('score_new_connections')` is only the stored procedure's
old name; it runs `rescoreAll()`. Do not transcribe the model anywhere else again.

## The formula

```
power = title × (0.45 + 0.055 × company) + reach bonus + bridge boost

tiers, on your network's curve (the default)   top 3% S · to 15% A · to 40% B · to 70% C · D
tiers, on the fixed scale                      S ≥ 7.5    A ≥ 5.5    B ≥ 4.0    C ≥ 2.5    D < 2.5
```

Which one is Scores → Tiers ([below](#tiers-on-your-networks-curve)).

It's a **product, not a sum**: a title is worth more at a bigger company, and a big
company is worth more the higher someone sits in it. A VP at a company scored 10 gets 9.0,
a founder at an unknown company 7.3, a director at an unknown company 5.4, and an intern
at a 10 gets 2.0. The old sum let an intern at a famous company tie with a director
somewhere unknown.

**Title (0–10)** comes from the person's roles, read part by part from the headline.
Former ("Ex-", "Former") roles count at 70%, and the person scores as their strongest
role. Current students are capped at 3. Rules that earlier words mask:

- "Vice President" is not "President", nor "Vice Provost" a provost.
- "Chief of Staff" is not a chief, and "to the CEO" or "to Professor Chen" is not the title.
- "Product Owner" is not an owner.
- A fraternity chair is not a chairman.
- "International" is not "intern".
- A title's possessive is an award or an office named for it: "President's Club" (a sales
  award), "Chairman's Award", "CEO's Office", "Dean's List", "Chancellor's Fellow".
- "MD" is a managing director only where a doctor's degree can't be meant: "MD @ J.P.
  Morgan", "MD, Investment Banking", not "MD, MBA", "Physician, MD" or "MD at Mayo Clinic".

**Universities** have a ladder of their own, on the same points: an assistant professor 5
(a senior IC's), an associate professor 6.5 (a manager's), a professor 7.5 (a director's:
"Professor (Emeritus)", "Distinguished Professor", "Prof."), a dean 9 (a VP's: a dean runs a
school as a VP runs a division), and a provost or a chancellor 10, like a president.
Associate and assistant deans and provosts and a department's chair or head are directors;
vice provosts and vice chancellors are VPs; adjunct, visiting and guest professors and
lecturers are ICs. "Dean" counts only as a title (before "of", "for", a comma or the
part's end), never in a company's name (Dean Foods). Until scoring 6 a professor was an
entry-level IC (4), and a dean or a chancellor only someone who works there (4 as well).

**Government and the services** (`officeTitle`) have their ladders too, on the same points:

| Level | Government | The services |
|---|---|---|
| 10 | a senator or U.S. representative, a governor, a mayor, a county executive, a cabinet secretary, an attorney general, the chief justice, a tribal nation's elected head | a 3–4 star general or admiral, the services' chiefs |
| 9 | a deputy, under or assistant secretary, a state legislator, a lieutenant governor, a commissioner of an agency, an ambassador or envoy, an inspector general, a U.S. or district attorney, a PEO or an SES member, a police chief, a judge | a 1–2 star general or admiral, a commanding general |
| 7.5 | a deputy assistant secretary, a city or county councilmember or commissioner, a county legislator, a sheriff, a school-board member, a special agent in charge | a colonel, a Navy or Coast Guard captain, a brigade or garrison commander |
| 6.5 | | a lieutenant colonel, a Navy commander, a battalion or squadron commander; a command sergeant major or master chief |
| 5 | | a major, an Army or Marine captain, a Navy lieutenant commander or lieutenant; a senior NCO or a warrant officer |

A commander's level is their unit's, the first one their title names (a company's is a
major, a division's a general, a fleet's or a corps' a 3–4 star); a deputy or an executive
officer is one below. They're read only **where a title is written**, the start of a part
before its comma, "at", "@" or bracket, so the office, the company or the club named after
it is only context: "Staff Assistant, Office of the Secretary of Defense", "Store Manager
at Dollar General" and "Law Clerk to Chief Judge…" aren't the office. And they count only
where their place says so:

- the title's organization must be a government's (`where()`): the one after its comma or
  "at", or else the next part when that is an organization ("Governor | State of Florida",
  not "Florida State Representative | Northwind Pharmaceuticals"), or the headline's first
  part ("State of Ohio | Governor"). A government is one by its own name: a state's or a
  city's ("State of Florida", "City of Orlando", "Orange County"), a department, a court, a
  legislature, an agency in full or with its field office ("FBI Miami Field Office", not
  "SBA Lending"), a tribal nation (not "Tribe Capital" or "Cherokee Nation Businesses");
- **precision first** (the fourth review round): a title that names its government ("U.S.
  Senator", "County Sheriff", "Mayor of Tampa", "Ohio State Treasurer") reads the other parts
  as its bio ("| Podcast Host", "| Swim Dad", "| Former Police Chief") unless they name an
  employer or a club; a bare title ("Mayor", "Police Chief", "Ambassador", "School Board
  Chair") needs its government named, or to be the whole headline. A county, a district or a
  ward named alone is a place, a government only for a local office. A missed official stays
  "Title unclear" (a neutral 4); a realtor read as a mayor would jump to A, so a doubtful
  case is left out;
- a title others hold too needs that government named, or to be the whole headline:
  "Mayor of Orlando" alone is a mayor, "Realtor at Compass | Mayor of Midtown" isn't; "City
  Manager" is also Uber's and Lime's, "Controller" and "Auditor" every company's, "Trade
  Representative" a beverage brand's, "Assistant to the President" a university's, "US
  Attorney" a U.S.-qualified lawyer's abroad, "Administrator" a systems administrator's.
  A title nobody else holds ("State Senator", "Special Agent in Charge", "U.S. Trade
  Representative") needs only no other organization beside it;
- never a club's, a church's, a school's or students', a profession's, a mock government's,
  a league, a fraternity's council, an honorary or a joke title (`CIVIC`: "Rotary District
  Governor", "Delegate, AMA House of Delegates", "Attorney General, SGA", "Commissioner,
  Orange County Pickleball League", "Mayor of Fun"), and nothing in a headline that names a
  mock government anywhere (`MOCK`: "Secretary of State | Florida Girls State", "Member of
  Parliament | UK Youth Parliament");
- every rank but the flag ranks spelled out needs its service in the same part or as a part
  of its own ("Captain | U.S. Navy"), and "Army" or "Navy" alone must be the whole
  organization or qualified ("U.S. Army"), since "Church Army" and "Brand Army" are crowds.
  A service in a part of its own is the rank's only when nothing but units and places is
  named beside the rank, and one further off only past a serving officer's job ("LTC |
  Acquisition Officer | U.S. Army"), not past an employer ("Captain | Delta Air Lines |
  Retired USAF" is an airline captain), and only with nothing civilian on the rank's other
  side ("Claims Handler | Admiral | Royal Navy Reserve" isn't). A short form that is also a
  credential or a company (LTC long-term care, CPT a personal trainer, CSM a ScrumMaster,
  ADM) needs its service in the same part, or a headline that is all military;
- a police or fire department's numbered division or battalion, a veterans' group, a
  museum, a boating club, a credit union, a cadet, a team, a mariner's licence or an
  honorary rank is no commission (`NOT_MILITARY`: "Kentucky Colonel", "Commander, VFW Post
  42", "Commander, 77th Street Division, LAPD", "Captain, Navy Rugby", "Master Chief | Halo
  Cosplayer");
- a veteran's civilian job scores as that job ("Army Veteran | Store Manager" is the manager).

"(Ret.)", "(Retd)", ", Retired", "Ret." and a part that says only "Retired" make a role
former, as "Ex-" does; "(R)" does only beside a rank, since CRPC(R) and REALTOR(R) are
marks. A retirement is its own role's: a service's after a civilian job ("Program Manager
at Leidos, U.S. Army (Ret.)") or a second role's ("Realtor at Compass, Firefighter (Ret.)")
leaves the job current, and a lone "Retired" part retires the role just before it (or a
rank with its service between), not a civilian job further back. A war or staff college's students are serving officers, not students. Until
scoring 6 none of this was read: a U.S. senator, a lieutenant general and the Secretary of
Commerce were all "Title unclear" (2.9, C).

**The company after "at" is where someone works, not what they do** (`AT_COMPANY`): its
words aren't read as a title, so "Server at President Hotel" and "Driver at Executive Limo"
are what they are (on scoring 5 the server was a C-suite, A). The company ends at a comma,
a bracket, an emoji, "and", "&" or "/" between words, or what says what they do there, so a
second title still counts ("at Stripe as Head of Growth", "Associate at Goldman Sachs
(VP)", "Engineer at Google and Founder of Northwind"). "at" is the word alone ("AT&T
Director" and "At-Large Director" are titles), and a part that starts with it has its title
in the company's span ("At Home Store Manager"). "MD at" a hospital, or with a specialty
after it ("MD at Emory, Pediatrics"), stays a doctor; "MD at Lazard, Healthcare M&A" is a
managing director. An
office named for its head is also where someone works (`OFFICE_NAME`): "IT Specialist,
Office of the Chief Information Officer" was a C-suite too. Staff aren't their boss:
"Executive Assistant to the General Manager" is the assistant, while "Promoted to VP" is
the VP.

**Where a title is held.** "at" or "@" names the company. So does a company the lists
know (curated or the public dataset) written after the title without it: after a comma
("Corporate VP, Samsung") or as the next part ("Global Category President | The Coca-Cola
Company", "Head of Country, Brazil - Snap"), for a current title that names none. That's
a guess, so it's kept narrow (`heldAt`):

- a founder, an owner or a CEO leads a venture of their own, so a big name after their
  title is an accelerator, an investor, a school or a past employer ("Founder | Y
  Combinator", "CEO | Stanford"): not taken;
- a program, an award, a membership or a degree isn't a job ("AWS Community Builder",
  "Forbes Council Member", "Harvard MBA", "Director, Microsoft Alliance");
- a school after any but an academic title is more often where they studied ("VP
  Marketing | Harvard");
- a company scan's company goes before the guess (the stored company, which ingest reads
  from the headline's own "at", doesn't).

Until scoring 6 only "at" counted, so a Coca-Cola president who wrote "| The Coca-Cola
Company" scored as one at an unknown company: 7.3 (A) instead of 9.5 (S).

**An audience of their own** counts like a title (`AUDIENCE`): 100K+ followers,
subscribers, listeners or readers like a manager's (6.5), 1M+ like a director's (7.5),
10M+ like a VP's (9), with no company ("Creator | 2.5M+ followers", "1.2M monthly
listeners", "3M+ on TikTok", "2,500,000 followers"). Views, users and impressions don't
count (a campaign's or a product's; those are the reach bonus's), nor does a part about
growing or managing someone else's ("Grew our TikTok to 2M followers", "Managed accounts
with 10M+ followers"). A 2.5M-follower creator scores 5.8 (A) where they scored 3.3 (C).

**A title the rules can't read** ("Studio / Show", "Storyteller", a job they don't list)
counts 4, an individual contributor's, the most common kind: not knowing someone's title
says nothing about how senior they are, as with a company we don't know. Until scoring 6
it was 3, below any job, so a founder who states no title and no company scored 2.2 (D);
now 2.9 (C), and a strong circle can lift them further (Bridge boost, below).

Schools are read alike; the rules name none. A major at a school is a student ("CS @ NYU",
"Economics at University of Utah"), and so is a leading title in a school club ("President,
USC Marketing Club", "VP, NYU Finance Society", "President of the Marketing Club at USC"): a
club, chapter, society or association named with a school's words (university, college,
school, student), or a club or society named with its short name. A short name is two to
four capitals that start or end with the U of University (USC, NYU, UCLA, BYU, UNC), so no
list of schools favours the ones on it. Not a short name:

- a country or union (US, USA, UK, EU, UN), a US national body (USGA, USTA, USAA) or the AAU;
- a company the curated list knows (UPS; its schools, such as UCLA, stay schools);
- a short list of companies, a league and unions written in capitals like a school
  (`NOT_A_SCHOOL`): UBS, UFC, UPMC, UnitedHealth's UHG and UHC, UA (Under Armour), UL, ULA
  (United Launch Alliance), UTC, and the UAW, USW, SEIU, UFCW and UFT. So "Finance @ UBS"
  works in finance, and "President, UAW Local 600 Chapter" leads a union local.

With a short name, only a club or a society is a student group, or an association named for
a field of study ("USC Trojan Marketing Association", "NYU Chapter of the American Marketing
Association"). A chapter alone is as often a union local's or a professional body's, and
another association a university's own staff ("KU Endowment Association"). An alumni club or
a parents' association is for grown-ups, and a company's own club (Sam's Club, AAA Club
Alliance, UPS Toastmasters Club) or a professional society (CFA Society, IEEE Computer
Society, an EO chapter) is not a school's.

The price: a school whose short name is on that list (UA, UL, UTC) isn't read from it; a
student chapter named only by a short name ("President, NYU Chapter of IEEE") reads as the
title it says; and a company's short name that isn't on the list can still read as a
school's in "Marketing @ …". Until September 2026 the rules named UCF and UF, so their
students and clubs were caught and other schools' weren't; the first rule that replaced them
also read "Finance @ UBS" as a student and the UAW local's president as a student's club role.

**Company (1–10)** comes, in order, from the score you set (the Scores tab, table
`company_scores`), then the curated `KNOWN_COMPANIES` list (245 companies, on it by the
rule [below](#the-curated-list)). Otherwise it's an estimate from how many of your people
work there: 5.5 at 5+, 6 at 15+, but never for schools (a company whose one industry, below,
is education). Unknown, and no company found, is 5 (`UNKNOWN_COMPANY`), the middle of the
scale, so the company weight runs from 0.725 (a company we don't know) to 1.0; 0.505 is the
floor, for a company you score 1. Not knowing a company says nothing about its size, so it
neither lifts someone's title nor sinks it. Until scoring 4 (September 2026) an unknown
company was 4 and no company 3, which pushed down everyone the list doesn't know: most of
any network outside big tech, and founders whose headline is only their company's name
("Back Roads Entertainment", "Snapback Sports") landed in D. One knock-on, on purpose: a
current role at a company we don't know now outweighs the same title held before at a top
company (a manager: 4.7 now, 4.6 as a former manager at a 10). Names are cleaned
first, so "Adobe Inc.", "Adobe Systems 🎨" and
"Adobe" are one company. Phrases like "at scale" and "at best" are not companies (Best Buy and
Best Western are). The list's aliases match from the start of a name, only in the forms their
companies use ([below](#aliases-kept-narrow)), and a name that says school, college or
university only matches a school on the list: "Kellogg School of Management" is not
Kellanova, "Warner University" not Warner Bros., "Chase College of Law" not JPMorgan Chase.
Bain Capital (private equity) has its own entry, apart from Bain & Company. If you picked
sectors in Settings, a company in one of them gets +1 or +2 on top (below).

**Reach bonus (≤1.5)** needs whole-word signals: investor, YC, 30 under 30, an audience or
revenue in the millions ("2.5M+", "2.5 million" or "2,500,000"), keynote/TEDx/patents, "award-winning" or "prize-winning", and the
top honour of each field (`HONOURS`): the Nobel, the Pulitzer, the Peabody, the Emmy, the
Grammy, the Oscar (Academy Award), the Tony, the Webby, the Clio and Cannes Lions, the James
Beard, the Turing Award, the Fields Medal, the Pritzker Prize, a MacArthur Fellow, a Rhodes
Scholar, and an Olympian or Paralympian or their medals. An award's name that is also a
company's, a person's or its own organisation's counts only as a claim ("Oscar-winning",
"Tony Award", "Emmy nominee", "Pulitzer finalist"), so Oscar Health, Peabody Energy, Clio the
legal software, Nobel Biocare, Olympic Steel, "Tony" as a first name and the staff of the
Peabody Awards or the Pulitzer Center get nothing. The price: "3x Emmy", with no award word,
isn't read either. Until September 2026 it named four awards, from advertising, TV, music and
the web (Cannes Lions, the Emmys, the Grammys, the Webbys), so a Pulitzer, an Oscar, a Nobel
Prize or an Olympic medal earned nothing, and "Emmy" or "Grammy" counted anywhere, a bakery's
name included. It's halved for someone at a company we don't know or one scored 4 or less,
because headlines are self-written: a company becoming neutral didn't make anyone's claims
truer, so `scorePerson` still judges an unknown company as the 4 it used to be here. That's
judged by the company's score before any sector lean (a score you set counts as the
company's own).

**Bridge boost (≤2)** goes to a 1st-degree person whose mapped circle is unusually strong,
the larger of two readings of it (`bridgeBoost`):

- **its share:** `(share at A or S − 0.12) × 5`, capped at 1, in a circle of 20+ people (a
  smaller one is too few to judge a share by);
- **its strong people:** +1 for every 25 at A or S, capped at 2, whatever its size.

A big circle's share can look ordinary while it holds more strong people than most circles
have people, and that's the hidden power a vague title doesn't show: someone whose title
reads as unclear at a company scored 8, with 72 people at A or S in a circle of 600, scores
5.6 (A) where they scored 3.6 (C). Until scoring 6 only the share counted, up to +1. It's
recomputed each time and never ratchets.

The person panel shows the working as `score_why`, e.g.
"VP / Partner / GM (9) · Adobe (8/10) · +0.7 strong circle", or with a sector lean
"Owner / Entrepreneur (8) · Smith Family Practice (6/10: 5 + 1 your sector: Dental)".

## Tiers on your network's curve

**Scores → Tiers** (`tierScale`, lib/settings.js; `TIER_SCALE_SETTING` in lib/scoring.js)
is `curve` unless the user chooses `fixed`. On the fixed scale everyone gets the same lines
(`tierFor`). They were tuned on a network full of companies the curated list knows, where S
is about the top 3–4%; in a network the list barely knows (most networks), almost nobody
reaches S or A, and a first scan looks bleak. The curve fixes that:

- **The shares** (`CURVE`): of your 1st-degree people, the top 3% are S, the next 12% A, the
  next 25% B and the next 30% C; the rest D. That's about where the fixed scale puts a
  network full of known companies.
- **Cut-offs** (`curveCutoffs`) come from your 1st-degree people's powers before any circle
  boost, so a boost (which reads the graded tiers) can't move its own cut-off. Everyone, the
  2nd degree included, is graded on the same cut-offs. At least one person reaches each cut-off.
- **Ties** at a cut-off all come in or all stay out, whichever lands nearer the share (in,
  when it's as near): eight "Store Manager at <a company nobody knows>", all at 4.7, don't
  all become A to fill two places.
- **It only lifts** (`curvedTier`): a tier is the better of the fixed scale's and the
  curve's, so a strong network keeps its fixed-scale tiers. The invented sample network is
  such a network: its tiers are the same on either scale (a test pins it), so the counts the
  tutorials and films show stay true.
- **A floor** (`CURVE_FLOOR`, 4): nobody under 4 is lifted into S or A. In a network of
  students, the strongest classmate is B at most.
- **Power never changes with the scale**, only tiers do, except through a bridge's circle
  boost, which reads the tiers you see.

`scoreNetwork(rows, { tierScale })` grades on the curve only when asked (called without one,
on the fixed scale, as the sample's generator does). A CSV import (lib/csv.js) is always graded
on its own curve, on the parse and on every load: it uses the app's defaults, never your
settings, as with company scores and sectors, and Scores → Tiers says so while one is open. `rescoreAll()` passes the saved choice
and stamps it (`app_meta` `scoring_tiers`); `rescoreIfStale()` rescores once when the stamp
and the saved choice differ. Saving a new choice rescores everyone and reports how many
people changed tier, each person once at their closest degree (lib/settings-effects.js, with
the sector focus's own `tierMoves`). Scores → Your sector's preview grades both sides on
the saved scale, so the preview and the save agree.

## The curated list

`KNOWN_COMPANIES` is everyone's default, so a written rule decides who is on it, not anyone's
own ties to a company. **A company is on the list only if most US professionals would
recognise it:**

- a household-name brand;
- a Fortune 500 company, or a public company as large;
- a top global VC, private equity, consulting, law or accounting firm;
- a frontier AI lab;
- a top national university.

**Scores follow one scale:** 10 the largest tech platforms and the frontier AI labs, 9 elite
(the most sought-after employers in tech, finance, consulting, investing and consumer
brands), 8 major, 7 well-known. Nothing on the list is below 7. Regional picks, picks from
one person's career or network, and small startups are not on it: they're estimated from
the network like any other company, and anyone can score them on the Scores tab. **When in
doubt, a company stays off**: the estimate is the neutral default. No comment in the list
speaks for one person (it used to say "home turf" and "local institutions"); a test checks.

Applying the rule (September 2026, after 0.2.1) changed 34 of the 165 entries:

- **Snap 9 → 8**, like its peers Pinterest, Reddit and X, and **MrBeast 8 → 7**: a household
  name, but a company of a few hundred people.
- **Removed, 32:** the "notable" 6s and the one "local institution", drawn from one network
  and one region (Grindr, Genius Sports, Later, Hard Rock Digital, Vanta, Kaseya, Havas,
  VaynerMedia, AdventHealth, University of Florida, The Athletic, UCF); private companies
  that are neither household names nor that size, and startups (Anduril, Polymarket,
  Kalshi, Databricks, Figma, Scale AI, Whatnot, Whop, Hims & Hers, Riot Games, Notion,
  Vercel, Plaid, Brex, Ramp, Mercury, Chime); two executive search firms (Egon Zehnder,
  Heidrick & Struggles); and the U.S. Space Force, the only military branch on the list.

The other 131 kept their score. Their other fields changed since: every entry gained an
industry ([below](#one-industry-per-company)), Bain's alias no longer takes in Bain Capital,
and the aliases that other companies share were closed ([below](#aliases-kept-narrow)).
`lib/legacy-scores.js` holds the old rows (name, score, the names it is offered for,
industry) for the offer below and nothing else; `lib/scoring.js` imports nothing, so the
model can't read them.

**Staleness:** `rescoreAll()` stamps `app_meta` 'scoring_list' with a fingerprint
(`scoringStamp()` in `lib/rpc.js`) of the whole list (every name, score, alias and
industry), of the broad industries' words and labels in `lib/companies.js`, and of every rule
table scoring reads headlines and names with (`RULE_TABLES` in `lib/scoring.js`: the title
ladder and its rules, the student, club and former rules, what isn't a company or a job
there, and the reach bonuses), and `rescoreIfStale()` rescores when it no longer matches.
The industries' words decide a company's one industry, which decides whether it is a school
(no estimate) and whether a broad pick in Settings leans it, and their labels are in the
stored working ("4 + 1 your sector: Healthcare & Biotech"). So editing any of these
refreshes stored scores with no `SCORING_VERSION` bump to remember; a test changes each part
and checks the stamp changes. How they're combined (the formula, the weights, the order of
the steps) is still a `SCORING_VERSION`. Until September 2026 the stamp covered the list and
the industries' words only, so an edit to a title rule or a school rule left stored scores
as they were until something else rescored them.

### Where the list comes from

The list was narrower than its rule: it leaned to tech, finance, consulting and media, so a
nurse, a lawyer or someone in retail found little of their world on it. The rule is now
applied from named sources, the same way in every field, so anyone can check the list or
extend it. Everything added in September 2026 came from these:

1. **The Fortune 500 (2025), its top 100.** Every company in it was considered, and the
   household names were added, whatever their field. Left off: the companies known inside
   their trade rather than by the public (below).
2. **Beyond the Fortune 100, in the fields the list had few or none of** (health care and
   drugmakers, retail and grocery, food and restaurants, hotels, autos, airlines, rail and
   shipping, telecoms, energy, news and TV): the one or two largest household names in each,
   by revenue, where the Fortune 100 has few or none. Restaurants: McDonald's and Chipotle,
   after Starbucks. Packaged food: Kraft Heinz and General Mills. Hotels: Marriott and
   Hilton. Airlines: Southwest, the fourth largest. Rail: Union Pacific, the largest.
   Discount stores: Dollar General and Dollar Tree, among the largest US employers. TV: Fox.
3. **Companies based outside the US, in those fields, as large as the Fortune 100** (over
   about $45 billion a year) **and household names here**: Nestlé, Anheuser-Busch (AB
   InBev), IKEA, Aldi, 7-Eleven, AstraZeneca, Bayer, Volkswagen, Mercedes-Benz, BMW, Honda,
   Hyundai, Kia, Nissan, Shell, BP, DHL.
4. **Household names in those fields that the Fortune 500 can't include**, nonprofits and
   private companies that publish no accounts: Kaiser Permanente (the largest nonprofit
   health system, as large as a Fortune 50 company), Mayo Clinic, Cleveland Clinic and Johns
   Hopkins Medicine; Mars; and in news, The New York Times and Bloomberg. Two parts of larger
   companies that people name on their own, Aetna (CVS Health) and GEICO (Berkshire
   Hathaway), have entries of their own.
5. **The Am Law 100 (2025)**, the ten largest US law firms by revenue: Kirkland & Ellis,
   Latham & Watkins, DLA Piper, Baker McKenzie, Skadden, Gibson Dunn, Sidley Austin, White &
   Case, Ropes & Gray. The tenth is left off until the ranking is checked.
6. **The private equity firms in the Fortune 500 (2025)**: Blackstone, KKR, Apollo Global
   Management (Bain Capital was already on).
7. **U.S. News & World Report's Best National Universities, 2025 edition, the top 20.** The
   five already on the list are all in it (Stanford, Harvard and MIT in its top five, Duke
   and UC Berkeley below). The other 15 were added: Princeton, Yale, Caltech, Johns Hopkins,
   Northwestern, Penn, Cornell, Chicago, Brown, Columbia, Dartmouth, UCLA, Rice, Notre Dame
   and Vanderbilt.

This pass was made without the published tables to hand, so a company whose rank sits near
a cutoff was left off rather than guessed. Check a source's current edition before adding
from it.

### How an addition is scored

- **8 at the size of the Fortune 100** (over about $45 billion a year), for a company based
  in the US or elsewhere. That is how the list already scored the Fortune 100 companies on it
  below 9: all at 8 (Walmart, UnitedHealth, the big banks, PepsiCo, Johnson & Johnson,
  Pfizer, the defense companies, IBM, Cisco, Oracle, Nike…) but Target and Intel, at 7. Those
  two keep their score: changing it would be a rescore, not an addition.
- **7 below that size**: Mayo Clinic, Chipotle, Marriott, GEICO, The New York Times…
- **Peers, where the list already scores that kind of firm otherwise**: private equity at 9
  with Bain Capital and BlackRock; the largest law firms at 8 with the Big Four, the largest
  accounting firms; McDonald's at 8 with Starbucks; universities by rank, as the list had
  them: the top five at 8 (Harvard, Stanford and MIT; now Princeton and Yale), ranks 6 to 20
  at 7 (Duke and UC Berkeley; now the other 13).
- **One industry each**, as for every entry: airlines, hotels, restaurants and grocers are
  consumer (hospitality and retail); railroads and shippers industry (logistics); telecoms
  tech; health insurers health, like UnitedHealth; other insurers and mortgage finance
  finance; law firms consulting (Consulting, Legal & Services); Fox entertainment, like
  NBCUniversal and Paramount.

### Aliases, kept narrow

Aliases match from the start of a name, so a short or shared first word would sweep in other
companies. Only a name no other company starts with stays open (`\b`: Costco, Pfizer,
"Deloitte Digital"); a shared one matches only in the forms its company uses, ending there
(`$`). The additions were written that way, and in September 2026 the entries from before
them were closed the same way, because they had swept in other companies: Snap-on, Snap
Finance, Snap One, Snap Fitness, Snap Kitchen and anything starting "Specs" read as Snap;
Harvard Pilgrim Health Care and Harvard Maintenance as Harvard; Stanford Health Care as
Stanford; Vanderbilt University Medical Center as Vanderbilt; Kellogg Brown & Root as
Kellanova; Fidelity National Financial, FIS and Fidelity Bank as Fidelity; Warner Music and
Warner Norcross + Judd as Warner Bros. Discovery; J&J Snack Foods as Johnson & Johnson;
Toyota of Orlando as Toyota; Coca-Cola Consolidated as Coca-Cola; Citi Trends as Citi;
Merrill Gardens as Bank of America; Merck Millipore as Merck; and Adobe Dental, Campbell
Clinic, Chase Brass, Goldman Properties, Sequoia Health, Nielsen Norman Group, Oracle
Elevator, Paramount Group, Pepsi Bottling Ventures and Blizzard Snow Removal as the listed
companies they start like. Snap is `^(snap|snapchat)( inc)?$`: Snap's AR glasses, Specs, are
no longer read as Snap. UnitedHealthcare, OptumRx and Sirius XM now read as their companies
(they didn't match before). So, in every entry:

- "GM" is a general manager, "Delta" also Delta Dental, "Apollo" also Apollo Hospitals and
  Apollo.io, "Columbia" also Columbia Sportswear, "Kirkland" also Kirkland's, "Penn State"
  isn't Penn, and "Northwestern Mutual" isn't Northwestern. None of them match; the full
  names do.
- Automakers and hotel companies by their own names only: "Honda of …", "Toyota of …" and
  "Hilton Garden Inn" are dealerships and franchised hotels with staff of their own, and a
  bottler (Coca-Cola Consolidated, Pepsi Bottling Ventures) is its own company.
- A brand's name on a venue isn't the brand: "State Farm Arena", "AT&T Stadium", "Capital One
  Arena" and "AT&T Performing Arts Center" aren't State Farm, AT&T or Capital One (`sponsor()`
  in `lib/scoring.js`). The sector directory reads venues the same way.
- Companies run apart keep their own names: Hewlett Packard Enterprise, Merck KGaA, Merck
  Millipore, Berkshire Hathaway HomeServices (franchised brokerages), Hilton Grand Vacations,
  Lowes Foods, Chevron Phillips Chemical, Siemens Energy and Siemens Healthineers, Uber
  Freight, Warner Music Group, and Mitsubishi UFJ (a bank), Mitsubishi HC Capital and
  Mitsubishi Estate aren't HP, Merck, Berkshire Hathaway, Hilton, Lowe's, Chevron, Siemens,
  Uber, Warner Bros. Discovery or Mitsubishi. Mitsubishi's makers (Mitsubishi Corporation,
  Heavy Industries, Electric, Motors) still read as Mitsubishi.
- A university takes in its name alone or with "University" and the schools named with it
  (Yale School of Management, Columbia Business School, Stanford GSB, Harvard Kennedy School;
  `university()` in `lib/scoring.js`), and nothing else: a hospital, a health system, a lab
  or a company that shares its name keeps its own (Harvard Pilgrim Health Care, Stanford
  Health Care, Vanderbilt University Medical Center, Brown University Health, the University
  of Pennsylvania Health System, UCLA Health, Yale New Haven Health, Johns Hopkins Medicine),
  and so does another school (Princeton High School, Harvard Elementary School). A school
  named apart from its university (Wharton, Kellogg, Booth) keeps its own name, as MIT Sloan
  did.
- A credential, a program or gig work on a listed company's platform, or a fan of it, isn't
  a job there (`NOT_ITS_STAFF`): "AWS Certified Solutions Architect", "Google Developer
  Expert", "Microsoft MVP", "Uber Driver", "Airbnb Superhost", "Twitch Streamer", "TikTok Shop
  Seller", "LinkedIn Top Voice", "Google Alum", "Coca-Cola Scholar", "Disney Fan". Written as
  the first part of a headline, a listed name reads as the person's employer; "AWS Certified
  Solutions Architect" was a role at Amazon (10). For a tech or media platform, a partner, a
  consultant or an admin is another company's too ("Google Premier Partner", "Workday
  Consultant"); at a bank, a firm or a shop they work there ("Deloitte Partner", "Starbucks
  Partner").
- Reading a name: cleaning trims a legal form ("Inc.", "Incorporated", "Corporation",
  "LLC"…; `LEGAL_FORM`), except where the name with it is another company (`WHOLE_NAME`):
  Chase Corporation and Merrill Corporation read as JPMorgan Chase and Bank of America until
  September 2026, and are their own now. A name stops at a sentence's end or a comma
  (`NAME_END`), not at an initial's or a short form's full stop: "J.P. Morgan" was cut to
  "J.P", which matched nothing, "J. Crew" and "T. Rowe Price" to nothing, "U.S. Bank" to
  "U.S" and "St. Jude Children's Research Hospital" to "St". They read in full now.
- The rule that drops "at home" dropped The Home Depot, Home Instead and Home Chef too. They
  read as companies now; "Stay at home mom" still names none.

`tests/known-companies.test.mjs` checks each addition's spellings, the forms each closed entry
must still read, that no two entries claim one name, a list of names that must stay their
own (`NOT_LISTED`), and the credentials and gigs that aren't jobs.

### What broadening changed

112 companies were added, 133 → 245: 3 at 9, 80 at 8, 29 at 7. By industry: 26 consumer, 20
industry, 17 finance, 16 health, 15 education, 9 consulting (law), 6 tech, 2 media, 1
entertainment. Adding them changed no score, alias or industry already on the list, so there
are no old rows to keep and no offer; stored scores are recomputed once because the list's
fingerprint changed (Staleness, above). Closing the older aliases afterwards changed no
score either: it stopped other companies from reading as listed ones, and they're
estimated from the network like any other.

Left off, and why:

- **Fortune 100 companies known inside their trade more than by the public**: McKesson,
  Cencora, Cardinal Health, Centene, Sysco, Archer Daniels Midland, StoneX, TD Synnex, Ingram
  Micro, Performance Food Group, Energy Transfer, Enterprise Products, Plains, Broadcom,
  TIAA; the refiners Phillips 66, Marathon Petroleum and Valero, known by regional
  gas-station brands; Charter Communications, known as Spectrum. And Publix, a regional
  grocer.
- **Near a cutoff**: the tenth law firm (Paul, Weiss or Morgan Lewis); Best Buy, at the
  Fortune 100 line; Carlyle and TPG, top private equity firms outside the Fortune 500.
- **As large, but not household names here**: Roche, Novartis and Sanofi; Stellantis and
  Ahold Delhaize, whose brands are (Jeep, Food Lion) but whose names aren't; Cargill and Koch,
  the largest private US companies.
- **Named like something else**: Circle K, also a college service club; Blue Cross Blue
  Shield, a federation of 33 companies rather than one.
- **Fields this pass didn't sweep beyond the Fortune 100**, for a later one: tech and
  aerospace, already well covered (Panasonic, LG, Lenovo, Airbus); manufacturing, chemicals
  and household goods (Honeywell, 3M, Bosch, Dow, Colgate-Palmolive, Kimberly-Clark); more
  food and drink (Hershey, Keurig Dr Pepper, Molson Coors); stores and brands (Macy's, Ross,
  Nordstrom, Estée Lauder); cruises and casinos (Carnival, MGM Resorts);
  homebuilders (D.R. Horton, Lennar); payroll (ADP); finance (Schwab, Vanguard); hospitals
  known within medicine or one region (Mass General, Cedars-Sinai, NYU Langone, MD
  Anderson); news beyond the Times and Bloomberg (The Washington Post, AP, Reuters, NPR).
- **Not decided**: government employers (the armed forces, the Postal Service), and whether
  xAI and Mistral are frontier AI labs (10).

### Keeping the old scores: a one-time offer

A list change shouldn't take anyone's view away silently. Scores computed with the old list
carry no 'scoring_list' stamp; the first time `rescoreAll()` replaces them (and some row was
already scored, so the database isn't new), it opens an offer: `app_meta`
'legacy_scores_offer' = `open`. The Scores tab then shows one card at the top: "Built-in
scores changed in this version: Snap 9 → 8, UCF 5 → estimated. Keep any of the old ones as
your own?", with *Keep all*, *Choose…* and *No thanks* (`app/components/LegacyScoresCard.js`,
`/api/company-scores/legacy`).

- **What it lists** (`lib/legacy-offer.js` `legacyOffer()`): each old entry that someone in
  this network works at now, whose built-in score is different now (the list or the
  estimate, before any sector lean), and that you haven't scored yourself. Current
  employers only, because those are what the Scores tab lists: a kept score shows there as
  yours and *Auto* can hand it back. (A company only in former roles would get a score
  nothing lists; a former role counts at 70%, so it moves people little.) A removed entry
  no longer canonicalises ("University of Central Florida" isn't "UCF" any more), so its
  names are found by its own names, read the way `cleanCompany()` read them then. Those are
  the old alias narrowed to the entry's own company: the old aliases also caught other
  companies (Snap-on and Specs Optical as Snap, Hard Rock Hotel as Hard Rock Digital, VaynerX
  as VaynerMedia), which the old list scored by mistake, and keeping must not give them its
  score. They end at the name (`$`) except where every company starting so is the entry's
  (UCF's colleges, AdventHealth's hospitals, Havas's agencies); a test checks.
- **Keep** writes the old score to `company_scores` under every name scoring uses for those
  rows (UCF's covers "UCF" and "University of Central Florida"), with the same
  `setCompanyScores()` that the Scores tab uses, then rescores everyone once for the whole
  batch. A kept score is yours like any other: *Auto* hands it back.
- **Once:** *Keep* or *No thanks* sets the offer to `kept` or `declined`, and nothing
  reopens it. An open offer whose first look finds nothing to offer closes itself (`none`):
  the network the old list scored is the one it reads, so nothing could turn up later, and
  every visit to the Scores tab would otherwise read the whole network again to find
  nothing.
- **Never** for a fresh database (nothing was scored with the old list), and never while a
  CSV import or the sample is on screen: those are scored in the browser, not the server.
- If the rescore after a keep fails, the scores and the answer are saved, the answer says
  so, and the next map load rescores (the model stamp is cleared).

The offer covers this one change, from lists that stamped nothing. A later edit to the list
changes the stamp and rescores, but offers nothing unless it brings its own old rows and
its own trigger.

## The public company dataset

The curated list stops at household names, so most places people actually work are unknown
to it and score the neutral 5. `COMPANY_DATA` (in `lib/scoring.js`, just below the curated
list) is a second, wider list: organizations with a public footprint that most people
wouldn't know by name, each scored from public facts anyone can check, with the source
beside the score.

**Where it sits.** `companyScore()` reads, in order:
1. your own score;
2. the curated list (`known`);
3. the dataset (`data`);
4. the network's estimate (`network`: 5.5 at 5+ people there, 6 at 15+);
5. the neutral 5 (`default`).

A company on the dataset is a fact, not an estimate. Many of your people working there
don't move it, and the legacy offer doesn't call it "estimated". The Scores tab labels it
*public data*.

**The scale.** 8 for Fortune 500 / Global 2000 / S&P 500 scale (about $20B+, or 20,000+
staff), a major pro league or a U.S. federal department. 7 for a listed company or a private
one valued at about $2–20B, a national TV network, a large health system, a major defense
research lab, or a university ranked about 11–50 (U.S. News Best National Universities).
6 for an established, notable one: a listed small or mid cap, a venture-backed company with
about $100M+ raised or 500+ staff, a university ranked about 51–150, or a national cultural
institution. Anything smaller isn't listed, because it would score 5 anyway. When in doubt,
the lower score.

**The rules.**
- Public sources only, never anyone's scan: the app uploads nothing, so nothing a user scans
  can reach the list.
- Organizations only. A one-person business or a personal brand is never listed, because
  its name points at someone.
- A name several organizations share goes in only in the forms that say which, and a venue
  named for a company never matches it (`tests/company-data.test.mjs`).
- It is fingerprinted into the scoring stamp with the curated list, so an entry added or
  rescored rescores stored scores once.

**Grown from public lists (2026-09-28).** 567 more, in one block at the end of
`COMPANY_DATA` (`// ── grown from public lists`):
- the Fortune 500 (2025), less the 127 either list already had: 376, with the
  brands staff write as their employer given entries of their own at their owner's score
  (KeyBank at KeyCorp's, Alaska Airlines at Alaska Air Group's), so the sector directory,
  which names those brands, still finds them;
- the U.S. federal government: 114 (departments and military branches 8, agencies and
  national labs 7);
- U.S. News's Best National Universities, ranks 21–100: 77 (21–50 at 7, 51–100 at 6).

Each of these matches only whole names (`exactly()`, or `university()` for a university
and its schools), and `tests/company-data-spellings.json` holds every form, each read
the way the app reads it. Left out on purpose: a form that is a common word, first name
or title alone (`COMMON` in the tests: "Army", "Hartford", "White House", which
"White House | Black Market" would have become), one two organizations share (CHS,
bare "Federal Reserve"), one the gig-work rule means can never read ("World Courier"),
and names the reader trims to a bare word ("Gap Inc." reads as "Gap"). Names that the
sector directory's words must still find are spelled its way ("US Bancorp", "Land O
Lakes", "Census Bureau").

**How it started (2026-09-28).** 155 organizations researched from public sources:
- 64 met the scale (11 at 8, 31 at 7, 22 at 6);
- 32 names were ambiguous and left out (several organizations share them);
- the rest were too small to add anything.

It grows each release, from broad public lists (the Fortune 500, the Forbes Global 2000,
the next bands of university rankings, federal agencies), so no one field's companies are
the only ones known.

**Names read through Unicode normalization.** Before any of this, a name is read through
NFKC. Styled letters (𝗠𝗶𝗰𝗿𝗼𝘀𝗼𝗳𝘁), full-width bars (｜) and the Apple logo glyph after
"Apple" used to hide a company, and a class year ("UCF ’26") is a student's, not the
school's name.

## One industry per company

Industry is inferred (`lib/companies.js` `INDUSTRIES`, regexes over names and headlines),
but each **company** gets exactly one, used everywhere: its colour in Paths, its row in
Scores, the school rule above, and the sector lean. `companyIndustry()` decides, in order:

1. **The curated list's own industry**, the last field of each `KNOWN_COMPANIES` entry.
   159 of the 245 names carry no industry word (Adobe, Pfizer, MIT, Costco…), so without it
   they took whatever their people's headlines said. Where a name does say something, the
   field agrees with it (a test in `tests/companies.test.mjs` checks both). Aliases count:
   "BNY Mellon" is BNY, finance.
2. **What the name says** ("Meridian Health" is health).
3. **What most of the people who work there now say** in their headlines, "unclear" answers
   aside. **A tie stays unclear**: that's the codebase's rule for guesses, and it keeps the
   answer the same whichever order rows are read in (the server and Paths read them in
   different orders).

`networkCompanies(rows, {industryOf})` computes it with the headcount, once per network,
and where each answer came from (`industryAndSource()`: `list`, `name`, `people`, or none
when unclear): a broad pick in Settings counts the first two only (below). `lib/scoring.js`
imports nothing, so the inference is passed in (`industryKeyOf`), the way `rescoreAll()`
always did. Before `SCORING_VERSION` 3 each *person's* headline decided their company's
industry, so two people at one company could get different estimates.

The words are the same for everyone. Until September 2026 they also named one school
("UCF") and one company's world ("Snap", "Snapchat", "Lens", "AR", so "AR Specialist",
accounts receivable, read as media), four retired picks (Polymarket, Anduril, Sandia and
Whatnot, which also read "whatnot", a word, as retail), and a job title, "growth", which made
"Head of Growth at Acme Software" and "Summit Growth Equity" media. "Growth marketing" still
reads as marketing, and "growth equity" as finance.

`readNetwork(rows, {industryOf})` reads every headline once (roles, student, reach signals)
and finds every company anyone names, a former employer included, with its headcount and
industry. `scoreNetwork(rows, {read})` then scores that read with no parsing, so the
preview and a save score one read twice for about the price of once.

Paths groups people under the names scoring gives companies (`companyOf()` is
`currentCompany()`, so every name comes from `cleanCompany()`): each bubble, list row and
"way in" is the company a score is built on, and there is one list of companies, the curated
one. Until September 2026 Paths merged names by a second, hand-picked list of its own
(`normalizeCompany`, about 77 substring rules, one person's picks among them), which also
folded other companies in: Oxford, Hartford and Bradford were Ford, Bainbridge was Bain, and
Mitsubishi UFJ, a bank, was "Mitsubishi Power". Names that list merged and the curated one
doesn't ("Navy Federal Credit Union" and "Navy Federal") are now two, like any other company
written two ways; a company worth merging belongs on the curated list.

Where Paths' colour can still differ from the industry scoring uses:

- **Two profiles in one database.** The server votes over every row it holds; Paths only
  sees the profile on screen. A company whose people mostly belong to the other profile can
  vote differently.

## Your sector (Settings)

Up to three picks and a strength, saved in `app_meta` 'settings' as
`sectorFocus: {sectors, strength}` (`lib/sector-focus.js` validates it). A pick is one of
the twelve broad `INDUSTRIES` keys or a sector from the directory (below); a choice of
industries saved before the directory existed reads as it did. In `companyScore()`, a
company gets **+1 (lean) or +2 (strong), capped at 10**, when a picked directory sector is
among the sectors it matches (`sectors`, passed in), or a picked industry is the industry
one of those sectors sits under (`sectorIndustries`), or its one industry when the curated
list or its name gave it (`industryFrom`). **An industry includes its sectors**, so
*Healthcare & Biotech* takes in a practice only the directory calls dental. **It doesn't
count an industry voted by job titles**: most companies' industry comes from their people's
headlines, a vote over words every kind of company employs (recruiter, attorney,
consultant, engineer, data), so a lone "Recruiter at Acme Widgets" made Acme consulting and
"Software Engineer at Pinecrest Foods" made a food company tech, and a broad pick lifted
them. Such a company counts only through the directory's sectors it is in, which don't read
a job for work every company has. Its colour in Paths and its one industry don't change.
However many picks match, it is added once, and `sector` names the pick that matched, a
directory sector before an industry. Never on a score you
set: `yours` is returned before the lean. The result keeps its source (`known`, `network`,
`default`) and adds `{base, sector, sectorBonus}` only when the score actually moved, so
everything reading `{score, source}` is unchanged. The working names the pick:
`explainScore(s, boost, {sectorLabel})` gets the labels from `lib/rpc.js`, because
`lib/scoring.js` imports nothing ("5/10: 4 + 1 your sector: Dental"); without them it says
"your sector" alone.

- A point of company score is worth `0.055 × title points`: +0.55 for a founder, +0.50 for
  a VP, +0.41 for a director, +0.22 for an IC. So +1 moves a VP at a 6 (7.0, A) to S (7.5),
  a director at YouTube (9) from 7.1 (A) to 7.5 (S), and a founder at an unknown company
  from 6.7 to 7.3 (7.8, S, at +2).
- **The lean lifts the company, not the headline's claims.** The reach bonus is halved by
  the company's score *before* the lean, so a founder at an unknown company who says "Angel
  investor" goes 7.2 → 7.8 on lean, not 7.2 → 8.3: liking a sector says nothing about whether
  a self-written claim is true. (A score you set is your judgement of the company, so it
  decides.)
- **Recomputed from scratch on every rescore, never written into `company_scores`**, so
  turning it off gives back exactly the scores from before. `rescoreAll()` reads the focus
  itself, so imports, company-score changes and a stale model all apply it.
- **Staleness:** `rescoreAll()` stamps `app_meta` 'scoring_focus' with the focus's
  fingerprint (`lean:health,dental@<version>`, the directory's version, or `none`).
  `rescoreIfStale()` rescores when it no longer matches the saved focus: a database restored
  or brought from another computer, a save whose rescore failed, or an update that changed
  the directory's words or how a pick matches (`MATCHING`, 3 since a broad pick stopped
  counting industries voted by job titles). Every pick carries the version, an industry too,
  since it includes its sectors; a focus of industries stamped before that
  (`lean:media,tech`) is redone once. The industries' own words are in the list stamp (the
  curated list, above).
- **Saving** goes through `POST /api/settings`; `lib/settings-effects.js` sees the focus's
  fingerprint changed and runs `rescoreAll({compareWith: the focus it replaced})`. That
  scores the same read of the rows with the old focus too, in memory, and counts who changed
  tier with `previewSectorFocus()` itself (people once, at their closest degree), so the save
  says what the preview said, even when the stored tiers were stale. A strength change with
  no sectors picked scores like nothing picked, so it saves without a rescore. If the
  rescore fails, the choice is still saved, the answer says so, and the old stamp makes the
  next map load retry. No promotion notifications fire: those belong to scans
  (`/api/ingest`).
- **The ripple:** more people at A/S raises circles' elite share, so bridge boosts and
  catalyst flags can change. Outlink's priority multiplies by tier, and the profile's Network
  Power and milestones count tiers. All of that follows the new tiers. The scanner's default
  order, newest connections first, doesn't look at tiers; only when you pick *Highest tier
  first* on the Scan page does it read bridges' circles by stored tier and apply its tier
  filter (`scrape.py`, the bridge order; `app/setup/page.js`). The Settings page says so.
- **A CSV import and the sample network are not re-weighted.** They're scored in the
  browser without the database's company scores or settings (`lib/csv.js`), and the
  sample's scores are baked into `public/demo-data.json`. Settings says so when one is open.
  The sample's companies all carry set scores ("sample score"), so a lean wouldn't move it
  anyway.
- **Calibration:** the lean inflates S. On the sample, scored as if scanned (no set
  scores), 14 of its 19 invented companies are tech, but only one (Northwind Labs) by its
  name; the other thirteen are tech by their people's headlines, which a broad pick no longer
  counts (Aperture Grid became one of them when "growth" stopped reading as media). So lean tech lifts one company and moves 10 of its 748 people up a tier, S 118 →
  123 of 873 rows, and strong tech 27 (before: 120 people and S 118 → 199 at lean, 220 at
  strong). Lean finance lifts Ironwood Capital (by its name) and Orchard Pay (Fintech &
  Payments by its name): 20 people up, S 118 → 132. On the synthetic network in the timing
  check (30,000 rows), lean tech and finance lift 390 companies and move 615 people up,
  where it was 704 and 1,189. Networks are often concentrated in their owner's own sector,
  so expect a broad lift more than a reshuffle, and "S is the top ~3–4%" no longer holds with
  a lean on.
- `users.sectors` (free text, never written by the app) is a different thing: the
  Sidebar's "Shared sector" insight and Outlink's priority still read it. The profile's
  *Your Sectors* shows the Settings choice.

## The sector directory

`lib/sector-directory.js` is a fixed list of the most common sectors people work in, 49 of
them (Dental, Real Estate, Software & SaaS, Insurance, K-12 Education, Beauty & Personal
Care, Agriculture & Farming, Veterinary & Animal Care, Social Work & Human Services,
Security Services…), each under one of the twelve industries and each with its words. It is
a list, not a model: no AI, nothing sent anywhere, the same answer on every computer every
time. Scores → Your sector shows each industry with its sectors, searches them by name,
word or company, and suggests the ones your network is in.

A sector is `{key, label, group, kind, words, roles?, names?, companies, not?}`. `key` is
saved in people's settings. `group` is the industry it sits under, and gives it that
industry's colour: Paths' colours don't change. `kind` is `industry` or `function`
([below](#industries-and-functions)).

### How a company matches

Worked out once per read of the network: `lib/rpc.js` `readForScoring()` passes
`sectorMatcher()` to `readNetwork()` as `sectorsOf`, beside `industryOf`, and each company's
matches ride along to `companyScore()`. Rescoring, the preview, the Scores tab and the
suggestions all read through it, so they agree. A company matches a sector when:

1. **its name** has one of the sector's `words` (or `names`, or a function sector's
   `roles`), or is one of its `companies`; or
2. **at least half of its people in your network**, and at least one, say one of the
   `words` in their headline. For a one-person company, that person decides. A function
   sector's `roles` don't count here.

A company can match several sectors; the lean is still added once. An industry includes its
sectors: picking *Healthcare & Biotech* counts a company whose one industry is health, and
any company the directory places in Hospitals & Clinics, Dental, Pharma & Biotech, Medical
Devices, Mental Health or Fitness & Wellness (`readForScoring()` passes `sectorGroup` as
`groupOf`, so each company's read carries the industries its sectors sit under). A practice
whose name and people say only "Dentist" has no industry of its own, but it is Dental, so
it's in health.

Words are whole words, any case, compared after accents, apostrophes and punctuation are
set aside: "incidental" isn't dental, "Banksy" isn't banking, "Lawson" isn't legal, "DSO"
matches only on its own, and "Oil & Gas" is "oil and gas". `dentist(s)` in the list means
dentist and dentists. `names` count in a company's name only: "AI" in "Quillon AI" says what
the company is, where in a headline it is as often a buzzword. `companies` match from the
start of the name as whole words (`aspen dental` is Aspen Dental Management), or the whole
name when they end with `$` (`box$` is Box, not Box Hill Hospital), and never a venue named
for one ("State Farm Arena", "FedEx Field"). A name that says school, college or university
only matches an education sector's companies ("Chase College of Law" isn't Chase the bank),
though its words still count. The matcher sees each company as `cleanCompany()` names it,
so an entry is written that way: "AWS" is Amazon and "Dover Corporation" is Dover by the
time the directory sees them, and a test runs every entry through `cleanCompany()` to check
it still reaches its sector (39 couldn't, before). A company on the curated list whose
alias is closed is written with `$` ("adobe$"), so a company that only starts like it
("Adobe Dental") isn't claimed.

**Which companies it names.** Only companies known across the country, in their sector: the
national brands, and institutions known nationally (Mass General, MD Anderson). A company
known in one state or metro area (a state's utility, a regional grocer, health system or law
firm) is left off, as the curated list leaves off regional picks: its name's words and its
people's headlines place it, like any other company. In September 2026 that took off
Orlando Health, AdventHealth, Florida Blue, Tampa Electric, the Orlando Utilities
Commission, Florida Power & Light, Shutts & Bowen, Gunster, Akerman, Universal Orlando,
Winn-Dixie and Publix, and by the same rule Georgia Power, Southern California Edison, PG&E,
Con Edison, Wawa, Sheetz, Meijer, H-E-B, Wegmans, BJ's, Baptist Health, Atrium Health,
Intermountain Health, Sutter Health, Banner Health, Northwell, Geisinger, Ochsner and Emory
Healthcare. **Schools are named in full, never by a short name**: the words university,
college and the names of their schools (business school, school of law…) place a school, and
short names were four Florida schools' (UCF, UF, FSU, USF) with a few others. The only short
names left are the curated list's own names for its schools (MIT, UCLA), because those are
the names scoring gives them.

What a headline counts, for precision:

- **What someone does now.** "Ex-", "Former" and "Retired" parts are where they were.
- **Not who they serve.** Words after "for", "helping", "serving", "supporting" or
  "empowering" don't count: "Mortgage lender for dentists" is banking, not dental.
- **Each part for its own company.** A part that names a company ("Host at The Long Table
  Podcast") counts for that company only. The parts before the first company describe that
  role ("Dentist | Owner at Smith Family Practice"); the parts after it are side notes and
  don't count ("… at Quillon | Soccer mom | Podcaster"). A headline that names no company
  (a company scan) counts all its current parts.
- **`not` cancels.** A `not` phrase cancels its sector's words in the text being read: "food
  bank" isn't banking, "travel nurse" isn't travel, "Army veteran" isn't serving now,
  "general counsel" (an in-house lawyer) doesn't make the company a law firm, "Newport News
  Shipbuilding" isn't news, "Customer Service Advisor" isn't at a dealership, "Government
  Affairs Manager" isn't in government, an "Auto Damage Estimator" isn't in construction.
- **A job every company has takes its part with it.** A part that holds a function sector's
  role (recruiter, attorney, marketing, accountant…) is about that work, so the industry
  words beside it don't place the company: "University Recruiter", "Construction Recruiter",
  "Insurance Defense Attorney", "Dental Marketing Manager" say nothing about where. The
  company's name still counts ("Marketing Manager at Aspen Dental" is Dental by Aspen
  Dental). A role inside a longer phrase of the list is that phrase's ("marketing" in
  "sports marketing"), and a role its own sector cancels doesn't count ("law" in "law
  enforcement").

### Industries and functions

The one-person rule is deliberate: a dentist's own practice is usually one person in your
network, and the majority keeps bigger companies honest. But it used to let a job every kind
of company has place a company by its one person: "Recruiter at Acme Widgets" made Acme HR &
Recruiting, "Marketing Manager at Bright Smiles Dental" pulled a dental practice into
marketing, and enough "Software Engineer at Chase" pulled a bank into software. So each
sector has a `kind`:

- **An industry sector** is a kind of business whose people's jobs say where they work: a
  dentist works at a dental practice, a realtor at a real estate firm, a nurse at a hospital.
  Its job titles are `words` and count everywhere. 39 of the 49.
- **A function sector** is work every kind of company has people for: HR & Recruiting,
  Marketing & Advertising, PR & Communications, Accounting & Tax, Legal, Management
  Consulting, Software & SaaS, AI & Data, Cybersecurity, and Security Services (many
  companies employ their own guards). Its `words` are kinds of firm only (staffing agency,
  law firm, CPA firm, marketing agency, SaaS, AI startup, MSSP, security company), and count
  everywhere. Its jobs, titles and the names of the work (recruiter, recruiting, attorney,
  accountant, tax, software engineer, JavaScript, security officer), are `roles`: they count
  in a company's name ("Acme Recruiting", "Smith CPA", "Jones Law Group") and never in a
  headline. So "Recruiter at Acme Staffing" matches by the name, "Attorney | Partner at Jones
  Law Group" is Legal, and a lone "Accountant at Pinecrest Foods" is not Accounting.

Software & SaaS, AI & Data and Cybersecurity are functions because banks, shops and hospitals
all employ software engineers, data scientists and security teams (and "AI" is in every other
headline): a company is in software when it sells software. "Software", "cybersecurity" and
"machine learning" still say so in a company's name.

The price is recall: a law firm named only for its partners ("Smith & Jones") whose people
write "Attorney", or a startup whose engineers never write "SaaS", isn't placed in the
function sector, and a broad pick doesn't reach it either, since its one industry came from
its people's job titles (Your sector, above). A missed firm only means no lean; placing
every company with a recruiter in consulting lifted the wrong people.

**The version.** `DIRECTORY_VERSION` is a hash of the list (and of `MATCHING`, which is
bumped by hand when how a pick matches changes, here or in `lib/scoring.js` `leanToward`),
so any edit changes it and nobody has to remember to. Every focus carries it in its
fingerprint, since an industry includes its sectors; after an update that changed the words,
the next load rescores. A word-list edit doesn't change `SCORING_VERSION`.

**Labels.** `lib/sector-labels.js` holds each pick's label, colour, industry and kind for
pages that only name a pick (the profile), so they don't load the word lists;
`lib/sector-directory.js` re-exports them, and a test keeps the two the same.

**Suggestions.** `suggestSectors(rows, read)` gives the five directory sectors with the most
people (each once) working now at a company that matches, with how many such companies:
"Dental: 42 people at 17 companies". `GET /api/settings/sector-suggestions`. Only a network
you've scanned: a CSV import or the sample isn't in the database.

**Cost.** Matching is a dictionary lookup per word, with every headline read once per read
of the network. On the synthetic network in the preview's timing check it added about 15% at
10,000 rows (120 → 138 ms) and 8% at 30,000 (336 → 364 ms); with every headline different,
13% and 9%. A pick from the directory scores as fast as an industry. The role and venue
checks (September 2026) cost nothing measurable: before and after them the preview took
about 200 ms at 10,000 rows and about 500 ms at 30,000, within the run-to-run noise.

### How to add or fix a sector

Anyone can improve the list. Precision over recall: a word that means something else in
another field lifts the wrong people, while a missing word only means no lean.

1. Edit `DIRECTORY` in `lib/sector-directory.js`. Add words to a sector, or a new sector
   under the industry it belongs to (`group`) with its `kind`: a function when every kind of
   company employs people for that work, else an industry. Prefer job titles, credentials
   and kinds of business that only this sector uses; in a function sector, jobs go in
   `roles` and only kinds of firm in `words`. Never a word every field uses on its own:
   manager, director, engineer, analyst, sales, associate, partner, agent, broker, producer,
   consultant and the like (the tests refuse them). Phrases that contain one are fine
   ("oral surgeon", "wealth manager").
2. A word that's right in a company's name but a buzzword in a headline goes in `names`.
3. Add a company only when its name carries none of the words, only if it is known across
   the country, and written as `cleanCompany()` names it (a test runs every entry through
   it). End it with `$` when its name is also a common word or the start of other
   companies' names (`box$`, `target$`, `adobe$`). No school by a short name.
4. When a word means something else inside some phrase, add the phrase to `not`.
5. Never rename or remove a `key`: it is saved in people's settings. Fix the label, words
   and companies instead. A new key must not be one of the twelve industries' keys.
6. Add examples to `EXAMPLES` in `tests/sector-directory.test.mjs`: at least one text the
   sector must match and one it must not (a headline, `company: Name`, or `[headline,
   company]`). Run `npm test`.
7. Add a CHANGELOG line. There's nothing to bump: the version follows the list, and scores
   picked from the directory refresh on their next load.

## How it was checked

For the mapped circles, a person's title should predict how senior *their own*
connections are. With the old model that correlation was 0.10; with this one it's 0.30.
Re-run that check whenever the model changes (the method is in the 0.1.10 PR, #14; there
is no script for it in the repo), and bump `SCORING_VERSION` so stored scores refresh.

**`SCORING_VERSION` 3 (one industry per company, the sector lean):** the lean changes
company scores, never title points, so the title-to-circle correlation is unchanged by
construction. One industry per company changed nothing on the sample network (0 of 873
scores). The sample can't stand in for the real check (14 bridges whose circles are random
titles): there, r(bridge title, circle's mean title) = −0.18 with or without a lean, and
r(bridge power, circle's mean title) = 0.15 with none, 0.20 lean tech, 0.01 strong tech.
Re-run the real check on a real network.

**The broader list (still `SCORING_VERSION` 3):** company scores only, so the
title-to-circle correlation is unchanged by construction. The sample network doesn't move (0
of 873 scores, with its own company scores or as if scanned): none of its invented companies
reads as a listed one, which a test checks.

**The neutral list (still `SCORING_VERSION` 3):** it changes company scores, never title
points, so the title-to-circle correlation is unchanged by construction, and the sample
network doesn't move (0 of 873 scores: its companies are invented, each scored for it).
`SCORING_VERSION` stays 3 because 3 is unreleased: a 0.2.x database rescores once anyway,
and the list stamp catches a database the unreleased build scored with the old list.

**Closed aliases, school short names that aren't schools, and broad picks that don't count
job titles (still `SCORING_VERSION` 3):** without a sector focus nothing on the sample
network moves (0 of 873 scores, titles or tiers, with its own company scores or as if
scanned): its invented names share no first word with a listed company, and none of its
headlines has a short name. With one, a broad pick lifts far fewer companies (Calibration,
above). The title-to-circle correlation is unchanged by construction for the company
changes; the school-club change touches titles only for club roles with a short name, so
re-run that check on a real network with school clubs in it.

**Schools read alike, functions, and industries with their sectors (still
`SCORING_VERSION` 3):** the school rules change title points only for school-club roles
and "major @ school" headlines (0 of the sample's 873 titles change), and the rest changes
company scores under a sector focus only, never title points. Re-run the title-to-circle
check on a real network with school clubs in it. A database the unreleased build scored
kept its old school readings until its next rescore (any import, company score or Settings
save); since the rule tables joined the list stamp (Staleness, above) the next load redoes
them, as it does a focus stamped before industries included their sectors. The Queue and the
person panel read the stored scores, so they change with them.

**Government and military titles (still `SCORING_VERSION` 6, and new rule tables):**
four rounds of adversarial review ran about 8,500 invented headlines through the reader
(officials, officers, and the ordinary headlines that share their words) and compared
ordinary ones with scoring 5. The first two found titles read inside office names and
clubs; the third (63 findings) found that a government word anywhere nearby was enough,
which is why a title now needs its own organization to be a government's (`where()`); the
fourth (59) found look-alikes on both sides, which is why a doubtful title is now left out
(precision first) and a named one reads its bio as bio.
Every case the rounds found is a test in `tests/scoring-misses.test.mjs`. The rule
tables' fingerprint includes the code that applies them, so a change to it rescores. The
sample network doesn't move (0 of 873 tiers or title points): it has no officials or
officers.

**`SCORING_VERSION` 6 (what a review found under-rated):** a review of the score in
September 2026 named the kinds of people it ranked too low, and scoring 6 is its fixes:
titles whose company is written without "at", "MD" and country heads, academics, an
audience of one's own, a title the rules can't read, and circles strong in number rather
than in share (all above). `tests/scoring-misses.test.mjs` holds invented examples of each,
and every one of those tests fails on scoring 5. On the sample network no tier and no
title's points move (0 of 873); four of its bridges, already S, score 0.1 to 0.6 higher
through the strong people in their circles (`public/demo-data.json` keeps the scores it
was built with, which the films show). The title changes reach academics, audiences,
unreadable titles and possessives, so re-run the title-to-circle check on a real network.
Two of the review's findings aren't changed here: a sector you pick lifts power, not only
how relevant someone is to you, and a founder's or a CEO's title at a venture nobody knows
still counts in full, which rates some of them too high.

## Bridges

Being high-scoring makes someone worth *knowing*. Being a **bridge** is about the circle
behind them: `circle_power`, `circle_s_count`, `circle_a_count`, `circle_elite_pct`. A
mid-tier person with twelve S-tier people behind them can be worth more to you than an
S-tier person who opens nothing. The boost above stays a bonus on top, at most +2, so
someone's own title and company still decide most of their score. A proposal to blend a
bridge's score toward their circle's strength was considered on 2026-09-24 and not adopted;
scoring 6's count of the strong people in a circle (Bridge boost, above) is the smaller step
a review later argued for.

## The honest caveat

The title ladder is a hand-written opinion, tuned against one real network, and the company
list, though it now follows a written rule, is a judgement about which names most
professionals know. Company scores are editable for exactly that reason. The model is
**domain-shaped**: the list now reaches health care, retail, autos, energy, law and the top
universities, but it is still a list of big names. Tradespeople, small and local businesses,
most schools and hospitals, and the public sector are estimated from the network, so a
network made mostly of them scores lower across the board than one full of large employers.
And the tier is a statement about **network position, not human worth**, SPEC invariant 6.
Say so plainly in any UI that shows a tier.
