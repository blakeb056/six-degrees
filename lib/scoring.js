// How much power a person holds, and why — the one place it is decided.
//
//   power = title × company weight + reach bonus + bridge boost
//
// The core is a PRODUCT, not a sum: a title is worth more at a bigger company,
// and a big company is worth more the higher you sit in it. A VP at Google
// outranks a founder of an unknown startup, who outranks an intern at Google.
// The old model added them (0.5 × seniority + 0.3 × company), which let an
// intern at a famous company score like a director at an unknown one.
//
//   title (0–10)         read from the person's roles in their headline, the
//                        strongest counting ("Ex-" and "Former" ones at 70%);
//                        student clubs and fraternities don't count as company
//                        titles. An audience of their own ("2.5M+ followers")
//                        counts like a title, and a title the rules can't read
//                        like the most common one, an individual contributor's.
//   company weight       0.45 + 0.055 × company score, so 0.725 when the company
//                        is unknown or none is found (a neutral 5) up to 1.0 (a
//                        company scored 10); 0.505 is the floor, for a company
//                        you score 1.
//   reach bonus (≤1.5)   real signals only, matched as whole words: investor,
//                        YC, 30 under 30, audience or revenue in the millions,
//                        TEDx/keynote/patents, and the top honours of every
//                        field (a Nobel, a Pulitzer, an Oscar, an Olympic
//                        medal…). Halved at a company we don't know or one
//                        scored 4 or less, judged before any sector lean.
//   bridge boost (≤2)    for a 1st-degree person whose circle is mapped, when
//                        their circle is unusually strong: a high share of it at
//                        A or S (up to +1), or many people there (+1 for every
//                        25, up to +2). Recomputed each time, never ratcheted.
//
// Company scores come from, in order: the score you set, a curated list of
// well-known companies, and otherwise how many of your people work there.
// If you picked sectors in Settings, a company in one of them gets +1 or +2
// on top (never above 10, never on a score you set). That is worked out fresh
// on every rescore and never written into your company scores.
//
// Tiers are graded on your network's curve unless you choose the fixed scale
// (Settings → Tiers): your top 3% of 1st-degree people are S, and so on down
// (CURVE). The curve only lifts, so a strong network keeps its fixed-scale
// tiers, and it never lifts anyone under 4 into S or A. Everyone, 2nd degree
// included, is graded on the same cut-offs, taken from your 1st degree.
// Everything here is a plain function; tests/scoring.test.mjs pins it down.

// Bump when the model changes: the app rescores stored rows once on next load.
// 3: one industry per company (not per person), and the sector lean.
// 4: an unknown company is neutral (5, not 4, and 5 when none is found, not 3),
//    and tiers are graded on your network's curve by default.
// 5: the public company dataset (COMPANY_DATA, below the curated list), read after the curated
//    list and before your network's estimate; names read through Unicode
//    normalization, so styled letters, full-width bars and logo glyphs don't
//    hide a company.
// 6: what a review found the score under-rating. A company named after a title
//    without "at" ("President | The Coca-Cola Company", "Corporate VP,
//    Samsung") is where the title is held; an audience of one's own counts like
//    a title; a strong circle counts by its strong people as well as its share
//    of them, up to +2; an unclear title counts as an IC's. (The title rules
//    themselves are tables, fingerprinted below.)
export const SCORING_VERSION = 6;

// ── title ────────────────────────────────────────────────────────────────────

export const LEVELS = {
  csuite: { key: 'csuite', label: 'C-Suite / Founder', level: 6, points: 10 },
  owner: { key: 'owner', label: 'Owner / Entrepreneur', level: 5, points: 8 },
  vp: { key: 'vp', label: 'VP / Partner / GM', level: 5, points: 9 },
  director: { key: 'director', label: 'Director / Head', level: 4, points: 7.5 },
  manager: { key: 'manager', label: 'Manager / Lead', level: 3, points: 6.5 },
  senior: { key: 'senior', label: 'Senior IC', level: 2, points: 5 },
  ic: { key: 'ic', label: 'IC / Entry', level: 1, points: 4 },
  // A title the rules can't read ("Studio / Show", "Storyteller", a job they
  // don't list) counts as the most common kind, an individual contributor's:
  // not knowing someone's title says nothing about how senior they are. Until
  // scoring 6 it was 3, below any job, which buried founders who state no title.
  unknown: { key: 'unknown', label: 'Title unclear', level: 1, points: 4 },
  intern: { key: 'intern', label: 'Intern', level: 0, points: 2 },
  student: { key: 'student', label: 'Student', level: 0, points: 1 },
  // Universities have their own ladder, on the same points as everyone's: a
  // dean runs a school, as a VP runs a division; a professor is a director's
  // equal, an associate professor a manager's, an assistant professor a senior
  // IC's. A provost, a chancellor and a president are C-suite, above.
  dean: { key: 'dean', label: 'Dean', level: 5, points: 9 },
  professor: { key: 'professor', label: 'Professor', level: 4, points: 7.5 },
  associateProfessor: { key: 'associateProfessor', label: 'Associate Professor', level: 3, points: 6.5 },
  assistantProfessor: { key: 'assistantProfessor', label: 'Assistant Professor', level: 2, points: 5 },
  // An audience of their own (AUDIENCE, below) is a position too: 100K+ counts
  // like a manager's title, 1M+ a director's, 10M+ a VP's.
  audience10m: { key: 'audience10m', label: 'Audience of 10M+', level: 5, points: 9 },
  audience1m: { key: 'audience1m', label: 'Audience of 1M+', level: 4, points: 7.5 },
  audience100k: { key: 'audience100k', label: 'Audience of 100K+', level: 3, points: 6.5 },
  // Government and the services, on the same points. An elected or appointed
  // leader (a senator, a governor, a mayor, a cabinet secretary) is C-suite;
  // their deputies, state legislators, commissioners, ambassadors and judges
  // are VPs; a deputy assistant secretary, a city councilmember or a sheriff a
  // director. Officers by rank: a 3–4 star general or admiral is C-suite, a
  // 1–2 star a VP, a colonel (a Navy captain) a director, a lieutenant colonel
  // (a commander) a manager, a major (a captain) a senior IC; a command
  // sergeant major or a master chief leads like a manager.
  govLeader: { key: 'govLeader', label: 'Government Leader', level: 6, points: 10 },
  govSenior: { key: 'govSenior', label: 'Senior Official', level: 5, points: 9 },
  judge: { key: 'judge', label: 'Judge', level: 5, points: 9 },
  govOfficial: { key: 'govOfficial', label: 'Government Official', level: 4, points: 7.5 },
  seniorGeneral: { key: 'seniorGeneral', label: 'General / Admiral (3–4 star)', level: 6, points: 10 },
  general: { key: 'general', label: 'General / Admiral (1–2 star)', level: 5, points: 9 },
  colonel: { key: 'colonel', label: 'Colonel / Navy Captain', level: 4, points: 7.5 },
  ltColonel: { key: 'ltColonel', label: 'Lt. Colonel / Commander', level: 3, points: 6.5 },
  seniorEnlisted: { key: 'seniorEnlisted', label: 'Senior Enlisted Leader', level: 3, points: 6.5 },
  nco: { key: 'nco', label: 'Senior NCO / Warrant Officer', level: 2, points: 5 },
  major: { key: 'major', label: 'Major / Captain', level: 2, points: 5 },
};

// Checked in this order within one part of a headline. Earlier rules REMOVE
// their words, so "Vice President" can't also read as "President", "Chief of
// Staff" as a chief, or "Product Owner" as an owner. The highest level found wins.
// A title's possessive is an award or an office named for it, not the title:
// "President's Club" (sales), "Chairman's Award", "CEO's Office", "Dean's List".
// Staff are not their boss: "Chief of Staff to the CEO", "Executive Assistant
// to the General Manager" (but "Promoted to VP" is the VP). Government and
// military titles aren't here: they count only where a title is written
// (officeTitle, below).
const TITLE_RULES = [
  [/\b(reporting )?(to|for) (the |our |a )?(ceo|cto|coo|cfo|cmo|founders?|co-?founders?|president|chair(man)?|professors?|dean|provost|chancellor)\b/g, null],
  [/(?<=\b(?:assistant|aide|advisor|adviser|chief of staff|support|liaison|scheduler|paralegal|clerk|counsel|associate|coordinator|manager)\s+)(to|for) (the |our |a )?(general manager|managing director|gm|vice president|[se]?vp|general counsel|chief counsel)\b/g, null],
  [/\bchief of staff\b/g, 'director'],
  [/\b(senior |executive |assistant |associate )?vice[-\s]?president\b|\b(s|e|a)?vp\b/g, 'vp'],
  // Universities, before the C-suite rule reads "Vice Chancellor" as a
  // chancellor: deputies are VPs, and associate and assistant deans, provosts
  // and a department's chair or head are directors. Adjunct, visiting and
  // guest professors teach, as instructors do; an assistant professor is
  // before an associate, an associate before a professor. "Prof." is one too.
  [/\b(vice|deputy)[-\s]?(chancellor|provost)\b/g, 'vp'],
  [/\b(associate|assistant) (dean|provost|chancellor)\b|\b(vice|deputy)[-\s]?dean\b|\b(department|dept\.?) (chair|head)\b|\bchair,? (of )?(the )?(department|dept\.?)\b/g, 'director'],
  [/\b(adjunct|visiting|affiliate|courtesy|guest) (assistant |associate |full )?prof(essor)?\b\.?/g, 'ic'],
  [/\bassistant prof(essor)?\b\.?/g, 'assistantProfessor'],
  [/\bassociate prof(essor)?\b\.?/g, 'associateProfessor'],
  [/\bprof(essor)?\b(?!['’]s\b)\.?/g, 'professor'],
  // A dean only as a title: before "of", "for", a comma or the part's end, and
  // never a company's name ("Dean Foods", "at Dean Health Plan").
  [/(?<!\b(?:at|@)\s*)\bdean\b(?!['’]s\b)(?=\s*(?:(?:of|for|at|and|emerit(?:us|a))\b|[&@,(]|$))/g, 'dean'],
  // A company's general counsel is an executive; the lawyers under a general
  // or a chief counsel are directors and seniors. A military chief (a chief
  // petty officer, a chief warrant officer) isn't a chief officer.
  [/\b(associate|assistant|deputy) general counsel\b/g, 'director'],
  [/\b(associate|assistant|deputy) chief counsel\b/g, 'senior'],
  [/\bgeneral counsel\b|\bchief counsel\b/g, 'vp'],
  [/\b(senior |master )?chief petty officer\b|\bchief warrant officer\b|\bchief master sergeant\b/g, null],
  // A government's or a lab's division and branch chiefs lead them.
  [/\bdivision chief\b|\bchief of (the )?[a-z]+ division\b/g, 'director'],
  [/\b(branch|section|unit) chief\b|^\s*chief,\s+[a-z &]+ (branch|section|office)\b/g, 'manager'],
  [/^\s*chief,\s+[a-z &]+ division\b/g, 'director'],
  [/\b(product|process|content|data|feature|service|project|business process) owner\b/g, 'ic'],
  [/\b(client|channel|strategic|business|brand|creative|agency|solutions?|account|community|developer|technology|alliances?|content|media|marketing|talent|partner) partner\b/g, 'senior'],
  [/\bpartner (manager|marketing|development|success)\b/g, 'manager'],
  [/\blead gen(eration)?\b|\bthought leader(ship)?\b/g, null],
  [/\binvestor relations\b/g, 'ic'],
  [/(?:\b(ceo|cto|cfo|coo|cmo|cro|cpo|cio|ciso|cdo|cso)\b|\bchief\s+(\w+\s+){0,3}officer\b|\bchief executive\b|\b(co-?)?founder\b|\bcofounder\b|\bpresident\b|\bchair(man|woman|person)\b|\bexecutive chair\b|\b(general|managing|founding) partner\b|\bchancellor\b|\bprovost\b)(?!['’]s\b)/g, 'csuite'],
  [/\b(co-?)?owner\b|\bentrepreneur\b|\bself[-\s]employed\b|\bproprietor\b/g, 'owner'],
  // "MD" is a managing director only where a doctor's degree can't be meant:
  // at a company that isn't a hospital's or a clinic's ("MD @ J.P. Morgan", read
  // in readPart), or with a division after it ("MD, Investment Banking"), not a
  // degree ("MD, MBA").
  [/\bmanaging director\b|\bmd\b(?=\s*(?:at\b|@))|^\s*md,\s+(?!(?:mba|phd|mph|ms|msc|mhs|mha|mhsa|jd|facs|facp|facc|faap|dds|dmd|do|rn|np|pa|ma|mbe|mpp)\b)|\bgeneral manager\b|\bgm\b|\bcountry (manager|director|lead|head)\b|\bhead of country\b|\bglobal head\b|\bchief (technologist|scientist|architect|economist|evangelist|strategist|engineer|of \w+)\b|^\s*partner\b|\bpartner (at|@)|\b(venture|senior|equity|operating) partner\b|\bboard (member|director|chair)\b|\bchair of the board\b|\bmember of the board\b|\bboard of directors\b/g, 'vp'],
  [/\b(senior |executive |creative |art |associate )?director\b|\bhead of\b|\bhead\b(?= (coach|chef))|\b(angel |venture )?investor\b|\bprincipal at\b|\b(technical|distinguished|senior) fellow\b|(?<!account |sales |customer )\bexecutive\b(?! (assistant|producer|chef))/g, 'director'],
  [/\bmanager\b|\bmgr\b|\b(team |tech |design |engineering )?lead\b|\bleader\b|\bprincipal\b|\bstaff (engineer|designer|scientist|product|data)\b|\bsupervisor\b|\bsuperintendent\b/g, 'manager'],
  [/\bsenior\b|\bsr\b\.?|\bspecialist\b|\barchitect\b|\bexpert\b|\bexecutive producer\b/g, 'senior'],
  [/\b(engineer|developer|designer|analyst|associate|coordinator|consultant|strategist|recruiter|creator|producer|editor|writer|artist|scientist|researcher|representative|assistant|administrator|technician|officer|agent|teacher|lecturer|postdoc(toral)?|nurse|attorney|lawyer|accountant|marketer|photographer|videographer|freelancer?|contractor|account executive|creative|influencer|coach|trainer|instructor|advisor|adviser|mentor|programmer|animator|illustrator|planner|buyer|broker|realtor|swe|sde|sre|pm|recruiting)\b/g, 'ic'],
];

const INTERN = /\b(intern|internship|trainee|apprentice)\b/;
// Matched against lowercase text. "CS @ University of Utah" is a student; a
// school's short name ("CS @ NYU") is SHORT_NAME's job, below.
const STUDENT = /\b(student|undergrad(uate)?|aspiring|phd candidate|recent grad(uate)?|class of 20\d\d|incoming (analyst|intern|associate|swe|engineer)|gpa|freshman|sophomore|b\.?s\.? candidate)\b|^\s*(honors )?(cs|computer science|ms ?cs|mscs|bscs|engineering|finance|marketing|business|economics|accounting|biology|psychology|information technology)\b.*(\s(@|at)\s*)(university|college)\b/;
const MAJOR = /^\s*(honors )?(cs|computer science|ms ?cs|mscs|bscs|engineering|finance|marketing|business|economics|accounting|biology|psychology|information technology)\b/i;
// A school's short name as people write it, in capitals: two to four letters
// that start or end with the U of "University" (USC, NYU, UCLA, BYU, UNC). It
// names no school, so every school's students and clubs read alike. Matched
// against the text as written: only capitals are a name ("usc" isn't one).
const SHORT_NAME = /\b(?:U[A-Z]{1,3}|[A-Z]{1,3}U)\b/g;
const AT_SHORT_NAME = /\s(?:@|[Aa][Tt])\s*(U[A-Z]{1,3}|[A-Z]{1,3}U)\b/;
// Short names that aren't a school's, whatever they look like: countries and
// unions of them, the AAU's youth sports clubs and a Unitarian (UU) society;
// and companies, a league and labor unions people write in capitals (UBS,
// UFC, UPMC, UnitedHealth Group and UnitedHealthcare, Under Armour, UL, United
// Launch Alliance, UTC; the UAW, USW, SEIU, UFCW and UFT). A short name the
// curated list knows as a company is one too (UPS). The price: a school whose
// short name is on this list (UA, UL, UTC) isn't read from it.
const NOT_A_SCHOOL = new Set(['US', 'USA', 'UK', 'UAE', 'EU', 'UN', 'UU', 'AAU',
  'UBS', 'UFC', 'UPMC', 'UHG', 'UHC', 'UA', 'UL', 'ULA', 'UTC', 'UAW', 'USW', 'SEIU', 'UFCW', 'UFT']);
const GREEK = '(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)';
const STUDENT_ORG = new RegExp(`\\b(fraternity|sorority|student (government|association|union|org(anization)?|senate)|honor society|campus)\\b|\\b${GREEK}\\s+${GREEK}\\b`);
// A club named with a school's words, either way round ("Marketing Club at the
// University of Utah", "University Consulting Club"). An association only
// counts before the school's words: "University Staff Association" is staff.
const SCHOOL_WORD_CLUB = /\b(club|chapter|society|association)\b.*\b(university|college|school|student)\b|\b(university|college|school|student)\b.*\b(club|chapter|society)\b/;
const CLUB = /\b(club|chapter|society|association)\b/;
// With a school's short name only a club or a society is a student group
// ("USC Marketing Club", "NYU Finance Society"), or an association named for
// a field of study ("USC Trojan Marketing Association"). A chapter is as often
// a union local's or a professional body's, and another association a
// university's staff ("KU Endowment Association").
const SHORT_NAME_CLUB = /\b(club|society)\b/;
const FIELD_ASSOCIATION = /\b(marketing|finance|financial|business|economics|accounting|consulting|investment|investing|entrepreneurship|engineering|computer science|data science|nursing|pre-?law|pre-?med|students?)\b.*\bassociation\b/;
// An alumni club or a parents' association is for grown-ups.
const GROWN_UP = /\b(alumni|alumnae|alumnus|alum|parents?)\b/;
const FORMER = /^\s*(ex[-\s]|former(ly)?\b|previously\b|prev\b|past\b|retired\b|ret(\.|d\.?)?\s)/i;
// Retired, written after the title: "Colonel (Ret.), U.S. Army", "COL (R)",
// "Admiral, USN, Ret.", "Army Colonel, Retired". A former role, like "Ex-" or
// "Retired" before it. A part that says only that ("Colonel, USAF - Retired")
// makes the role before it former (readRoles).
const RETIRED = /\(\s*(?:[a-z.]+,\s*)?ret(\.|ired|d\.?)?\s*\)|,\s*ret(\.|ired|d\.?)?\s*(?=,|$)|,\s*retired\s*(?=,|\)|$)|\bret\.\s*$|\b(army|navy|air force|marine corps|marines|usmc|usaf|usn|uscg|coast guard|space force)\s+(ret(\.|d\.?)?|retired)\s*$/i;
const RETIRED_ONLY = /^\s*\(?\s*(ret\.?|retd\.?|retired)\s*\)?\s*$/i;
// An office named for its head is where someone works, not their title: "IT
// Specialist, Office of the Chief Information Officer", "Attorney, Judge
// Advocate General's Corps". Only the head's title is taken out, so a title
// written after an office's own name stays ("Office of Technology Licensing
// Director").
const OFFICE_NAME = /\boffice of (the )?(chief [a-z]+ officer|ceo|cto|cfo|coo|cio|ciso|cmo|president|vice president|general counsel|chief counsel|inspector general|solicitor general|surgeon general|attorney general|(under |deputy )?secretary( of [a-z ]+?)?|governor|lieutenant governor|mayor|director( of [a-z ]+?)?|chair(man)?|commissioner|(u\.?s\.? )?(senator|congress(wo)?man|representative)( [a-z.]+){0,3})(?=\s*(,|$|\||\sat\s|@))|\b(judge advocate|adjutant) general['’]?s? corps\b/g;
// The company after "at" says where someone works, not what they do: its
// words aren't read as a title ("Server at President Hotel", "Driver at
// Executive Limo"). It runs to the next comma, or to a phrase that starts
// saying what they do there ("at Stripe as Head of Growth").
const AT_COMPANY = /(\s(?:at\b|@)\s*)(?:(?!\s(?:as|where|leading|building|helping|working)\s)[^,|])*/g;
const HEALTH_ORG = /\b(?:hospitals?|clinics?|health|healthcare|medical|medicine|physicians?|pediatrics?|surgery|surgical|kaiser|mayo|hopkins|dermatology|cardiology|oncology|orthopa?edics?|urgent care)\b/;

/** Can this short name ("USC", "UBS") be a school's? Not one on NOT_A_SCHOOL, nor a company the curated list knows. */
function schoolShortName(name) {
  if (NOT_A_SCHOOL.has(name) || /^US[A-Z]{2}$/.test(name)) return false;   // USGA, USTA, USAA, USPS…
  const listed = cleanCompany(name);
  return !KNOWN_INDUSTRY.has(listed) || KNOWN_INDUSTRY.get(listed) === 'education';
}

/** Does this part of a headline say they're studying now? "CS @ NYU", "Economics student". */
// A war or staff college's students are serving officers, not students.
const SERVICE_SCHOOL = /\b(war college|staff college|command and general staff|naval postgraduate school|air university|national defense university|eisenhower school|joint forces staff college|school of advanced (military|air|warfighting))\b/i;

function studies(part) {
  if (SERVICE_SCHOOL.test(part)) return false;
  if (STUDENT.test(` ${part.toLowerCase()} `)) return true;
  const at = MAJOR.test(part) && AT_SHORT_NAME.exec(part);
  return !!at && schoolShortName(at[1]);
}

/**
 * Is this part of a headline a role in a school club? "President, USC
 * Marketing Club", "VP, NYU Finance Society", "President of the Marketing Club
 * at the University of Utah". A club, chapter, society or association with a
 * school's words, or a club or society with its short name, and not an alumni
 * or parents' group.
 */
function isSchoolClub(part) {
  const lower = part.toLowerCase();
  if (!CLUB.test(lower) || GROWN_UP.test(lower)) return false;
  if (SCHOOL_WORD_CLUB.test(lower)) return true;
  if (!SHORT_NAME_CLUB.test(lower) && !FIELD_ASSOCIATION.test(lower)) return false;
  return [...part.matchAll(SHORT_NAME)].some(([name]) => schoolShortName(name));
}

/** The parts of a headline, in order: "CEO @ X | Ex-Google | Speaker" → three parts. */
export function headlineParts(headline = '') {
  return String(headline || '').normalize('NFKC').split(/\s*(?:\||•|·|⋅|\/\/| – | — | - |;)\s*/).map((s) => s.trim()).filter(Boolean);
}

function readPart(part) {
  let s = ` ${part.toLowerCase()} `.replace(OFFICE_NAME, ' ');
  // "MD at a hospital" is a doctor, which only the company says.
  const at = s.match(/\s(?:at\b|@)\s*([^,|]*)/);
  if (at && /\bmd\b(?=\s*(?:at\b|@))/.test(s) && HEALTH_ORG.test(at[1])) s = s.replace(/\bmd\b/, ' ');
  s = s.replace(AT_COMPANY, '$1 ');
  if (INTERN.test(s)) return LEVELS.intern;
  if (studies(part)) return LEVELS.student;
  let best = null;
  for (const [re, key] of TITLE_RULES) {
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    s = s.replace(re, ' ');
    if (key && (!best || LEVELS[key].level > best.level || (LEVELS[key].level === best.level && LEVELS[key].points > best.points))) best = LEVELS[key];
  }
  if (best && best.level >= 3 && (STUDENT_ORG.test(part.toLowerCase()) || isSchoolClub(part))) return { ...LEVELS.student, label: 'Student (club role)' };
  return best;
}

// ── government and the services ─────────────────────────────────────────────
// A government or military title counts only where a title is written: the
// start of a headline part, before its organization ("Senator, U.S. Senate",
// "Colonel | U.S. Air Force", "Deputy Secretary of Defense"). Anywhere else
// the same words name an office, a company or a club: "Staff Assistant,
// Office of the Secretary of Defense", "Store Manager at Dollar General",
// "Law Clerk to Chief Judge…". And a title means government only where its
// place says so: an organization after "at" must be a government's ("Speaker
// at Soho House", "Administrator at U.S. Bank" aren't), and a club, a church,
// a school, a profession, a mock government, an honorary or a joke title never
// is (CIVIC: "Rotary District Governor", "Delegate, AMA House of Delegates",
// "Governor, Florida Boys State", "Mayor of Fun at Northwind"). Every rank but
// the flag ranks spelled out needs its service beside it, in the same part or
// as a part of its own ("Captain | U.S. Navy"), and nothing a veterans' group,
// a cadet, a team, a licence or an honorary title holds is a commission
// (NOT_MILITARY: "Kentucky Colonel", "Commander, VFW Post 42", "Captain, Navy
// Rugby", "Master Chief | Halo Cosplayer"). A captain is a colonel's equal only
// in a navy; a commander's level is their unit's (a division's is a general).
// Two rounds of adversarial review found what these rules keep out; the cases
// are in tests/scoring-misses.test.mjs.
const STATES = String.raw`alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|puerto rico|guam|american samoa|(?:the )?(?:u\.?\s?s\.?\s)?virgin islands|(?:the )?northern mariana islands|district of columbia`;
const COUNTRIES = String.raw`afghanistan|albania|algeria|andorra|angola|argentina|armenia|australia|austria|azerbaijan|the bahamas|bahamas|bahrain|bangladesh|barbados|belarus|belgium|belize|benin|bhutan|bolivia|bosnia and herzegovina|botswana|brazil|brunei|bulgaria|burkina faso|burundi|cabo verde|cambodia|cameroon|canada|central african republic|chad|chile|china|colombia|comoros|congo|costa rica|cote d'ivoire|ivory coast|croatia|cuba|cyprus|czech republic|czechia|denmark|djibouti|dominica|dominican republic|ecuador|egypt|el salvador|equatorial guinea|eritrea|estonia|eswatini|ethiopia|fiji|finland|france|gabon|the gambia|gambia|georgia|germany|ghana|greece|grenada|guatemala|guinea|guinea-bissau|guyana|haiti|the holy see|holy see|honduras|hungary|iceland|india|indonesia|iran|iraq|ireland|israel|italy|jamaica|japan|jordan|kazakhstan|kenya|kiribati|kosovo|kuwait|kyrgyzstan|laos|latvia|lebanon|lesotho|liberia|libya|liechtenstein|lithuania|luxembourg|madagascar|malawi|malaysia|maldives|mali|malta|marshall islands|mauritania|mauritius|mexico|micronesia|moldova|monaco|mongolia|montenegro|morocco|mozambique|myanmar|burma|namibia|nauru|nepal|the netherlands|netherlands|new zealand|nicaragua|niger|nigeria|north korea|north macedonia|norway|oman|pakistan|palau|panama|papua new guinea|paraguay|peru|the philippines|philippines|poland|portugal|qatar|romania|russia|rwanda|saint kitts and nevis|saint lucia|saint vincent and the grenadines|samoa|san marino|sao tome and principe|saudi arabia|senegal|serbia|seychelles|sierra leone|singapore|slovakia|slovenia|solomon islands|somalia|south africa|south korea|the republic of korea|korea|south sudan|spain|sri lanka|sudan|suriname|sweden|switzerland|syria|taiwan|tajikistan|tanzania|thailand|timor-leste|togo|tonga|trinidad and tobago|tunisia|turkey|turkiye|turkmenistan|tuvalu|uganda|ukraine|the united arab emirates|united arab emirates|the united kingdom|united kingdom|great britain|uruguay|uzbekistan|vanuatu|venezuela|vietnam|yemen|zambia|zimbabwe|the kyrgyz republic|kyrgyz republic|the slovak republic|slovak republic|lao pdr|viet nam|the vatican|vatican|osce|the osce`;
const INTERNATIONAL = String.raw`the united nations|united nations|u\.?n\.?|nato|the european union|european union|the organization of american states|organization of american states|the african union|african union|asean|the world trade organization|world trade organization|the oecd|oecd|opec|interpol`;
const STATE_NAME = new RegExp(String.raw`\b(${STATES})\b`);
// A state's government named as the place it is: "State of Florida", "Commonwealth of Virginia".
const STATE_GOV = new RegExp(String.raw`\b(?:state|commonwealth) of (?:${STATES})\b|\b(?:${STATES}) (?:state )?(?:government|legislature|senate|house of (?:representatives|delegates)|general assembly|state assembly|supreme court|department|agency|office|cabinet)\b`);
// A place that is only a state: the whole part says nothing else.
const JUST_A_STATE = new RegExp(String.raw`^(?:the )?(?:(?:state|commonwealth) of )?(?:${STATES})(?: state)?$`);
// Where a government title may name its government: its own body, not "U.S. Bank".
const GOV_ORG = new RegExp(String.raw`\b(?:u\.?\s?s\.?|united states|federal|state of|commonwealth of|city of|county of|town of|village of|borough of|township of)\b[^,|]*\b(?:department|dept\.?|agency|administration|bureau|commission|board|office|service|authority|court|senate|house|assembly|legislature|congress|government|marshals|attorney['’]?s office|embassy|mission)\b|\b(?:department|dept\.?) of\b|\b(?:senate|house of representatives|house of delegates|state assembly|legislature|congress|supreme court|court of appeals|(?:district|circuit|superior|county|municipal|probate|family|juvenile|tax|bankruptcy) court|judicial circuit|city council|town council|county commission|board of (?:county )?commissioners|board of supervisors|police department|sheriff['’]?s office|state attorney['’]?s office|district attorney['’]?s office|white house|embassy|consulate|parliament|government)\b|${STATE_GOV.source}`);
// Not a government's: clubs, churches, schools and students, professions,
// mock governments, honorary and joke titles.
const CIVIC = /\b(rotary|lions clubs?|kiwanis|circle k|jaycees|jci|toastmasters|optimist|civitan|elks|moose|masonic|freemasons?|lodge|knights of columbus|pta|pto|students?|sga|asg|associated students|student government|model (un|united nations|congress|senate|legislature|g20|nato|oas)|\w*mun|boys state|girls state|youth (in|and) government|mock (trial|congress|legislature|government)|intercollegiate|faculty|(staff|faculty|student|graduate|university|employee|classified|academic|campus) (senate|assembly)|honor (court|council|board)|scouts?|fraternity|sorority|district \d{4}|alumni|model parliament|youth parliament|high school|middle school|olympics|ama|aba|american medical association|american bar association|chamber of commerce|youth|church|catholic|diocese|synod|presbyterian|methodist|baptist|episcopal|lutheran|congregation|ministry|ministries|vestry|temple|mosque|synagogue|daughters of the american revolution|sons of the american revolution|lineage|association|society|convention|cosplay|honorary|fantasy|kickball|softball|soccer|baseball|basketball|football|hockey|bowling|golf|tournament|esports|gaming|of (fun|vibes|content|culture|coffee|memes|good vibes|snacks|the (internet|office|slack|break room|group chat)))\b|\b(bar|medical|nursing|hospital|dental|bankers|realtors?) (association|board of governors)\b|\bboard of governors\b/;
const LEAD = String.raw`(?:(?:acting|interim|the|honorable|hon\.?|\d+(?:st|nd|rd|th)|principal|u\.?\s?s\.?|united states)\s+)*`;
// A company's or a board's officers: "Assistant Secretary of the Corporation", "of Acme Holdings Inc.".
const CORP_OFFICER = /\b(corporation|company|board|inc\.?|llc|holdings|ltd|plc|trust|fund|bank|partners|group)\b/;
// Judging that isn't a court's: competitions, fairs, moot courts, a food court.
const NOT_COURT = /\b(universit(y|ies)|college|students?|sga|moot|mock|sommeliers?|food court|fair|competition|hackathon|pageant|show|debate|awards?|contest|olympiad|festival|teen court|cook-?off|bake-?off)\b/;
const FED_BODY = String.raw`(?:u\.?\s?s\.?\s|united states )?(?:securities and exchange commission|consumer product safety commission|nuclear regulatory commission|commodity futures trading commission|equal employment opportunity commission|international trade commission|federal (?:communications|trade|election|energy regulatory|maritime) commission|federal deposit insurance corporation|federal reserve(?: board| system)?|board of governors of the federal reserve(?: system)?|national (?:labor relations|transportation safety) board|internal revenue service|food and drug administration|social security administration|customs and border protection|council of economic advisers)`;
const FED_AGENCY = new RegExp(String.raw`^(?:fcc|sec|ftc|fda|irs|cbp|fema|epa|nasa|faa|tsa|dea|atf|ssa|gsa|sba|opm|nrc|ferc|cftc|eeoc|nlrb|fec|uspto|${FED_BODY})$`);

// The services, and the units and bases that say which one.
const SVC = String.raw`(?:(?:u\.?\s?s\.?|united states|royal|british|canadian|australian|indian|israeli)\s+)?(?:army national guard|air national guard|national guard|army reserves?|navy reserves?|naval reserves?|air force reserves?|marine corps reserves?|coast guard reserves?|army (?:nurse|medical|dental|medical service|medical specialist|veterinary|chaplain) corps|navy (?:nurse|medical service|chaplain) corps|army|navy|air force|marine corps|marines|space force|coast guard|armed forces|canadian armed forces|department of defense|public health service(?: commissioned corps)?|noaa corps|noaa commissioned officer corps)|(?:u\.?\s?s\.?|united states) marine|\b(?:usmc|usmcr|usaf|usafr|afrc|usn|usnr|uscg|uscgr|ussf|usar|arng|ang|usphs|dod|raf|idf)\b`;
// "Army" and "Navy" alone are also a crowd's or a brand's words ("Church Army",
// "Brand Army", "Grassroots Army"): alone, a service is the whole organization
// ("Captain, U.S. Navy", "Colonel, Army National Guard"), or qualified.
const QUALIFIED_SVC = String.raw`(?:(?:u\.?\s?s\.?|united states|royal|british|canadian|australian|indian|israeli|the)\s+(?:army|navy|air force|marine corps|marines|space force|coast guard)|army national guard|air national guard|national guard|(?:army|navy|naval|air force|marine corps|coast guard) reserves?|air force|marine corps|space force|coast guard|armed forces|department of defense|public health service|noaa corps|noaa commissioned officer corps|army (?:nurse|medical|dental|medical service|medical specialist|veterinary|chaplain) corps|navy (?:nurse|medical service|chaplain) corps)|(?:u\.?\s?s\.?|united states) marine|\b(?:usmc|usmcr|usaf|usafr|afrc|usn|usnr|uscg|uscgr|ussf|usar|arng|ang|usphs|dod|raf|idf)\b`;
const NOT_SVC_AFTER = String.raw`(?!\s(?:spouses?|wife|wives|husbands?|moms?|mothers?|dads?|fathers?|grandmas?|grandpas?|brats?|famil(?:y|ies)|kids?|rotc|jrotc|federal|exchange|cross|pier|surplus|one|league|association|times|history|museum|band|academy|veterans?|vet)\b)`;
const SERVICE_IN = new RegExp(String.raw`(?<!(?:salvation|old|texas|nebraska|great|commemorative|church|brand|grassroots)\s)(?:${QUALIFIED_SVC})${NOT_SVC_AFTER}|\b(?:uss|usns|uscgc|afb)\s|\bnaval\b|\bv[a-z]{1,3}-\d+\b|\b(?:air force base|joint base|naval air station|naval station|marine corps (?:base|air station)|marine (?:division|expeditionary|regiment|aircraft wing|logistics group))\b|\b\d+(?:st|nd|rd|th) (?:[a-z]+ ){0,2}(?:division|brigade|battalion|regiment|wing|squadron|fleet|corps|group|airborne|infantry|cavalry)\b`);
// A part whose organization is just a service ("Colonel, Army", "Captain, Navy").
const REST_IS_SERVICE = new RegExp(String.raw`^(?:the\s+)?(?:${SVC})\b${NOT_SVC_AFTER}`);
const NAVY_IN = new RegExp(String.raw`(?<!(?:old|texas|nebraska|great)\s)\b(?:navy|naval|usn|usnr|coast guard|uscg|uscgr|noaa corps|noaa commissioned officer corps|public health service|usphs|uss|usns|uscgc)\b${NOT_SVC_AFTER}`);
// A part that is only a service ("U.S. Navy", "Retired U.S. Army", "USAF (Ret.)").
const SERVICE_ONLY = new RegExp(String.raw`^(?:(?:retired|former|ret\.?|retd\.?)\s+)?(?:the\s+)?(?:(?:${STATES})\s+)?(?:${SVC})(?:\s+reserves?)?(?:,?\s*(?:\((?:ret\.?|retd\.?|retired|active duty)\)|ret\.?|retd\.?|retired|active duty))?$`);
const RETIRED_SERVICE = /^(retired|former|ret\b)|\bret\.?\)?$|\bretired\)?$/;
const MIL_UNIT = /\b(division|brigade|battalion|squadron|wing|regiment|fleet|command|corps|group|task force|carrier|uss|usns|uscgc|infantry|airborne|cavalry|artillery|armor|special forces|seal team|marines?|garrison|installation|base|detachment|company|battery|troop|flight)\b/;
const NOT_MILITARY = /\b(army and navy union|honorary|kentucky colonels?|tennessee colonel|commemorative air force|great navy|texas navy|nebraska navy|civil air patrol|rotc|jrotc|cadets?|midshipm[ae]n|american legion|vfw|veterans of foreign wars|amvets|disabled american veterans|marine corps league|navy league|air force association|association of the united states army|ausa|moaa|auxiliary|order of the|boy scouts|girl scouts|scouts bsa|sea cadets|young marines|salvation army|licensed|license|mariner|merchant marine|charter|vessel|yacht|halo|cosplay\w*|reenact\w*|star trek|varsity|intramural|club|league|rugby|lacrosse|football|soccer|basketball|baseball|hockey|crew|rowing|sailing team|athletics|captain of|(?:usna|usma|usafa|uscga)\s*['’]?\d{2})\b|(?<!seal )\bteam\b/;

// Military short forms, read only at the start of a title and only beside a service.
const RANK_SHORT = [
  [/^(?:lt\.?\s?gen(?:eral|\.)?|ltgen|ltg|lieut\.?\s?general)(?=\s|$)/, 'lieutenant general'],
  [/^(?:maj\.?\s?gen(?:eral|\.)?|majgen|mg)(?=\s|$)/, 'major general'],
  [/^(?:brig\.?\s?gen(?:eral|\.)?|bgen|bg)(?=\s|$)/, 'brigadier general'],
  [/^gen\.?(?=\s|$)/, 'general'],
  [/^(?:vice\s?adm(?:iral|\.)?|vadm)(?=\s|$)/, 'vice admiral'],
  [/^(?:rear\s?adm(?:iral|\.)?|radm|rdml)(?=\s|$)/, 'rear admiral'],
  [/^adm\.?(?=\s|$)/, 'admiral'],
  [/^(?:lt\.?\s?col(?:onel|\.)?|lieut\.?\s?colonel|ltcol|ltc|lcol)(?=\s|$)/, 'lieutenant colonel'],
  [/^col\.?(?=\s|$)/, 'colonel'],
  [/^(?:lt\.?\s?cdr\.?|lcdr|ltcdr|lt\.?\s?commander)(?=\s|$)/, 'lieutenant commander'],
  [/^cdr\.?(?=\s|$)/, 'commander'],
  [/^(?:capt\.?|cpt)(?=\s|$)/, 'captain'],
  [/^maj\.?(?=\s|$)/, 'major'],
  [/^lt\.?(?=\s|$)/, 'lieutenant'],
  [/^csm(?=\s|$)/, 'command sergeant major'],
  [/^(?:sgtmaj|sgt\.?\s?maj\.?)(?=\s|$)/, 'sergeant major'],
  [/^sgm(?=\s|$)/, 'sergeant major'],
  [/^cmsgt(?=\s|$)/, 'chief master sergeant'],
  [/^(?:mcpo|mcpon|cmc)(?=\s|$)/, 'master chief'],
  [/^scpo(?=\s|$)/, 'senior chief petty officer'],
  [/^(?:cw[2-5]|cwo[2-5]?)(?=\s|$)/, 'chief warrant officer'],
  [/^wo1(?=\s|$)/, 'warrant officer'],
  [/^sfc(?=\s|$)/, 'sergeant first class'],
  [/^1sg(?=\s|$)/, 'first sergeant'],
  [/^(?:msg|msgt)(?=\s|$)/, 'master sergeant'],
  [/^smsgt(?=\s|$)/, 'senior master sergeant'],
  [/^mgysgt(?=\s|$)/, 'master gunnery sergeant'],
  [/^gysgt(?=\s|$)/, 'gunnery sergeant'],
];
// [the whole title, its level, whether it needs a service beside it]. The
// flag ranks spelled out, and the services' chiefs, are nobody else's. A
// captain is 'captain' (a colonel's equal in a navy, a major's elsewhere), a
// lieutenant counts only in a navy (a major's equal), and a commander,
// commanding or executive officer is 'commander': their unit decides.
const RANKS = [
  [String.raw`chief of staff of the (?:u\.?\s?s\.?\s)?(?:army|air force)|vice chief of staff of the (?:u\.?\s?s\.?\s)?(?:army|air force)|chief of naval operations|vice chief of naval operations|commandant of the (?:u\.?\s?s\.?\s)?(?:marine corps|coast guard)|(?:vice )?chairman of the joint chiefs(?: of staff)?|chief of space operations|chief of the national guard bureau`, 'seniorGeneral', false],
  [String.raw`sergeant major of the (?:army|marine corps)|master chief petty officer of the (?:navy|coast guard)|chief master sergeant of the (?:air force|space force)|senior enlisted advisor to the chairman`, 'seniorEnlisted', false],
  [String.raw`lieutenant general|vice admiral|(?:three|four|3|4)[-\s]star (?:general|admiral)|general of the army|fleet admiral|air marshal|air chief marshal`, 'seniorGeneral', false],
  [String.raw`major general|brigadier general|rear admiral(?: \((?:lower|upper) half\))?|(?:one|two|1|2)[-\s]star (?:general|admiral)|air vice marshal|air commodore`, 'general', false],
  [String.raw`(?:deputy )?commanding general|brigadier|commodore`, 'general', true],
  [String.raw`general|admiral`, 'seniorGeneral', true],
  [String.raw`lieutenant colonel|wing commander`, 'ltColonel', true],
  [String.raw`colonel|group captain`, 'colonel', true],
  [String.raw`(?:(?:deputy|vice|garrison|installation|base|battalion|squadron|wing|group|ship|regimental|brigade|division|corps|fleet|company|battery|troop|flight|detachment|task force) )*commander|commanding officer|executive officer`, 'commander', true],
  [String.raw`lieutenant commander|squadron leader|major`, 'major', true],
  [String.raw`captain`, 'captain', true],
  [String.raw`lieutenant`, 'lieutenant', true],
  [String.raw`command sergeant major|sergeant major|(?:command )?master chief(?: petty officer)?|chief master sergeant|command chief(?: master sergeant)?|master gunnery sergeant`, 'seniorEnlisted', true],
  [String.raw`(?:senior )?chief petty officer|senior chief|(?:senior )?master sergeant|(?:first|1st) sergeant|sergeant first class|gunnery sergeant|(?:chief )?warrant officer(?: [1-5])?`, 'nco', true],
  [String.raw`o-?(?:9|10)`, 'seniorGeneral', true],
  [String.raw`o-?[78]`, 'general', true],
  [String.raw`o-?6`, 'colonel', true],
  [String.raw`o-?5`, 'ltColonel', true],
  [String.raw`o-?4`, 'major', true],
  [String.raw`e-?9`, 'seniorEnlisted', true],
  [String.raw`e-?[78]`, 'nco', true],
].map(([src, key, needsService]) => [new RegExp(`^(?:${src})$`), key, needsService]);
const LEVEL_DOWN = { seniorGeneral: 'general', general: 'colonel', colonel: 'ltColonel', ltColonel: 'major', major: 'major' };

// A unit's usual commander, smallest first: the first unit a title names is the
// one commanded ("Executive Officer, 1st Battalion, 75th Ranger Regiment" is a
// battalion's).
const UNIT_LEVELS = [
  [/\b(company|battery|troop|flight|detachment)\b/, 'major'],
  [/\b(battalion|squadron|ship|uss|uscgc|submarine|destroyer|frigate|cutter|v[a-z]{1,3}-\d+)\b/, 'ltColonel'],
  [/\b(brigade|wing|group|regiment|garrison|installation|base|naval (air )?station|naval hospital|joint base)\b/, 'colonel'],
  [/\b(division|strike group|region|command|(surface|submarine|naval|expeditionary) forces?|air forces)\b/, 'general'],
  [/\b(corps|fleet|combatant command|(materiel|combat|mobility|training and doctrine|futures|forces|special operations|space|cyber|strategic|transportation|northern|southern|central|european|pacific|indo-pacific|africa|global strike|education and training) command)\b/, 'seniorGeneral'],
];

/** A commander's (or a commanding or executive officer's) level, from their unit. */
function commandLevel(n, where) {
  const text = `${n.replace(/\b(commander|commanding officer|executive officer|deputy|vice)\b/g, ' ')} ${where}`;
  let key = 'ltColonel';
  let first = Infinity;
  for (const [re, level] of UNIT_LEVELS) {
    const m = text.match(re);
    if (m && (m.index < first || (m.index === first && level === 'seniorGeneral'))) { first = m.index; key = level; }
  }
  if (/\b(deputy|vice)\b/.test(n) || /^executive officer/.test(n)) key = LEVEL_DOWN[key];
  return key;
}

/** A rank written as the title, or null; `retired` when it says so. */
function militaryTitle(raw, t, title, rest, prev, next, others, nextRetired = false) {
  if (NOT_MILITARY.test(t)) return null;
  const atOrg = rest.match(/(?:^|\s)(?:at|@)\s+(.+)$/);
  if (atOrg && !SERVICE_IN.test(atOrg[1]) && !REST_IS_SERVICE.test(atOrg[1])) return null;
  let n = title.replace(/(?<=[a-z])-(?=[a-z])/g, ' ').replace(/^(?:(?:acting|interim|the)\s+)*/, '');
  let retired = /\(\s*r\s*\)/.test(raw.toLowerCase());
  n = n.replace(/,?\s+(?:\(?ret\.?\)?|\(?retired\)?)$/, () => { retired = true; return ''; })
    .replace(/,?\s+\(?active duty\)?$/, '');
  let service = SERVICE_IN.test(t) || REST_IS_SERVICE.test(rest);
  const lead = n.match(new RegExp(`^(?:${SVC})(?:\\s+reserves?)?\\s+`));
  if (lead) { n = n.slice(lead[0].length); service = true; }
  const trail = n.match(new RegExp(`(?:\\s+(?:in|with|of) the)?\\s+(?:${SVC})$`));
  const variants = trail ? [n, n.slice(0, -trail[0].length)] : [n];
  if (trail) service = true;
  const alone = SERVICE_ONLY.test(next) ? next : !rest && SERVICE_ONLY.test(prev) ? prev : null;
  if (alone && (!rest || MIL_UNIT.test(rest))) { service = true; if (alone === next && (RETIRED_SERVICE.test(next) || nextRetired)) retired = true; }
  if (!service && !rest && others.some((o) => SERVICE_ONLY.test(o))) service = true;
  for (let v of variants) {
    let short = false;
    for (const [re, full] of RANK_SHORT) {
      if (re.test(v)) { v = v.replace(re, full); short = true; break; }
    }
    for (const [re, key, needsService] of RANKS) {
      if (!re.test(v)) continue;
      if ((needsService || short) && !service) return null;
      const naval = NAVY_IN.test(t) || (!!alone && NAVY_IN.test(alone));
      const level = key === 'captain' ? (naval ? 'colonel' : 'major')
        : key === 'lieutenant' ? (naval ? 'major' : null)
          : key === 'commander' ? commandLevel(v, rest) : key;
      return level ? { key: level, retired } : null;
    }
  }
  return null;
}

// Government titles, [the whole title after LEAD, a level or (c) => level | null].
// The first pattern that matches decides; a function that returns SKIP lets the
// later ones try. `c` is { n: the title without LEAD, rest: the part's text
// after the title, text: the part with the parts on either side, at: whether
// the part names its organization with "at" }.
const SKIP = Symbol('not this pattern');
const place = String.raw`(?:(?:${STATES}) (?:state )?)?`;
const houseOf = (c) => /\bhouse of (representatives|delegates)\b|\bstate (house|assembly|senate|legislature)\b|\bgeneral assembly\b|\blegislature\b|\bassembly\b|\bstate senate\b|\bhouse district \d+/.test(c.text);
const congress = (c) => /\b(u\.?\s?s\.?|united states) (house|senate|congress)\b|\bcongress\b(?! of)|\bcongressional district\b|\bat-large\b/.test(c.text);
const inState = (c) => STATE_NAME.test(c.n) || STATE_GOV.test(c.text) || JUST_A_STATE.test(c.next) || JUST_A_STATE.test(c.rest);
// The organization a part names after its title looks like a government's (or there is none).
const GOVISH = new RegExp(String.raw`\b(?:district|county|city|town|village|borough|township|parish|metro|ward|at-large|state|commonwealth|circuit|court|judicial|senate|house|assembly|legislature|congress|u\.?\s?s\.?|united states|federal|department|dept\.?|agency|administration|bureau|commission|board|authority|office|service|nation|tribe|pueblo|embassy|consulate|mission|parliament|ministry|government|police|sheriff|peo|program|division|region|united nations|nato|${STATES})\b`);
const govRest = (c) => !c.rest || GOVISH.test(c.rest);
const GOV = [
  // Congress and the legislatures.
  [String.raw`(?:u\.?\s?s\.?|united states) senator(?: (?:for|from) .*)?`, 'govLeader'],
  [String.raw`${place}state (?:senator|representative|rep\.?|delegate|assembly ?(?:member|man|woman|person)|legislator)(?: .*)?`, (c) => (govRest(c) && (houseOf(c) || inState(c) || /\bdistrict\b/.test(c.text)) ? 'govSenior' : null)],
  [String.raw`${place}(?:district \d+ )?senator(?: (?:for|from|of) .*)?`, (c) => (/\b(u\.?\s?s\.?|united states) senate\b/.test(c.text) ? 'govLeader' : /\bsenate\b/.test(c.text) || inState(c) ? 'govSenior' : null)],
  [String.raw`(?:u\.?\s?s\.?|united states) representative (?:for|from) (?:${STATES})['’]?s? (?:\d+(?:st|nd|rd|th)|at-large)(?: congressional)? district`, 'govLeader'],
  [String.raw`congress(?:wo)?man(?: (?:for|from) .*)?|congressperson(?: (?:for|from) .*)?|member of (?:the )?(?:u\.?\s?s\.?\s|united states )?congress|(?:member|delegate) (?:of|to) the (?:u\.?\s?s\.?|united states) house of representatives|resident commissioner(?: of puerto rico)?`, 'govLeader'],
  [String.raw`(?:(?:u\.?\s?s\.?|united states|congressional) )?(?:representative|rep\.?)(?: (?:for|from|of) .*)?|member|legislator`, (c) => (!govRest(c) ? SKIP : congress(c) ? 'govLeader' : houseOf(c) && (inState(c) || /\bhouse\b/.test(c.text)) ? 'govSenior' : /\bcounty legislature\b/.test(c.text) ? 'govOfficial' : SKIP)],
  [String.raw`(?:(?:[a-z.'-]+ ){0,3})?county legislator(?: .*)?`, 'govOfficial'],
  [String.raw`member of the (?:[a-z.']+ ){0,3}(?:house of (?:representatives|delegates)|state assembly|assembly|state senate|senate|legislature|general assembly)(?: .*)?`, (c) => (inState(c) ? 'govSenior' : null)],
  [String.raw`assembly ?(?:member|man|woman|person)(?: .*)?|delegate(?: .*)?`, (c) => (houseOf(c) && inState(c) ? 'govSenior' : null)],
  [String.raw`${place}(?:state )?(?:(?:senate|house|assembly) )?(?:majority|minority) (?:leader|whip)(?: .*)?|speaker(?: pro tem(?:pore)?)?(?: of the (?:u\.?\s?s\.?\s)?(?:house|assembly)(?: of (?:representatives|delegates))?)?(?: .*)?|(?:senate )?president(?: pro tem(?:pore)?)?(?: of the (?:[a-z.']+ ){0,2}senate)?`,
    (c) => (!new RegExp(String.raw`\b(house of (representatives|delegates)|state house|state assembly|senate|legislature|congress|(?:${STATES}) (?:general |state )?assembly)\b`).test(c.part) ? SKIP
      : inState(c) || /\bstate\b/.test(c.part) ? 'govSenior' : 'govLeader')],
  // Governors and statewide offices.
  [String.raw`(?:(?:${STATES}) )?(?:lieutenant|lt\.?) governor(?: (?:of|for) .*)?`, (c) => (inState(c) ? 'govSenior' : null)],
  [String.raw`(?:(?:${STATES}) )?governor(?: (?:of|for) .*)?`, (c) => (/\bfederal reserve\b/.test(c.text) ? 'govSenior' : inState(c) || /\b(nation|tribe|pueblo|indian community)\b/.test(c.text) ? 'govLeader' : null)],
  [String.raw`federal reserve governor|member of the board of governors of the federal reserve(?: system)?|member`, (c) => (/\bfederal reserve\b/.test(c.text) ? 'govSenior' : SKIP)],
  [String.raw`${place}(?:state )?(?:treasurer|comptroller|controller|auditor|auditor general|superintendent of public instruction|commissioner of (?:agriculture|insurance|education|labor|revenue)|land commissioner|insurance commissioner|surgeon general)(?: (?:of|for) .*)?`, (c) => (govRest(c) && (STATE_NAME.test(c.n) || /^state /.test(c.n) || STATE_GOV.test(c.text) || JUST_A_STATE.test(c.next)) ? 'govSenior' : SKIP)],
  // Cities, counties and tribes.
  [String.raw`mayor pro tem(?:pore)?(?: .*)?`, 'govOfficial'],
  [String.raw`(?:deputy|vice|assistant) mayor(?: .*)?`, (c) => (c.at && !GOV_ORG.test(c.rest) ? null : 'govSenior')],
  [String.raw`mayor(?: of .*)?`, (c) => (c.at ? null : !c.rest && !c.next && !/ of /.test(c.n) ? null
    : c.rest ? (GOV_ORG.test(c.rest) || /\b(city|town|village|borough|township)\b/.test(c.rest) ? 'govLeader' : null)
      : c.next && !GOVISH.test(c.next) ? null : 'govLeader')],
  [String.raw`(?:(?:[a-z.'-]+ ){0,3})?county (?:executive|mayor|judge executive)(?: of .*)?`, 'govLeader'],
  [String.raw`(?:principal )?chief|(?:tribal )?(?:chairman|chairwoman|chairperson|president)`, (c) => (/\b(nation|tribe|tribal|pueblo|band of|indian community|rancheria)\b/.test(c.text) && !c.at ? 'govLeader' : SKIP)],
  [String.raw`(?:(?:[a-z.'-]+ ){0,3})?(?:county|city|town|village|borough) (?:administrator|manager)(?: .*)?`, 'govOfficial'],
  // Cabinets: the federal one's, and a state's when it says so.
  [String.raw`${place}secretary of (?:state|defense|war|commerce|labor|education|energy|agriculture|transportation|veterans affairs|homeland security|health(?: and human services)?|housing and urban development|the (?:treasury|interior|army|navy|air force))(?: (?:of|for) .*)?`,
    (c) => (/secretary of state of /.test(c.n) && !STATE_NAME.test(c.n) ? null : !govRest(c) ? null
      : STATE_NAME.test(c.n) || STATE_GOV.test(c.text) || JUST_A_STATE.test(c.next) || JUST_A_STATE.test(c.rest) ? 'govSenior' : 'govLeader')],
  [String.raw`deputy assistant secretary(?: .*)?`, 'govOfficial'],
  [String.raw`(?:deputy under|deputy|under)[-\s]?secretary(?: (?:of|for) .*)?|undersecretary(?: .*)?|assistant secretary(?: (?:of|for) .*)?`,
    (c) => (CORP_OFFICER.test(c.text) ? null : / (of|for) /.test(` ${c.n} `) || GOV_ORG.test(c.text) ? 'govSenior' : null)],
  [String.raw`(?:deputy )?(?:national security advis[eo]r|director of national intelligence)|assistant to the president(?: for .*)?|white house chief of staff|director of the office of management and budget|(?:u\.?\s?s\.?\s|united states )?trade representative`, (c) => (/^deputy/.test(c.n) ? 'govSenior' : 'govLeader')],
  [String.raw`director`, (c) => (/^(?:the )?(?:office of management and budget|federal bureau of investigation|fbi|central intelligence agency|cia|national security agency|nsa|u\.?\s?s\.? secret service|u\.?\s?s\.? marshals service|u\.?\s?s\.? census bureau|national institutes of health|centers for disease control and prevention|cdc|u\.?\s?s\.? mint|bureau of alcohol, tobacco, firearms and explosives|atf)$/.test(c.rest || c.next) ? 'govSenior' : SKIP)],
  [String.raw`(?:fbi|cia|nsa|atf|dea|cdc|nih) director`, 'govSenior'],
  [String.raw`postmaster general|librarian of congress|archivist of the united states|auditor general of the (?:army|navy|air force)`, 'govSenior'],
  [String.raw`(?:u\.?\s?s\.?\s|united states )?special (?:presidential )?envoy(?: .*)?|charge d'affaires(?: .*)?|(?:under|assistant)[-\s]secretary[-\s]general(?: .*)?`, (c) => (govRest(c) ? 'govSenior' : null)],
  [String.raw`special agent in charge|assistant special agent in charge|chief patrol agent|undersheriff|(?:regional|associate|deputy associate) administrator|assistant inspector general(?: .*)?|(?:principal )?deputy assistant attorney general(?: .*)?|associate deputy attorney general(?: .*)?`, (c) => (GOVISH.test(`${c.rest} ${c.next}`) || FED_AGENCY.test(c.rest || c.next) || /inspector general|attorney general/.test(c.n) ? 'govOfficial' : null)],
  [String.raw`director of the (?:fbi|cia|nsa|federal bureau of investigation|central intelligence agency|national security agency|secret service|u\.?\s?s\.? marshals service)|(?:u\.?\s?s\.?|united states) marshal(?: .*)?|comptroller (?:general of the united states|of the currency)|treasurer of the united states`, 'govSenior'],
  // Lawyers for the government.
  [String.raw`(?:principal )?deputy associate attorney general(?: .*)?`, 'govOfficial'],
  [String.raw`associate attorney general(?: .*)?`, 'govSenior'],
  [String.raw`(?:principal )?deputy attorney general(?: .*)?|assistant attorney general(?: .*)?`, (c) => (/\b(of the united states|u\.?\s?s\.? department of justice|department of justice|doj)\b/.test(c.text) && !STATE_GOV.test(c.text) ? 'govSenior' : 'senior')],
  [String.raw`(?:special deputy|special assistant|senior assistant) attorney general(?: .*)?`, 'senior'],
  [String.raw`${place}attorney general(?: (?:of|for) .*)?`, 'govLeader'],
  [String.raw`(?:assistant|deputy|senior assistant|chief assistant|executive assistant) (?:u\.?\s?s\.?|united states|district|state|county|commonwealth(?:['’]s)?) attorney(?: .*)?`, 'senior'],
  [String.raw`(?:u\.?\s?s\.?|united states|district|state|county|commonwealth(?:['’]s)?) attorney(?: (?:for|of) .*)?`, (c) => (/\battorney at law\b/.test(c.text) || (c.rest && !GOV_ORG.test(c.rest) && !/\b(district|county|circuit|judicial)\b/.test(c.rest)) ? null : 'govSenior')],
  [String.raw`deputy (?:inspector general|solicitor general|program executive officer|peo)(?: .*)?`, 'govOfficial'],
  [String.raw`(?:solicitor|inspector|surgeon|adjutant) general(?: .*)?`, 'govSenior'],
  // Defense and civil-service executives.
  [String.raw`program executive officer(?: .*)?`, 'govSenior'],
  [String.raw`peo(?: [a-z0-9&]+){0,2}`, (c) => (c.service ? 'govSenior' : null)],
  [String.raw`(?:member of the )?senior executive service(?: member)?|(?:tier (?:[1-3]|i{1,3}) )?ses(?: tier [1-3])?(?: member)?`, (c) => (/senior executive service/.test(c.n) || c.service || GOV_ORG.test(c.text) ? 'govSenior' : null)],
  // Diplomats and international bodies.
  [String.raw`secretary[-\s]general(?: .*)?`, (c) => (new RegExp(String.raw`\b(${INTERNATIONAL})\b`).test(c.text) ? 'govLeader' : null)],
  [String.raw`(?:u\.?\s?s\.?\s|united states )?ambassador(?: of the united states| extraordinary and plenipotentiary)?(?: to (?:the )?(?:republic of |kingdom of |state of )?(?:${COUNTRIES}|${INTERNATIONAL}))?|ambassador-at-large(?: .*)?`,
    (c) => (!govRest(c) ? null : / to /.test(` ${c.n} `) || c.retired || new RegExp(String.raw`\b(${INTERNATIONAL})\b`).test(c.rest) || /\b(u\.?\s?s\.? embassy|embassy (of|in)|american embassy|department of state|state department|foreign service|u\.?\s?s\.? mission)\b/.test(c.text) ? 'govSenior' : null)],
  [String.raw`ambassador of (?:the )?(?:${COUNTRIES}) to (?:the )?(?:united states|${COUNTRIES}|${INTERNATIONAL})`, 'govSenior'],
  [String.raw`(?:deputy |alternate )?(?:permanent )?representative (?:of .* )?to the (?:${INTERNATIONAL})(?: .*)?|(?:deputy |alternate )?permanent representative(?: .*)?`, (c) => (new RegExp(String.raw`\b(${INTERNATIONAL})\b`).test(c.text) ? 'govSenior' : null)],
  [String.raw`consul general(?: .*)?`, 'govOfficial'],
  // Courts.
  [String.raw`chief justice(?: .*)?`, (c) => (/\b(court|judicial)\b/.test(c.text) && !NOT_COURT.test(c.text) ? 'govLeader' : null)],
  [String.raw`(?:(?:${STATES}|state|u\.?\s?s\.?) )?supreme court justice(?: .*)?`, 'judge'],
  [String.raw`(?:associate |presiding )?justice(?: of .*)?`, (c) => (/\b(supreme|appeals|appellate|superior) (judicial )?court|court of (appeals|criminal appeals)\b/.test(c.text) && !NOT_COURT.test(c.text) ? 'judge' : null)],
  [String.raw`(?:(?:chief|presiding|senior|associate|federal|state|u\.?\s?s\.?|united states|district|circuit|county|superior|family|probate|municipal|juvenile|criminal|civil|city|justice|appellate|appeals|bankruptcy|magistrate|administrative law|immigration|tax|trial|tribal|court) )*judge(?: of .*)?`,
    (c) => (NOT_COURT.test(c.text) ? null
      : /\b(federal|district|circuit|superior|probate|municipal|juvenile|criminal|appellate|appeals|bankruptcy|magistrate|administrative law|immigration|court|united states|u\.?\s?s\.?)\b/.test(c.n) || /\b(court|judicial|circuit|district of)\b/.test(c.text) || (c.retired && /^(?:hon\.? )?judge$/.test(c.n)) ? 'judge' : null)],
  // Commissions.
  [String.raw`(?:(?:[a-z.'-]+ ){0,3}(?:county|city|town|village|borough|parish) )?(?:(?:planning|zoning|parks?(?: and recreation)?|library|historic preservation) )*(?:county |city |town )?commissioner(?: .*)?`,
    (c) => (/\b(county|city|town|village|borough|parish|planning|zoning|parks?|library|historic)\b/.test(c.n) ? 'govOfficial' : SKIP)],
  [String.raw`(?:police|fire) (?:commissioner|chief)|chief of (?:police|the fire department)|superintendent of police`, 'govSenior'],
  [String.raw`chief`, (c) => (/\b(police department|fire department|police|fire rescue)\b/.test(c.rest) ? 'govSenior' : SKIP)],
  [String.raw`(?:fcc|sec|ftc|fec|fda|irs|cbp|ice|fema|epa|nrc|ferc|cftc|eeoc|nlrb|ssa|uspto|nasa|faa|tsa|dea|atf|gsa|sba) (?:commissioner|administrator|chair(?:man|woman)?)`, 'govSenior'],
  [String.raw`(?:deputy|assistant|associate) commissioner(?: .*)?`, (c) => (GOV_ORG.test(c.text) || FED_AGENCY.test(c.rest) ? 'govOfficial' : null)],
  [String.raw`commissioner(?: of .*)?`, (c) => (/\b(county|city|town|village|borough|board of (county )?commissioners)\b/.test(c.text) ? 'govOfficial'
    : new RegExp(String.raw`\b${FED_BODY}\b`).test(c.text) || /\b(public service|public utilities|corporation|railroad) commission\b/.test(c.text) ? 'govSenior'
    : /^commissioner of (the )?(health|education|agriculture|insurance|labor|revenue|police|corrections|public safety|human services|social services|transportation|environmental protection|baseball|internal revenue|food and drugs|u\.?\s?s\.? customs|immigration|social security)\b/.test(c.n) || GOV_ORG.test(c.rest || c.next) || FED_AGENCY.test(c.rest || c.next) ? 'govSenior' : null)],
  [String.raw`(?:deputy )?administrator(?: of .*)?`, (c) => (/\b(environmental protection agency|epa|federal aviation|faa|fema|nasa|transportation security|tsa|usaid|drug enforcement|dea|nhtsa|general services administration|gsa|small business administration|sba|centers for medicare|federal highway|federal transit|federal railroad|maritime administration|national oceanic)\b/.test(`${c.n} ${c.rest} ${FED_AGENCY.test(c.next) ? c.next : ''}`) ? (/^deputy/.test(c.n) ? 'govOfficial' : 'govSenior') : null)],
  [String.raw`chair(?:man|woman|person)?(?: of .*)?`, (c) => (!c.at && (new RegExp(String.raw`\b${FED_BODY}\b`).test(c.text) || /\b(public service|public utilities|corporation|railroad) commission\b/.test(c.text)) ? 'govSenior' : SKIP)],
  // Local officials.
  [String.raw`(?:(?:[a-z0-9.'-]+ ){0,3})?(?:council ?(?:member|man|woman|person)|councilmember|councill?or|alder(?:man|woman|person)|selectman|selectwoman|select board member)(?: .*)?`,
    (c) => (/\b(forbes|advisory|parent|students?|youth|business|young entrepreneur|yec|technology|advisors?)\b/.test(c.part) ? null
      : /\b(city|town|village|borough|county|district \d+|ward \d+|metro|at-large)\b/.test(c.text) ? 'govOfficial' : null)],
  [String.raw`(?:(?:[a-z.'-]+ ){0,3})?county supervisor(?: .*)?|member of the (?:[a-z.']+ ){0,2}board of supervisors`, (c) => (govRest(c) ? 'govOfficial' : null)],
  [String.raw`(?:(?:[a-z.'-]+ ){0,3}(?:county|parish) )?sheriff(?: of .*)?`, (c) => (/\b(county|parish)\b/.test(c.text) ? 'govOfficial' : null)],
  [String.raw`school board (?:member|chair(?:man|woman|person)?|trustee|president|vice chair)(?: .*)?|member of the (?:[a-z.']+ ){0,3}school board`, 'govOfficial'],
  [String.raw`prime minister(?: of .*)?|member of parliament(?: .*)?`, 'govLeader'],
].map(([src, key]) => [new RegExp(`^${LEAD}(?:${src})$`), key]);
const OFFICE_TABLES = { corpOfficer: CORP_OFFICER, notCourt: NOT_COURT, fedBody: FED_BODY, fedAgency: FED_AGENCY, govish: GOVISH,
  qualifiedService: QUALIFIED_SVC, restIsService: REST_IS_SERVICE, unitLevels: UNIT_LEVELS, states: STATES, countries: COUNTRIES, international: INTERNATIONAL, stateGov: STATE_GOV, govOrg: GOV_ORG,
  civic: CIVIC, lead: LEAD, service: SVC, serviceIn: SERVICE_IN, navy: NAVY_IN, serviceOnly: SERVICE_ONLY, milUnit: MIL_UNIT,
  notMilitary: NOT_MILITARY, rankShort: RANK_SHORT, ranks: RANKS,
  gov: GOV.map(([re, key]) => [re, typeof key === 'function' ? String(key) : key]) };

const lowerPart = (text) => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\(\s*(?:[a-z.]+,\s*)?(ret(\.|ired|d\.?)?|r)\s*\)/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A government or military title written where a title goes, or null: the
 * part's text up to its first comma, "at", "@" or bracket is the title; the
 * rest of the part, and the parts on either side, only say where it is held.
 * A rank that says it's retired comes back with `retired`.
 */
function officeTitle(part, prev = '', next = '', others = [], former = false) {
  const t = lowerPart(part);
  const cut = t.search(/,|\s(?:at|@)\s|\s@|\(/);
  const title = (cut < 0 ? t : t.slice(0, cut)).trim().replace(/[.:;]+$/, '');
  const rest = cut < 0 ? '' : t.slice(cut).replace(/^[,\s]+/, '');
  const around = { prev: lowerPart(prev), next: lowerPart(next) };
  const mil = militaryTitle(part, t, title, rest, around.prev, around.next, others.map(lowerPart), RETIRED.test(next) || RETIRED_ONLY.test(next));
  if (mil) return { ...LEVELS[mil.key], ...(mil.retired && { retired: true }) };
  // Government: never a club's, a church's, a school's or a joke's, and never
  // at an organization that isn't a government's.
  const nearby = rest || /\b(of|for|to)\b/.test(title) ? t : `${t} ${around.next}`;
  if (CIVIC.test(nearby)) return null;
  const at = /^(?:at|@)\s/.test(rest);
  if (at && !GOV_ORG.test(rest)) return null;
  const c = { n: title.replace(new RegExp(`^${LEAD}`), ''), part: t, rest, at, next: around.next, text: `${around.prev} ${t} ${around.next}`,
    service: SERVICE_IN.test(`${t} ${around.next}`), retired: former || RETIRED.test(part) };
  for (const [re, key] of GOV) {
    if (!re.test(title)) continue;
    const k = typeof key === 'function' ? key(c) : key;
    if (k === SKIP) continue;
    return k ? LEVELS[k] : null;
  }
  return null;
}

// An audience of their own, in one part of a headline: "2.5M+ followers",
// "2,500,000 followers", "1.2M monthly listeners", "500K subscribers", "3M+ on
// TikTok". Not views, users or impressions, which are a campaign's or a
// product's (those are the reach bonus's), and not in a part about growing or
// managing someone else's ("Grew our TikTok to 2M followers", "Managed
// accounts with 10M+ followers").
const COUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|b|thousand|million|billion)?\+?`;
const AUDIENCE = [
  new RegExp(String.raw`(?<![\w.,$])${COUNT}((?:\s+[a-z]+){0,2}?)\s+(followers|subscribers|subs|listeners|readers|fans)\b`, 'gi'),
  new RegExp(String.raw`(?<![\w.,$])${COUNT}\s+(on|across)\s+(tiktok|youtube|instagram|ig|twitter|x|linkedin|snapchat|twitch|facebook|threads|social media|socials)\b`, 'gi'),
];
const NOT_THEIR_AUDIENCE = /\b(grew|grow|growing|grown|scaled|scaling|built|building|drove|driving|generated|generating|managed|managing|manage|helped|helping|clients?)\b/i;
const UNIT = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };

/** The audience level a part of a headline claims (LEVELS key), or null. */
function audienceIn(part = '') {
  if (NOT_THEIR_AUDIENCE.test(part)) return null;
  let most = 0;
  for (const re of AUDIENCE) {
    for (const m of part.matchAll(re)) most = Math.max(most, Number(m[1].replace(/,/g, '')) * (UNIT[(m[2] || '').toLowerCase()] || 1));
  }
  return most >= 1e7 ? 'audience10m' : most >= 1e6 ? 'audience1m' : most >= 1e5 ? 'audience100k' : null;
}

// A title's company written without "at" (readRoles) is only a guess, so it's
// kept narrow. A founder, an owner or a CEO leads a venture of their own: a big
// company after their title is an accelerator, an investor, a school or a past
// employer ("Founder | Y Combinator", "CEO | Stanford"), almost never theirs.
// A program, an award, a membership or a degree is not a job there ("AWS
// Community Builder", "Forbes Council Member", "Harvard MBA", "Director,
// Microsoft Alliance"). And a school after any title but an academic one is
// more often where they studied ("VP Marketing | Harvard").
const OWN_VENTURE = /\b((co-?)?founder|cofounder|owner|entrepreneur|ceo|chief executive)\b/i;
const AFFILIATION = /\b(alum|alumn(i|us|a|ae)|community|builders?|alliances?|council|members?|fellows?|fellowship|accelerator|cohort|batch|portfolio|backed|residents?|residency|speakers?|summit|conference|awards?|honorees?|mentors?|advisors?|investors?|partners?|foundation|club|society|chapter|program(me)?|scholars?|grads?|graduate|mba|gsb|class)\b/i;
const ACADEMIC = /\b(prof(essor)?|lecturer|dean|provost|chancellor|faculty|instructor|postdoc(toral)?|research(er)?|scientist|department|dept)\b/i;

/** The company the lists know that `text` names, for the title in `titlePart` to be held at, or null. */
function heldAt(text, titlePart) {
  if (OWN_VENTURE.test(titlePart) || AFFILIATION.test(text)) return null;
  const name = cleanCompany(text);
  if (!name || !(KNOWN_BY_NAME.has(name) || DATA_BY_NAME.has(name))) return null;
  return KNOWN_INDUSTRY.get(name) === 'education' && !ACADEMIC.test(titlePart) ? null : name;
}

/** A company named after a comma in a title's part: "Corporate VP, Samsung". */
function heldAfterComma(part) {
  for (const piece of part.split(/,\s+/).slice(1)) {
    const name = heldAt(piece, part);
    if (name) return name;
  }
  return null;
}

/**
 * Every role a headline names: "CEO @ X | Ex-VP at Google | Speaker" gives a
 * current CEO role at X and a former VP role at Google. A part that names only
 * a company ("GTM @ Quillon") still says they work there.
 *
 * A title's company written without "at" is where it's held: after a comma
 * ("Corporate VP, Samsung") or as the next part ("President | The Coca-Cola
 * Company", "Head of Partnerships - Snap"). Only a company the lists know
 * (curated or public dataset), since anything can follow a title ("Founder |
 * Speaker", "President, North America"), only for a current title without
 * one, and not where heldAt() says it's an affiliation. Such a role is
 * `inferred`: a company scan's company goes before it.
 * An audience of their own is a role of its own (`audience`), with no company.
 */
export function readRoles(headline = '', role = '') {
  const out = [];
  const parts = headlineParts(headline || role);
  for (const [i, raw] of parts.entries()) {
    if (RETIRED_ONLY.test(raw)) {
      const before = out[out.length - 1];
      if (before) before.former = true;
      continue;
    }
    const former = FORMER.test(raw) || RETIRED.test(raw);
    const part = raw.replace(FORMER, '').replace(/^[@\s.:]+/, '');
    let title = officeTitle(part, parts[i - 1] ?? '', parts[i + 1] ?? '', parts, former) || readPart(part);
    const retired = !!title?.retired;
    if (retired) { const { retired: _, ...rest } = title; title = rest; }
    let company = companyIn(part) || (out.length === 0 && isKnownCompany(part) ? cleanCompany(part) : null);
    let inferred = false;
    if (!company && title) {
      company = heldAfterComma(part);
      inferred = !!company;
    }
    if (!title && company) title = { ...LEVELS.ic, label: 'Works there' };
    if (title) out.push({ title, company, former: former || retired, part, ...(inferred && { inferred }) });
    else if (!former) {
      const before = [...out].reverse().find((r) => !r.audience);
      const at = before && !before.former && !before.company ? heldAt(part, before.part) : null;
      if (at) Object.assign(before, { company: at, inferred: true });
    }
    const audience = audienceIn(part);
    if (audience) out.push({ title: LEVELS[audience], company: null, former, part, audience: true });
  }
  return out;
}

/** Is this person a student right now? Then no other title makes them powerful yet. */
export function isStudent(headline = '') {
  return headlineParts(headline).some((p) => !FORMER.test(p) && !SERVICE_SCHOOL.test(p) && (studies(p) || INTERN.test(` ${p.toLowerCase()} `)));
}

/** The person's first current title (a quick read; scoring weighs every role), an audience only when it's all they state. */
export function readTitle(headline = '', role = '') {
  const roles = readRoles(headline, role);
  const r = roles.find((x) => !x.former && !x.audience) || roles.find((x) => !x.former) || roles[0];
  return r ? { ...r.title, part: r.part } : { ...LEVELS.unknown, part: headlineParts(headline || role)[0] || '' };
}

// ── company ──────────────────────────────────────────────────────────────────

// Well-known companies, scored for what a person there can usually open up.
// These are the defaults for everyone who runs the app, so one written rule
// decides who is on the list, not anyone's own ties to a company. A company is
// on it only if most US professionals would recognise it:
//   - a household-name brand;
//   - a Fortune 500 company, or a public company as large;
//   - a top global VC, private equity, consulting, law or accounting firm;
//   - a frontier AI lab;
//   - a top national university.
// Scores follow one scale: 10 the largest tech platforms and the frontier AI
// labs, 9 elite (the most sought-after employers), 8 major, 7 well-known.
// Nothing on the list is below 7. Regional picks, picks from one person's
// career or network, and small startups are not on it: they are estimated
// from the network like any other company (4, or 5–6 when many of the
// network's people work there), and anyone can score them on Paths → Scores,
// where a score set always wins. When in doubt, a company stays off: the
// estimate is the neutral default.
//
// The rule is applied from named sources, the same way in every field, so
// anyone can check the list or extend it: the Fortune 500, the largest law
// firms, one ranking of universities and the others docs/brain/SCORING.md
// names. An addition is 8 at the size of the Fortune 100 (over about $45
// billion a year), as nearly every such company already here is, and 7 below
// it; where the list already scores its kind of firm otherwise, it follows
// those peers (private equity at 9 with Bain Capital, the largest law firms at
// 8 with the Big Four, universities by their rank). SCORING.md also says what
// applying the rule changed; lib/legacy-scores.js keeps the old scores, for
// the one-time offer to keep them (never for scoring).
//
// Aliases are matched from the start of the (cleaned) company name, as whole
// words, so they are kept narrow. A name that other companies also start with
// (Ford, Delta, Fidelity, Warner, Apollo, Columbia, Chase) matches only in the
// forms its company uses, ending there ($), and never as a short form that is
// also a word or a title: "GM" is a general manager. A dealership, a bottler
// or a franchise has staff of its own ("Toyota of …", "Coca-Cola
// Consolidated"), and so do companies that share a name or were spun off
// (Fidelity National Financial, Warner Music Group, J&J Snack Foods, Merck
// Millipore, Chase Brass). Only a name no other company starts with stays open
// (\b): Costco, Pfizer, "Deloitte Digital". tests/known-companies.test.mjs
// holds the names each must read and the names that must stay their own.
//
// The last field is the company's industry, one of lib/companies.js's
// INDUSTRIES keys (this file imports nothing, so they are plain strings;
// tests/companies.test.mjs checks each one). Most of these names carry no
// industry word, so without it Adobe, Pfizer or MIT would take whatever their
// people's headlines happen to say. Where a name does say something
// (YouTube → media, Tesla → industry), the field agrees with it.

// A brand's name on an arena or a stadium is not the brand's company: "State
// Farm Arena" and "AT&T Stadium" have staff of their own. Brands that name
// well-known venues are matched with this.
const VENUE = String.raw`(?! (performing arts )?(arena|stadium|center|centre|field|park|ballpark|dome|amphitheat(er|re)|theat(er|re)|pavilion|forum|coliseum|speedway)\b)`;
const sponsor = (names) => new RegExp(String.raw`^(${names})\b${VENUE}`);
// A university by its own names: the name alone or with "University", and its
// schools ("Harvard Business School", "Yale School of Management", "Stanford
// University School of Medicine"). Not a hospital, health plan, lab or
// company that shares its name (Harvard Pilgrim Health Care, Stanford Health
// Care, Vanderbilt University Medical Center, Brown University Health), nor
// another school that does (Princeton High School). `more` adds a form of its own.
const SCHOOLS = String.raw`( [a-z]+)?( graduate)? school of [a-z ,&]+| (business|law|medical|divinity|nursing|dental|journalism|graduate|extension|kennedy) school`;
const university = (names, more = '') => new RegExp(String.raw`^(${names})( university)?(${SCHOOLS}${more})?$`);

export const KNOWN_COMPANIES = [
  // 10 — the largest tech platforms and the frontier AI labs
  ['Google', 10, /^(google|deepmind)\b|^alphabet$/, 'tech'],
  ['Apple', 10, /^apple( inc)?$/, 'tech'],
  ['Microsoft', 10, /^microsoft\b/, 'tech'],
  ['Amazon', 10, /^(amazon|aws|amazon web services)\b(?! (conservation|watch)\b)/, 'tech'],
  ['Meta', 10, /^meta( platforms| superintelligence labs| ai)?$|^(facebook|instagram|whatsapp|reality labs)\b/, 'tech'],
  ['NVIDIA', 10, /^nvidia\b/, 'tech'],
  ['OpenAI', 10, /^(openai|open ai)\b/, 'tech'],
  ['Anthropic', 10, /^anthropic\b/, 'tech'],
  ['Tesla', 10, /^tesla( motors| inc)?$/, 'industry'],
  // 9 — elite: the most sought-after employers in tech, finance, consulting,
  // investing and consumer brands
  ['Netflix', 9, /^netflix\b/, 'entertainment'],
  ['YouTube', 9, /^youtube\b/, 'media'],
  ['LinkedIn', 9, /^linkedin\b/, 'tech'],
  ['TikTok', 9, /^(tiktok|bytedance)\b/, 'media'],
  ['SpaceX', 9, /^spacex\b/, 'defense'],
  ['Stripe', 9, /^stripe\b/, 'finance'],
  ['Palantir', 9, /^palantir\b/, 'tech'],
  ['Coca-Cola', 9, /^(the )?coca[-\s]cola( company| north america)?$/, 'consumer'],
  ['Disney', 9, /^(the walt |walt )?disney\b/, 'entertainment'],
  ['Goldman Sachs', 9, /^goldman sachs\b|^goldman$/, 'finance'],
  ['JPMorgan Chase', 9, /^(jp ?morgan|j\.p\. morgan|jpmorgan chase)\b|^chase( bank| home lending| card services| auto| for business)?$/, 'finance'],
  ['Morgan Stanley', 9, /^morgan stanley\b/, 'finance'],
  ['BlackRock', 9, /^blackrock\b/, 'finance'],
  ['McKinsey', 9, /^mckinsey\b/, 'consulting'],
  ['BCG', 9, /^(bcg|boston consulting group)\b/, 'consulting'],
  ['Bain', 9, /^bain( & company| and company)?$/, 'consulting'],
  // A private equity firm, not Bain & Company: its own entry (so its own
  // industry), at the 9 it had when it was an alias of Bain.
  ['Bain Capital', 9, /^bain capital$/, 'finance'],
  ['Procter & Gamble', 9, /^(p&g|procter)\b/, 'consumer'],
  ['Sequoia', 9, /^sequoia( capital)?$/, 'finance'],
  ['Andreessen Horowitz', 9, /^(a16z|andreessen)\b/, 'finance'],
  ['Y Combinator', 9, /^(y combinator|yc)$/, 'finance'],
  // The private equity firms in the Fortune 500, peers of Bain Capital. Apollo
  // only by its full name: Apollo Hospitals, Apollo.io and others share "Apollo".
  ['Blackstone', 9, /^blackstone( group)?$/, 'finance'], ['KKR', 9, /^(kkr|kohlberg kravis roberts)\b/, 'finance'],
  ['Apollo Global Management', 9, /^apollo( global( management)?| management)$/, 'finance'],
  // 8 — major companies and institutions
  ['Salesforce', 8, /^salesforce\b/, 'tech'], ['Adobe', 8, /^adobe( systems)?$/, 'tech'], ['Oracle', 8, /^oracle( america| health| netsuite| cloud( infrastructure)?| financial services( software)?)?$/, 'tech'], ['IBM', 8, /^ibm\b/, 'tech'],
  ['Uber', 8, /^uber( technologies| eats)?$/, 'tech'], ['Airbnb', 8, /^airbnb\b/, 'tech'], ['DoorDash', 8, /^doordash\b/, 'tech'], ['Spotify', 8, /^spotify\b/, 'entertainment'],
  ['Snap', 8, /^(snap|snapchat)( inc)?( (specs|spectacles|(mena|emea|apac|latam|north america)( region)?))?$/, 'media'], ['Pinterest', 8, /^pinterest\b/, 'media'], ['Reddit', 8, /^reddit\b/, 'media'], ['X', 8, /^(x corp|twitter)\b/, 'media'],
  ['Roblox', 8, /^roblox\b/, 'entertainment'], ['Shopify', 8, /^shopify\b(?! (plus )?partners?\b)/, 'consumer'], ['Snowflake', 8, /^snowflake( computing)?$/, 'tech'], ['Datadog', 8, /^datadog\b/, 'tech'],
  ['CrowdStrike', 8, /^crowdstrike\b/, 'tech'], ['ServiceNow', 8, /^servicenow\b/, 'tech'], ['Canva', 8, /^canva\b/, 'tech'],
  ['Intuit', 8, /^intuit\b/, 'tech'], ['Cisco', 8, /^cisco\b/, 'tech'], ['Qualcomm', 8, /^qualcomm\b/, 'tech'], ['AMD', 8, /^amd\b/, 'tech'],
  ['Samsung', 8, /^samsung\b/, 'tech'], ['Sony', 8, /^sony\b/, 'entertainment'], ['Epic Games', 8, /^epic games\b/, 'entertainment'],
  ['Coinbase', 8, /^coinbase\b/, 'finance'], ['Robinhood', 8, /^robinhood\b/, 'finance'], ['Block', 8, /^(block|square|cash app)$/, 'finance'],
  ['Visa', 8, /^visa( inc)?$/, 'finance'], ['Mastercard', 8, /^mastercard\b/, 'finance'], ['American Express', 8, /^(american express|amex)\b/, 'finance'],
  ['Capital One', 8, sponsor('capital one'), 'finance'], ['BNY', 8, /^(bny|bny mellon|bank of new york)\b/, 'finance'], ['Citi', 8, /^(citi( private bank)?|citigroup|citibank)$/, 'finance'],
  ['Wells Fargo', 8, sponsor('wells fargo'), 'finance'], ['Bank of America', 8, new RegExp(String.raw`^bank of america\b${VENUE}|^merrill( lynch( wealth management)?| edge)?$`), 'finance'], ['Fidelity', 8, /^fidelity( investments| institutional| management (&|and) research( company)?)?$/, 'finance'],
  ['Deloitte', 8, /^deloitte\b/, 'consulting'], ['PwC', 8, /^(pwc|pricewaterhouse)\b/, 'consulting'], ['EY', 8, /^(ey|ernst & young)$/, 'consulting'], ['KPMG', 8, /^kpmg\b/, 'consulting'],
  ['Accenture', 8, /^accenture\b/, 'consulting'],
  ['Nike', 8, /^nike\b/, 'consumer'], ['PepsiCo', 8, /^pepsico\b|^pepsi( beverages( company)?| cola( company)?)?$/, 'consumer'], ['Walmart', 8, /^walmart\b/, 'consumer'], ['Starbucks', 8, /^starbucks\b/, 'consumer'],
  ['Unilever', 8, /^unilever\b/, 'consumer'], ['LVMH', 8, /^lvmh\b/, 'consumer'], ["L'Oréal", 8, /^l'?or[eé]al\b/, 'consumer'], ['Red Bull', 8, sponsor('red bull'), 'consumer'],
  ['NBCUniversal', 8, /^(nbcuniversal|nbc universal|nbc)\b/, 'entertainment'], ['Warner Bros. Discovery', 8, /^(warner (bros|brothers)( discovery| pictures| entertainment| television( studios)?| games| animation| studios)?|warner ?media|wbd)$/, 'entertainment'],
  ['Lockheed Martin', 8, /^lockheed\b/, 'defense'], ['Northrop Grumman', 8, /^northrop\b/, 'defense'], ['Boeing', 8, /^boeing\b/, 'defense'], ['RTX', 8, /^(rtx|raytheon)\b/, 'defense'],
  ['General Dynamics', 8, /^general dynamics\b/, 'defense'], ['Blue Origin', 8, /^blue origin\b/, 'defense'], ['Siemens', 8, /^siemens\b(?! (energy|healthineers|gamesa)\b)/, 'industry'],
  // Mitsubishi's makers, not the group's bank, lender or landlord (MUFG, Mitsubishi HC Capital, Mitsubishi Estate).
  ['Mitsubishi', 8, /^mitsubishi\b(?! (ufj|hc capital|estate)\b)/, 'industry'], ['Toyota', 8, /^toyota( motor( north america| corporation| manufacturing( [a-z]+){0,2}| sales( usa)?)?| north america| financial services| research institute( of north america)?)?$/, 'industry'], ['Johnson & Johnson', 8, /^johnson (&|and) johnson\b|^j&j$/, 'health'],
  ['Pfizer', 8, /^pfizer\b/, 'health'], ['UnitedHealth', 8, /^(unitedhealth(care)?|united ?health ?care|united health group|optum(rx|care|health|insight|serve)?)\b/, 'health'], ['World Bank', 8, /^world bank\b/, 'finance'],
  ['NASA', 8, /^nasa\b(?! federal credit union\b)/, 'defense'], ['Stanford University', 8, university('stanford', '| gsb'), 'education'], ['Harvard University', 8, university('harvard', '| college'), 'education'], ['MIT', 8, /^(mit|massachusetts institute of technology)$/, 'education'],
  // Added from the sources in docs/brain/SCORING.md, at 8: the Fortune 100
  // (2025) and companies as large, whether based elsewhere, private or
  // nonprofit. Health insurers, health systems and drugmakers. Aetna is part
  // of CVS Health but keeps its own name, as people do. Merck KGaA is a
  // different company from Merck.
  ['CVS Health', 8, /^(cvs|cvshealth)\b/, 'health'], ['Aetna', 8, /^aetna\b/, 'health'], ['Cigna', 8, /^cigna\b/, 'health'], ['Humana', 8, /^humana\b/, 'health'],
  ['Elevance Health', 8, /^elevance\b|^anthem( blue cross( (and |& )?blue shield)?| inc| health plans)?$/, 'health'],
  ['HCA Healthcare', 8, /^hca\b/, 'health'], ['Kaiser Permanente', 8, /^kaiser( (permanente|foundation (health plan|hospitals))\b|$)/, 'health'],
  ['Merck', 8, /^merck\b(?! (kgaa|group|millipore)\b)/, 'health'], ['AbbVie', 8, /^abbvie\b/, 'health'], ['Eli Lilly', 8, /^eli lilly\b|^lilly( usa)?$/, 'health'],
  ['Bristol Myers Squibb', 8, /^bristol[-\s]?myers\b/, 'health'], ['AstraZeneca', 8, /^astrazeneca\b/, 'health'],
  ['Bayer', 8, /^bayer( ag| u\.?s\.?| crop ?science| pharmaceuticals| healthcare| consumer health)?$/, 'health'],
  // Retail, grocery, food and drink. Lowes Foods is a different grocer.
  ['Costco', 8, /^costco\b/, 'consumer'], ['The Home Depot', 8, sponsor('home depot'), 'consumer'], ['Kroger', 8, sponsor('kroger'), 'consumer'],
  ['IKEA', 8, /^ikea\b/, 'consumer'], ['Aldi', 8, /^aldi\b/, 'consumer'], ['7-Eleven', 8, /^7[-\s]?eleven\b/, 'consumer'],
  ['Walgreens', 8, /^walgreens?\b/, 'consumer'], ["Lowe's", 8, /^lowe['’]?s( companies| home improvement)?$/, 'consumer'],
  ['Albertsons', 8, /^albertsons( companies)?$/, 'consumer'], ['TJX', 8, /^(tjx( companies)?|tj ?maxx)$/, 'consumer'],
  ['Tyson Foods', 8, /^tyson( foods)?$/, 'consumer'], ['Nestlé', 8, /^nestl[eé](?![a-z])/, 'consumer'],
  ['Anheuser-Busch', 8, /^(anheuser[-\s]busch|ab[-\s]?inbev)\b/, 'consumer'], ['Mars', 8, /^mars( inc| incorporated| wrigley| petcare| snacking)?$/, 'consumer'],
  // Smaller than the Fortune 100, but 8 like Starbucks, the other restaurant company here.
  ["McDonald's", 8, /^mcdonald['’]?s\b/, 'consumer'],
  // Automakers, by the makers' own names only.
  ['General Motors', 8, /^general motors\b/, 'industry'], ['Ford', 8, /^ford( motor( company| credit( company)?)?)?$/, 'industry'],
  ['Volkswagen', 8, /^(volkswagen( group( of america)?| of america| ag)?|vw)$/, 'industry'],
  ['Mercedes-Benz', 8, /^mercedes[-\s]benz( group| usa| ag| u\.s)?$/, 'industry'], ['BMW', 8, /^bmw( group| ag| of north america| manufacturing)?$/, 'industry'],
  ['Honda', 8, /^(american )?honda( motor( company)?| north america| aircraft( company)?| r&d( americas)?)?$/, 'industry'],
  ['Hyundai', 8, /^hyundai( motor( company| america| group| north america)?)?$/, 'industry'], ['Kia', 8, /^kia( motors?| america| motors america| georgia)?$/, 'industry'],
  ['Nissan', 8, /^nissan( motor( company| corporation)?| north america| americas)?$/, 'industry'],
  // Airlines, telecoms, energy and shipping. "Delta" alone is also Delta
  // Dental and a sorority, so only the airline's full name matches.
  ['Delta Air Lines', 8, /^delta (air lines|airlines)\b/, 'consumer'], ['United Airlines', 8, /^united airlines\b/, 'consumer'],
  ['American Airlines', 8, sponsor('american airlines'), 'consumer'],
  ['Verizon', 8, sponsor('verizon'), 'tech'], ['AT&T', 8, sponsor('at ?& ?t'), 'tech'], ['T-Mobile', 8, sponsor(String.raw`t[-\s]?mobile`), 'tech'],
  ['Comcast', 8, sponsor('comcast|xfinity'), 'tech'],
  ['ExxonMobil', 8, /^exxon( ?mobil)?\b/, 'industry'], ['Chevron', 8, /^chevron\b(?! phillips\b)/, 'industry'], ['ConocoPhillips', 8, /^conocophillips\b/, 'industry'],
  ['Shell', 8, /^shell( oil( company)?| usa| energy| global solutions| trading)?$/, 'industry'], ['BP', 8, /^(bp( america| p\.l\.c)?|british petroleum)$/, 'industry'],
  ['UPS', 8, /^ups( supply chain solutions| airlines| healthcare)?$|^united parcel service\b/, 'industry'], ['FedEx', 8, sponsor('fedex|federal express'), 'industry'],
  ['DHL', 8, /^dhl\b/, 'industry'],
  // Insurers and mortgage finance. Berkshire Hathaway by its own name only:
  // its companies keep theirs (GEICO below; its HomeServices brokerages are
  // franchises).
  ['Berkshire Hathaway', 8, /^berkshire hathaway$/, 'finance'],
  ['State Farm', 8, sponsor('state farm'), 'finance'], ['Allstate', 8, sponsor('allstate'), 'finance'], ['MetLife', 8, sponsor('metlife'), 'finance'],
  ['Progressive', 8, /^progressive( insurance| casualty insurance( company)?)?$/, 'finance'],
  ['Prudential Financial', 8, /^prudential( financial| insurance( company of america)?)?$/, 'finance'], ['New York Life', 8, /^new york life\b/, 'finance'],
  ['Nationwide', 8, /^nationwide( insurance| mutual( insurance( company)?)?| financial)?$/, 'finance'], ['Liberty Mutual', 8, /^liberty mutual\b/, 'finance'],
  ['USAA', 8, /^usaa\b/, 'finance'], ['Travelers', 8, /^travelers( insurance| companies)?$/, 'finance'],
  ['Fannie Mae', 8, /^(fannie mae|federal national mortgage association)\b/, 'finance'], ['Freddie Mac', 8, /^(freddie mac|federal home loan mortgage)\b/, 'finance'],
  // Computers and machinery. HP only: Hewlett Packard Enterprise is another company.
  ['Dell', 8, /^dell( technologies| emc)?$/, 'tech'], ['HP', 8, /^(hp|hewlett[-\s]packard)( inc| company)?$/, 'tech'],
  ['Caterpillar', 8, /^caterpillar\b/, 'industry'], ['John Deere', 8, /^(john deere|deere( (&|and) company)?)\b/, 'industry'],
  // Nine of the ten largest US law firms by revenue (the Am Law 100, 2025),
  // 8 like the Big Four, the largest firms in accounting.
  ['Kirkland & Ellis', 8, /^kirkland (&|and) ellis\b/, 'consulting'], ['Latham & Watkins', 8, /^latham (&|and) watkins\b/, 'consulting'],
  ['DLA Piper', 8, /^dla piper\b/, 'consulting'], ['Baker McKenzie', 8, /^baker (& )?mckenzie\b/, 'consulting'], ['Skadden', 8, /^skadden\b/, 'consulting'],
  ['Gibson Dunn', 8, /^gibson dunn\b/, 'consulting'], ['Sidley Austin', 8, /^sidley( austin)?\b/, 'consulting'],
  ['White & Case', 8, /^white (&|and) case\b/, 'consulting'], ['Ropes & Gray', 8, /^ropes (&|and) gray\b/, 'consulting'],
  // The top five of U.S. News's Best National Universities (2025 edition),
  // with Harvard, Stanford and MIT above. Yale New Haven Health is a hospital
  // system of its own.
  ['Princeton University', 8, university('princeton'), 'education'], ['Yale University', 8, university('yale', '| college'), 'education'],
  // 7 — well-known companies and universities
  ['Discord', 7, /^discord\b/, 'tech'], ['Paramount', 7, /^paramount( global| pictures| skydance| streaming| television( studios)?| media networks|\+)?$/, 'entertainment'], ['Madison Square Garden', 7, /^(madison square garden|msg)\b/, 'entertainment'],
  ['Fanatics', 7, /^fanatics\b/, 'consumer'], ['Nielsen', 7, /^nielsen( holdings| company| media research| audience measurement)?$/, 'media'], ['The Trade Desk', 7, /^the trade desk\b/, 'media'], ['SiriusXM', 7, /^sirius ?xm\b/, 'entertainment'],
  ['Twitch', 7, /^twitch\b/, 'entertainment'], ['Electronic Arts', 7, /^(electronic arts|ea)$/, 'entertainment'], ['Activision Blizzard', 7, /^(activision( blizzard)?|blizzard( entertainment)?)$/, 'entertainment'],
  ['MrBeast', 7, /^(mrbeast|beast industries)$/, 'media'], ['Lyft', 7, /^lyft\b/, 'tech'], ['Instacart', 7, /^instacart\b/, 'tech'], ['Duolingo', 7, /^duolingo\b/, 'tech'],
  ['Intel', 7, /^intel( corporation)?$/, 'tech'], ['Workday', 7, /^workday\b/, 'tech'], ['PayPal', 7, /^paypal\b/, 'finance'], ['Credit Karma', 7, /^credit karma\b/, 'finance'],
  ['Chick-fil-A', 7, /^chick[-\s]fil[-\s]a\b/, 'consumer'], ['Target', 7, /^target( corporation)?$/, 'consumer'], ['Booz Allen Hamilton', 7, /^booz allen\b/, 'defense'],
  ['L3Harris', 7, /^l3harris\b/, 'defense'], ['Leidos', 7, /^leidos\b/, 'defense'],
  ['WPP', 7, /^wpp\b/, 'media'], ['Omnicom', 7, /^omnicom\b/, 'media'], ['Publicis', 7, /^publicis\b/, 'media'], ['Interpublic', 7, /^(interpublic|ipg)\b/, 'media'], ['Dentsu', 7, /^dentsu\b/, 'media'],
  ['Kellanova', 7, /^(kellanova|kellogg['’]?s|kellogg( company)?)$/, 'consumer'], ['Campbell', 7, /^campbell( soup( company)?| company|['’]?s)?$/, 'consumer'], ['Goodyear', 7, /^goodyear\b/, 'industry'],
  ['Duke University', 7, /^duke( university)?$/, 'education'], ['UC Berkeley', 7, /^(uc berkeley|university of california,? berkeley)\b/, 'education'],
  // Added from the same sources: household names smaller than the Fortune
  // 100. The best-known health systems, by their own names (Johns Hopkins
  // Medicine apart from the university below).
  ['Mayo Clinic', 7, /^mayo clinic\b/, 'health'], ['Cleveland Clinic', 7, /^cleveland clinic\b/, 'health'],
  ['Johns Hopkins Medicine', 7, /^johns hopkins (medicine|hospital|health( system|care)|all children['’]?s|bayview|community physicians)\b/, 'health'],
  ['Dollar General', 7, /^dollar general\b/, 'consumer'], ['Dollar Tree', 7, /^dollar tree\b/, 'consumer'],
  ['Chipotle', 7, /^chipotle\b/, 'consumer'], ['Kraft Heinz', 7, /^kraft (heinz|foods)\b/, 'consumer'], ['General Mills', 7, /^general mills\b/, 'consumer'],
  ['Marriott', 7, /^marriott( international| hotels( (&|and) resorts)?)?$/, 'consumer'], ['Hilton', 7, /^hilton( worldwide( holdings)?| hotels( (&|and) resorts)?)?$/, 'consumer'],
  ['Southwest Airlines', 7, /^southwest airlines\b/, 'consumer'], ['Union Pacific', 7, /^union pacific\b/, 'industry'],
  // Part of Berkshire Hathaway, named on its own.
  ['GEICO', 7, /^(geico|government employees insurance)\b/, 'finance'],
  // Fox Corporation reads as "Fox" once "Corporation" is trimmed, like any company name.
  ['Fox', 7, /^fox( news( channel| media)?| sports| entertainment| broadcasting( company)?| television stations| business( network)?)?$/, 'entertainment'],
  ['The New York Times', 7, /^new york times\b|^nyt$/, 'media'],
  ['Bloomberg', 7, /^bloomberg( lp| l\.p| news| media| industry group| law| tax| government| intelligence)?$/, 'media'],
  // Ranks 6 to 20 of U.S. News's Best National Universities (2025 edition),
  // with Duke and UC Berkeley above. A school named apart from its university
  // (Wharton, Kellogg, Booth) keeps its own name, as MIT Sloan does.
  ['Caltech', 7, /^(caltech|california institute of technology)$/, 'education'],
  ['Johns Hopkins University', 7, /^johns hopkins( university\b|$| (carey|bloomberg|whiting|krieger|peabody|sais)\b| school of\b)|^jhu$/, 'education'],
  ['Northwestern University', 7, university('northwestern'), 'education'], ['University of Pennsylvania', 7, university('university of pennsylvania|upenn|penn'), 'education'],
  ['Cornell University', 7, university('cornell', '| tech'), 'education'], ['University of Chicago', 7, university('university of chicago|uchicago'), 'education'],
  ['Brown University', 7, university('brown'), 'education'], ['Columbia University', 7, university('columbia university|columbia(?= (business|law|journalism) school$)'), 'education'],
  ['Dartmouth College', 7, university('dartmouth', '| college'), 'education'], ['UCLA', 7, /^(ucla|university of california,? los angeles)$|^ucla anderson\b/, 'education'],
  ['Rice University', 7, university('rice university'), 'education'], ['University of Notre Dame', 7, university('university of notre dame|notre dame'), 'education'],
  ['Vanderbilt University', 7, university('vanderbilt'), 'education'],
];

// ── the public company dataset ─────────────────────────────────────────────
// Organizations the curated list (KNOWN_COMPANIES, above) leaves off, scored
// from public facts.
//
// The curated list is kept to household names, 7 to 10, and "when in doubt, a
// company stays off". That leaves most of the places people actually work
// unknown, and an unknown company scores a neutral 5. This is the second,
// wider list: companies and institutions with a public footprint that most
// people wouldn't know by name, each scored against the scale below from facts
// anyone can check, with its source. It is read after the curated list and
// before the estimate from a network's own headcount, and it grows each release.
//
// The scale, from public facts only:
//   8  Fortune 500 / Forbes Global 2000 / S&P 500 scale (about $20B+ market
//      cap or valuation, or 20,000+ staff), a major pro league, a U.S. federal
//      department; or a studio or park whose staff are such a company's.
//   7  a listed company or a private one valued at about $2–20B, a national TV
//      network, a large health system, a major defense research lab, a
//      university ranked about 11–50 (U.S. News Best National Universities).
//   6  established and notable: a listed small or mid cap, a venture-backed
//      company with about $100M+ raised or 500+ staff, a university ranked
//      about 51–150, a national cultural institution.
//   Smaller than that isn't listed: it would score the neutral 5 anyway.
//
// Rules, as for the curated list:
// - Built from public sources only (exchange listings, reported valuations,
//   rankings, the organizations' own sites). Never from anyone's scan: the app
//   uploads nothing, so nothing a user scans can reach this file.
// - Organizations only; nothing here is about a person. A one-person business
//   or a personal brand is never listed: its name would point at someone.
// - A name several organizations share is listed only in forms that say which
//   ("Hotwire Communications", not "Hotwire"; "Simon Property Group", not
//   "Simon"), and a venue named for a company ("Raymond James Stadium") never
//   matches it. tests/company-data.test.mjs holds the names each must read and
//   the names that must stay their own. It lives here, not in a file of its
//   own, because this module imports nothing (tests/legacy-scores.test.mjs).
//
// Each entry: [name, score, alias, industry, source]. The alias matches the
// name as cleanCompany() reads it (lowercase, from the start); the industry is
// one of lib/companies.js's INDUSTRIES keys; the source is where the score's
// facts come from.

// Most entries match a few exact forms: the names people actually write, each
// matched whole (after cleanCompany's trim: lowercase, no "Inc.", no "the"), so
// a longer name that only starts the same way never reads as one.
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactly = (...forms) => new RegExp(`^(${forms.map((f) => esc(f.toLowerCase())).join('|')})$`);

export const COMPANY_DATA = [
  // 8 — major companies and institutions
  ['Anduril', 8, /^anduril( industries)?$/, 'defense', '$61B valuation, Series H (May 2026)'],
  ['CoreWeave', 8, /^coreweave$/, 'tech', 'NASDAQ: CRWV, about $48B market cap (Sept 2026)'],
  ['GE Vernova', 8, /^ge (vernova|gas power|renewable energy|grid solutions|power)$/, 'industry', 'NYSE: GEV, about $255B market cap, 78,000 staff (2025–26)'],
  ['LSEG', 8, /^(lseg|london stock exchange( group)?|refinitiv|ftse russell)$/, 'finance', 'LSE: LSEG, FTSE 100, 28,500 staff (2025)'],
  ['MLB', 8, /^(mlb|major league baseball)\b(?! (players|the show)\b)/, 'entertainment', 'A major U.S. pro league, about $12B revenue (2024)'],
  ['Raymond James', 8, sponsor('raymond james'), 'finance', 'NYSE: RJF, S&P 500, about $31B market cap (Sept 2026)'],
  ['Siemens Energy', 8, /^siemens (energy|gamesa)\b/, 'industry', 'Xetra: ENR, about 103,000 staff (FY2025)'],
  ['Simon Property Group', 8, /^simon (property( group)?|malls|premium outlets)$/, 'realestate', 'NYSE: SPG, S&P 100, about $78B market cap (Sept 2026)'],
  ['U.S. Department of the Treasury', 8, /^((the )?u\.?s\.? )?(department of the treasury|treasury department)$|^(u\.?s\.? treasury|treasury\.gov)$/, 'defense', 'U.S. federal department, about 116,000 staff (2025)'],
  ['Universal Orlando', 8, /^universal( orlando( resort)?| studios (orlando|florida)|['’]?s (islands of adventure|volcano bay|epic universe)| epic universe)$|^(islands of adventure|epic universe)$/, 'entertainment', 'NBCUniversal (Comcast), about 28,000 staff (2024)'],
  ['Universal Pictures', 8, /^universal (pictures( international)?|filmed entertainment( group)?)$/, 'entertainment', 'NBCUniversal (Comcast), a Big Five Hollywood studio'],
  // 7 — well-known companies and institutions
  ['AdventHealth', 7, /^advent ?health( orlando| medical group)?$|^florida hospital$/, 'health', 'Nonprofit health system, about 100,000 staff (2025)'],
  ['AFRL', 7, /^(afrl|(u\.?s\.? )?air force research lab(oratory)?|afosr|air force office of scientific research)$/, 'defense', 'U.S. Air Force research laboratory, 11,000+ personnel (2024)'],
  ['AmTrust Financial', 7, /^amtrust( financial( services)?| north america| international| insurance)?$/, 'finance', 'Private insurer, about $9B gross written premium (2025)'],
  ['B&Q', 7, /^b ?& ?q$/, 'consumer', 'Kingfisher plc (LSE: KGF), 27,000 staff (2023)'],
  ['Black & Veatch', 7, /^black (&|and) veatch\b/, 'industry', 'Employee-owned engineering firm, about 13,000 staff, $5.1B revenue (2025)'],
  ['CBS Sports', 7, /^cbs ?sports( network| digital| hq| golazo network)?$|^cbssports\.com$/, 'entertainment', 'Paramount Skydance (NASDAQ: PSKY)'],
  ['DISH Network', 8, /^dish( network| tv| media| (&|and) sling( tv)?)?$|^sling tv$/, 'entertainment', 'EchoStar (8, like its parent); DISH and Sling about $9.7B revenue (2025)'],
  ['EliseAI', 7, /^(elise ?ai|meet ?elise)$/, 'tech', '$2.2B valuation, Series E (Aug 2025)'],
  ['fal', 7, /^fal( ?\.ai| ai)?$/, 'tech', '$4.5B valuation, Series D (Dec 2025)'],
  ['Genpact', 7, /^genpact\b/, 'consulting', 'NYSE: G, about 146,500 staff (2025)'],
  ['Hotwire Communications', 7, /^hotwire communications$/, 'tech', 'About $7B valuation in Brookfield deal (June 2025)'],
  ['IMAX', 7, /^imax\b/, 'entertainment', 'NYSE: IMAX, about $3B market cap (Sept 2026)'],
  ['Lionsgate', 7, /^lions ?gate( studios| films| television| entertainment| canada| uk)?$/, 'entertainment', 'NYSE: LION, about $3.2B market cap (Sept 2026)'],
  ['Magnolia Network', 7, /^magnolia network$/, 'media', 'Warner Bros. Discovery national cable network'],
  ['NiCE Cognigy', 7, /^(nice )?cognigy(\.ai)?$/, 'tech', 'NICE Ltd (NASDAQ: NICE), acquired for about $955M (2025)'],
  ['NSWC Dahlgren', 7, /^(naval surface warfare center,? dahlgren( division)?|nswc dahlgren( division)?|nswcdd)$/, 'defense', 'U.S. Navy warfare center, about 4,700 staff'],
  ['Orlando Health', 7, /^orlando (health|regional medical center)$/, 'health', 'Nonprofit health system, about 38,000 staff, $9.9B revenue (FY2025)'],
  ['Polymarket', 7, /^polymarket( us)?$/, 'finance', '$15B valuation, April 2026 round'],
  ['Roku', 7, /^roku$/, 'tech', 'NASDAQ: ROKU, S&P MidCap 400 (2026)'],
  ['TEKsystems', 7, /^tek ?systems( global services)?$/, 'consulting', 'Allegis Group, $7B+ revenue (2025)'],
  ['Temenos', 7, /^temenos( ag| group)?$/, 'tech', 'SIX: TEMN, about 5,100 staff (2025)'],
  ['Tufts University', 7, university('tufts'), 'education', 'U.S. News Best National Universities, 2025 edition: #37'],
  ['UC Irvine', 7, /^(uc irvine|uci|university of california,? irvine)$/, 'education', 'U.S. News Best National Universities: #32 (2026 edition)'],
  ['UC San Diego', 7, /^(uc san diego|ucsd|university of california,? san diego)$/, 'education', 'U.S. News Best National Universities, 2025 edition: #29'],
  ['UC Santa Barbara', 7, /^(uc santa barbara|ucsb|u\.c\. santa barbara|university of california,? santa barbara)$/, 'education', 'U.S. News Best National Universities, 2025 edition: #39'],
  ['Under Armour', 7, /^under ?arm(ou|o)r$/, 'consumer', 'NYSE: UAA, about 13,900 staff (2026)'],
  ['University of Florida', 7, university('university of florida|uf'), 'education', 'U.S. News Best National Universities, 2025 edition: #30'],
  ['Vanta', 7, /^vanta$/, 'tech', '$4.15B valuation, Series D (July 2025)'],
  ['Versant Media', 7, /^versant media( group)?$/, 'media', 'NASDAQ: VSNT, Comcast cable networks spin-off (2026)'],
  ['Whatnot', 7, /^whatnot$/, 'tech', 'Valued at $20B (Aug 2026)'],
  ['WWE', 7, /^(wwe|world wrestling entertainment)$/, 'entertainment', 'TKO Group Holdings (NYSE: TKO)'],
  // 6 — established and notable
  ['A-LIGN', 6, /^a[- ]?lign$/, 'tech', 'About $1B valuation in Hg deal (July 2025)'],
  ['Aleph Group', 6, /^aleph (group|holdings?)$/, 'media', 'About 2,000 staff, about $495M raised'],
  ['Angi', 6, /^(angi( homeservices)?|angie['’]?s list|homeadvisor)$/, 'tech', 'NASDAQ: ANGI, about 2,300 staff (2025)'],
  ['Anomaly', 6, /^anomaly( nyc| new york| la| london| toronto)?$/, 'media', 'Stagwell (NASDAQ: STGW) agency, 800+ staff (2025)'],
  ['Astrion', 6, /^astrion$/, 'defense', 'Defense contractor, 6,000+ staff (2025)'],
  ['Babylist', 6, /^babylist( health)?$/, 'consumer', '$750M revenue (2025)'],
  ['D&AD', 6, /^(d ?& ?ad|design (and|&) art direction)$/, 'media', 'UK design and advertising charity, home of the D&AD Pencils'],
  ['Even Realities', 6, /^even ?realities$/, 'tech', '$1B valuation (July 2026)'],
  ['Focusrite', 6, /^focusrite( plc| group| audio engineering)?$/, 'tech', 'LSE AIM: TUNE'],
  ['Freedom Mortgage', 6, /^freedom mortgage( corp(oration)?)?$/, 'finance', 'Large U.S. mortgage lender, $78B originations (2025)'],
  ['Hard Rock Digital', 6, /^hard rock (digital|bet)$/, 'entertainment', 'Hard Rock International / Seminole Gaming venture, 500+ staff (2026)'],
  ['Kurdistan24', 6, /^kurdistan ?24$/, 'media', 'National broadcaster in five languages (since 2015)'],
  ['Later', 6, /^later(\.com)?$/, 'media', 'Social media platform, Summit Partners-backed ($255M, 2021–22)'],
  ['National Trust for Scotland', 6, /^(the )?national trust for scotland$/, 'nonprofit', 'National conservation charity, 326,000 members'],
  ['NewDay USA', 6, /^new ?day (usa|financial)$/, 'finance', 'U.S. VA-loan lender, about 670 staff (2026)'],
  ['SRM Institute of Science and Technology', 6, /^(srmist|srm ist|srm institute of science (and|&) technology|srm university( chennai)?)$/, 'education', 'NIRF 2025: #11 among Indian universities'],
  ['ThreatLocker', 6, /^threat ?locker$/, 'tech', 'About $468M raised, $190M Series F (July 2026)'],
  // Open, as the old list had it: UCF's colleges and offices ("UCF College of
  // Business", "UCF IT") are UCF, and no other organization starts with its name.
  ['University of Central Florida', 6, /^(ucf|university of central florida)\b/, 'education', 'U.S. News Best National Universities: about #120 (2025–2027 editions)'],
  ['University of Minnesota', 6, university('university of minnesota|umn', '|[-,]? ?twin cities'), 'education', 'U.S. News Best National Universities, 2025 edition: #54'],
  ['University of South Florida', 6, university('university of south florida|usf', '| health| st\\.? petersburg| sarasota[- ]manatee'), 'education', 'U.S. News Best National Universities, 2025 edition: #91'],
  ['Voloridge', 6, /^voloridge( investment management)?$/, 'finance', 'Quantitative investment firm, $36B regulatory AUM (2025)'],
  ['Wales Millennium Centre', 6, /^wales millennium cent(re|er)$/, 'entertainment', 'National arts centre of Wales'],
  // ── grown from public lists (2026-09-28) ──
  // The Fortune 500 (2025), the U.S. federal government and U.S. News's Best
  // National Universities (2025 edition, ranks 21–100), less what either list
  // already had. Each matches only the whole names people write (exactly(),
  // or university() for a university and its schools), researched from the
  // lists themselves and the organizations' own pages; forms shared with
  // anyone else, or that are a common word alone, were left out.
  // Fortune 500 (2025)
  ['McKesson', 8, exactly('mckesson', 'covermymeds'), 'health', 'Fortune 500 (2025): #9, $309.0B revenue'],
  ['Cencora', 8, exactly('cencora', 'amerisourcebergen', 'amerisource bergen'), 'health', 'Fortune 500 (2025): #10, $294.0B revenue'],
  ['Cardinal Health', 8, exactly('cardinal health'), 'health', 'Fortune 500 (2025): #15, $226.8B revenue'],
  ['Centene', 8, exactly('centene', 'wellcare', 'wellcare health plans', 'health net', 'fidelis care', 'ambetter', 'ambetter health', 'superior healthplan'), 'health', 'Fortune 500 (2025): #23, $163.1B revenue'],
  ['Phillips 66', 8, exactly('phillips 66', 'phillips 66 company', 'phillips66'), 'industry', 'Fortune 500 (2025): #28, $145.5B revenue'],
  ['Marathon Petroleum', 8, exactly('marathon petroleum', 'marathon petroleum company', 'mplx'), 'industry', 'Fortune 500 (2025): #29, $140.4B revenue'],
  ['Valero', 8, exactly('valero', 'valero energy', 'valero refining'), 'industry', 'Fortune 500 (2025): #34, $124.0B revenue'],
  ['Archer Daniels Midland', 8, exactly('archer daniels midland', 'archer-daniels-midland company', 'archer daniels midland company', 'archer-daniels-midland', 'adm investor services'), 'industry', 'Fortune 500 (2025): #50, $85.5B revenue'],
  ['Energy Transfer', 8, exactly('energy transfer', 'energy transfer lp', 'energy transfer partners', 'energy transfer equity'), 'industry', 'Fortune 500 (2025): #53, $82.7B revenue'],
  ['Sysco', 8, exactly('sysco', 'freshpoint', 'sygma network'), 'consumer', 'Fortune 500 (2025): #56, $78.8B revenue'],
  ['Publix', 8, exactly('publix', 'publix super markets', 'publix supermarkets', 'publix pharmacy', 'publix liquors'), 'consumer', 'Fortune 500 (2025): #71, $60.2B revenue'],
  ['TD SYNNEX', 8, exactly('td synnex', 'tdsynnex', 'tech data', 'hyve solutions'), 'tech', 'Fortune 500 (2025): #73, $58.5B revenue'],
  ['Enterprise Products', 8, exactly('enterprise products', 'enterprise products partners', 'enterprise products partners lp', 'enterprise products company'), 'industry', 'Fortune 500 (2025): #78, $56.2B revenue'],
  ['Charter Communications', 8, exactly('charter communications', 'charter spectrum', 'spectrum enterprise', 'spectrum reach', 'spectrum business', 'spectrum news', 'spectrum news 13', 'spectrum news ny1', 'spectrum bay news 9', 'cox communications', 'cox business'), 'tech', 'Fortune 500 (2025): #79, $55.1B revenue'],
  ['Performance Food Group', 8, exactly('performance food group', 'performance food group company', 'performance foodservice', 'reinhart foodservice', 'core-mark international', 'core-mark', 'eby-brown', 'cheney brothers', 'cheney bros'), 'consumer', 'Fortune 500 (2025): #80, $54.7B revenue'],
  ['Broadcom', 8, exactly('broadcom', 'symantec'), 'tech', 'Fortune 500 (2025): #88, $52.4B revenue'],
  ['VMware', 8, exactly('vmware', 'vmware by broadcom'), 'tech', 'Broadcom\'s: Fortune 500 (2025): #88, $52.4B revenue'],
  ['Ingram Micro', 8, exactly('ingram micro', 'ingram micro holding'), 'tech', 'Fortune 500 (2025): #95, $48.0B revenue'],
  ['Dow', 8, exactly('dow', 'dow chemical company', 'dow chemical'), 'industry', 'Fortune 500 (2025): #103, $43.0B revenue'],
  ['Thermo Fisher Scientific', 8, exactly('thermo fisher scientific', 'thermo fisher', 'thermofisher', 'thermofisher scientific', 'fisher scientific', 'thermo scientific', 'patheon'), 'health', 'Fortune 500 (2025): #104, $42.9B revenue'],
  ['US Bancorp', 8, exactly('us bancorp', 'u.s. bancorp', 'u.s. bank', 'us bank', 'usbank', 'u.s. bank national association', 'elavon'), 'finance', 'Fortune 500 (2025): #105, $42.7B revenue'],
  ['Abbott', 8, exactly('abbott', 'abbott laboratories', 'abbott labs', 'abbott diagnostics', 'abbott nutrition', 'abbott vascular', 'abbott diabetes care', 'abbott rapid diagnostics', 'abbott molecular'), 'health', 'Fortune 500 (2025): #107, $42.0B revenue'],
  ['Best Buy', 8, exactly('best buy', 'best buy canada'), 'consumer', 'Fortune 500 (2025): #108, $41.5B revenue'],
  ['GE Aerospace', 8, exactly('ge aerospace', 'ge aviation', 'avio aero'), 'defense', 'Fortune 500 (2025): #118, $38.7B revenue'],
  ['Honeywell Technologies', 8, exactly('honeywell technologies', 'honeywell building automation', 'honeywell building technologies', 'honeywell industrial automation', 'honeywell process solutions', 'honeywell uop'), 'industry', 'Fortune 500 (2025): #119, $38.5B revenue'],
  ['Philip Morris International', 8, exactly('philip morris international', 'philip morris products', 'swedish match'), 'consumer', 'Fortune 500 (2025): #121, $37.9B revenue'],
  ['US Foods', 8, exactly('us foods', 'u.s. foods', 'us foods holding', 'usfoods', 'us foodservice', 'u.s. foodservice'), 'consumer', 'Fortune 500 (2025): #122, $37.9B revenue'],
  ['D.R. Horton', 8, exactly('d.r. horton', 'dr horton', 'd. r. horton', 'dhi mortgage'), 'realestate', 'Fortune 500 (2025): #123, $36.8B revenue'],
  ['Lithia Motors', 8, exactly('lithia motors', 'lithia', 'lithia & driveway', 'lithia and driveway'), 'consumer', 'Fortune 500 (2025): #124, $36.6B revenue'],
  ['Mondelez International', 8, exactly('mondelez international', 'mondelēz international', 'mondelez', 'mondelēz', 'nabisco', 'cadbury'), 'consumer', 'Fortune 500 (2025): #125, $36.4B revenue'],
  ['CBRE', 8, exactly('cbre', 'cbre group', 'cb richard ellis', 'cbre investment management', 'trammell crow company'), 'realestate', 'Fortune 500 (2025): #128, $35.8B revenue'],
  ['Lennar', 8, exactly('lennar', 'lennar homes', 'lennar mortgage'), 'realestate', 'Fortune 500 (2025): #129, $35.4B revenue'],
  ['PNC', 8, exactly('pnc', 'pnc bank', 'pnc financial services', 'pnc financial services group'), 'finance', 'Fortune 500 (2025): #131, $34.4B revenue'],
  ['Cummins', 8, exactly('cummins', 'accelera by cummins', 'cummins power generation', 'meritor'), 'industry', 'Fortune 500 (2025): #132, $34.1B revenue'],
  ['PACCAR', 8, exactly('paccar', 'kenworth truck company', 'peterbilt motors', 'peterbilt motors company', 'daf trucks', 'paccar parts', 'paccar financial'), 'industry', 'Fortune 500 (2025): #133, $33.7B revenue'],
  ['Amgen', 8, exactly('amgen', 'horizon therapeutics'), 'health', 'Fortune 500 (2025): #134, $33.4B revenue'],
  ['United Natural Foods', 8, exactly('united natural foods', 'unfi', 'supervalu'), 'consumer', 'Fortune 500 (2025): #138, $31.0B revenue'],
  ['Nucor', 8, exactly('nucor', 'nucor steel', 'vulcraft'), 'industry', 'Fortune 500 (2025): #140, $30.7B revenue'],
  ['Penske Automotive Group', 8, exactly('penske automotive group', 'penske automotive', 'premier truck group', 'sytner group'), 'consumer', 'Fortune 500 (2025): #141, $30.5B revenue'],
  ['Coupang', 8, exactly('coupang', 'farfetch'), 'tech', 'Fortune 500 (2025): #142, $30.3B revenue'],
  ['Hewlett Packard Enterprise', 8, exactly('hewlett packard enterprise', 'hewlett-packard enterprise', 'hpe', 'hpe aruba networking', 'aruba networks', 'hewlett packard labs'), 'tech', 'Fortune 500 (2025): #143, $30.1B revenue'],
  ['Juniper Networks', 8, exactly('juniper networks'), 'tech', 'Hewlett Packard Enterprise\'s: Fortune 500 (2025): #143, $30.1B revenue'],
  ['Duke Energy', 8, exactly('duke energy', 'duke energy florida', 'duke energy carolinas', 'duke energy progress', 'duke energy indiana', 'duke energy ohio', 'piedmont natural gas', 'piedmont natural gas company'), 'industry', 'Fortune 500 (2025): #144, $29.9B revenue'],
  ['Ferguson Enterprises', 8, exactly('ferguson enterprises', 'ferguson'), 'industry', 'Fortune 500 (2025): #146, $29.6B revenue'],
  ['Jabil', 8, exactly('jabil', 'jabil circuit'), 'tech', 'Fortune 500 (2025): #148, $28.9B revenue'],
  ['Gilead Sciences', 8, exactly('gilead sciences', 'gilead', 'kite pharma'), 'health', 'Fortune 500 (2025): #149, $28.8B revenue'],
  ['CarMax', 8, exactly('carmax', 'carmax auto finance', 'edmunds.com'), 'consumer', 'Fortune 500 (2025): #151, $28.2B revenue'],
  ['NRG Energy', 8, exactly('nrg energy', 'reliant energy', 'direct energy', 'green mountain energy'), 'industry', 'Fortune 500 (2025): #153, $28.1B revenue'],
  ['Vivint', 8, exactly('vivint', 'vivint smart home'), 'tech', 'NRG Energy\'s: Fortune 500 (2025): #153, $28.1B revenue'],
  ['Arrow Electronics', 8, exactly('arrow electronics', 'arrow enterprise computing solutions'), 'tech', 'Fortune 500 (2025): #154, $27.9B revenue'],
  ['Baker Hughes', 8, exactly('baker hughes', 'baker hughes company', 'bhge'), 'industry', 'Fortune 500 (2025): #155, $27.8B revenue'],
  ['AIG', 8, exactly('aig', 'american international group'), 'finance', 'Fortune 500 (2025): #157, $27.3B revenue'],
  ['Applied Materials', 8, exactly('applied materials'), 'tech', 'Fortune 500 (2025): #158, $27.2B revenue'],
  ['Occidental Petroleum', 8, exactly('occidental petroleum', 'occidental oil and gas', 'anadarko petroleum', '1pointfive'), 'industry', 'Fortune 500 (2025): #159, $26.9B revenue'],
  ['AutoNation', 8, exactly('autonation', 'autonation usa'), 'consumer', 'Fortune 500 (2025): #160, $26.8B revenue'],
  ['Southern Company', 8, exactly('southern company', 'southern company gas', 'southern company services', 'georgia power', 'georgia power company', 'alabama power', 'alabama power company', 'mississippi power', 'mississippi power company', 'southern nuclear', 'nicor gas'), 'industry', 'Fortune 500 (2025): #161, $26.7B revenue'],
  ['The Hartford', 8, exactly('hartford financial services group', 'hartford insurance group', 'hartford fire insurance company', 'hartford funds'), 'finance', 'Fortune 500 (2025): #162, $26.5B revenue'],
  ['Charles Schwab', 8, exactly('charles schwab', 'schwab', 'td ameritrade'), 'finance', 'Fortune 500 (2025): #164, $26.0B revenue'],
  ['Truist', 8, exactly('truist', 'truist financial', 'truist bank', 'truist securities', 'suntrust', 'suntrust bank', 'bb&t', 'branch banking and trust'), 'finance', 'Fortune 500 (2025): #168, $25.6B revenue'],
  ['Freeport-McMoRan', 8, exactly('freeport-mcmoran', 'freeport mcmoran', 'freeport-mcmoran copper & gold', 'freeport minerals', 'climax molybdenum'), 'industry', 'Fortune 500 (2025): #169, $25.5B revenue'],
  ['Micron Technology', 8, exactly('micron technology', 'micron', 'micron semiconductor'), 'tech', 'Fortune 500 (2025): #170, $25.1B revenue'],
  ['Carrier Global', 8, exactly('carrier global', 'carrier transicold', 'viessmann climate solutions'), 'industry', 'Fortune 500 (2025): #172, $24.8B revenue'],
  ['NextEra Energy', 8, exactly('nextera energy', 'nextera', 'nextera energy resources', 'florida power & light', 'florida power and light', 'florida power & light company', 'fpl group'), 'industry', 'Fortune 500 (2025): #173, $24.8B revenue'],
  ['3M', 8, exactly('3m', '3m company', 'minnesota mining and manufacturing'), 'industry', 'Fortune 500 (2025): #174, $24.6B revenue'],
  ['Marsh McLennan', 8, exactly('marsh mclennan', 'marsh & mclennan companies', 'marsh & mclennan', 'marsh mclennan companies', 'marsh mclennan agency', 'marsh risk', 'marsh re', 'marsh management consulting', 'marsh usa', 'guy carpenter', 'guy carpenter & company'), 'finance', 'Fortune 500 (2025): #175, $24.5B revenue'],
  ['Oliver Wyman', 8, exactly('oliver wyman'), 'finance', 'Marsh McLennan\'s: Fortune 500 (2025): #175, $24.5B revenue'],
  ['PG&E', 8, exactly('pg&e', 'pacific gas and electric company', 'pacific gas and electric', 'pacific gas & electric'), 'industry', 'Fortune 500 (2025): #176, $24.4B revenue'],
  ['Synchrony', 8, exactly('synchrony', 'synchrony financial', 'synchrony bank', 'carecredit'), 'finance', 'Fortune 500 (2025): #178, $24.2B revenue'],
  ['Danaher', 8, exactly('danaher', 'beckman coulter', 'cepheid', 'cytiva', 'leica biosystems', 'leica microsystems', 'sciex', 'integrated dna technologies', 'aldevron', 'abcam'), 'health', 'Fortune 500 (2025): #180, $23.9B revenue'],
  ['Booking Holdings', 8, exactly('booking holdings', 'booking.com', 'priceline', 'priceline.com', 'priceline group', 'agoda'), 'tech', 'Fortune 500 (2025): #182, $23.7B revenue'],
  ['OpenTable', 8, exactly('opentable'), 'tech', 'Booking Holdings\'s: Fortune 500 (2025): #182, $23.7B revenue'],
  ['EOG Resources', 8, exactly('eog resources', 'eog'), 'industry', 'Fortune 500 (2025): #183, $23.7B revenue'],
  ['Quanta Services', 8, exactly('quanta services'), 'industry', 'Fortune 500 (2025): #184, $23.7B revenue'],
  ['Discover Financial', 8, exactly('discover financial', 'discover financial services', 'discover bank', 'discover card'), 'finance', 'Fortune 500 (2025): #185, $23.6B revenue'],
  ['Constellation Energy', 8, exactly('constellation energy', 'constellation energy generation', 'constellation newenergy', 'constellation nuclear', 'calpine', 'exelon generation', 'exelon nuclear'), 'industry', 'Fortune 500 (2025): #186, $23.6B revenue'],
  ['Genuine Parts', 8, exactly('genuine parts', 'genuine parts company', 'motion industries'), 'industry', 'Fortune 500 (2025): #187, $23.5B revenue'],
  ['JLL', 8, exactly('jll', 'jones lang lasalle', 'lasalle investment management'), 'realestate', 'Fortune 500 (2025): #188, $23.4B revenue'],
  ['Lear', 8, exactly('lear'), 'industry', 'Fortune 500 (2025): #189, $23.3B revenue'],
  ['Live Nation Entertainment', 8, exactly('live nation entertainment', 'live nation', 'ticketmaster'), 'entertainment', 'Fortune 500 (2025): #190, $23.2B revenue'],
  ['Sherwin-Williams', 8, exactly('sherwin-williams', 'sherwin williams', 'sherwin-williams company', 'valspar'), 'industry', 'Fortune 500 (2025): #191, $23.1B revenue'],
  ['Exelon', 8, exactly('exelon', 'exelon utilities', 'comed', 'commonwealth edison', 'commonwealth edison company', 'peco energy', 'peco energy company', 'baltimore gas and electric', 'baltimore gas and electric company', 'baltimore gas & electric', 'pepco holdings', 'potomac electric power company', 'delmarva power', 'delmarva power & light', 'atlantic city electric'), 'industry', 'Fortune 500 (2025): #192, $23.0B revenue'],
  ['Macy\'s', 8, exactly('macy\'s', 'macys', 'bloomingdale\'s', 'bloomingdales', 'bluemercury'), 'consumer', 'Fortune 500 (2025): #193, $23.0B revenue'],
  ['Halliburton', 8, exactly('halliburton', 'halliburton company', 'halliburton energy services'), 'industry', 'Fortune 500 (2025): #194, $22.9B revenue'],
  ['Stryker', 8, exactly('stryker', 'inari medical', 'vocera'), 'health', 'Fortune 500 (2025): #195, $22.6B revenue'],
  ['Waste Management', 8, exactly('waste management', 'wm healthcare solutions', 'stericycle'), 'industry', 'Fortune 500 (2025): #197, $22.1B revenue'],
  ['State Street', 8, exactly('state street', 'state street bank and trust company', 'state street bank', 'state street global advisors', 'state street investment management', 'ssga'), 'finance', 'Fortune 500 (2025): #198, $22.1B revenue'],
  ['WESCO International', 8, exactly('wesco international', 'wesco distribution', 'anixter'), 'industry', 'Fortune 500 (2025): #199, $21.8B revenue'],
  ['ONEOK', 8, exactly('oneok', 'magellan midstream partners', 'magellan midstream', 'enlink midstream'), 'industry', 'Fortune 500 (2025): #200, $21.7B revenue'],
  ['Ross Stores', 8, exactly('ross stores', 'ross dress for less', 'dd\'s discounts', 'dds discounts'), 'consumer', 'Fortune 500 (2025): #204, $21.1B revenue'],
  ['Tenet Healthcare', 8, exactly('tenet healthcare', 'tenet health', 'united surgical partners international'), 'health', 'Fortune 500 (2025): #206, $20.7B revenue'],
  ['BJ\'s Wholesale Club', 8, exactly('bj\'s wholesale club', 'bjs wholesale club', 'bj\'s wholesale club holdings', 'bj\'s wholesale', 'bjs wholesale'), 'consumer', 'Fortune 500 (2025): #207, $20.5B revenue'],
  ['Fiserv', 8, exactly('fiserv', 'first data'), 'finance', 'Fortune 500 (2025): #208, $20.5B revenue'],
  ['Altria', 8, exactly('altria', 'altria group', 'philip morris usa', 'njoy'), 'consumer', 'Fortune 500 (2025): #209, $20.4B revenue'],
  ['Becton Dickinson', 8, exactly('becton dickinson', 'becton dickinson and company', 'becton'), 'health', 'Fortune 500 (2025): #211, $20.2B revenue'],
  ['Colgate-Palmolive', 8, exactly('colgate-palmolive', 'colgate palmolive', 'colgate-palmolive company', 'hill\'s pet nutrition', 'hills pet nutrition', 'tom\'s of maine'), 'consumer', 'Fortune 500 (2025): #212, $20.1B revenue'],
  ['Kimberly-Clark', 8, exactly('kimberly-clark', 'kimberly clark', 'kimberly-clark professional'), 'consumer', 'Fortune 500 (2025): #213, $20.1B revenue'],
  ['Parker Hannifin', 8, exactly('parker hannifin', 'parker-hannifin', 'parker aerospace'), 'industry', 'Fortune 500 (2025): #215, $19.9B revenue'],
  ['Cognizant', 8, exactly('cognizant', 'cognizant technology solutions'), 'consulting', 'Fortune 500 (2025): #217, $19.7B revenue'],
  ['American Electric Power', 8, exactly('american electric power', 'aep', 'aep ohio', 'aep texas', 'appalachian power', 'indiana michigan power', 'swepco', 'public service company of oklahoma'), 'industry', 'Fortune 500 (2025): #218, $19.7B revenue'],
  ['GE HealthCare', 8, exactly('ge healthcare', 'ge healthcare technologies', 'ge health care'), 'health', 'Fortune 500 (2025): #219, $19.7B revenue'],
  ['ADP', 8, exactly('adp', 'automatic data processing', 'adp totalsource'), 'tech', 'Fortune 500 (2025): #220, $19.2B revenue'],
  ['Cleveland-Cliffs', 8, exactly('cleveland-cliffs', 'cleveland cliffs', 'ak steel', 'stelco'), 'industry', 'Fortune 500 (2025): #221, $19.2B revenue'],
  ['Aflac', 8, exactly('aflac', 'aflac japan'), 'finance', 'Fortune 500 (2025): #222, $18.9B revenue'],
  ['Newmont', 8, exactly('newmont', 'newmont mining'), 'industry', 'Fortune 500 (2025): #225, $18.7B revenue'],
  ['International Paper', 8, exactly('international paper', 'international paper company', 'ds smith'), 'industry', 'Fortune 500 (2025): #226, $18.6B revenue'],
  ['AutoZone', 8, exactly('autozone', 'auto zone'), 'consumer', 'Fortune 500 (2025): #227, $18.5B revenue'],
  ['PulteGroup', 8, exactly('pultegroup', 'pulte group', 'pulte homes', 'pulte mortgage'), 'realestate', 'Fortune 500 (2025): #229, $17.9B revenue'],
  ['Ameriprise Financial', 8, exactly('ameriprise financial', 'ameriprise', 'ameriprise financial services', 'columbia threadneedle investments', 'columbia threadneedle'), 'finance', 'Fortune 500 (2025): #230, $17.9B revenue'],
  ['ManpowerGroup', 8, exactly('manpowergroup', 'manpower group', 'experis'), 'consulting', 'Fortune 500 (2025): #232, $17.9B revenue'],
  ['PPG', 8, exactly('ppg', 'ppg industries', 'ppg aerospace'), 'industry', 'Fortune 500 (2025): #234, $17.7B revenue'],
  ['Steel Dynamics', 8, exactly('steel dynamics', 'omnisource'), 'industry', 'Fortune 500 (2025): #236, $17.5B revenue'],
  ['Loews', 8, exactly('loews', 'boardwalk pipelines'), 'finance', 'Fortune 500 (2025): #237, $17.5B revenue'],
  ['Loews Hotels', 8, exactly('loews hotels', 'loews hotels &'), 'finance', 'Loews\'s: Fortune 500 (2025): #237, $17.5B revenue'],
  ['Emerson Electric', 8, exactly('emerson electric', 'emerson automation solutions', 'emerson process management', 'aspentech', 'national instruments'), 'industry', 'Fortune 500 (2025): #238, $17.5B revenue'],
  ['Aramark', 8, exactly('aramark'), 'consumer', 'Fortune 500 (2025): #239, $17.4B revenue'],
  ['MGM Resorts', 8, exactly('mgm resorts', 'mgm resorts international', 'mgm grand', 'bellagio', 'mandalay bay', 'aria resort & casino', 'mgm national harbor', 'borgata'), 'entertainment', 'Fortune 500 (2025): #240, $17.2B revenue'],
  ['Vistra Energy', 8, exactly('vistra energy', 'luminant', 'txu energy'), 'industry', 'Fortune 500 (2025): #241, $17.2B revenue'],
  ['W.W. Grainger', 8, exactly('w.w. grainger', 'ww grainger', 'w. w. grainger', 'grainger industrial supply'), 'industry', 'Fortune 500 (2025): #243, $17.2B revenue'],
  ['Jacobs Solutions', 8, exactly('jacobs solutions'), 'industry', 'Fortune 500 (2025): #245, $17.0B revenue'],
  ['Jacobs Engineering', 8, exactly('jacobs engineering', 'jacobs engineering group'), 'industry', 'Jacobs Solutions\'s: Fortune 500 (2025): #245, $17.0B revenue'],
  ['Kiewit', 8, exactly('kiewit', 'peter kiewit sons', 'kiewit infrastructure', 'kiewit power constructors', 'kiewit building group', 'kiewit engineering group'), 'industry', 'Fortune 500 (2025): #247, $16.8B revenue'],
  ['Boston Scientific', 8, exactly('boston scientific'), 'health', 'Fortune 500 (2025): #248, $16.7B revenue'],
  ['O\'Reilly Auto Parts', 8, exactly('o\'reilly auto parts', 'oreilly auto parts', 'o\'reilly automotive', 'oreilly automotive'), 'consumer', 'Fortune 500 (2025): #249, $16.7B revenue'],
  ['Markel', 8, exactly('markel', 'markel group', 'markel specialty', 'markel ventures'), 'finance', 'Fortune 500 (2025): #251, $16.6B revenue'],
  ['Whirlpool', 8, exactly('whirlpool'), 'industry', 'Fortune 500 (2025): #252, $16.6B revenue'],
  ['Builders FirstSource', 8, exactly('builders firstsource', 'builders first source'), 'industry', 'Fortune 500 (2025): #254, $16.4B revenue'],
  ['Targa Resources', 8, exactly('targa resources', 'targa resources partners', 'targa'), 'industry', 'Fortune 500 (2025): #256, $16.4B revenue'],
  ['Fluor', 8, exactly('fluor'), 'industry', 'Fortune 500 (2025): #257, $16.3B revenue'],
  ['AECOM', 8, exactly('aecom', 'aecom tishman'), 'industry', 'Fortune 500 (2025): #259, $16.3B revenue'],
  ['Edward Jones', 8, exactly('edward jones', 'edward jones investments', 'jones financial companies'), 'finance', 'Fortune 500 (2025): #260, $16.3B revenue'],
  ['Kohl\'s', 8, exactly('kohl\'s', 'kohls'), 'consumer', 'Fortune 500 (2025): #261, $16.2B revenue'],
  ['Principal Financial Group', 8, exactly('principal financial group', 'principal financial', 'principal global investors', 'principal asset management'), 'finance', 'Fortune 500 (2025): #263, $16.1B revenue'],
  ['Dominion Energy', 8, exactly('dominion energy', 'dominion energy virginia', 'dominion energy south carolina'), 'industry', 'Fortune 500 (2025): #264, $16.1B revenue'],
  ['Kyndryl', 8, exactly('kyndryl', 'kyndryl holdings'), 'tech', 'Fortune 500 (2025): #265, $16.1B revenue'],
  ['Republic Services', 8, exactly('republic services'), 'industry', 'Fortune 500 (2025): #266, $16.0B revenue'],
  ['Devon Energy', 8, exactly('devon energy', 'coterra energy', 'coterra'), 'industry', 'Fortune 500 (2025): #267, $15.9B revenue'],
  ['Illinois Tool Works', 8, exactly('illinois tool works', 'itw'), 'industry', 'Fortune 500 (2025): #268, $15.9B revenue'],
  ['Northern Trust', 8, exactly('northern trust', 'northern trust company', 'northern trust asset management'), 'finance', 'Fortune 500 (2025): #269, $15.9B revenue'],
  ['Universal Health Services', 8, exactly('universal health services'), 'health', 'Fortune 500 (2025): #271, $15.8B revenue'],
  ['EchoStar', 8, exactly('echostar', 'hughes network systems'), 'tech', 'Fortune 500 (2025): #273, $15.8B revenue'],
  ['Ecolab', 8, exactly('ecolab', 'nalco water'), 'industry', 'Fortune 500 (2025): #274, $15.7B revenue'],
  ['Cheniere Energy', 8, exactly('cheniere energy', 'cheniere', 'cheniere energy partners'), 'industry', 'Fortune 500 (2025): #275, $15.7B revenue'],
  ['Texas Instruments', 8, exactly('texas instruments'), 'tech', 'Fortune 500 (2025): #277, $15.6B revenue'],
  ['U.S. Steel', 8, exactly('u.s. steel', 'united states steel', 'us steel', 'big river steel'), 'industry', 'Fortune 500 (2025): #278, $15.6B revenue'],
  ['Estée Lauder', 8, exactly('estée lauder', 'estee lauder', 'estée lauder companies', 'estee lauder companies', 'mac cosmetics'), 'consumer', 'Fortune 500 (2025): #279, $15.6B revenue'],
  ['Kenvue', 8, exactly('kenvue'), 'consumer', 'Fortune 500 (2025): #281, $15.5B revenue'],
  ['IQVIA', 8, exactly('iqvia', 'iqvia holdings', 'quintiles', 'quintilesims', 'ims health'), 'health', 'Fortune 500 (2025): #282, $15.4B revenue'],
  ['Stanley Black & Decker', 8, exactly('stanley black & decker', 'stanley black and decker', 'black & decker', 'black and decker', 'dewalt'), 'industry', 'Fortune 500 (2025): #283, $15.4B revenue'],
  ['Keurig Dr Pepper', 8, exactly('keurig dr pepper', 'keurig', 'keurig green mountain', 'dr pepper snapple group', 'dr pepper'), 'consumer', 'Fortune 500 (2025): #284, $15.4B revenue'],
  ['United Rentals', 8, exactly('united rentals'), 'industry', 'Fortune 500 (2025): #285, $15.3B revenue'],
  ['Con Edison', 8, exactly('con edison', 'consolidated edison', 'con ed', 'coned', 'orange and rockland utilities', 'orange & rockland'), 'industry', 'Fortune 500 (2025): #286, $15.3B revenue'],
  ['Amphenol', 8, exactly('amphenol'), 'tech', 'Fortune 500 (2025): #287, $15.2B revenue'],
  ['Baxter International', 8, exactly('baxter international', 'baxter healthcare'), 'health', 'Fortune 500 (2025): #288, $15.1B revenue'],
  ['Kinder Morgan', 8, exactly('kinder morgan'), 'industry', 'Fortune 500 (2025): #289, $15.1B revenue'],
  ['Nordstrom', 8, exactly('nordstrom', 'nordstrom rack'), 'consumer', 'Fortune 500 (2025): #291, $15.0B revenue'],
  ['Supermicro', 8, exactly('supermicro', 'super micro computer', 'super micro'), 'tech', 'Fortune 500 (2025): #292, $15.0B revenue'],
  ['First Citizens BancShares', 8, exactly('first citizens bancshares', 'first-citizens bank & trust', 'first citizens bank & trust', 'first citizens bank and trust', 'silicon valley bank', 'cit bank'), 'finance', 'Fortune 500 (2025): #293, $15.0B revenue'],
  ['Lam Research', 8, exactly('lam research'), 'tech', 'Fortune 500 (2025): #295, $14.9B revenue'],
  ['Tractor Supply', 8, exactly('tractor supply', 'tractor supply company', 'petsense'), 'consumer', 'Fortune 500 (2025): #296, $14.9B revenue'],
  ['Casey\'s General Stores', 8, exactly('casey\'s general stores', 'caseys general stores', 'casey\'s general store'), 'consumer', 'Fortune 500 (2025): #297, $14.9B revenue'],
  ['Viatris', 8, exactly('viatris', 'mylan', 'mylan pharmaceuticals'), 'health', 'Fortune 500 (2025): #298, $14.7B revenue'],
  ['EMCOR', 8, exactly('emcor', 'emcor group', 'emcor services'), 'industry', 'Fortune 500 (2025): #300, $14.6B revenue'],
  ['CSX', 8, exactly('csx', 'csx transportation', 'csxt', 'csx intermodal terminals'), 'industry', 'Fortune 500 (2025): #301, $14.5B revenue'],
  ['LKQ', 8, exactly('lkq', 'lkq europe', 'lkq pick your part', 'euro car parts'), 'industry', 'Fortune 500 (2025): #302, $14.4B revenue'],
  ['Otis Worldwide', 8, exactly('otis worldwide', 'otis elevator company', 'otis elevator', 'otis elevators'), 'industry', 'Fortune 500 (2025): #303, $14.3B revenue'],
  ['S&P Global', 8, exactly('s&p global', 'standard & poor\'s', 'standard and poor\'s', 's&p global ratings', 's&p global market intelligence', 's&p global commodity insights', 's&p dow jones indices', 'platts', 'mcgraw hill financial'), 'finance', 'Fortune 500 (2025): #305, $14.2B revenue'],
  ['Regeneron', 8, exactly('regeneron', 'regeneron pharmaceuticals', 'regeneron genetics center'), 'health', 'Fortune 500 (2025): #306, $14.2B revenue'],
  ['BorgWarner', 8, exactly('borgwarner', 'borg warner', 'borg-warner'), 'industry', 'Fortune 500 (2025): #307, $14.1B revenue'],
  ['Textron', 8, exactly('textron', 'textron aviation', 'textron systems', 'bell textron', 'bell helicopter', 'bell flight', 'cessna', 'beechcraft', 'textron specialized vehicles', 'textron eaviation'), 'defense', 'Fortune 500 (2025): #311, $13.7B revenue'],
  ['Expedia Group', 8, exactly('expedia group', 'expedia', 'vrbo', 'homeaway', 'hotels.com', 'orbitz', 'travelocity'), 'tech', 'Fortune 500 (2025): #312, $13.7B revenue'],
  ['Fidelity National Financial', 8, exactly('fidelity national financial', 'fnf', 'fidelity national title group', 'fidelity national title', 'chicago title', 'chicago title insurance company', 'commonwealth land title', 'ticor title', 'alamo title'), 'finance', 'Fortune 500 (2025): #313, $13.7B revenue'],
  ['Carvana', 8, exactly('carvana'), 'consumer', 'Fortune 500 (2025): #314, $13.7B revenue'],
  ['DXC Technology', 8, exactly('dxc technology', 'dxc technology company', 'dxc', 'luxoft'), 'tech', 'Fortune 500 (2025): #315, $13.7B revenue'],
  ['W. R. Berkley', 8, exactly('w. r. berkley', 'w.r. berkley', 'wr berkley'), 'finance', 'Fortune 500 (2025): #316, $13.6B revenue'],
  ['M&T Bank', 8, exactly('m&t bank', 'm & t bank', 'm&t', 'manufacturers and traders trust company', 'wilmington trust'), 'finance', 'Fortune 500 (2025): #317, $13.5B revenue'],
  ['Dick\'s Sporting Goods', 8, exactly('dick\'s sporting goods', 'dicks sporting goods', 'dick\'s house of sport', 'golf galaxy'), 'consumer', 'Fortune 500 (2025): #318, $13.4B revenue'],
  ['Xcel Energy', 8, exactly('xcel energy', 'northern states power company', 'public service company of colorado', 'southwestern public service company'), 'industry', 'Fortune 500 (2025): #319, $13.4B revenue'],
  ['Fifth Third', 8, exactly('fifth third', 'fifth third bancorp', 'fifth third bank', 'fifth third securities', 'comerica bank', 'comerica'), 'finance', 'Fortune 500 (2025): #320, $13.3B revenue'],
  ['Sempra', 8, exactly('sempra', 'sempra energy', 'san diego gas & electric', 'sdg&e', 'southern california gas company', 'socalgas', 'southern california gas'), 'industry', 'Fortune 500 (2025): #322, $13.2B revenue'],
  ['Corning', 8, exactly('corning', 'corning optical communications', 'corning life sciences'), 'industry', 'Fortune 500 (2025): #324, $13.1B revenue'],
  ['Lumen Technologies', 8, exactly('lumen technologies', 'centurylink', 'century link'), 'tech', 'Fortune 500 (2025): #325, $13.1B revenue'],
  ['FirstEnergy', 8, exactly('firstenergy', 'first energy', 'jersey central power & light', 'jcp&l', 'ohio edison', 'met-ed', 'penelec', 'potomac edison', 'mon power', 'west penn power', 'toledo edison'), 'industry', 'Fortune 500 (2025): #326, $13.0B revenue'],
  ['Hess', 8, exactly('hess'), 'industry', 'Fortune 500 (2025): #327, $13.0B revenue'],
  ['Labcorp', 8, exactly('labcorp', 'labcorp holdings', 'laboratory corporation of america', 'laboratory corporation of america holdings', 'labcorp diagnostics'), 'health', 'Fortune 500 (2025): #328, $13.0B revenue'],
  ['Western Digital', 8, exactly('western digital', 'western digital technologies'), 'tech', 'Fortune 500 (2025): #329, $13.0B revenue'],
  ['DaVita', 8, exactly('davita', 'davita kidney care', 'davita healthcare partners'), 'health', 'Fortune 500 (2025): #331, $12.8B revenue'],
  ['Henry Schein', 8, exactly('henry schein', 'henry schein dental', 'henry schein medical', 'henry schein one'), 'health', 'Fortune 500 (2025): #333, $12.7B revenue'],
  ['Ryder System', 8, exactly('ryder system', 'ryder truck rental', 'ryder fleet management solutions', 'ryder supply chain solutions', 'ryder last mile'), 'industry', 'Fortune 500 (2025): #334, $12.6B revenue'],
  ['Community Health Systems', 8, exactly('community health systems', 'chspsc'), 'health', 'Fortune 500 (2025): #335, $12.6B revenue'],
  ['DTE Energy', 8, exactly('dte energy', 'dte energy company', 'dte electric', 'dte gas', 'detroit edison', 'michcon'), 'industry', 'Fortune 500 (2025): #337, $12.5B revenue'],
  ['LPL Financial', 8, exactly('lpl financial', 'lpl financial holdings', 'lpl', 'linsco private ledger'), 'finance', 'Fortune 500 (2025): #340, $12.4B revenue'],
  ['Citizens Financial Group', 8, exactly('citizens financial group', 'citizens jmp'), 'finance', 'Fortune 500 (2025): #341, $12.4B revenue'],
  ['MasTec', 8, exactly('mastec', 'mastec north america', 'mastec network solutions', 'mastec clean energy & infrastructure', 'mastec power delivery'), 'industry', 'Fortune 500 (2025): #342, $12.3B revenue'],
  ['Berry Global', 8, exactly('berry global', 'berry global group', 'berry plastics'), 'industry', 'Fortune 500 (2025): #344, $12.3B revenue'],
  ['Norfolk Southern', 8, exactly('norfolk southern', 'norfolk southern railway'), 'industry', 'Fortune 500 (2025): #346, $12.1B revenue'],
  ['Air Products', 8, exactly('air products', 'air products and chemicals', 'air products & chemicals'), 'industry', 'Fortune 500 (2025): #347, $12.1B revenue'],
  ['J.B. Hunt', 8, exactly('j.b. hunt', 'j.b. hunt transport services', 'j.b. hunt transport', 'jb hunt', 'j. b. hunt', 'jb hunt transport services', 'jbhunt'), 'industry', 'Fortune 500 (2025): #348, $12.1B revenue'],
  ['Huntington Bancshares', 8, exactly('huntington bancshares', 'huntington national bank', 'huntington bank'), 'finance', 'Fortune 500 (2025): #351, $12.0B revenue'],
  ['Eversource', 8, exactly('eversource', 'eversource energy', 'northeast utilities', 'nstar', 'connecticut light & power', 'public service of new hampshire'), 'industry', 'Fortune 500 (2025): #353, $11.9B revenue'],
  ['Entergy', 8, exactly('entergy', 'entergy louisiana', 'entergy arkansas', 'entergy texas', 'entergy mississippi', 'entergy new orleans'), 'industry', 'Fortune 500 (2025): #355, $11.9B revenue'],
  ['Crown Holdings', 8, exactly('crown holdings', 'crown cork & seal', 'crown cork and seal', 'crown cork & seal company'), 'industry', 'Fortune 500 (2025): #359, $11.8B revenue'],
  ['Avis Budget Group', 8, exactly('avis budget group', 'avis budget', 'avis car rental', 'avis rent a car', 'budget rent a car', 'budget car rental', 'zipcar'), 'consumer', 'Fortune 500 (2025): #360, $11.8B revenue'],
  ['Intercontinental Exchange', 8, exactly('intercontinental exchange', 'new york stock exchange', 'nyse', 'ice mortgage technology', 'ice futures', 'ice data services', 'ice clear'), 'finance', 'Fortune 500 (2025): #361, $11.8B revenue'],
  ['Alaska Air Group', 8, exactly('alaska air group', 'alaska air', 'horizon air'), 'consumer', 'Fortune 500 (2025): #362, $11.7B revenue'],
  ['Alaska Airlines', 8, exactly('alaska airlines'), 'consumer', 'Alaska Air Group\'s: Fortune 500 (2025): #362, $11.7B revenue'],
  ['Hawaiian Airlines', 8, exactly('hawaiian airlines'), 'consumer', 'Alaska Air Group\'s: Fortune 500 (2025): #362, $11.7B revenue'],
  ['GXO Logistics', 8, exactly('gxo logistics', 'gxo', 'wincanton', 'clipper logistics'), 'industry', 'Fortune 500 (2025): #363, $11.7B revenue'],
  ['AGCO', 8, exactly('agco', 'massey ferguson', 'valtra', 'precision planting'), 'industry', 'Fortune 500 (2025): #364, $11.7B revenue'],
  ['Arthur J. Gallagher', 8, exactly('arthur j. gallagher', 'arthur j. gallagher &', 'arthur j gallagher', 'ajg', 'gallagher re', 'gallagher bassett', 'gallagher benefit services'), 'finance', 'Fortune 500 (2025): #367, $11.6B revenue'],
  ['Huntington Ingalls Industries', 8, exactly('huntington ingalls industries', 'huntington ingalls', 'hii', 'newport news shipbuilding', 'ingalls shipbuilding', 'hii mission technologies'), 'defense', 'Fortune 500 (2025): #368, $11.5B revenue'],
  ['International Flavors & Fragrances', 8, exactly('international flavors & fragrances', 'international flavors and fragrances'), 'industry', 'Fortune 500 (2025): #369, $11.5B revenue'],
  ['Darden Restaurants', 8, exactly('darden restaurants', 'olive garden', 'longhorn steakhouse', 'capital grille', 'yard house', 'cheddar\'s scratch kitchen'), 'consumer', 'Fortune 500 (2025): #370, $11.4B revenue'],
  ['Cincinnati Financial', 8, exactly('cincinnati financial', 'cincinnati insurance companies', 'cincinnati insurance company', 'cincinnati insurance'), 'finance', 'Fortune 500 (2025): #371, $11.3B revenue'],
  ['Yum China', 8, exactly('yum china', 'yum china holdings', 'kfc china', 'pizza hut china'), 'consumer', 'Fortune 500 (2025): #373, $11.3B revenue'],
  ['Las Vegas Sands', 8, exactly('las vegas sands', 'sands china', 'marina bay sands', 'venetian macao'), 'entertainment', 'Fortune 500 (2025): #374, $11.3B revenue'],
  ['Ulta Beauty', 8, exactly('ulta beauty', 'ulta', 'ulta salon'), 'consumer', 'Fortune 500 (2025): #375, $11.3B revenue'],
  ['Caesars Entertainment', 8, exactly('caesars entertainment', 'caesars', 'caesars palace', 'caesars sportsbook', 'eldorado resorts'), 'entertainment', 'Fortune 500 (2025): #376, $11.3B revenue'],
  ['BrightSpring Health Services', 8, exactly('brightspring health services', 'brightspring', 'brightspring health', 'pharmerica'), 'health', 'Fortune 500 (2025): #377, $11.3B revenue'],
  ['The Hershey Company', 8, exactly('hershey company', 'hershey\'s', 'hershey foods'), 'consumer', 'Fortune 500 (2025): #379, $11.2B revenue'],
  ['Diamondback Energy', 8, exactly('diamondback energy'), 'industry', 'Fortune 500 (2025): #383, $11.1B revenue'],
  ['American Tower', 8, exactly('american tower', 'coresite'), 'realestate', 'Fortune 500 (2025): #384, $11.0B revenue'],
  ['Vertex Pharmaceuticals', 8, exactly('vertex pharmaceuticals', 'vertex pharma'), 'health', 'Fortune 500 (2025): #385, $11.0B revenue'],
  ['Owens Corning', 8, exactly('owens corning', 'owens-corning', 'owens corning fiberglas'), 'industry', 'Fortune 500 (2025): #387, $11.0B revenue'],
  ['Advance Auto Parts', 8, exactly('advance auto parts', 'advance auto', 'advance stores company'), 'consumer', 'Fortune 500 (2025): #389, $10.9B revenue'],
  ['Mohawk Industries', 8, exactly('mohawk industries', 'mohawk flooring', 'mohawk home', 'daltile', 'dal-tile', 'unilin', 'pergo'), 'industry', 'Fortune 500 (2025): #391, $10.8B revenue'],
  ['Motorola Solutions', 8, exactly('motorola solutions', 'avigilon', 'silvus technologies'), 'tech', 'Fortune 500 (2025): #392, $10.8B revenue'],
  ['Burlington Stores', 8, exactly('burlington stores', 'burlington coat factory', 'burlington coat factory warehouse'), 'consumer', 'Fortune 500 (2025): #399, $10.6B revenue'],
  ['Expeditors International', 8, exactly('expeditors international', 'expeditors international of washington', 'expeditors intl'), 'industry', 'Fortune 500 (2025): #400, $10.6B revenue'],
  ['Lululemon', 8, exactly('lululemon', 'lululemon athletica'), 'consumer', 'Fortune 500 (2025): #401, $10.59B revenue'],
  ['FIS', 8, exactly('fis', 'fidelity national information services', 'fis global', 'tsys', 'total system services'), 'finance', 'Fortune 500 (2025): #402, $10.54B revenue'],
  ['The Williams Companies', 8, exactly('williams companies'), 'industry', 'Fortune 500 (2025): #404, $10.50B revenue'],
  ['Autoliv', 8, exactly('autoliv'), 'industry', 'Fortune 500 (2025): #407, $10.39B revenue'],
  ['Wabtec', 8, exactly('wabtec', 'westinghouse air brake technologies', 'ge transportation'), 'industry', 'Fortune 500 (2025): #408, $10.39B revenue'],
  ['PSEG', 8, exactly('pseg', 'public service enterprise group', 'pse&g', 'public service electric and gas company', 'public service electric and gas', 'pseg long island', 'pseg nuclear'), 'industry', 'Fortune 500 (2025): #409, $10.29B revenue'],
  ['eBay', 8, exactly('ebay'), 'tech', 'Fortune 500 (2025): #411, $10.28B revenue'],
  ['Global Payments', 8, exactly('global payments', 'worldpay', 'heartland payment systems'), 'finance', 'Fortune 500 (2025): #413, $10.11B revenue'],
  ['NewsCorp', 8, exactly('newscorp', 'new york post', 'news uk', 'news corp australia'), 'media', 'Fortune 500 (2025): #414, $10.09B revenue'],
  ['Dow Jones', 8, exactly('dow jones', 'dow jones & company'), 'media', 'NewsCorp\'s: Fortune 500 (2025): #414, $10.09B revenue'],
  ['The Wall Street Journal', 8, exactly('wall street journal', 'wsj'), 'media', 'NewsCorp\'s: Fortune 500 (2025): #414, $10.09B revenue'],
  ['HarperCollins', 8, exactly('harpercollins', 'harpercollins publishers'), 'media', 'NewsCorp\'s: Fortune 500 (2025): #414, $10.09B revenue'],
  ['Thor Industries', 8, exactly('thor industries', 'jayco', 'keystone rv', 'thor motor coach', 'tiffin motorhomes'), 'industry', 'Fortune 500 (2025): #415, $10.04B revenue'],
  ['Constellation Brands', 8, exactly('constellation brands'), 'consumer', 'Fortune 500 (2025): #418, $9.96B revenue'],
  ['Quest Diagnostics', 8, exactly('quest diagnostics'), 'health', 'Fortune 500 (2025): #419, $9.87B revenue'],
  ['KLA', 8, exactly('kla', 'kla-tencor', 'kla tencor'), 'tech', 'Fortune 500 (2025): #420, $9.81B revenue'],
  ['Biogen', 8, exactly('biogen', 'biogen idec'), 'health', 'Fortune 500 (2025): #424, $9.68B revenue'],
  ['Concentrix', 8, exactly('concentrix', 'webhelp', 'convergys'), 'consulting', 'Fortune 500 (2025): #426, $9.62B revenue'],
  ['Cintas', 8, exactly('cintas'), 'industry', 'Fortune 500 (2025): #427, $9.60B revenue'],
  ['Analog Devices', 8, exactly('analog devices', 'maxim integrated', 'linear technology'), 'tech', 'Fortune 500 (2025): #430, $9.43B revenue'],
  ['Interactive Brokers', 8, exactly('interactive brokers', 'interactive brokers group', 'ibkr'), 'finance', 'Fortune 500 (2025): #432, $9.38B revenue'],
  ['Regions Financial', 8, exactly('regions financial', 'regions bank'), 'finance', 'Fortune 500 (2025): #433, $9.37B revenue'],
  ['Zoetis', 8, exactly('zoetis'), 'health', 'Fortune 500 (2025): #435, $9.26B revenue'],
  ['Hertz', 8, exactly('hertz', 'hertz global holdings', 'dollar thrifty automotive group', 'thrifty car rental', 'dollar rent a car'), 'consumer', 'Fortune 500 (2025): #440, $9.05B revenue'],
  ['NOV', 8, exactly('nov', 'national oilwell varco'), 'industry', 'Fortune 500 (2025): #443, $8.87B revenue'],
  ['Graphic Packaging', 8, exactly('graphic packaging', 'graphic packaging holding company', 'graphic packaging international'), 'industry', 'Fortune 500 (2025): #444, $8.81B revenue'],
  ['Avery Dennison', 8, exactly('avery dennison'), 'industry', 'Fortune 500 (2025): #445, $8.76B revenue'],
  ['Equinix', 8, exactly('equinix'), 'tech', 'Fortune 500 (2025): #446, $8.75B revenue'],
  ['PVH', 8, exactly('pvh', 'phillips-van heusen'), 'consumer', 'Fortune 500 (2025): #449, $8.65B revenue'],
  ['CenterPoint Energy', 8, exactly('centerpoint energy'), 'industry', 'Fortune 500 (2025): #450, $8.64B revenue'],
  ['WEC Energy Group', 8, exactly('wec energy group', 'we energies', 'wisconsin public service', 'wisconsin electric power company'), 'industry', 'Fortune 500 (2025): #451, $8.60B revenue'],
  ['Xylem', 8, exactly('xylem', 'evoqua water technologies', 'evoqua'), 'industry', 'Fortune 500 (2025): #452, $8.56B revenue'],
  ['PPL', 8, exactly('ppl', 'ppl electric utilities', 'lg&e and ku energy', 'lg&e', 'louisville gas and electric company', 'kentucky utilities', 'rhode island energy'), 'industry', 'Fortune 500 (2025): #454, $8.46B revenue'],
  ['ABM Industries', 8, exactly('abm industries'), 'industry', 'Fortune 500 (2025): #458, $8.36B revenue'],
  ['Intuitive Surgical', 8, exactly('intuitive surgical'), 'health', 'Fortune 500 (2025): #459, $8.35B revenue'],
  ['Rockwell Automation', 8, exactly('rockwell automation'), 'industry', 'Fortune 500 (2025): #461, $8.26B revenue'],
  ['Solventum', 8, exactly('solventum'), 'health', 'Fortune 500 (2025): #462, $8.25B revenue'],
  ['Prologis', 8, exactly('prologis'), 'realestate', 'Fortune 500 (2025): #465, $8.20B revenue'],
  ['XPO', 8, exactly('xpo', 'xpo logistics'), 'industry', 'Fortune 500 (2025): #468, $8.07B revenue'],
  ['Palo Alto Networks', 8, exactly('palo alto networks', 'cyberark', 'cyberark software'), 'tech', 'Fortune 500 (2025): #470, $8.03B revenue'],
  ['Vertiv', 8, exactly('vertiv', 'vertiv holdings'), 'industry', 'Fortune 500 (2025): #471, $8.01B revenue'],
  ['Welltower', 8, exactly('welltower'), 'realestate', 'Fortune 500 (2025): #472, $7.99B revenue'],
  ['Foot Locker', 8, exactly('foot locker', 'footlocker', 'champs sports', 'kids foot locker'), 'consumer', 'Fortune 500 (2025): #473, $7.99B revenue'],
  ['TransDigm', 8, exactly('transdigm', 'transdigm group'), 'defense', 'Fortune 500 (2025): #475, $7.94B revenue'],
  ['KBR', 8, exactly('kbr', 'kellogg brown & root', 'kellogg brown and root'), 'defense', 'Fortune 500 (2025): #480, $7.74B revenue'],
  ['Sprouts Farmers Market', 8, exactly('sprouts farmers market', 'sprouts farmers markets'), 'consumer', 'Fortune 500 (2025): #481, $7.72B revenue'],
  ['Williams-Sonoma', 8, exactly('williams-sonoma', 'williams sonoma', 'pottery barn', 'pottery barn kids', 'west elm', 'pbteen'), 'consumer', 'Fortune 500 (2025): #482, $7.71B revenue'],
  ['CACI', 8, exactly('caci', 'caci international'), 'defense', 'Fortune 500 (2025): #484, $7.66B revenue'],
  ['Microchip Technology', 8, exactly('microchip technology', 'microsemi', 'atmel'), 'tech', 'Fortune 500 (2025): #485, $7.63B revenue'],
  ['Newell Brands', 8, exactly('newell brands', 'newell rubbermaid', 'rubbermaid', 'rubbermaid commercial products', 'yankee candle', 'yankee candle company'), 'consumer', 'Fortune 500 (2025): #487, $7.58B revenue'],
  ['Sanmina', 8, exactly('sanmina', 'sanmina-sci'), 'tech', 'Fortune 500 (2025): #489, $7.57B revenue'],
  ['Yum Brands', 8, exactly('yum brands'), 'consumer', 'Fortune 500 (2025): #491, $7.55B revenue'],
  ['Fastenal', 8, exactly('fastenal', 'fastenal company'), 'industry', 'Fortune 500 (2025): #492, $7.55B revenue'],
  ['CMS Energy', 8, exactly('cms energy', 'consumers energy'), 'industry', 'Fortune 500 (2025): #493, $7.51B revenue'],
  ['Monster Beverage', 8, exactly('monster beverage', 'monster energy', 'monster energy company'), 'consumer', 'Fortune 500 (2025): #494, $7.49B revenue'],
  ['SAIC', 8, exactly('saic', 'science applications international'), 'defense', 'Fortune 500 (2025): #496, $7.48B revenue'],
  ['Howmet Aerospace', 8, exactly('howmet aerospace', 'howmet'), 'defense', 'Fortune 500 (2025): #498, $7.43B revenue'],
  ['Vulcan Materials', 8, exactly('vulcan materials', 'vulcan materials company'), 'industry', 'Fortune 500 (2025): #500, $7.42B revenue'],
  ['StoneX Group', 7, exactly('stonex group', 'stonex financial', 'stonex markets', 'intl fcstone', 'fcstone', 'gain capital', 'forex.com'), 'finance', 'Fortune 500 (2025): #42, $99.9B revenue'],
  ['Plains All American', 7, exactly('plains all american', 'plains all american pipeline', 'plains gp holdings'), 'industry', 'Fortune 500 (2025): #92, $50.1B revenue'],
  ['TIAA', 7, exactly('tiaa', 'teachers insurance and annuity association', 'tiaa-cref', 'tiaa cref'), 'finance', 'Fortune 500 (2025): #98, $46.9B revenue'],
  ['Nuveen', 7, exactly('nuveen', 'nuveen investments'), 'finance', 'TIAA\'s: Fortune 500 (2025): #98, $46.9B revenue'],
  ['MassMutual', 7, exactly('massmutual', 'massachusetts mutual life insurance company', 'mass mutual', 'massmutual financial group', 'massmutual ascend'), 'finance', 'Fortune 500 (2025): #102, $43.1B revenue'],
  ['World Kinect', 7, exactly('world kinect', 'world fuel services', 'kinect energy'), 'industry', 'Fortune 500 (2025): #106, $42.2B revenue'],
  ['Northwestern Mutual', 7, exactly('northwestern mutual', 'northwestern mutual life insurance company', 'northwestern mutual life', 'northwestern mutual wealth management company'), 'finance', 'Fortune 500 (2025): #109, $41.4B revenue'],
  ['Molina Healthcare', 7, exactly('molina healthcare', 'molina'), 'health', 'Fortune 500 (2025): #111, $40.7B revenue'],
  ['PBF Energy', 7, exactly('pbf energy', 'pbf logistics'), 'industry', 'Fortune 500 (2025): #135, $33.1B revenue'],
  ['GuideWell', 7, exactly('guidewell', 'guidewell mutual holding', 'florida blue', 'blue cross blue shield of florida', 'triple-s management'), 'health', 'Fortune 500 (2025): #136, $33.0B revenue'],
  ['HF Sinclair', 7, exactly('hf sinclair', 'hollyfrontier', 'holly frontier', 'sinclair oil', 'holly energy partners'), 'industry', 'Fortune 500 (2025): #150, $28.6B revenue'],
  ['Avnet', 7, exactly('avnet', 'premier farnell', 'farnell element14'), 'tech', 'Fortune 500 (2025): #181, $23.8B revenue'],
  ['Reinsurance Group of America', 7, exactly('reinsurance group of america', 'rga reinsurance company', 'rga reinsurance'), 'finance', 'Fortune 500 (2025): #196, $22.1B revenue'],
  ['American Family Insurance', 7, exactly('american family insurance', 'american family insurance group', 'american family mutual insurance', 'amfam'), 'finance', 'Fortune 500 (2025): #202, $21.3B revenue'],
  ['CDW', 7, exactly('cdw', 'cdw government', 'cdw-g', 'cdw canada', 'cdw uk'), 'tech', 'Fortune 500 (2025): #205, $21.0B revenue'],
  ['Group 1 Automotive', 7, exactly('group 1 automotive', 'group1 automotive'), 'consumer', 'Fortune 500 (2025): #214, $19.9B revenue'],
  ['Corebridge Financial', 7, exactly('corebridge financial', 'corebridge'), 'finance', 'Fortune 500 (2025): #224, $18.8B revenue'],
  ['Lincoln Financial', 7, exactly('lincoln financial', 'lincoln financial group', 'lincoln national', 'lincoln national life insurance company', 'lincoln financial distributors'), 'finance', 'Fortune 500 (2025): #228, $18.4B revenue'],
  ['Murphy USA', 7, exactly('murphy usa', 'murphy express', 'quickchek'), 'consumer', 'Fortune 500 (2025): #231, $17.9B revenue'],
  ['C.H. Robinson', 7, exactly('c.h. robinson', 'ch robinson', 'c. h. robinson', 'c.h. robinson worldwide', 'ch robinson worldwide', 'robinson fresh'), 'industry', 'Fortune 500 (2025): #233, $17.7B revenue'],
  ['Edison International', 7, exactly('edison international', 'southern california edison', 'so cal edison', 'socal edison'), 'industry', 'Fortune 500 (2025): #235, $17.6B revenue'],
  ['Asbury Automotive Group', 7, exactly('asbury automotive group', 'asbury automotive'), 'consumer', 'Fortune 500 (2025): #242, $17.2B revenue'],
  ['Global Partners LP', 7, exactly('global partners lp', 'alltown fresh'), 'industry', 'Fortune 500 (2025): #244, $17.2B revenue'],
  ['Corteva', 7, exactly('corteva', 'corteva agriscience'), 'industry', 'Fortune 500 (2025): #246, $16.9B revenue'],
  ['Guardian Life', 7, exactly('guardian life', 'guardian life insurance', 'guardian life insurance company of america'), 'finance', 'Fortune 500 (2025): #253, $16.5B revenue'],
  ['Ally Financial', 7, exactly('ally financial', 'ally bank', 'ally auto'), 'finance', 'Fortune 500 (2025): #255, $16.4B revenue'],
  ['Land O Lakes', 7, exactly('land o lakes', 'land o\'lakes', 'land o\' lakes', 'purina animal nutrition', 'winfield united'), 'consumer', 'Fortune 500 (2025): #262, $16.2B revenue'],
  ['Auto-Owners Insurance', 7, exactly('auto-owners insurance', 'auto owners insurance', 'auto-owners insurance company', 'auto-owners'), 'finance', 'Fortune 500 (2025): #270, $15.8B revenue'],
  ['Pacific Life', 7, exactly('pacific life', 'pacific life insurance company', 'pacific life re'), 'finance', 'Fortune 500 (2025): #272, $15.8B revenue'],
  ['Farmers Insurance', 7, exactly('farmers insurance', 'farmers insurance exchange', 'farmers insurance group'), 'finance', 'Fortune 500 (2025): #280, $15.5B revenue'],
  ['Mutual of Omaha', 7, exactly('mutual of omaha', 'mutual of omaha insurance company', 'mutual of omaha insurance', 'mutual of omaha mortgage'), 'finance', 'Fortune 500 (2025): #299, $14.6B revenue'],
  ['Sonic Automotive', 7, exactly('sonic automotive', 'echopark automotive', 'echopark'), 'consumer', 'Fortune 500 (2025): #304, $14.2B revenue'],
  ['Western & Southern Financial Group', 7, exactly('western & southern financial group', 'western and southern financial group', 'western & southern', 'western and southern', 'western & southern life', 'western-southern life', 'gerber life insurance', 'gerber life', 'fort washington investment advisors'), 'finance', 'Fortune 500 (2025): #310, $13.8B revenue'],
  ['Erie Insurance', 7, exactly('erie insurance', 'erie insurance group', 'erie indemnity company', 'erie indemnity', 'erie insurance exchange', 'erie family life insurance'), 'finance', 'Fortune 500 (2025): #323, $13.2B revenue'],
  ['Unum', 7, exactly('unum', 'unum group', 'unum us', 'unum uk'), 'finance', 'Fortune 500 (2025): #330, $12.9B revenue'],
  ['Delek US', 7, exactly('delek us', 'delek us holdings', 'delek us energy'), 'industry', 'Fortune 500 (2025): #336, $12.5B revenue'],
  ['Equitable Holdings', 7, exactly('equitable holdings', 'axa equitable', 'axa equitable life insurance company', 'equitable financial life insurance company', 'equitable advisors'), 'finance', 'Fortune 500 (2025): #338, $12.4B revenue'],
  ['DuPont', 7, exactly('dupont', 'dupont de nemours', 'du pont'), 'industry', 'Fortune 500 (2025): #339, $12.4B revenue'],
  ['Conagra Brands', 7, exactly('conagra brands', 'conagra', 'conagra foods'), 'consumer', 'Fortune 500 (2025): #350, $12.1B revenue'],
  ['Hormel Foods', 7, exactly('hormel foods', 'hormel', 'jennie-o turkey store', 'jennie-o'), 'consumer', 'Fortune 500 (2025): #352, $11.9B revenue'],
  ['Alcoa', 7, exactly('alcoa', 'alcoa world alumina'), 'industry', 'Fortune 500 (2025): #354, $11.9B revenue'],
  ['Assurant', 7, exactly('assurant'), 'finance', 'Fortune 500 (2025): #356, $11.9B revenue'],
  ['Chewy', 7, exactly('chewy', 'chewy.com', 'chewy health', 'chewy vet care', 'chewy pharmacy'), 'consumer', 'Fortune 500 (2025): #357, $11.9B revenue'],
  ['Wayfair', 7, exactly('wayfair', 'perigold', 'allmodern'), 'consumer', 'Fortune 500 (2025): #358, $11.9B revenue'],
  ['Graybar', 7, exactly('graybar', 'graybar electric company', 'graybar electric'), 'industry', 'Fortune 500 (2025): #365, $11.6B revenue'],
  ['Molson Coors', 7, exactly('molson coors', 'molson coors beverage company', 'molson coors brewing company', 'molsoncoors', 'millercoors', 'coors brewing company', 'molson coors canada'), 'consumer', 'Fortune 500 (2025): #366, $11.6B revenue'],
  ['The Andersons', 7, exactly('andersons'), 'industry', 'Fortune 500 (2025): #378, $11.3B revenue'],
  ['The Mosaic Company', 7, exactly('mosaic company', 'mosaic fertilizantes'), 'industry', 'Fortune 500 (2025): #381, $11.1B revenue'],
  ['Thrivent', 7, exactly('thrivent', 'thrivent financial', 'thrivent financial for lutherans'), 'finance', 'Fortune 500 (2025): #388, $10.9B revenue'],
  ['Toll Brothers', 7, exactly('toll brothers', 'toll bros'), 'realestate', 'Fortune 500 (2025): #390, $10.8B revenue'],
  ['Accendra Health', 7, exactly('accendra health', 'accendra', 'apria', 'apria healthcare', 'byram healthcare'), 'health', 'Fortune 500 (2025): #395, $10.7B revenue'],
  ['NVR', 7, exactly('nvr', 'ryan homes', 'nvhomes', 'heartland homes', 'nvr mortgage'), 'realestate', 'Fortune 500 (2025): #396, $10.7B revenue'],
  ['Jefferies', 7, exactly('jefferies', 'jefferies financial group', 'jefferies group', 'jefferies & company'), 'finance', 'Fortune 500 (2025): #403, $10.52B revenue'],
  ['FM Global', 7, exactly('fm global', 'factory mutual insurance company', 'factory mutual', 'fm affiliated', 'affiliated fm', 'fm approvals'), 'finance', 'Fortune 500 (2025): #406, $10.41B revenue'],
  ['Celanese', 7, exactly('celanese'), 'industry', 'Fortune 500 (2025): #412, $10.28B revenue'],
  ['QVC Group', 7, exactly('qvc group', 'qvc', 'qurate retail group', 'qurate retail', 'qurate'), 'consumer', 'Fortune 500 (2025): #416, $10.04B revenue'],
  ['Icahn Enterprises', 7, exactly('icahn enterprises', 'icahn enterprises l.p', 'icahn automotive group', 'icahn automotive'), 'finance', 'Fortune 500 (2025): #417, $10.02B revenue'],
  ['QXO', 7, exactly('qxo', 'qxo building products', 'beacon roofing supply', 'beacon building products', 'topbuild', 'kodiak building partners'), 'industry', 'Fortune 500 (2025): #421, $9.76B revenue'],
  ['Gold.com', 7, exactly('gold.com', 'a-mark precious metals', 'a-mark', 'jm bullion', 'stack\'s bowers galleries', 'govmint'), 'finance', 'Fortune 500 (2025): #423, $9.70B revenue'],
  ['SpartanNash', 7, exactly('spartannash', 'spartannash company', 'spartan nash'), 'consumer', 'Fortune 500 (2025): #428, $9.55B revenue'],
  ['Ace Hardware', 7, exactly('ace hardware', 'ace retail holdings', 'westlake ace hardware'), 'consumer', 'Fortune 500 (2025): #429, $9.49B revenue'],
  ['Eastman Chemical', 7, exactly('eastman chemical', 'eastman chemical company'), 'industry', 'Fortune 500 (2025): #431, $9.38B revenue'],
  ['JetBlue', 7, exactly('jetblue', 'jetblue airways', 'jet blue'), 'consumer', 'Fortune 500 (2025): #434, $9.28B revenue'],
  ['KeyCorp', 7, exactly('keycorp', 'keybank national association', 'keybanc capital markets'), 'finance', 'Fortune 500 (2025): #436, $9.24B revenue'],
  ['KeyBank', 7, exactly('keybank', 'key bank'), 'finance', 'KeyCorp\'s: Fortune 500 (2025): #436, $9.24B revenue'],
  ['Oscar Health', 7, exactly('oscar health', 'oscar insurance'), 'health', 'Fortune 500 (2025): #437, $9.18B revenue'],
  ['Ovintiv', 7, exactly('ovintiv'), 'industry', 'Fortune 500 (2025): #438, $9.15B revenue'],
  ['Skechers', 7, exactly('skechers', 'skechers u.s.a', 'skechers usa'), 'consumer', 'Fortune 500 (2025): #441, $8.97B revenue'],
  ['Optimum Communications', 7, exactly('optimum communications', 'altice usa', 'suddenlink', 'news 12 networks'), 'tech', 'Fortune 500 (2025): #442, $8.95B revenue'],
  ['Insight Enterprises', 7, exactly('insight enterprises'), 'tech', 'Fortune 500 (2025): #447, $8.70B revenue'],
  ['Franklin Templeton', 7, exactly('franklin templeton', 'franklin resources', 'franklin templeton investments', 'legg mason', 'clearbridge investments', 'western asset management', 'brandywine global investment management', 'putnam investments', 'benefit street partners', 'clarion partners', 'lexington partners'), 'finance', 'Fortune 500 (2025): #453, $8.48B revenue'],
  ['Packaging Corporation of America', 7, exactly('packaging corporation of america', 'packaging corp of america'), 'industry', 'Fortune 500 (2025): #457, $8.38B revenue'],
  ['American Financial Group', 7, exactly('american financial group', 'great american insurance group', 'great american insurance company', 'great american insurance'), 'finance', 'Fortune 500 (2025): #460, $8.32B revenue'],
  ['Old Republic International', 7, exactly('old republic international', 'old republic', 'old republic national title insurance company'), 'finance', 'Fortune 500 (2025): #463, $8.23B revenue'],
  ['Old Republic Title', 7, exactly('old republic title', 'old republic national title'), 'finance', 'Old Republic International\'s: Fortune 500 (2025): #463, $8.23B revenue'],
  ['Securian Financial', 7, exactly('securian financial', 'securian financial group', 'securian', 'minnesota life insurance company', 'minnesota life'), 'finance', 'Fortune 500 (2025): #464, $8.23B revenue'],
  ['J.M. Smucker', 7, exactly('j.m. smucker', 'j.m. smucker company', 'j. m. smucker', 'jm smucker', 'smucker\'s', 'smuckers'), 'consumer', 'Fortune 500 (2025): #466, $8.18B revenue'],
  ['Taylor Morrison', 7, exactly('taylor morrison', 'taylor morrison home', 'darling homes'), 'realestate', 'Fortune 500 (2025): #467, $8.17B revenue'],
  ['Voya Financial', 7, exactly('voya financial', 'voya', 'voya investment management'), 'finance', 'Fortune 500 (2025): #469, $8.05B revenue'],
  ['Par Pacific', 7, exactly('par pacific', 'par pacific holdings', 'par hawaii'), 'industry', 'Fortune 500 (2025): #474, $7.97B revenue'],
  ['Commercial Metals', 7, exactly('commercial metals', 'commercial metals company'), 'industry', 'Fortune 500 (2025): #476, $7.93B revenue'],
  ['Post Holdings', 7, exactly('post holdings', 'post consumer brands', 'michael foods', 'weetabix'), 'consumer', 'Fortune 500 (2025): #477, $7.92B revenue'],
  ['Masco', 7, exactly('masco', 'delta faucet company', 'delta faucet', 'behr paint company', 'behr process'), 'consumer', 'Fortune 500 (2025): #478, $7.83B revenue'],
  ['Rush Enterprises', 7, exactly('rush enterprises', 'rush truck centers'), 'industry', 'Fortune 500 (2025): #479, $7.80B revenue'],
  ['Zimmer Biomet', 7, exactly('zimmer biomet', 'zimmer biomet holdings', 'biomet'), 'health', 'Fortune 500 (2025): #483, $7.68B revenue'],
  ['Watsco', 7, exactly('watsco', 'carrier enterprise', 'baker distributing company', 'baker distributing', 'gemaire distributors'), 'industry', 'Fortune 500 (2025): #486, $7.62B revenue'],
  ['ARKO', 7, exactly('arko', 'gpm investments'), 'consumer', 'Fortune 500 (2025): #488, $7.57B revenue'],
  ['WME', 7, exactly('wme', 'endeavor group holdings', 'wme group', 'william morris endeavor', 'william morris endeavor entertainment', 'img licensing', '160over90'), 'entertainment', 'Fortune 500 (2025): #495, $7.48B revenue'],
  ['Core & Main', 7, exactly('core & main', 'core and main'), 'industry', 'Fortune 500 (2025): #497, $7.44B revenue'],
  ['Ingredion', 7, exactly('ingredion'), 'industry', 'Fortune 500 (2025): #498, $7.43B revenue'],
  // U.S. federal government
  ['U.S. Department of State', 8, exactly('u.s. department of state', 'us department of state', 'united states department of state', 'department of state', 'state department', 'u.s. state department', 'us state department', 'state.gov', 'u.s. foreign service', 'us foreign service', 'united states foreign service', 'u.s. embassy', 'us embassy', 'united states embassy', 'american embassy', 'u.s. consulate general', 'us consulate general', 'u.s. consulate', 'us consulate'), 'defense', 'U.S. executive department (state.gov, OPM data), about 77,000 staff incl. locally employed (2025)'],
  ['U.S. Department of Defense', 8, exactly('u.s. department of defense', 'us department of defense', 'united states department of defense', 'department of defense', 'u.s. department of war', 'us department of war', 'united states department of war', 'department of war', 'dod', 'u.s. dod', 'us dod', 'defense department', 'u.s. defense department', 'office of the secretary of defense', 'office of the secretary of war'), 'defense', 'U.S. executive department (war.gov, OPM and DMDC data), about 685,000 civilians and 1.3 million active duty (2026)'],
  ['U.S. Department of Justice', 8, exactly('u.s. department of justice', 'us department of justice', 'united states department of justice', 'u.s. doj', 'us doj', 'u.s. justice department', 'us justice department'), 'defense', 'U.S. executive department (justice.gov, OPM data), about 107,300 staff (July 2026)'],
  ['U.S. Department of the Interior', 8, exactly('u.s. department of the interior', 'us department of the interior', 'united states department of the interior', 'department of the interior', 'u.s. department of interior', 'us department of interior', 'department of interior', 'interior department', 'u.s. interior department'), 'defense', 'U.S. executive department (doi.gov, OPM data), about 59,900 staff (July 2026)'],
  ['U.S. Department of Agriculture', 8, exactly('u.s. department of agriculture', 'us department of agriculture', 'united states department of agriculture', 'usda', 'u.s. usda', 'natural resources conservation service', 'animal and plant health inspection service', 'food safety and inspection service', 'agricultural research service', 'agricultural marketing service', 'farm service agency', 'usda rural development', 'usda ars', 'usda aphis', 'usda nrcs', 'usda fsis', 'usda fsa', 'usda ams', 'usda fns', 'usda ers', 'usda nass', 'usda nifa'), 'defense', 'U.S. executive department (usda.gov, OPM data), about 78,000 staff (July 2026)'],
  ['U.S. Department of Commerce', 8, exactly('u.s. department of commerce', 'us department of commerce', 'united states department of commerce', 'u.s. commerce department', 'us commerce department', 'international trade administration', 'bureau of industry and security', 'bureau of economic analysis'), 'defense', 'U.S. executive department (commerce.gov, OPM data), about 41,200 staff (July 2026)'],
  ['U.S. Department of Labor', 8, exactly('u.s. department of labor', 'us department of labor', 'united states department of labor', 'usdol', 'u.s. dol', 'us dol', 'u.s. labor department', 'us labor department', 'bureau of labor statistics', 'u.s. bureau of labor statistics', 'us bureau of labor statistics', 'mine safety and health administration', 'u.s. osha', 'us osha', 'federal osha'), 'defense', 'U.S. executive department (dol.gov, OPM data), about 11,100 staff (July 2026)'],
  ['HHS', 8, exactly('hhs', 'u.s. hhs', 'us hhs', 'health resources and services administration', 'hrsa', 'administration for children and families', 'samhsa'), 'health', 'U.S. executive department (hhs.gov, OPM data), about 72,900 staff (July 2026)'],
  ['HUD', 8, exactly('hud', 'department of housing and urban development', 'u.s. hud', 'us hud'), 'defense', 'U.S. executive department (hud.gov, OPM data), about 5,900 staff (July 2026)'],
  ['U.S. Department of Transportation', 8, exactly('u.s. department of transportation', 'us department of transportation', 'united states department of transportation', 'usdot', 'u.s. dot', 'us dot', 'federal highway administration', 'fhwa', 'federal railroad administration', 'federal transit administration', 'federal motor carrier safety administration', 'fmcsa', 'national highway traffic safety administration', 'nhtsa', 'phmsa', 'u.s. maritime administration', 'marad'), 'defense', 'U.S. executive department (transportation.gov, OPM data), about 52,900 staff (July 2026)'],
  ['U.S. Department of Energy', 8, exactly('u.s. department of energy', 'us department of energy', 'united states department of energy', 'department of energy', 'usdoe', 'u.s. doe', 'us doe'), 'defense', 'U.S. executive department (energy.gov, OPM data), about 13,400 federal staff (July 2026)'],
  ['U.S. Department of Education', 8, exactly('u.s. department of education', 'us department of education', 'united states department of education', 'federal student aid'), 'defense', 'U.S. executive department (ed.gov, OPM data), about 2,300 staff (July 2026)'],
  ['U.S. Department of Veterans Affairs', 8, exactly('u.s. department of veterans affairs', 'us department of veterans affairs', 'united states department of veterans affairs', 'department of veterans affairs', 'veterans affairs', 'u.s. veterans affairs', 'us veterans affairs', 'u.s. va', 'us va', 'veterans health administration', 'veterans benefits administration', 'national cemetery administration', 'va medical center', 'veterans affairs medical center', 'va health care system', 'va healthcare system', 'va hospital'), 'health', 'U.S. executive department (va.gov, OPM data), about 446,500 staff (July 2026)'],
  ['U.S. Department of Homeland Security', 8, exactly('u.s. department of homeland security', 'us department of homeland security', 'united states department of homeland security', 'department of homeland security', 'u.s. dhs', 'us dhs', 'federal law enforcement training centers', 'federal law enforcement training center', 'fletc', 'federal protective service'), 'defense', 'U.S. executive department (dhs.gov, OPM data), about 225,500 civilian staff (July 2026)'],
  ['U.S. Army', 8, exactly('u.s. army', 'us army', 'united states army', 'u.s. army reserve', 'us army reserve', 'united states army reserve', 'department of the army', 'u.s. department of the army', 'us department of the army', 'united states department of the army', 'hqda'), 'defense', 'U.S. military branch (army.mil, DMDC and OPM data), about 458,100 active duty and 188,300 civilians (2026)'],
  ['U.S. Navy', 8, exactly('u.s. navy', 'us navy', 'united states navy', 'u.s. navy reserve', 'us navy reserve', 'united states navy reserve', 'u.s. naval reserve', 'us naval reserve', 'united states naval reserve', 'department of the navy', 'u.s. department of the navy', 'us department of the navy', 'united states department of the navy', 'office of naval research', 'usn'), 'defense', 'U.S. military branch (navy.mil, DMDC and OPM data), about 347,700 active duty and 184,300 civilians (2026)'],
  ['U.S. Air Force', 8, exactly('u.s. air force', 'us air force', 'united states air force', 'usaf', 'u.s. air force reserve', 'us air force reserve', 'united states air force reserve', 'air force reserve command', 'department of the air force', 'u.s. department of the air force', 'us department of the air force'), 'defense', 'U.S. military branch (af.mil, DMDC and OPM data), about 320,000 active duty and 144,000 civilians (2026)'],
  ['U.S. Marine Corps', 8, exactly('u.s. marine corps', 'us marine corps', 'united states marine corps', 'usmc', 'marine corps', 'u.s. marine corps reserve', 'us marine corps reserve', 'united states marine corps reserve', 'usmcr', 'marine forces reserve', 'u.s. marines', 'us marines', 'united states marines'), 'defense', 'U.S. military branch (marines.mil, DMDC and OPM data), about 169,900 active duty and 16,200 civilians (2026)'],
  ['U.S. Space Force', 8, exactly('u.s. space force', 'us space force', 'united states space force', 'space systems command', 'space operations command', 'space training and readiness command', 'space development agency', 'ussf'), 'defense', 'U.S. military branch (spaceforce.mil, DMDC and OPM data), about 10,200 Guardians and 7,100 civilians (2026)'],
  ['U.S. Coast Guard', 8, exactly('u.s. coast guard', 'us coast guard', 'united states coast guard', 'uscg', 'u.s. coast guard reserve', 'us coast guard reserve', 'united states coast guard reserve'), 'defense', 'U.S. military branch (uscg.mil, DMDC and OPM data), about 43,600 active duty and 8,700 civilians (2026)'],
  ['National Guard', 8, exactly('national guard', 'u.s. national guard', 'us national guard', 'united states national guard', 'army national guard', 'air national guard', 'national guard bureau', 'arng', 'alabama national guard', 'alabama army national guard', 'alabama air national guard', 'alaska national guard', 'alaska army national guard', 'alaska air national guard', 'arizona national guard', 'arizona army national guard', 'arizona air national guard', 'arkansas national guard', 'arkansas army national guard', 'arkansas air national guard', 'california national guard', 'california army national guard', 'california air national guard', 'colorado national guard', 'colorado army national guard', 'colorado air national guard', 'connecticut national guard', 'connecticut army national guard', 'connecticut air national guard', 'delaware national guard', 'delaware army national guard', 'delaware air national guard', 'florida national guard', 'florida army national guard', 'florida air national guard', 'georgia national guard', 'georgia army national guard', 'georgia air national guard', 'hawaii national guard', 'hawaii army national guard', 'hawaii air national guard', 'idaho national guard', 'idaho army national guard', 'idaho air national guard', 'illinois national guard', 'illinois army national guard', 'illinois air national guard', 'indiana national guard', 'indiana army national guard', 'indiana air national guard', 'iowa national guard', 'iowa army national guard', 'iowa air national guard', 'kansas national guard', 'kansas army national guard', 'kansas air national guard', 'kentucky national guard', 'kentucky army national guard', 'kentucky air national guard', 'louisiana national guard', 'louisiana army national guard', 'louisiana air national guard', 'maine national guard', 'maine army national guard', 'maine air national guard', 'maryland national guard', 'maryland army national guard', 'maryland air national guard', 'massachusetts national guard', 'massachusetts army national guard', 'massachusetts air national guard', 'michigan national guard', 'michigan army national guard', 'michigan air national guard', 'minnesota national guard', 'minnesota army national guard', 'minnesota air national guard', 'mississippi national guard', 'mississippi army national guard', 'mississippi air national guard', 'missouri national guard', 'missouri army national guard', 'missouri air national guard', 'montana national guard', 'montana army national guard', 'montana air national guard', 'nebraska national guard', 'nebraska army national guard', 'nebraska air national guard', 'nevada national guard', 'nevada army national guard', 'nevada air national guard', 'new hampshire national guard', 'new hampshire army national guard', 'new hampshire air national guard', 'new jersey national guard', 'new jersey army national guard', 'new jersey air national guard', 'new mexico national guard', 'new mexico army national guard', 'new mexico air national guard', 'new york national guard', 'new york army national guard', 'new york air national guard', 'north carolina national guard', 'north carolina army national guard', 'north carolina air national guard', 'north dakota national guard', 'north dakota army national guard', 'north dakota air national guard', 'ohio national guard', 'ohio army national guard', 'ohio air national guard', 'oklahoma national guard', 'oklahoma army national guard', 'oklahoma air national guard', 'oregon national guard', 'oregon army national guard', 'oregon air national guard', 'pennsylvania national guard', 'pennsylvania army national guard', 'pennsylvania air national guard', 'rhode island national guard', 'rhode island army national guard', 'rhode island air national guard', 'south carolina national guard', 'south carolina army national guard', 'south carolina air national guard', 'south dakota national guard', 'south dakota army national guard', 'south dakota air national guard', 'tennessee national guard', 'tennessee army national guard', 'tennessee air national guard', 'texas national guard', 'texas army national guard', 'texas air national guard', 'utah national guard', 'utah army national guard', 'utah air national guard', 'vermont national guard', 'vermont army national guard', 'vermont air national guard', 'virginia national guard', 'virginia army national guard', 'virginia air national guard', 'washington national guard', 'washington army national guard', 'washington air national guard', 'west virginia national guard', 'west virginia army national guard', 'west virginia air national guard', 'wisconsin national guard', 'wisconsin army national guard', 'wisconsin air national guard', 'wyoming national guard', 'wyoming army national guard', 'wyoming air national guard', 'district of columbia national guard', 'district of columbia army national guard', 'district of columbia air national guard', 'd.c. national guard', 'd.c. army national guard', 'd.c. air national guard', 'dc national guard', 'dc army national guard', 'dc air national guard', 'puerto rico national guard', 'puerto rico army national guard', 'puerto rico air national guard', 'guam national guard', 'guam army national guard', 'guam air national guard', 'virgin islands national guard', 'virgin islands army national guard', 'virgin islands air national guard', 'u.s. virgin islands national guard', 'u.s. virgin islands army national guard', 'u.s. virgin islands air national guard'), 'defense', 'U.S. military reserve component (nationalguard.mil, OPM data), about 433,000 members (FY2025)'],
  ['FBI', 8, exactly('fbi', 'federal bureau of investigation', 'u.s. federal bureau of investigation', 'us federal bureau of investigation'), 'defense', 'U.S. federal law-enforcement agency (fbi.gov, OPM data), about 35,300 staff (July 2026)'],
  ['CIA', 8, exactly('cia', 'central intelligence agency', 'u.s. central intelligence agency', 'us central intelligence agency'), 'defense', 'U.S. intelligence agency (cia.gov, Wikipedia), about 21,500 staff (estimate; staffing classified)'],
  ['NSA', 8, exactly('nsa', 'national security agency', 'u.s. national security agency', 'us national security agency', 'central security service'), 'defense', 'U.S. intelligence agency (nsa.gov, Wikipedia), 30,000-40,000 staff (estimate, 2024-25)'],
  ['Defense Logistics Agency', 8, exactly('defense logistics agency', 'u.s. defense logistics agency', 'us defense logistics agency', 'dla', 'dla troop support', 'dla aviation', 'dla land and maritime', 'dla distribution', 'dla energy', 'dla disposition services'), 'defense', 'U.S. defense agency (dla.mil, OPM data), about 23,000 civilians (May 2026)'],
  ['Defense Health Agency', 8, exactly('defense health agency', 'u.s. defense health agency', 'us defense health agency', 'walter reed national military medical center', 'brooke army medical center', 'naval medical center san diego', 'naval medical center portsmouth', 'madigan army medical center', 'tripler army medical center', 'womack army medical center', 'landstuhl regional medical center', 'fort belvoir community hospital', 'carl r. darnall army medical center', 'william beaumont army medical center', 'eisenhower army medical center'), 'health', 'U.S. defense health agency (health.mil, OPM data), about 46,400 civilians (May 2026)'],
  ['Army & Air Force Exchange Service', 8, exactly('army & air force exchange service', 'army air force exchange service', 'army & air force exchange', 'aafes'), 'defense', 'U.S. defense agency (aafes.com), about 35,000 associates (2026)'],
  ['NAVSEA', 8, exactly('navsea', 'naval sea systems command', 'naval surface warfare center', 'nswc', 'naval undersea warfare center', 'nuwc', 'norfolk naval shipyard', 'portsmouth naval shipyard', 'puget sound naval shipyard', 'pearl harbor naval shipyard'), 'defense', 'U.S. Navy systems command (navsea.navy.mil, OPM data), about 33,300 civilians (May 2026)'],
  ['NAVAIR', 8, exactly('navair', 'naval air systems command', 'naval air warfare center', 'nawcad', 'nawcwd', 'fleet readiness center', 'fleet readiness center east', 'fleet readiness center southeast', 'fleet readiness center southwest', 'frcse'), 'defense', 'U.S. Navy systems command (navair.navy.mil, OPM data), about 26,600 civilians (May 2026)'],
  ['Air Force Materiel Command', 8, exactly('air force materiel command', 'u.s. air force materiel command', 'us air force materiel command', 'air force life cycle management center', 'aflcmc', 'air force sustainment center', 'air force test center', 'air force nuclear weapons center', 'oklahoma city air logistics complex', 'ogden air logistics complex', 'warner robins air logistics complex'), 'defense', 'U.S. Air Force major command (afmc.af.mil, OPM data), about 64,500 civilians (May 2026)'],
  ['U.S. Army Corps of Engineers', 8, exactly('u.s. army corps of engineers', 'us army corps of engineers', 'united states army corps of engineers', 'army corps of engineers', 'usace'), 'defense', 'U.S. Army engineering command (usace.army.mil, OPM data), about 34,300 civilians (May 2026)'],
  ['Social Security Administration', 8, exactly('social security administration', 'u.s. social security administration', 'us social security administration', 'united states social security administration'), 'defense', 'U.S. federal agency (ssa.gov, OPM data), about 49,500 staff (July 2026)'],
  ['IRS', 8, exactly('irs', 'internal revenue service', 'u.s. internal revenue service', 'us internal revenue service', 'united states internal revenue service', 'irs criminal investigation', 'irs-ci', 'irs office of chief counsel'), 'defense', 'U.S. tax agency (irs.gov, OPM data), about 71,800 staff (July 2026)'],
  ['USPS', 8, exactly('usps', 'united states postal service', 'u.s. postal service', 'us postal service', 'united states post office', 'u.s. post office', 'us post office', 'usps office of inspector general'), 'defense', 'U.S. federal establishment (usps.com, Federal News Network), about 623,000 employees (August 2025)'],
  ['U.S. Customs and Border Protection', 8, exactly('u.s. customs and border protection', 'us customs and border protection', 'united states customs and border protection', 'customs and border protection', 'cbp', 'u.s. cbp', 'us cbp', 'u.s. border patrol', 'us border patrol', 'united states border patrol', 'border patrol'), 'defense', 'U.S. border agency (cbp.gov, OPM data), about 70,300 staff (July 2026)'],
  ['U.S. Immigration and Customs Enforcement', 8, exactly('u.s. immigration and customs enforcement', 'us immigration and customs enforcement', 'united states immigration and customs enforcement', 'immigration and customs enforcement', 'homeland security investigations', 'enforcement and removal operations', 'ice hsi', 'ice ero'), 'defense', 'U.S. immigration agency (ice.gov, OPM data), about 28,900 staff (July 2026)'],
  ['TSA', 8, exactly('tsa', 'transportation security administration', 'u.s. transportation security administration', 'us transportation security administration', 'federal air marshal service'), 'defense', 'U.S. aviation-security agency (tsa.gov, OPM data), about 59,600 staff (July 2026)'],
  ['USCIS', 8, exactly('uscis', 'u.s. citizenship and immigration services', 'us citizenship and immigration services', 'united states citizenship and immigration services', 'citizenship and immigration services'), 'defense', 'U.S. immigration-services agency (uscis.gov, OPM data), about 20,300 staff (July 2026)'],
  ['Federal Bureau of Prisons', 8, exactly('federal bureau of prisons', 'bureau of prisons', 'u.s. bureau of prisons', 'us bureau of prisons', 'federal prison system', 'federal prison industries', 'unicor'), 'defense', 'U.S. prison agency (bop.gov, OPM data), about 33,900 staff (July 2026)'],
  ['FAA', 8, exactly('faa', 'federal aviation administration', 'u.s. federal aviation administration', 'us federal aviation administration', 'united states federal aviation administration', 'u.s. faa', 'us faa'), 'defense', 'U.S. aviation agency (faa.gov, OPM data), about 44,700 staff (July 2026)'],
  ['U.S. Forest Service', 8, exactly('u.s. forest service', 'us forest service', 'united states forest service', 'usda forest service'), 'defense', 'U.S. land agency (fs.usda.gov, OPM data), about 33,500 staff (July 2026)'],
  ['Defense Intelligence Agency', 7, exactly('defense intelligence agency', 'u.s. defense intelligence agency', 'us defense intelligence agency'), 'defense', 'U.S. defense intelligence agency (dia.mil), about 16,500 staff (2025)'],
  ['National Geospatial-Intelligence Agency', 7, exactly('national geospatial-intelligence agency', 'national geospatial intelligence agency', 'u.s. national geospatial-intelligence agency', 'us national geospatial-intelligence agency'), 'defense', 'U.S. defense intelligence agency (nga.mil), about 14,500 staff (2025)'],
  ['National Reconnaissance Office', 7, exactly('national reconnaissance office', 'nro', 'u.s. national reconnaissance office', 'us national reconnaissance office'), 'defense', 'U.S. intelligence agency (nro.gov), about 3,000 staff (2025)'],
  ['DARPA', 7, exactly('darpa', 'defense advanced research projects agency', 'u.s. defense advanced research projects agency'), 'defense', 'U.S. defense research agency (darpa.mil, OPM data), about 220 staff and $4.3B budget (FY2026)'],
  ['ODNI', 7, exactly('odni', 'u.s. odni', 'us odni'), 'defense', 'U.S. intelligence office (dni.gov), about 1,300 staff after 2025 cuts'],
  ['Defense Information Systems Agency', 7, exactly('defense information systems agency', 'u.s. defense information systems agency', 'us defense information systems agency'), 'defense', 'U.S. defense agency (disa.mil, OPM data), about 6,200 civilians (May 2026)'],
  ['Defense Contract Management Agency', 7, exactly('defense contract management agency', 'dcma'), 'defense', 'U.S. defense agency (dcma.mil, OPM data), about 8,700 civilians (May 2026)'],
  ['Defense Finance and Accounting Service', 7, exactly('defense finance and accounting service', 'dfas'), 'defense', 'U.S. defense agency (dfas.mil, OPM data), about 9,500 civilians (May 2026)'],
  ['Missile Defense Agency', 7, exactly('missile defense agency', 'u.s. missile defense agency', 'us missile defense agency'), 'defense', 'U.S. defense agency (mda.mil, OPM data), about 2,500 civilians (May 2026)'],
  ['Defense Counterintelligence and Security Agency', 7, exactly('defense counterintelligence and security agency', 'dcsa', 'defense security service'), 'defense', 'U.S. defense agency (dcsa.mil, OPM data), about 5,000 civilians (May 2026)'],
  ['DoDEA', 7, exactly('dodea', 'department of defense education activity', 'department of war education activity', 'dodds'), 'defense', 'U.S. defense agency (dodea.edu, OPM data), about 14,500 staff (May 2026)'],
  ['NAVWAR', 7, exactly('navwar', 'naval information warfare systems command', 'naval information warfare center', 'niwc', 'niwc pacific', 'niwc atlantic', 'space and naval warfare systems command', 'spawar'), 'defense', 'U.S. Navy systems command (navwar.navy.mil, OPM data), about 9,500 civilians (May 2026)'],
  ['NAVFAC', 7, exactly('navfac', 'naval facilities engineering systems command', 'naval facilities engineering command'), 'defense', 'U.S. Navy systems command (navfac.navy.mil, OPM data), about 13,700 civilians (May 2026)'],
  ['U.S. Naval Research Laboratory', 7, exactly('u.s. naval research laboratory', 'us naval research laboratory', 'united states naval research laboratory', 'naval research laboratory', 'naval research lab', 'u.s. naval research lab'), 'defense', 'U.S. Navy research laboratory (nrl.navy.mil, Wikipedia), about 2,500 civilians (2015)'],
  ['Army Research Laboratory', 7, exactly('army research laboratory', 'army research lab', 'u.s. army research laboratory', 'us army research laboratory', 'devcom army research laboratory', 'devcom army research lab', 'devcom arl', 'army research office', 'u.s. army research office'), 'defense', 'U.S. Army research laboratory (arl.devcom.army.mil), about 2,500 staff (2024)'],
  ['NIH', 7, exactly('nih', 'national institutes of health', 'u.s. national institutes of health', 'us national institutes of health', 'united states national institutes of health', 'nih clinical center', 'u.s. national cancer institute', 'us national cancer institute', 'nih national cancer institute', 'national human genome research institute', 'national library of medicine', 'fogarty international center', 'niaid', 'nhlbi', 'nhgri', 'nichd', 'ninds', 'niddk', 'niehs', 'nibib', 'ncats', 'nigms', 'nimhd', 'ninr', 'nidcr', 'nidcd', 'nccih', 'niaaa'), 'health', 'U.S. health agency (nih.gov, OPM data), about 16,500 staff (July 2026)'],
  ['CDC', 7, exactly('cdc', 'centers for disease control and prevention', 'centers for disease control', 'center for disease control and prevention', 'center for disease control', 'u.s. cdc', 'us cdc', 'niosh'), 'health', 'U.S. health agency (cdc.gov, OPM data), about 9,100 staff (July 2026)'],
  ['FDA', 7, exactly('fda', 'u.s. food and drug administration', 'us food and drug administration', 'united states food and drug administration', 'food and drug administration', 'u.s. fda', 'us fda'), 'health', 'U.S. health agency (fda.gov, OPM data), about 16,300 staff (July 2026)'],
  ['Centers for Medicare & Medicaid Services', 7, exactly('centers for medicare & medicaid services', 'centers for medicare and medicaid services', 'center for medicare & medicaid services', 'center for medicare and medicaid services', 'u.s. cms', 'us cms'), 'health', 'U.S. health agency (cms.gov, OPM data), about 5,700 staff (July 2026)'],
  ['Indian Health Service', 7, exactly('indian health service', 'u.s. indian health service', 'us indian health service'), 'health', 'U.S. health agency (ihs.gov, OPM data), about 12,200 staff (July 2026)'],
  ['U.S. Public Health Service', 7, exactly('u.s. public health service', 'us public health service', 'united states public health service', 'usphs', 'usphs commissioned corps', 'public health service commissioned corps', 'u.s. public health service commissioned corps'), 'health', 'U.S. uniformed service (usphs.gov), about 6,500 officers (2025)'],
  ['FEMA', 7, exactly('fema', 'federal emergency management agency', 'u.s. federal emergency management agency'), 'defense', 'U.S. emergency-management agency (fema.gov, OPM data), about 20,300 staff incl. reservists (July 2026)'],
  ['U.S. Secret Service', 7, exactly('u.s. secret service', 'us secret service', 'united states secret service', 'secret service', 'usss'), 'defense', 'U.S. protective agency (secretservice.gov, OPM data), about 8,600 staff (July 2026)'],
  ['U.S. Marshals Service', 7, exactly('u.s. marshals service', 'us marshals service', 'united states marshals service', 'u.s. marshals', 'us marshals', 'united states marshals', 'u.s. marshal service', 'us marshal service', 'united states marshal service'), 'defense', 'U.S. law-enforcement agency (usmarshals.gov, OPM data), about 5,400 staff (July 2026)'],
  ['DEA', 7, exactly('dea', 'drug enforcement administration', 'u.s. drug enforcement administration', 'us drug enforcement administration', 'united states drug enforcement administration'), 'defense', 'U.S. drug-enforcement agency (dea.gov, OPM data), about 8,500 staff (July 2026)'],
  ['ATF', 7, exactly('atf', 'bureau of alcohol', 'bureau of alcohol tobacco and firearms', 'u.s. atf', 'us atf'), 'defense', 'U.S. firearms agency (atf.gov, OPM data), about 4,500 staff (July 2026)'],
  ['U.S. Attorney\'s Offices', 7, exactly('u.s. attorney\'s offices', 'u.s. attorney\'s office', 'us attorney\'s office', 'united states attorney\'s office', 'u.s. attorneys office', 'us attorneys office', 'united states attorneys office', 'u.s. attorney’s office', 'united states attorney’s office', 'executive office for u.s. attorneys', 'eousa', 'usao'), 'defense', 'U.S. federal prosecutors (justice.gov/usao, OPM data), about 10,400 staff (July 2026)'],
  ['NOAA', 7, exactly('noaa', 'national oceanic and atmospheric administration', 'noaa fisheries', 'national marine fisheries service', 'national weather service', 'noaa national weather service', 'national hurricane center', 'noaa corps'), 'defense', 'U.S. science agency (noaa.gov, OPM data), about 9,800 staff (July 2026)'],
  ['NIST', 7, exactly('nist', 'national institute of standards and technology'), 'defense', 'U.S. standards lab (nist.gov, OPM data), about 3,200 staff (July 2026)'],
  ['Census Bureau', 7, exactly('census bureau', 'u.s. census bureau', 'us census bureau', 'united states census bureau', 'bureau of the census', 'u.s. bureau of the census'), 'defense', 'U.S. statistical agency (census.gov, OPM data), about 10,900 staff (July 2026)'],
  ['USPTO', 7, exactly('uspto', 'united states patent and trademark office', 'u.s. patent and trademark office', 'us patent and trademark office', 'patent and trademark office', 'u.s. patent office', 'us patent office', 'united states patent office'), 'defense', 'U.S. patent office (uspto.gov, OPM data), about 13,500 staff (July 2026)'],
  ['EPA', 7, exactly('epa', 'u.s. environmental protection agency', 'us environmental protection agency', 'united states environmental protection agency', 'environmental protection agency', 'u.s. epa', 'us epa'), 'defense', 'U.S. environmental agency (epa.gov, OPM data), about 12,500 staff (July 2026)'],
  ['U.S. Securities and Exchange Commission', 7, exactly('u.s. securities and exchange commission', 'us securities and exchange commission', 'united states securities and exchange commission', 'u.s. sec', 'us sec'), 'finance', 'U.S. securities regulator (sec.gov, OPM data), about 3,900 staff (July 2026)'],
  ['Federal Trade Commission', 7, exactly('federal trade commission', 'ftc', 'u.s. federal trade commission', 'us federal trade commission', 'united states federal trade commission', 'u.s. ftc', 'us ftc'), 'defense', 'U.S. consumer-protection regulator (ftc.gov, OPM data), about 1,000 staff (July 2026)'],
  ['Federal Communications Commission', 7, exactly('federal communications commission', 'u.s. federal communications commission', 'us federal communications commission', 'united states federal communications commission', 'u.s. fcc', 'us fcc'), 'defense', 'U.S. communications regulator (fcc.gov, OPM data), about 1,200 staff (July 2026)'],
  ['Federal Reserve Board', 7, exactly('federal reserve board', 'federal reserve board of governors', 'u.s. federal reserve board'), 'finance', 'U.S. central bank board (federalreserve.gov), 3,057 authorized positions (2025 budget)'],
  ['FDIC', 7, exactly('fdic', 'federal deposit insurance'), 'finance', 'U.S. bank regulator (fdic.gov, OPM data), about 5,000 staff (July 2026)'],
  ['GAO', 7, exactly('gao', 'u.s. government accountability office', 'us government accountability office', 'united states government accountability office', 'government accountability office', 'u.s. gao', 'us gao', 'general accounting office', 'u.s. general accounting office'), 'defense', 'U.S. legislative audit agency (gao.gov budget request), about 3,300 staff (FY2026)'],
  ['Library of Congress', 7, exactly('library of congress', 'u.s. library of congress', 'us library of congress', 'congressional research service', 'u.s. copyright office', 'united states copyright office'), 'nonprofit', 'U.S. national library (loc.gov), 3,238 permanent staff (FY2023)'],
  ['Smithsonian Institution', 7, exactly('smithsonian institution', 'smithsonian', 'smithsonian institute', 'national air and space museum', 'national museum of american history', 'smithsonian\'s national zoo', 'smithsonian tropical research institute', 'smithsonian astrophysical observatory', 'smithsonian environmental research center', 'smithsonian american art museum'), 'nonprofit', 'U.S. museum and research institution (si.edu), 6,343 federal and trust staff (September 2025)'],
  ['USAID', 7, exactly('usaid', 'united states agency for international development', 'u.s. agency for international development', 'us agency for international development', 'agency for international development'), 'defense', 'U.S. foreign-aid agency, closed 2025 (usaid.gov, OPM data), more than 10,000 staff before 2025'],
  ['Peace Corps', 7, exactly('peace corps', 'u.s. peace corps', 'us peace corps', 'united states peace corps', 'peace corps response'), 'defense', 'U.S. volunteer agency (peacecorps.gov, OPM data), about 600 staff and 3,300 volunteers (2025-26)'],
  ['National Park Service', 7, exactly('national park service', 'u.s. national park service', 'us national park service', 'united states national park service'), 'defense', 'U.S. parks agency (nps.gov, OPM data), about 19,000 staff (July 2026)'],
  ['USGS', 7, exactly('usgs', 'u.s. geological survey', 'us geological survey', 'united states geological survey'), 'defense', 'U.S. science agency (usgs.gov, OPM data), about 5,900 staff (July 2026)'],
  ['U.S. Fish and Wildlife Service', 7, exactly('u.s. fish and wildlife service', 'us fish and wildlife service', 'united states fish and wildlife service', 'fish and wildlife service', 'usfws', 'u.s. fish & wildlife service', 'us fish & wildlife service'), 'defense', 'U.S. wildlife agency (fws.gov, OPM data), about 6,300 staff (July 2026)'],
  ['Bureau of Land Management', 7, exactly('bureau of land management', 'u.s. bureau of land management', 'us bureau of land management'), 'defense', 'U.S. land agency (blm.gov, OPM data), about 5,800 staff (July 2026)'],
  ['National Science Foundation', 7, exactly('national science foundation', 'u.s. national science foundation', 'us national science foundation', 'u.s. nsf', 'us nsf'), 'defense', 'U.S. science-funding agency (nsf.gov, OPM data), about 1,100 staff (July 2026)'],
  ['General Services Administration', 7, exactly('general services administration', 'u.s. general services administration', 'us general services administration', 'united states general services administration', 'u.s. gsa', 'us gsa'), 'defense', 'U.S. federal agency (gsa.gov, OPM data), about 8,200 staff (July 2026)'],
  ['U.S. Small Business Administration', 7, exactly('u.s. small business administration', 'us small business administration', 'united states small business administration', 'small business administration', 'u.s. sba', 'us sba'), 'defense', 'U.S. federal agency (sba.gov, OPM data), about 5,100 staff (July 2026)'],
  ['Cybersecurity and Infrastructure Security Agency', 7, exactly('cybersecurity and infrastructure security agency', 'cybersecurity & infrastructure security agency', 'u.s. cisa', 'us cisa', 'dhs cisa'), 'defense', 'U.S. cybersecurity agency (cisa.gov, OPM data), about 2,200 staff (July 2026)'],
  ['NNSA', 7, exactly('nnsa', 'national nuclear security administration', 'u.s. national nuclear security administration'), 'defense', 'U.S. nuclear-security agency (energy.gov/nnsa, Wikipedia), 2,600+ federal staff (2024)'],
  ['Tennessee Valley Authority', 7, exactly('tennessee valley authority'), 'defense', 'U.S. federal power corporation (tva.com annual report), more than 10,600 employees (FY2025)'],
  ['The White House', 7, exactly('white house office', 'u.s. executive office of the president', 'us executive office of the president'), 'defense', 'U.S. Executive Office of the President (whitehouse.gov annual staff report), 411 staff (July 2026)'],
  ['U.S. Senate', 7, exactly('u.s. senate', 'united states senate', 'us senate', 'senate of the united states'), 'defense', 'U.S. legislative chamber (senate.gov, CRS R43946), 6,019 staff (2022)'],
  ['U.S. House of Representatives', 7, exactly('u.s. house of representatives', 'us house of representatives', 'united states house of representatives', 'u.s. house'), 'defense', 'U.S. legislative chamber (house.gov, CRS R43947), 9,247 staff (2023)'],
  ['U.S. Congress', 7, exactly('u.s. congress', 'us congress', 'united states congress', 'congress of the united states'), 'defense', 'U.S. legislature (congress.gov, CRS), about 15,000 staff (2022-23)'],
  ['U.S. Courts', 7, exactly('u.s. courts', 'us courts', 'united states courts', 'u.s. district court', 'us district court', 'united states district court', 'u.s. court of appeals', 'us court of appeals', 'united states court of appeals', 'u.s. bankruptcy court', 'us bankruptcy court', 'united states bankruptcy court', 'u.s. court of federal claims', 'us court of federal claims', 'united states court of federal claims', 'u.s. court of international trade', 'u.s. probation office', 'united states probation office', 'u.s. probation and pretrial services', 'federal public defender', 'office of the federal public defender'), 'defense', 'U.S. federal judiciary (uscourts.gov), more than 32,000 staff (2026)'],
  ['Supreme Court of the United States', 7, exactly('supreme court of the united states', 'u.s. supreme court', 'us supreme court', 'united states supreme court', 'scotus'), 'defense', 'U.S. Supreme Court (supremecourt.gov), more than 500 staff (2026)'],
  ['Los Alamos National Laboratory', 7, exactly('los alamos national laboratory', 'los alamos national lab', 'los alamos national labs', 'lanl', 'triad national security', 'los alamos national security'), 'defense', 'U.S. national laboratory (lanl.gov economic impact report), about 16,500 workers (FY2025)'],
  ['Lawrence Livermore National Laboratory', 7, exactly('lawrence livermore national laboratory', 'lawrence livermore national lab', 'lawrence livermore', 'llnl', 'lawrence livermore lab', 'livermore lab', 'lawrence livermore national security'), 'defense', 'U.S. national laboratory (llnl.gov), about 9,000 staff (2025)'],
  ['Sandia National Laboratories', 7, exactly('sandia national laboratories', 'sandia national laboratory', 'sandia national labs', 'sandia national lab', 'sandia labs', 'sandia laboratories', 'ntess'), 'defense', 'U.S. national laboratory (sandia.gov facts and figures), about 16,300 staff (FY2025)'],
  ['Oak Ridge National Laboratory', 7, exactly('oak ridge national laboratory', 'oak ridge national lab', 'ornl', 'ut-battelle'), 'defense', 'U.S. national laboratory (ornl.gov), more than 7,000 staff (2026)'],
  ['Argonne National Laboratory', 7, exactly('argonne national laboratory', 'argonne national lab', 'argonne', 'uchicago argonne'), 'defense', 'U.S. national laboratory (anl.gov), 3,836 employees (FY2024)'],
  ['Jet Propulsion Laboratory', 7, exactly('jet propulsion laboratory', 'jet propulsion lab', 'jpl', 'caltech jpl', 'jpl caltech'), 'defense', 'NASA research center run by Caltech (jpl.nasa.gov, Wikipedia), about 4,500 staff (late 2025)'],
  ['MIT Lincoln Laboratory', 7, exactly('mit lincoln laboratory', 'mit lincoln lab', 'lincoln laboratory'), 'defense', 'DoD federally funded research center (ll.mit.edu, Wikipedia), about 4,500 staff (FY2024)'],
  ['Lawrence Berkeley National Laboratory', 7, exactly('lawrence berkeley national laboratory', 'lawrence berkeley national lab', 'lawrence berkeley lab', 'berkeley lab', 'lbnl'), 'defense', 'U.S. national laboratory (DOE Office of Science), about 3,400 employees (2026)'],
  ['Brookhaven National Laboratory', 7, exactly('brookhaven national laboratory', 'brookhaven national lab', 'brookhaven lab', 'brookhaven science associates'), 'defense', 'U.S. national laboratory (DOE Office of Science), about 3,000 employees (2026)'],
  ['Pacific Northwest National Laboratory', 7, exactly('pacific northwest national laboratory', 'pacific northwest national lab', 'pnnl'), 'defense', 'U.S. national laboratory (pnnl.gov, Wikipedia), about 6,100 staff (2026)'],
  ['Idaho National Laboratory', 7, exactly('idaho national laboratory', 'idaho national lab', 'inl', 'battelle energy alliance'), 'defense', 'U.S. national laboratory (inl.gov, Wikipedia), about 5,700 staff (2023)'],
  ['NREL', 7, exactly('nrel', 'national renewable energy laboratory', 'national renewable energy lab', 'national laboratory of the rockies'), 'defense', 'U.S. national laboratory (nrel.gov, Wikipedia), about 3,700 staff (FY2025)'],
  ['Fermilab', 7, exactly('fermilab', 'fermi national accelerator laboratory', 'fnal', 'fermi research alliance', 'fermiforward discovery group'), 'defense', 'U.S. national laboratory (DOE Office of Science), about 1,800 employees (2026)'],
  ['SLAC', 7, exactly('slac', 'slac national accelerator laboratory', 'slac national accelerator lab', 'stanford linear accelerator center'), 'defense', 'U.S. national laboratory (DOE Office of Science), about 1,700 employees (2026)'],
  ['Johns Hopkins APL', 7, exactly('johns hopkins apl', 'johns hopkins applied physics laboratory', 'johns hopkins applied physics lab', 'jhu apl', 'jhuapl'), 'defense', 'DoD university-affiliated research center (jhuapl.edu, Wikipedia), about 8,800 staff (2025)'],
  // U.S. News Best National Universities, 2025 edition: ranks 21–100
  ['Carnegie Mellon University', 7, university('carnegie mellon university|carnegie mellon'), 'education', 'U.S. News Best National Universities, 2025 edition: #21'],
  ['University of Michigan', 7, university('university of michigan|university of michigan-ann arbor|university of michigan ann arbor|umich'), 'education', 'U.S. News Best National Universities, 2025 edition: #21'],
  ['Washington University in St. Louis', 7, university('washington university in st\\. louis|washington university in st louis|washington university in saint louis|washington university|washu|wash u|wustl'), 'education', 'U.S. News Best National Universities, 2025 edition: #21'],
  ['Emory University', 7, university('emory university|emory'), 'education', 'U.S. News Best National Universities, 2025 edition: #24'],
  ['Georgetown University', 7, university('georgetown university|georgetown|georgetown law|georgetown university law center'), 'education', 'U.S. News Best National Universities, 2025 edition: #24'],
  ['University of Virginia', 7, university('university of virginia'), 'education', 'U.S. News Best National Universities, 2025 edition: #24'],
  ['UNC Chapel Hill', 7, university('unc chapel hill|university of north carolina-chapel hill|university of north carolina chapel hill|unc-chapel hill|unc-ch'), 'education', 'U.S. News Best National Universities, 2025 edition: #27'],
  ['University of Southern California', 7, university('university of southern california'), 'education', 'U.S. News Best National Universities, 2025 edition: #27'],
  ['New York University', 7, university('new york university|nyu'), 'education', 'U.S. News Best National Universities, 2025 edition: #30'],
  ['University of Texas at Austin', 7, university('university of texas at austin|university of texas-austin|university of texas austin|ut austin|ut-austin'), 'education', 'U.S. News Best National Universities, 2025 edition: #30'],
  ['Georgia Tech', 7, university('georgia tech|georgia institute of technology|gatech'), 'education', 'U.S. News Best National Universities, 2025 edition: #33'],
  ['UC Davis', 7, university('uc davis|university of california davis|university of california-davis|u\\.c\\. davis'), 'education', 'U.S. News Best National Universities, 2025 edition: #33'],
  ['University of Illinois Urbana-Champaign', 7, university('university of illinois urbana-champaign|university of illinois at urbana-champaign|university of illinois urbana champaign|uiuc'), 'education', 'U.S. News Best National Universities, 2025 edition: #33'],
  ['Boston College', 7, university('boston college'), 'education', 'U.S. News Best National Universities, 2025 edition: #37'],
  ['University of Wisconsin-Madison', 7, university('university of wisconsin-madison|university of wisconsin madison|uw-madison|uw madison'), 'education', 'U.S. News Best National Universities, 2025 edition: #39'],
  ['Boston University', 7, university('boston university'), 'education', 'U.S. News Best National Universities, 2025 edition: #41'],
  ['Ohio State University', 7, university('ohio state university|ohio state'), 'education', 'U.S. News Best National Universities, 2025 edition: #41'],
  ['Rutgers University-New Brunswick', 7, university('rutgers university-new brunswick|rutgers university new brunswick|rutgers-new brunswick|rutgers new brunswick'), 'education', 'U.S. News Best National Universities, 2025 edition: #41'],
  ['University of Maryland College Park', 7, university('university of maryland college park|university of maryland-college park|university of maryland at college park|umcp'), 'education', 'U.S. News Best National Universities, 2025 edition: #44'],
  ['University of Rochester', 7, university('university of rochester'), 'education', 'U.S. News Best National Universities, 2025 edition: #44'],
  ['Lehigh University', 7, university('lehigh university|lehigh'), 'education', 'U.S. News Best National Universities, 2025 edition: #46'],
  ['Purdue University', 7, university('purdue university|purdue|purdue university west lafayette|purdue university-west lafayette'), 'education', 'U.S. News Best National Universities, 2025 edition: #46'],
  ['University of Georgia', 7, university('university of georgia'), 'education', 'U.S. News Best National Universities, 2025 edition: #46'],
  ['University of Washington', 7, university('university of washington|university of washington seattle|university of washington-seattle|uw seattle'), 'education', 'U.S. News Best National Universities, 2025 edition: #46'],
  ['Wake Forest University', 7, university('wake forest university|wake forest'), 'education', 'U.S. News Best National Universities, 2025 edition: #46'],
  ['Case Western Reserve University', 6, university('case western reserve university|case western|cwru'), 'education', 'U.S. News Best National Universities, 2025 edition: #51'],
  ['Texas A&M University', 6, university('texas a&m university|texas a&m|texas a&m university-college station|texas a&m university college station|tamu'), 'education', 'U.S. News Best National Universities, 2025 edition: #51'],
  ['Virginia Tech', 6, university('virginia tech|virginia polytechnic institute'), 'education', 'U.S. News Best National Universities, 2025 edition: #51'],
  ['Florida State University', 6, university('florida state university|florida state'), 'education', 'U.S. News Best National Universities, 2025 edition: #54'],
  ['Northeastern University', 6, university('northeastern university|northeastern'), 'education', 'U.S. News Best National Universities, 2025 edition: #54'],
  ['William & Mary', 6, university('william & mary|college of william & mary|college of william and mary|william and mary|w&m'), 'education', 'U.S. News Best National Universities, 2025 edition: #54'],
  ['North Carolina State University', 6, university('north carolina state university|nc state university|nc state|n\\.c\\. state|ncsu'), 'education', 'U.S. News Best National Universities, 2025 edition: #58'],
  ['Stony Brook University', 6, university('stony brook university|stony brook|suny stony brook|stony brook university-suny'), 'education', 'U.S. News Best National Universities, 2025 edition: #58'],
  ['UC Merced', 6, university('uc merced|university of california merced|university of california-merced'), 'education', 'U.S. News Best National Universities, 2025 edition: #58'],
  ['UMass Amherst', 6, university('umass amherst|university of massachusetts amherst|university of massachusetts-amherst|umass-amherst'), 'education', 'U.S. News Best National Universities, 2025 edition: #58'],
  ['Villanova University', 6, university('villanova university|villanova'), 'education', 'U.S. News Best National Universities, 2025 edition: #58'],
  ['Brandeis University', 6, exactly('brandeis university', 'brandeis'), 'education', 'U.S. News Best National Universities, 2025 edition: #63'],
  ['George Washington University', 6, university('george washington university'), 'education', 'U.S. News Best National Universities, 2025 edition: #63'],
  ['Michigan State University', 6, university('michigan state university|michigan state'), 'education', 'U.S. News Best National Universities, 2025 edition: #63'],
  ['Penn State', 6, university('penn state|pennsylvania state university|pennsylvania state university-university park|penn state university park|penn state university'), 'education', 'U.S. News Best National Universities, 2025 edition: #63'],
  ['Santa Clara University', 6, university('santa clara university'), 'education', 'U.S. News Best National Universities, 2025 edition: #63'],
  ['Tulane University', 6, university('tulane university|tulane'), 'education', 'U.S. News Best National Universities, 2025 edition: #63'],
  ['University of Miami', 6, university('university of miami'), 'education', 'U.S. News Best National Universities, 2025 edition: #63'],
  ['Rensselaer Polytechnic Institute', 6, university('rensselaer polytechnic institute|rensselaer|rpi'), 'education', 'U.S. News Best National Universities, 2025 edition: #70'],
  ['University of Connecticut', 6, university('university of connecticut|uconn'), 'education', 'U.S. News Best National Universities, 2025 edition: #70'],
  ['University of Pittsburgh', 6, university('university of pittsburgh|pitt'), 'education', 'U.S. News Best National Universities, 2025 edition: #70'],
  ['Binghamton University', 6, university('binghamton university|binghamton university-suny|suny binghamton|binghamton'), 'education', 'U.S. News Best National Universities, 2025 edition: #73'],
  ['Indiana University Bloomington', 6, university('indiana university bloomington|indiana university-bloomington|iu bloomington|indiana university'), 'education', 'U.S. News Best National Universities, 2025 edition: #73'],
  ['Syracuse University', 6, university('syracuse university|syracuse'), 'education', 'U.S. News Best National Universities, 2025 edition: #73'],
  ['Colorado School of Mines', 6, university('colorado school of mines|colorado mines'), 'education', 'U.S. News Best National Universities, 2025 edition: #76'],
  ['Stevens Institute of Technology', 6, university('stevens institute of technology'), 'education', 'U.S. News Best National Universities, 2025 edition: #76'],
  ['University at Buffalo', 6, university('university at buffalo|university at buffalo-suny|suny buffalo|suny at buffalo|university of buffalo'), 'education', 'U.S. News Best National Universities, 2025 edition: #76'],
  ['UC Riverside', 6, university('uc riverside|university of california riverside|university of california-riverside'), 'education', 'U.S. News Best National Universities, 2025 edition: #76'],
  ['Clemson University', 6, university('clemson university|clemson'), 'education', 'U.S. News Best National Universities, 2025 edition: #80'],
  ['Pepperdine University', 6, university('pepperdine university|pepperdine'), 'education', 'U.S. News Best National Universities, 2025 edition: #80'],
  ['Rutgers University-Newark', 6, university('rutgers university-newark|rutgers university newark|rutgers-newark|rutgers newark'), 'education', 'U.S. News Best National Universities, 2025 edition: #80'],
  ['University of Illinois Chicago', 6, university('university of illinois chicago|university of illinois at chicago|university of illinois-chicago'), 'education', 'U.S. News Best National Universities, 2025 edition: #80'],
  ['New Jersey Institute of Technology', 6, university('new jersey institute of technology|njit'), 'education', 'U.S. News Best National Universities, 2025 edition: #84'],
  ['UC Santa Cruz', 6, university('uc santa cruz|university of california santa cruz|university of california-santa cruz'), 'education', 'U.S. News Best National Universities, 2025 edition: #84'],
  ['Drexel University', 6, university('drexel university|drexel'), 'education', 'U.S. News Best National Universities, 2025 edition: #86'],
  ['Howard University', 6, university('howard university'), 'education', 'U.S. News Best National Universities, 2025 edition: #86'],
  ['Marquette University', 6, university('marquette university|marquette'), 'education', 'U.S. News Best National Universities, 2025 edition: #86'],
  ['University of Delaware', 6, university('university of delaware|udel'), 'education', 'U.S. News Best National Universities, 2025 edition: #86'],
  ['Worcester Polytechnic Institute', 6, university('worcester polytechnic institute|wpi'), 'education', 'U.S. News Best National Universities, 2025 edition: #86'],
  ['American University', 6, university('american university'), 'education', 'U.S. News Best National Universities, 2025 edition: #91'],
  ['Baylor University', 6, university('baylor university'), 'education', 'U.S. News Best National Universities, 2025 edition: #91'],
  ['Fordham University', 6, university('fordham university|fordham'), 'education', 'U.S. News Best National Universities, 2025 edition: #91'],
  ['Loyola Marymount University', 6, university('loyola marymount university|loyola marymount'), 'education', 'U.S. News Best National Universities, 2025 edition: #91'],
  ['Rochester Institute of Technology', 6, university('rochester institute of technology|rit'), 'education', 'U.S. News Best National Universities, 2025 edition: #91'],
  ['Southern Methodist University', 6, university('southern methodist university'), 'education', 'U.S. News Best National Universities, 2025 edition: #91'],
  ['Florida International University', 6, university('florida international university|fiu'), 'education', 'U.S. News Best National Universities, 2025 edition: #98'],
  ['Gonzaga University', 6, university('gonzaga university|gonzaga'), 'education', 'U.S. News Best National Universities, 2025 edition: #98'],
  ['Rutgers University-Camden', 6, university('rutgers university-camden|rutgers university camden|rutgers-camden|rutgers camden'), 'education', 'U.S. News Best National Universities, 2025 edition: #98'],
  ['Temple University', 6, university('temple university'), 'education', 'U.S. News Best National Universities, 2025 edition: #98'],
  ['University of Colorado Boulder', 6, university('university of colorado boulder|university of colorado at boulder|university of colorado-boulder|cu boulder|cu-boulder'), 'education', 'U.S. News Best National Universities, 2025 edition: #98'],
  ['University of Iowa', 6, university('university of iowa|uiowa'), 'education', 'U.S. News Best National Universities, 2025 edition: #98'],
  ['Yeshiva University', 6, university('yeshiva university'), 'education', 'U.S. News Best National Universities, 2025 edition: #98'],
  // ── end of the public lists ──
];

const JUNK_COMPANY = /^(self[-\s]?employed|freelance|various|multiple|confidential|n\/a|none|tbd|open to work|looking|seeking)$/i;
// "at scale", "at the intersection of…", "at heart", "at home", "at best",
// "at best-in-class companies": phrases, not employers. The Home Depot, Home
// Instead and Home Chef are employers, and so are Best Buy, Best Western and
// Best Friends Animal Society.
const NOT_A_COMPANY = /^(scale$|heart|large|night|home(?! (depot|instead|chef)\b)|work|speed|best(?=$|[-\s]in[-\s]class|\s(of|practices?)\b)|the intersection|intersection|the crossroads|the forefront|the core|every stage|all levels|your service)\b/i;
// Where a company's name stops: a sentence's end ("Acme Corp. We build…") or a
// comma, but not the full stop of an initial or a short form ("J.P. Morgan",
// "J. Crew", "T. Rowe Price", "U.S. Bank", "St. Jude Children's Research
// Hospital"), which used to cut the name to "J.P" or nothing.
const NAME_END = /(?<!\b(?:[a-z]|st|mt|ft))\.\s|,\s/i;
// A company's legal form, trimmed so "Acme, Inc." and "Acme" are one company.
const LEGAL_FORM = /,?\s+(inc|incorporated|llc|ltd|l\.l\.c|corp|corporation|co|gmbh|plc|pbc)\.?$/i;
// Names that are another company with their legal form than without it: Chase
// Corporation (coatings) isn't Chase the bank, nor Merrill Corporation
// (financial printing) Bank of America's Merrill. Kept whole, so no alias takes them.
const WHOLE_NAME = /^(chase|merrill) corp(oration)?$/i;
// A name that says it is a school only matches a school on the list: the
// aliases match from the start of a name, so "Kellogg School of Management"
// read as Kellanova, "Warner University" as Warner Bros., "Campbell
// University" as Campbell's and "Chase College of Law" as JPMorgan Chase.
const SCHOOL_NAME = /\b(school|college|university)\b/;
// A credential, a program or gig work on a listed company's platform, or a fan
// of it, is not a job there: "AWS Certified Solutions Architect", "Google
// Developer Expert", "Uber Driver", "Airbnb Superhost", "Twitch Streamer",
// "TikTok Shop Seller", "LinkedIn Top Voice", "Google Alum", "Disney Fan".
// People write those as the first part of a headline, where a listed name
// reads as their employer; none of the listed companies' own names says them.
const NOT_ITS_STAFF = /\b(certified|certifications?|mvps?|champions?|experts?|ambassadors?|developers?|instructors?|trainers?|moderators?|superhosts?|hosts?|drivers?|dashers?|couriers?|shoppers?|sellers?|fba|kdp|dsp|franchisees?|streamers?|affiliates?|creators?|influencers?|athletes?|scholars?|shareholders?|alum|alumni|alumnus|alumna|alumnae|top voice|users? groups?|for startups|fans?|enthusiasts?|lovers?|nerds?|geeks?|junkies?|buffs?|addicts?|aficionados?|10,?000 (small businesses|women)|10ksb)\b/;
// A tech or media platform's partners, consultants and admins are other
// companies' staff ("Google Premier Partner", "Salesforce Consultant",
// "Workday Admin"). At a bank, a firm or a shop they work there ("Deloitte
// Partner", "Starbucks Partner"), so this reads only against those industries.
const PLATFORM_ROLE = /\b(partners?|consultants?|admins?|administrators?)\b/;
const PLATFORMS = new Set(['tech', 'media', 'entertainment']);

/** A company name as people write it → one clean, canonical name (or null). */
export function cleanCompany(raw) {
  // NFKC first: styled letters ("𝗠𝗶𝗰𝗿𝗼𝘀𝗼𝗳𝘁") and full-width punctuation ("｜")
  // become plain ones. Private-use glyphs go with the emoji: the Apple logo
  // () after "Apple" used to leave it unread.
  let s = String(raw || '')
    .normalize('NFKC')
    .replace(/[\p{Extended_Pictographic}\p{Co}\u{FE0F}‍]/gu, '')
    .split(/\s*(?:\||•|·| – | — | - |!|\(|\/| {2,})\s*/)[0]
    .split(NAME_END)[0]
    .replace(/[\s,.:;'"]+$/, '')
    // A class year ("UCF ’26", "UF '28") is a student's; the school is the name.
    .replace(/\s+['’‘]\d{2}$/, '');
  if (!WHOLE_NAME.test(s)) s = s.replace(LEGAL_FORM, '');
  s = s.trim();
  if (!s || s.length < 2 || JUNK_COMPANY.test(s) || NOT_A_COMPANY.test(s)) return null;
  if (s.length > 50 || s.split(/\s+/).length > 6 || /\$|\d+%|\d+[kmb]\+/i.test(s)) return null;
  const lower = s.toLowerCase();
  const bare = lower.replace(/^the /, '');
  const school = SCHOOL_NAME.test(lower);
  const notStaff = NOT_ITS_STAFF.test(bare);
  const platformRole = PLATFORM_ROLE.test(bare);
  // The curated list, then the public dataset: a name either one claims.
  for (const list of [KNOWN_COMPANIES, COMPANY_DATA]) {
    for (const [name, , alias, industry] of list) {
      if (school && industry !== 'education') continue;
      if (lower === name.toLowerCase()) return name;
      if (notStaff || (platformRole && PLATFORMS.has(industry))) continue;
      if (alias.test(lower) || alias.test(bare)) return name;
    }
  }
  return s;
}

const KNOWN_BY_NAME = new Map(KNOWN_COMPANIES.map(([name, score]) => [name, score]));
const DATA_BY_NAME = new Map(COMPANY_DATA.map(([name, score]) => [name, score]));
// Industries from both lists: a dataset company's own, like a curated one's.
const KNOWN_INDUSTRY = new Map([...KNOWN_COMPANIES, ...COMPANY_DATA].map(([name, , , industry]) => [name, industry]));

const isKnownCompany = (text) => {
  const c = cleanCompany(text);
  return !!c && (KNOWN_BY_NAME.has(c) || DATA_BY_NAME.has(c));
};

/**
 * Each role with its company filled in where the headline didn't say: a
 * company scan's company, else the stored company (unless that company is
 * only mentioned in an "Ex-" part), goes to the first current role that is a
 * title (an audience has no employer). A company scan's company also goes
 * before one only inferred from the headline (readRoles); the stored one,
 * which ingest reads from the headline's "at", doesn't.
 */
export function rolesWithCompanies(row) {
  const roles = readRoles(row?.headline, row?.role);
  const scanned = cleanCompany(row?.scanned_company);
  const fill = scanned || (() => {
    const stored = cleanCompany(row?.company);
    return stored && !roles.some((r) => r.former && r.company === stored) ? stored : null;
  })();
  const first = roles.find((r) => !r.former && !r.audience);
  if (fill && first && (!first.company || (scanned && first.inferred))) first.company = fill;
  if (fill && !first) roles.unshift({ title: { ...LEVELS.unknown }, company: fill, former: false, part: '' });
  if (!roles.length) roles.push({ title: { ...LEVELS.unknown }, company: null, former: false, part: '' });
  return roles;
}

/** The company a person works at now (their first current title's). */
export function currentCompany(row) {
  return rolesWithCompanies(row).find((r) => !r.former && !r.audience)?.company || null;
}

function companyIn(part = '') {
  const m = String(part).match(/(?:\s(?:at\s+|@\s*)|^@|\s@)(.+)$/i);
  return m ? cleanCompany(m[1]) : null;
}

// ── industry ─────────────────────────────────────────────────────────────────

export const UNCLEAR = 'unknown';

/** The curated list's industry for a company, by its name or any alias of it. */
export function knownIndustry(name) {
  if (!name) return null;
  return KNOWN_INDUSTRY.get(name) || KNOWN_INDUSTRY.get(cleanCompany(name)) || null;
}

/** The answer most of them give, ignoring "unclear"; a tie stays unclear. */
function mostSaid(answers = []) {
  const counts = new Map();
  for (const a of answers) if (a && a !== UNCLEAR) counts.set(a, (counts.get(a) || 0) + 1);
  let best = UNCLEAR;
  let top = 0;
  let tied = false;
  for (const [key, n] of counts) {
    if (n > top) { best = key; top = n; tied = false; } else if (n === top) tied = true;
  }
  return tied ? UNCLEAR : best;
}

/**
 * One industry per company, so its colour in Paths, its row in Scores and any
 * sector lean agree. In order: the curated list's own industry; what the name
 * says; otherwise what most of the people who work there now say in their
 * headlines. A tie stays unclear rather than guessed, which also keeps the
 * answer the same whichever order the rows arrive in (the server and Paths
 * read them in different orders).
 *
 * `industryOf(company, headline)` returns an industry key; it is
 * lib/companies.js's inference, passed in so this file needs no imports.
 * Without it only the curated list can answer.
 */
export function companyIndustry(name, options) {
  return industryAndSource(name, options).industry;
}

/**
 * companyIndustry, with where the answer came from: 'list' (the curated
 * list), 'name' (the company's name) or 'people' (their headlines), or null
 * when it is unclear. Your sector's broad picks count only the first two
 * (leanToward): the people's vote is over job words every kind of company
 * employs, so "Recruiter at Acme Widgets" alone would put Acme in consulting.
 * @returns { industry, from }
 */
export function industryAndSource(name, { industryOf, headlines = [] } = {}) {
  if (!name) return { industry: UNCLEAR, from: null };
  const known = knownIndustry(name);
  if (known) return { industry: known, from: 'list' };
  if (!industryOf) return { industry: UNCLEAR, from: null };
  const byName = industryOf(name, null);
  if (byName && byName !== UNCLEAR) return { industry: byName, from: 'name' };
  const voted = mostSaid(headlines.map((h) => industryOf(null, h)));
  return { industry: voted, from: voted === UNCLEAR ? null : 'people' };
}

/** The broad industries a company's directory sectors sit under, each once, in their order. */
const industriesUnder = (keys, groupOf) => [...new Set(keys.map(groupOf).filter(Boolean))];

/**
 * Per company, from the people who work there now (each person once): how
 * many there are, and the company's one industry. `rolesOf` lets a caller
 * that also reads each row's roles (Paths) parse every headline once.
 * `sectorsOf(name, headlines)` is Settings' sector directory
 * (lib/sector-directory.js sectorMatcher), passed in like `industryOf`; with
 * it, each company also gets the directory's sectors it matches, and with
 * `groupOf(sector key)` (lib/sector-directory.js sectorGroup) the broad
 * industries those sectors sit under.
 * @returns { headcount: Map name → n, industries: Map name → industry key,
 *   industryFrom: Map name → 'list' | 'name' | 'people' | null (industryAndSource),
 *   sectors: Map name → sector keys, sectorIndustries: Map name → industry keys }
 */
export function networkCompanies(rows = [], { industryOf, sectorsOf, groupOf, rolesOf = rolesWithCompanies } = {}) {
  const at = new Map();
  const seen = new Set();
  for (const r of rows) {
    for (const role of rolesOf(r)) {
      const key = `${role.company}|${r.profile_url || r.id}`;
      if (!role.company || role.former || seen.has(key)) continue;
      seen.add(key);
      const c = at.get(role.company) || { n: 0, headlines: [] };
      c.n++;
      c.headlines.push(r.headline);
      at.set(role.company, c);
    }
  }
  const headcount = new Map();
  const industries = new Map();
  const industryFrom = new Map();
  const sectors = new Map();
  const sectorIndustries = new Map();
  for (const [name, c] of at) {
    headcount.set(name, c.n);
    const { industry, from } = industryAndSource(name, { industryOf, headlines: c.headlines });
    industries.set(name, industry);
    industryFrom.set(name, from);
    if (!sectorsOf) continue;
    const keys = sectorsOf(name, c.headlines);
    sectors.set(name, keys);
    if (groupOf) sectorIndustries.set(name, industriesUnder(keys, groupOf));
  }
  return { headcount, industries, industryFrom, sectors, sectorIndustries };
}

// ── your sector ──────────────────────────────────────────────────────────────

// Points a company in one of your sectors gets on top of its score (Settings →
// Your sector). A point of company score is worth 0.055 × title points: +0.55
// for a founder, +0.41 for a director, +0.22 for an IC.
export const SECTOR_BONUS = { lean: 1, strong: 2 };

/**
 * A company score leaned toward your sectors: `focus` is { sectors, strength:
 * 'lean' | 'strong' } as saved in Settings, where a sector is a broad industry
 * key or a key from the sector directory. A directory sector matches when it
 * is among the company's `sectors` (the directory's matches, injected). A
 * broad industry includes its sectors: it matches any industry the company's
 * sectors sit under (`sectorIndustries`), so Healthcare & Biotech picks up a
 * practice only the directory calls dental, and the company's one `industry`
 * when the curated list or its name gave it (`industryFrom`). An industry
 * voted by its people's headlines doesn't count: the vote is over job words
 * every kind of company employs (recruiter, attorney, engineer, data), so a
 * lone "Recruiter at Acme Widgets" would make Acme consulting. The
 * directory's sectors, which don't read a job for work every company has, are
 * what count for such a company. However many match, the bonus is added once;
 * `sector` names the pick that matched, a directory sector before a broad
 * industry. Capped at 10. The extra fields appear only when the score actually
 * moved, so everything that reads a plain { score, source } keeps working.
 */
function leanToward(base, industry, industryFrom, sectors, sectorIndustries, focus) {
  const bonus = SECTOR_BONUS[focus?.strength] || 0;
  if (!bonus || !Array.isArray(focus.sectors)) return base;
  const byIndustry = industryFrom !== 'people';
  const pick = (sectors?.length && focus.sectors.find((k) => sectors.includes(k)))
    || focus.sectors.find((k) => (byIndustry && k === industry) || sectorIndustries?.includes(k));
  if (!pick) return base;
  const score = Math.min(10, base.score + bonus);
  if (score === base.score) return base;
  return { ...base, score, base: base.score, sector: pick, sectorBonus: score - base.score };
}

// A company the list doesn't know, or none found at all, is the middle of the
// scale: not knowing a company says nothing about how big it is, so it neither
// lifts someone's title nor sinks it. Until scoring 4 an unknown company was 4
// and no company 3, which pushed down everyone the curated list doesn't know:
// most of a network outside big tech, and founders who write only their
// company's name. How many of your people work there still nudges it up.
export const UNKNOWN_COMPANY = 5;

/**
 * A company's score and where it came from.
 *   yours    you set it
 *   known    the curated list above
 *   data     the public company dataset (COMPANY_DATA): 6 to 8, from public facts
 *   network  unknown to both; nudged up when several of your people work there
 *   default  unknown, and few of your people there
 *   none     no company found for this person
 * With a sector focus, a company in one of your sectors gets +1 or +2 on top
 * ({ base, sector, sectorBonus } say so). A score you set is never changed.
 * `industry` is the company's one industry (companyIndustry); a curated
 * company's own is used when none is given. `industryFrom` says where it
 * came from (industryAndSource): one from its people's headlines doesn't lean
 * it (leanToward). `sectors` are the sector directory's keys it matches
 * (lib/sector-directory.js), when known, and `sectorIndustries` the broad
 * industries those sit under. companyScoreIn() passes all of these from a
 * read of the network.
 */
export function companyScore(name, { overrides = new Map(), headcount = 0, industry, industryFrom, sectors, sectorIndustries, focus } = {}) {
  if (!name) return { score: UNKNOWN_COMPANY, source: 'none' };
  if (overrides.has(name)) return { score: overrides.get(name), source: 'yours' };
  const ind = industry ?? KNOWN_INDUSTRY.get(name);
  let base;
  if (KNOWN_BY_NAME.has(name)) base = { score: KNOWN_BY_NAME.get(name), source: 'known' };
  else if (DATA_BY_NAME.has(name)) base = { score: DATA_BY_NAME.get(name), source: 'data' };
  else if (ind !== 'education' && headcount >= 15) base = { score: 6, source: 'network' };
  else if (ind !== 'education' && headcount >= 5) base = { score: 5.5, source: 'network' };
  else base = { score: UNKNOWN_COMPANY, source: 'default' };
  return focus ? leanToward(base, ind, industryFrom, sectors, sectorIndustries, focus) : base;
}

/**
 * A company's score from a read of the network (readNetwork): its headcount,
 * industry and where that came from, and its sectors, as scoreNetwork scores
 * it. Rescoring, Settings' preview and Paths → Scores all score a company
 * through this, so they give it the same score.
 */
export function companyScoreIn(read, name, { overrides, focus } = {}) {
  const c = name ? read?.companies.get(name) : null;
  return companyScore(name, {
    overrides, headcount: c?.headcount || 0, industry: c?.industry, industryFrom: c?.industryFrom,
    sectors: c?.sectors, sectorIndustries: c?.sectorIndustries, focus,
  });
}

// ── reach bonus ──────────────────────────────────────────────────────────────

// The top honours of every field, so recognition doesn't depend on which field
// someone is in: science, economics, peace and literature (Nobel), journalism
// (Pulitzer), broadcasting (Peabody), TV (Emmy), music (Grammy), film (Oscar),
// theatre (Tony), the web (Webby), advertising (Clio, Cannes Lions), food
// (James Beard), computing (Turing), mathematics (Fields), architecture
// (Pritzker), sport (the Olympics and Paralympics), and the MacArthur and
// Rhodes. An award's name alone can be a company's, a person's or its own
// organisation's ("Oscar Health", "Peabody Energy", Clio the legal software,
// "Tony", "Emmy's Bakery", "the Peabody Awards", "Pulitzer Center"), so those
// count only as claimed: "… Award", "…-winning", "… winner", "… nominee".
// docs/brain/SCORING.md says what the list replaced.
const HONOURS = [
  String.raw`nobel (prize|laureate)`, String.raw`pulitzer( prize|[-\s](winning|winner|finalist))`,
  String.raw`(emmy|grammy|oscar|tony|peabody|clio|james beard|turing)[-\s](award|winning|winner|nominated|nominee|honoree)`,
  'academy award', 'webby', 'cannes lions', 'fields medal', 'pritzker prize', 'macarthur fellow', 'rhodes scholar',
  String.raw`(olympi|paralympi)(an|c (gold|silver|bronze|medalist|champion))`,
].join('|');

const BONUSES = [
  [/\b(angel investor|investor|venture capital(ist)?|vc|general partner|limited partner)\b(?! relations)/i, 1, 'investor'],
  [/\by ?combinator\b|\(yc\)|\byc\b ?[wsfx]?\d{0,2}\b/i, 1, 'YC'],
  [/\b30 under 30\b/i, 1, '30 under 30'],
  [/\b(\d[\d.,]*\s?(m|b|million|billion)|\d{1,3}(,\d{3}){2,})\+?\s*(views|followers|subscribers|impressions|users|downloads|installs|listeners|students|customers|members|reach)\b|\$?\s?\d[\d.,]*\s?(m|b|million|billion)\+?\s*(in )?(sales|revenue|arr|gmv|raised|funding)\b|\braised \$?\s?\d[\d.,]*\s?(m|b|million|billion)\b/i, 0.75, 'reach in the millions'],
  [new RegExp(String.raw`\b(tedx?|keynote|patents?|author of|best[-\s]?selling|award[-\s]winning|prize[-\s]winning|${HONOURS})\b`, 'i'), 0.5, 'recognition'],
];

/** The headline's reach signals before any halving: points (capped at 1.5) and reasons. */
function readReach(headline = '') {
  let points = 0;
  const reasons = [];
  for (const [re, p, label] of BONUSES) if (re.test(headline || '')) { points += p; reasons.push(label); }
  return { points: Math.min(1.5, points), reasons };
}

/**
 * Bonus points from signals in the headline, capped at 1.5, with the reasons.
 * Headlines are self-written: claims from someone at a company nobody knows
 * (company score 4 or less; scorePerson passes 4 for a company we don't know,
 * whatever its neutral score) count half. `found` is the headline's
 * readReach(), when it has been read already.
 */
export function reachBonus(headline = '', companyScoreValue = 10, found = readReach(headline)) {
  let { points } = found;
  const reasons = [...found.reasons];
  if (points && companyScoreValue <= 4) { points /= 2; reasons.push('halved: unknown company'); }
  return { points: round1(points), reasons };
}

// ── what stored scores were read with ────────────────────────────────────────

// Every table of words and rules above that reads a headline or a company
// name: the title ladder and its rules, the student, club and former rules,
// what isn't a company or a job there, and the reach bonuses. lib/rpc.js
// fingerprints them, with the curated list and the industries' words, into
// the stamp stored scores carry, so editing any of them rescores stored scores
// once, with no SCORING_VERSION to remember. How they're combined (the
// formula, the weights, the order of the steps) is still a SCORING_VERSION.
export const RULE_TABLES = {
  levels: LEVELS, titles: TITLE_RULES, intern: INTERN, student: STUDENT, major: MAJOR, shortName: SHORT_NAME,
  atShortName: AT_SHORT_NAME, notASchool: NOT_A_SCHOOL, studentOrg: STUDENT_ORG, schoolWordClub: SCHOOL_WORD_CLUB,
  club: CLUB, shortNameClub: SHORT_NAME_CLUB, fieldAssociation: FIELD_ASSOCIATION, grownUp: GROWN_UP, former: FORMER,
  junkCompany: JUNK_COMPANY, notACompany: NOT_A_COMPANY, nameEnd: NAME_END, legalForm: LEGAL_FORM, wholeName: WHOLE_NAME,
  schoolName: SCHOOL_NAME, notItsStaff: NOT_ITS_STAFF, platformRole: PLATFORM_ROLE, platforms: PLATFORMS, bonuses: BONUSES,
  audience: AUDIENCE, notTheirAudience: NOT_THEIR_AUDIENCE, audienceUnits: UNIT, ownVenture: OWN_VENTURE,
  affiliation: AFFILIATION, academic: ACADEMIC, retired: RETIRED, retiredOnly: RETIRED_ONLY, officeName: OFFICE_NAME, atCompany: AT_COMPANY, healthOrg: HEALTH_ORG, serviceSchool: SERVICE_SCHOOL,
  offices: OFFICE_TABLES,
};

// ── putting it together ──────────────────────────────────────────────────────

// The fixed scale, the same lines for everyone. In a network like the one it
// was tuned on, S is the top ~3–4%: VP and up at strong companies, founders and
// C-suite at known ones, directors only at 10/10 companies. In a network the
// curated list barely knows (most of them), hardly anyone reaches S or A.
export function tierFor(power) {
  if (power >= 7.5) return 'S';
  if (power >= 5.5) return 'A';
  if (power >= 4) return 'B';
  if (power >= 2.5) return 'C';
  return 'D';
}

// Settings → Tiers: graded on your network's curve (the default), or on the
// fixed scale above.
export const TIER_SCALES = ['curve', 'fixed'];
export const TIER_SCALE_SETTING = {
  default: 'curve',
  parse(value) {
    if (TIER_SCALES.includes(value)) return value;
    throw new Error("Tiers are graded either on your network's curve ('curve') or on the fixed scale ('fixed').");
  },
};

// The curve: the share of your 1st-degree people at each tier or above. Your
// top 3% are S, the next 12% A, the next 25% B, the next 30% C, the rest D:
// about where the fixed scale puts a network full of companies it knows.
export const CURVE = [['S', 0.03], ['A', 0.15], ['B', 0.4], ['C', 0.7]];
// The curve finds the best of any network, but it doesn't lift anyone under
// this power (B on the fixed scale) into S or A: in a network of students,
// the strongest classmate is B at most.
export const CURVE_FLOOR = 4;
const TIER_RANK = { D: 0, C: 1, B: 2, A: 3, S: 4 };

/**
 * Where each tier starts on this network's curve: the power of the last person
 * inside each share of `powers` (your 1st-degree people's, before any circle
 * boost), best first. At least one person reaches each cut-off, so a small
 * network still has a top. People tied at a cut-off all come in or all stay
 * out, whichever lands nearer the share (in, when it's as near): a network
 * where eight people read "Store Manager" at companies nobody knows, all at
 * the same power, shouldn't put all eight in A to fill two places. Null for an
 * empty network.
 */
export function curveCutoffs(powers = []) {
  const best = powers.filter(Number.isFinite).sort((a, b) => b - a);
  if (!best.length) return null;
  const cut = {};
  for (const [tier, share] of CURVE) {
    const k = Math.max(1, Math.round(best.length * share));
    const at = best[k - 1];
    const through = best.filter((p) => p >= at).length;     // everyone tied there comes in…
    const above = best.filter((p) => p > at).length;        // …or no one tied there does
    cut[tier] = above === 0 || through - k <= k - above ? at : best[above - 1];
  }
  return cut;
}

/**
 * A tier graded on the curve: the fixed scale's tier, lifted to the curve's
 * when that is higher. The curve only lifts, so a strong network keeps its
 * fixed-scale tiers, and it never lifts anyone under CURVE_FLOOR into S or A.
 * Without `cutoffs` (the fixed scale chosen, or no network yet), the fixed tier.
 */
export function curvedTier(power, cutoffs) {
  const fixed = tierFor(power);
  if (!cutoffs) return fixed;
  let curve = 'D';
  if (power >= cutoffs.C) curve = 'C';
  if (power >= cutoffs.B) curve = 'B';
  if (power >= cutoffs.A && power >= CURVE_FLOOR) curve = 'A';
  if (power >= cutoffs.S && power >= CURVE_FLOOR) curve = 'S';
  return TIER_RANK[curve] > TIER_RANK[fixed] ? curve : fixed;
}

const round1 = (n) => Math.round(n * 10) / 10;

export const FORMER_WEIGHT = 0.7;
export const STUDENT_CAP = 3;

/**
 * What scoring reads from one person's row: every role with its company,
 * whether they are a student now, and the headline's reach signals. Reading
 * headlines is most of the work, so a network read once (readNetwork) can be
 * scored several ways: Settings' preview scores it with two sector focuses.
 */
export function readPerson(row) {
  return { roles: rolesWithCompanies(row), student: isStudent(row?.headline), reach: readReach(row?.headline) };
}

/**
 * One person's score, before any bridge boost: their strongest role, where a
 * role is worth title × company weight. Former roles count at 70% — an ex-SVP
 * still knows the people an SVP knows. A current student is capped at 3 title
 * points whatever else they list. `companyFor(name)` returns companyScore();
 * `read` is the row's readPerson(), when it has been read already.
 */
/** A role's title points as they count: 70% for a former role, capped for a student. */
function rolePoints(role, student) {
  const points = role.title.points * (role.former ? FORMER_WEIGHT : 1);
  return student ? Math.min(points, STUDENT_CAP) : points;
}

export function scorePerson(row, companyFor = (name) => companyScore(name), read = readPerson(row)) {
  const { roles, student, reach } = read;
  let best = null;
  for (const role of roles) {
    const co = companyFor(role.company);
    const points = rolePoints(role, student);
    const core = points * (0.45 + 0.055 * co.score);
    if (!best || core > best.core) best = { role, co, points, core };
  }
  // Halved or not by the company's own score, before any sector lean: that you
  // like a sector says nothing about whether a self-written claim is true. A
  // company we don't know counts as 4 here, as it did before it became neutral:
  // not knowing the company doesn't make a self-written claim any truer.
  const unknown = best.co.source === 'default' || best.co.source === 'none';
  const bonus = reachBonus(row?.headline, unknown ? 4 : best.co.base ?? best.co.score, reach);
  const power = round1(best.core + bonus.points);
  const title = { ...best.role.title, former: best.role.former, student, points: round1(best.points) };
  if (best.role.former) title.label = `Former ${title.label}`;
  if (student && best.role.title.level > 0) title.label = `Student · ${title.label}`;
  const out = { title, company: best.role.company, companyScore: best.co.score, companySource: best.co.source, bonus, power, tier: tierFor(power) };
  // Only when your sector moved the company's score, so explainScore can show it.
  if (best.co.sectorBonus) out.companySector = { key: best.co.sector, base: best.co.base, bonus: best.co.sectorBonus };
  return out;
}

// ── for the views ────────────────────────────────────────────────────────────
// Views that rank or describe people by where they work (the Queue's order,
// the person panel's notes) read the model's own company scores through these,
// so none keeps a list of famous names of its own.

// A company scored this high is a top company wherever a view says so: the
// curated list's major companies and up, or any company your own score or
// your sector puts there.
export const TOP_COMPANY = 8;

/**
 * The company score a row's power was computed with: the row's stored
 * company_prestige_score (a score you set, the curated list's or the
 * network's estimate, and any sector lean), or companyScore()'s for a row not
 * scored yet, which only the curated list can raise.
 */
export function rowCompanyScore(row, read) {
  const stored = Number(row?.company_prestige_score);
  return stored > 0 ? stored : scorePerson(row, undefined, read ?? readPerson(row)).companyScore;
}

/**
 * The company someone's score is built on, their strongest role's, with its
 * score (rowCompanyScore) and whether that role is a former one. A scored row
 * says which role it was by its title points (seniority_score): a former role
 * counts at 70%, so it never has a current role's points. Two roles with the
 * same points go to the one the stored working names (score_why, "… · Beta
 * Labs (9/10, your score)"), since a score you set or your sector can make
 * either the stronger; then to the one whose company the list scores as
 * stored, else the first, as scorePerson keeps the first of equals. A row not
 * scored yet, or whose headline no longer has those points, goes by
 * scorePerson with the list alone.
 * @returns { name, score, former } — name is null when no company was found
 */
export function scoredCompany(row, read = readPerson(row)) {
  const stored = Number(row?.company_prestige_score);
  if (stored > 0) {
    const points = Number(row?.seniority_score);
    const same = read.roles.filter((r) => Math.abs(round1(rolePoints(r, read.student)) - points) < 0.05);
    const why = String(row?.score_why || '');
    const role = same.find((r) => r.company && why.includes(` · ${r.company} (${stored}/10`))
      || same.find((r) => companyScore(r.company).score === stored) || same[0];
    if (role) return { name: role.company, score: stored, former: role.former };
  }
  const s = scorePerson(row, undefined, read);
  return { name: s.company, score: stored > 0 ? stored : s.companyScore, former: s.title.former };
}

/**
 * The top companies (TOP_COMPANY and up) someone works at now and worked at
 * before, for the person panel's notes: `now` is the company their score is
 * built on when that is a current role, else their first current role's;
 * `before` the best of their former roles' (not the one they're at now), each
 * { name, score } or null. The company their score is built on gets the
 * score it was scored with (scoredCompany); any other gets companyScore()'s,
 * which only the curated list can raise.
 */
export function topCompanies(row) {
  const read = readPerson(row);
  const scored = scoredCompany(row, read);
  const top = (name) => {
    if (!name) return null;
    const score = name === scored.name ? scored.score : companyScore(name).score;
    return score >= TOP_COMPANY ? { name, score } : null;
  };
  const current = read.roles.filter((r) => !r.former && r.company);
  const now = top(!scored.former && current.some((r) => r.company === scored.name) ? scored.name : current[0]?.company);
  let before = null;
  for (const r of read.roles) {
    if (!r.former || r.company === now?.name) continue;
    const t = top(r.company);
    if (t && (!before || t.score > before.score)) before = t;
  }
  return { now, before };
}

/**
 * A 1st-degree person's boost for a strong mapped circle, the larger of:
 *   - its share: up to +1 when the share of their circle at A or S is well
 *     above normal (circles under 20 people are too small to judge a share);
 *   - its strong people: +1 for every 25 at A or S, up to +2, however big the
 *     circle. A big circle's share can look ordinary while it holds more
 *     strong people than most circles have people: that's the hidden power a
 *     vague title doesn't show. Until scoring 6 only the share counted.
 */
export function bridgeBoost(circle = []) {
  const total = circle.length;
  const sCount = circle.filter((p) => p.tier === 'S').length;
  const aCount = circle.filter((p) => p.tier === 'A').length;
  const elitePct = total ? (sCount + aCount) / total : 0;
  const circlePower = sCount * 3 + aCount * 1.5 + elitePct * 10 + Math.log(total + 1) * 1.5;
  const byShare = total >= 20 ? Math.max(0, Math.min(1, (elitePct - 0.12) * 5)) : 0;
  const boost = Math.max(byShare, Math.min(2, (sCount + aCount) / 25));
  const isCatalyst = (sCount >= 5 && elitePct >= 0.25) || circlePower >= 50 || (sCount >= 3 && elitePct >= 0.3);
  return { boost: round1(boost), total, sCount, aCount, elitePct, circlePower, isCatalyst };
}

/**
 * A plain-English line for why someone scores what they do, e.g.
 * "VP / Partner / GM (9) · Quillon (5/10: 4 + 1 your sector: Dental) · +0.7 strong circle".
 * `sectorLabel(key)` names the sector that leaned the company (this file
 * imports nothing, so the labels are passed in); without it the line says
 * "your sector" alone.
 */
export function explainScore(s, boost = 0, { sectorLabel } = {}) {
  const which = s.companySector && sectorLabel?.(s.companySector.key);
  const co = s.companySector
    ? `${s.company} (${s.companyScore}/10: ${s.companySector.base} + ${s.companySector.bonus} your sector${which ? `: ${which}` : ''})`
    : `${s.company || 'no company found'} (${s.companyScore}/10${s.companySource === 'yours' ? ', your score' : ''})`;
  const bits = [`${s.title.label} (${s.title.points})`, co];
  if (s.bonus.points) bits.push(`+${s.bonus.points} ${s.bonus.reasons.join(', ')}`);
  if (boost) bits.push(`+${boost} strong circle`);
  return bits.join(' · ');
}

/**
 * A network read once, to be scored any number of ways: each row's
 * readPerson(), and every company anyone names (in a current role or a former
 * one) with what its score depends on besides your own choices: how many of
 * your people work there now, and its one industry. With `sectorsOf` (the
 * sector directory, as networkCompanies takes it), also the directory's
 * sectors it matches, and with `groupOf` the broad industries those sit
 * under, worked out here once however many ways the read is scored. Pass it
 * to scoreNetwork() with the same rows.
 * @returns { people: Map row → readPerson, headcount, industries,
 *   companies: Map name → { headcount, industry, industryFrom, sectors?, sectorIndustries? } }
 */
export function readNetwork(rows = [], { industryOf, sectorsOf, groupOf } = {}) {
  const people = new Map();
  for (const r of rows) people.set(r, readPerson(r));
  const { headcount, industries, industryFrom, sectors, sectorIndustries } = networkCompanies(rows, {
    industryOf, sectorsOf, groupOf, rolesOf: (r) => people.get(r).roles,
  });
  const companies = new Map();
  for (const [name, n] of headcount) {
    companies.set(name, {
      headcount: n, industry: industries.get(name), industryFrom: industryFrom.get(name),
      ...(sectorsOf && { sectors: sectors.get(name) }),
      ...(sectorsOf && groupOf && { sectorIndustries: sectorIndustries.get(name) }),
    });
  }
  // A company only in someone's former roles has no current people to count or
  // ask; its name (or the curated list) is all there is to go on.
  for (const { roles } of people.values()) {
    for (const { company } of roles) {
      if (!company || companies.has(company)) continue;
      const keys = sectorsOf ? sectorsOf(company, []) : null;
      const { industry, from } = industryAndSource(company, { industryOf });
      companies.set(company, {
        headcount: 0, industry, industryFrom: from,
        ...(keys && { sectors: keys }),
        ...(keys && groupOf && { sectorIndustries: industriesUnder(keys, groupOf) }),
      });
    }
  }
  return { people, headcount, industries, companies };
}

/**
 * Score a whole network. People first, with company scores that can use how
 * many of your people work at each company and each company's one industry;
 * then, with `tierScale` 'curve', everyone is graded on the network's curve,
 * with cut-offs from the 1st-degree people's scores so far (the app passes
 * the saved Settings → Tiers, which is the curve unless you chose otherwise;
 * called without one, a network is graded on the fixed scale); then
 * 1st-degree bridges get their circle boost from their scored circle, judged
 * by the tiers you see, and are graded again on the same cut-offs.
 * `focus` is the sector focus from Settings, or nothing. `read` is
 * readNetwork() of these rows, when they have been read already. Returns one
 * result per row id, plus the per-company facts it used, each company's score
 * (companyScore(), by name) and the curve's cut-offs (null on the fixed scale).
 */
export function scoreNetwork(rows = [], {
  overrides = new Map(), industryOf, sectorsOf, groupOf, focus, tierScale = 'fixed',
  read = readNetwork(rows, { industryOf, sectorsOf, groupOf }),
} = {}) {
  // Each company is scored once; everyone there shares the answer.
  const companyScores = new Map();
  const companyFor = (name) => {
    if (!companyScores.has(name)) companyScores.set(name, companyScoreIn(read, name, { overrides, focus }));
    return companyScores.get(name);
  };
  const out = new Map();
  for (const r of rows) out.set(r.id, { ...scorePerson(r, companyFor, read.people.get(r)), boost: 0 });
  // The curve's cut-offs come from your 1st-degree people before any circle
  // boost, so a boost (which reads the graded tiers) can't move its own cut-off.
  const cutoffs = tierScale === 'fixed' ? null
    : curveCutoffs(rows.filter((r) => r.degree !== 2).map((r) => out.get(r.id).power));
  if (cutoffs) for (const s of out.values()) s.tier = curvedTier(s.power, cutoffs);
  const circles = new Map();
  for (const r of rows) {
    if (r.degree !== 2 || !r.source_connection_id) continue;
    const list = circles.get(r.source_connection_id) || [];
    list.push(out.get(r.id));
    circles.set(r.source_connection_id, list);
  }
  for (const [bridgeId, circle] of circles) {
    const s = out.get(bridgeId);
    if (!s) continue;
    const b = bridgeBoost(circle);
    s.circle = b;
    s.boost = b.boost;
    s.power = round1(s.power + b.boost);
    s.tier = curvedTier(s.power, cutoffs);
  }
  return { scores: out, headcount: read.headcount, industries: read.industries, companyScores, cutoffs };
}
