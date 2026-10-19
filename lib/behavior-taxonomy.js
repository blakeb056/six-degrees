// The learning log's event taxonomy (Blake, 2026-10-19: "a complete logger to
// collect data, behaviour etc, to have true specific data sets to use and point
// at in the future for calibration, analysis, behaviour"). Every kind of event
// the log keeps, every type within it, the fields it carries and when it fires,
// in one table: the server checks what the pages send against it
// (lib/learning-log.js recordBatch), docs/brain/LEARNING-LOG.md describes it,
// and tests/behavior-log.test.mjs holds the three together, so a type that's
// documented but never fired, or fired but never documented, fails a test.
//
// `from` says who records it:
//   page     the app's pages, batched through POST /api/learning (lib/learning-client.js)
//   server   the app's own routes, as the thing happens
//   scanner  the server, reading the scanner's output as it runs (app/api/scraper)
// `reserved` marks a type the server accepts with nothing sending it yet.
//
// Plain data and pure functions, no imports: the pages and the server both
// read it.

export const LEARNING_SCHEMA_VERSION = 2;

const t = (from, when, fields = {}, extra = {}) => Object.freeze({ from, when, fields: Object.freeze(fields), ...extra });

// Fields almost every page event carries, added by the server: the window's
// session (lib/learning-client.js) as `sid`, and the tab it happened on.
export const PAGE_FIELDS = Object.freeze({ sid: 'the window session it happened in', tab: 'the tab it happened on' });

export const TAXONOMY = Object.freeze({
  session: Object.freeze({
    start: t('page', 'a window opens the app (each page load; a reload stays in the same session)', {
      shell: "'desktop' (the Mac or Windows app) or 'browser'", size: 'the window size bucket (sizeBucket)', reload: 'true when the page was reloaded',
      version: 'the app version (added by the server)', plugins: 'installed plugins, id to version (added by the server)',
      class: 'the class picked, or network (added by the server)', theme: 'the look in use (added by the server)',
    }, { limit: 20 }),
    pulse: t('page', 'every 5 minutes while the window is open', { ms: 'time since the session started', activeMs: 'of it, time with the window in front and used in the last minute', views: 'tabs shown so far' }, { limit: 20 }),
    end: t('page', 'the window closes or the page unloads', { ms: 'the session length', activeMs: 'active time', views: 'tabs shown', hiddenMs: 'time with the window hidden' }, { limit: 20 }),
    resize: t('page', 'the window settles at a new size bucket (one second after resizing stops)', { size: 'the new bucket', from: 'the bucket before' }, { limit: 20 }),
  }),
  nav: Object.freeze({
    enter: t('page', 'a tab or a notch sub-tab is shown', {
      tab: 'the tab (network, degrees, separation, map, class, paths, breach, scan, linkedin, profile, settings, ...)', sub: 'the notch sub-tab lit, if any',
      from: 'the tab before', fromSub: 'its sub-tab', entry: "what led there: 'header', 'notch', 'link', 'card', 'button', 'history', 'app' (the app moved itself) or 'open'",
    }, { limit: 120 }),
    dwell: t('page', 'a tab or sub-tab is left (or the window closes): how long it was shown', { tab: 'the tab', sub: 'the sub-tab', ms: 'time shown', activeMs: 'of it, active time' }, { limit: 120 }),
  }),
  control: Object.freeze({
    filter: t('page', "a filter is switched: a tier, a degree or a cell of the Filters grid (or the whole grid, a reset or Show all), Separation's tier and rarity chips and the sector or company it aims at, Paths' level and scanned", {
      what: "'tier', 'degree', 'cell', 'grid', 'rarity', 'company', 'sector', 'path', 'seniority' or 'scanned'", value: 'what was switched (a company or sector by name)',
      on: 'shown after the tap', where: 'the tab or page',
    }, { limit: 120 }),
    tiers: t('page', 'the Tiers switch (Filters, or the chips under the map) is flipped', { on: 'tiers on after the flip', where: 'the map tab' }, { limit: 60 }),
    shape: t('page', 'a Galaxy shape is picked: Rings, Clusters, Orbit, Degrees or the Wi-Fi fan', { value: 'the shape', from: 'the shape before' }, { limit: 60 }),
    view: t('page', "a view is picked: the notch's views on a map tab (Galaxy, Orbit, Grid, ...), or Paths' Companies and People", { value: 'the view', where: 'the tab' }, { limit: 60 }),
    lines: t('page', 'Filters → Lines: which tiers draw their lines', { value: "'all', 'none' or the tiers" }, { limit: 60 }),
    lab: t('page', 'a Galaxy physics or look control settles at a new value (a second after the last change)', { name: 'the control', value: 'its value' }, { limit: 60 }),
    sort: t('page', "a list's order is changed (the Scan page's Start with)", { where: 'the list', value: 'the order' }, { limit: 60 }),
    lens: t('page', "what a map sizes or colours by is changed (Paths' Size by, the people map's Colour). The class lens itself changes with a class pick (onboarding/class-switch)", { where: 'the map', value: 'the lens' }, { limit: 60 }),
    search: t('page', 'a search or finder query settles (a second after typing stops)', {
      where: 'which search box', category: "'person', 'company', 'sector', 'title', 'place', 'other' or 'empty'", length: 'its length in characters',
      text: 'the words, kept only for company and sector queries, never for a name', results: 'how many matched',
    }, { limit: 60 }),
    'map-view': t('page', "the Map tab changes what it shows: its view, the dots' colour, the heat's measure, a company picked in its finder, or the zoom where it stopped", { what: "'view', 'colour', 'heat', 'company' or 'zoom'", value: 'its value' }, { limit: 60 }),
    'show-ties': t('page', 'Show ties is switched', { on: 'on after the switch', where: 'where it was switched' }, { limit: 60 }),
  }),
  focus: Object.freeze({
    open: t('page', "a circle's focus opens (Network Circle's Galaxy, Bridge Chains)", { how: "'click' or 'hold' (held 3.5 s)", where: "'galaxy' or 'chains'", depth: 'how far along a chain: 1 for your own connection' }, { person: true, limit: 60 }),
    close: t('page', "a circle's focus closes", { how: "how it opened: 'click' or 'hold'", ms: 'how long it was open', where: 'the view' }, { person: true, limit: 60 }),
    dive: t('page', 'a focus goes a level deeper or comes back up: a dive into the circle, or a step along Bridge Chains', { depth: 'the depth now (chain position, plus one in a dive)', max: 'the deepest this focus went' }, { person: true, limit: 60 }),
  }),
  interaction: Object.freeze({
    'card-open': t('page', "a person's card opens", { where: 'the view' }, { person: true, limit: 120 }),
    'card-dwell': t('page', "a person's card closes or another opens: how long it was open", { ms: 'time open', where: 'the view' }, { person: true, limit: 120 }),
    hover: t('page', 'the pointer rests on a person dot for 1.5 s or more: summed per person between flushes', { n: 'how many rests', ms: 'their total time', where: 'the view' }, { person: true, limit: 200 }),
    'profile-open': t('server', "a profile opens: in Sixgree's own browser (POST /api/profile-view), or in your browser (sent by the page)", { counted: 'whether it counted as a profile view', via: "'panel' or 'browser'" }, { person: true, also: 'page', limit: 60 }),
    'connect-click': t('page', 'Connect is pressed on a card (Auto presses it on the server, route auto)', { route: "'panel', 'linkedin' or 'auto'", where: 'the view' }, { person: true, limit: 60, also: 'server' }),
    'read-all-mutuals': t('server', 'Read all mutuals is started for someone', {}, { person: true }),
    'request-sent': t('server', 'a request is marked as sent (by hand, the panel, or Auto): the send log', { route: 'how', attempt: 'which attempt', bridge: 'through whom', exposure: 'the list it was picked from' }, { person: true, essential: true }),
    'invite-detected': t('server', 'LinkedIn showed "Invitation sent": after Auto pressed Connect (the server), or in the LinkedIn panel (the page)', { outcome: "the scanner's words", route: "'panel' when the panel saw it" }, { person: true, also: 'page', limit: 60 }),
    'more-like-this': t('server', 'More like this, on a class reveal card (POST /api/class react)', { against: 'the other card', list: 'the list' }, { person: true }),
    'not-this-one': t('server', 'Not this one, on a class reveal card', { against: 'the other card', list: 'the list' }, { person: true }),
    skip: t('page', 'a person is skipped', {}, { person: true, reserved: true }),
    dismiss: t('page', 'a person is dismissed', {}, { person: true, reserved: true }),
    never: t('page', 'Never show me, for one person', {}, { person: true, reserved: true }),
  }),
  section: Object.freeze({
    toggle: t('page', 'a section of Separation or Breach is expanded or collapsed', { page: "'separation' or 'breach'", section: 'which', open: 'open after the click' }, { limit: 60 }),
    seen: t('page', 'a tier section of Separation or Breach is on screen for a second (once per visit)', { page: "'separation' or 'breach'", section: 'which' }, { limit: 60 }),
  }),
  onboarding: Object.freeze({
    'class-pick': t('server', 'a class is picked for the first time', { from: 'the class before', to: 'the class', restored: 'its answers came back' }),
    'class-switch': t('server', 'another class is picked', { from: 'the class before', to: 'the class', restored: 'its answers came back' }),
    target: t('server', "a class's target is named", { class: 'the class', sectors: 'sectors', roles: 'roles', targets: 'how many companies', city: 'a city was given' }),
    'offer-skipped': t('server', 'the offer to pick a class is skipped'),
    retune: t('server', 'Tune or Retune starts', { class: 'the class', mode: 'tune or retune' }),
    'duel-shown': t('server', 'a This or That duel is put on screen', { class: 'the class', a: 'card A, as attributes', b: 'card B', left: 'which is on the left', round: 'the round', index: 'its number', mirrorOf: 'the answer it repeats, sides swapped', mode: 'standard, tune or retune' }),
    duel: t('server', 'a duel is answered', { class: 'the class', a: 'card A', b: 'card B', choice: "'a', 'b', 'both', 'neither' or 'skip'", left: 'which was on the left', ms: 'decision time', round: 'the round', focus: 'what it asked about', mirrorOf: 'the answer it repeats' }),
    'duel-undo': t('server', 'an answer is undone', { class: 'the class' }),
    'duels-done': t('server', 'the duels end', { class: 'the class', answers: 'how many', field: 'the field they set' }),
    'questions-skipped': t('server', 'the duels are skipped', { class: 'the class' }),
    'never-pick': t('server', 'Never show me is saved', { class: 'the class', avoid: 'what is pushed down (Less) or off (Never)' }),
    retake: t('server', 'a class is retaken from the start', { class: 'the class' }),
    'tier-browse': t('page', "the class tab's ranked list is browsed: Show more, or the list switched", { class: 'the class', what: "'more' or 'list'", value: 'the list', shown: 'how many rows are shown after' }, { limit: 60 }),
  }),
  scan: Object.freeze({
    start: t('server', 'a scan job starts', { action: 'what it does', target: 'whose circle (a connection id)', round: 'pages planned this round', manual: 'manual mode', window: 'pages left in the scan window', sitting: 'an Auto scan sitting', lifted: 'limits lifted' }),
    page: t('scanner', 'a page of a scan is read', { action: 'the job', target: 'whose circle', page: 'the page number in this job', found: 'people it found', gapMs: 'time since the page before (the pace)' }),
    batch: t('server', 'a page of people arrives (POST /api/ingest), with its tier mix', { degree: 'their degree', bridge: 'whose circle', company: 'the company searched', received: 'people sent', people: 'kept', added: 'new', alreadyConnected: 'already yours', S: 'network S', A: 'network A', classS: 'class S', classA: 'class A' }),
    break: t('scanner', "a break between pages ends (manual mode's breaks), or Auto scan plans its rest between sittings", { action: 'the job', seconds: 'its length', after: 'the page before it', how: "'taken' (sat out), 'skipped' (cut short by a stop) or 'planned' (an Auto rest)", mode: "'manual' or 'auto-rest'" }),
    limit: t('server', "a limit holds a scan back: a press refused at the scan window, at profile views a day or Auto's request caps, or a scan that stopped at a limit", { what: "'window', 'profiles', 'invites' or 'limit'", action: 'the job' }),
    stop: t('server', 'a scan stops before it finished', { by: "'user', 'limit' or 'push-back'", action: 'the job', target: 'whose circle', pages: 'pages read' }),
    error: t('server', 'a scan fails', { action: 'the job', code: 'the exit code', message: 'the reason, without names or links' }),
    job: t('server', 'a scan job ends: its summary', { action: 'the job', target: 'whose circle', pages: 'pages', perPage: 'people per page', people: 'people', exit: 'how it ended', limitHit: 'a limit held it', pushback: 'LinkedIn pushed back', sitting: 'Auto scan sitting' }),
  }),
  panel: Object.freeze({
    open: t('page', "Sixgree's own browser comes forward, or shows another section", { section: "'feed', 'messaging', 'notifications', 'jobs' (the LinkedIn tab), 'profile' or 'scan'", from: 'the section before' }, { limit: 60 }),
    time: t('page', 'the LinkedIn panel leaves a section or closes: how long it was shown', { section: 'the section', ms: 'time shown' }, { limit: 60 }),
    nav: t('page', "the panel's Back or Forward is pressed", { dir: "'back' or 'forward'", section: 'the section' }, { limit: 60 }),
  }),
  settings: Object.freeze({
    change: t('server', "a setting is saved with a new value: any of lib/settings.js (whoever saves it), the scanner's settings as `scanner.<name>`, and the switches this browser keeps (Help's hints, the strategy engine), sent by the page", { key: 'the setting', old: 'the value before', new: 'the value now (a long value as its size and hash)' }, { also: 'page', limit: 60 }),
  }),
  health: Object.freeze({
    error: t('page', 'an error or an unhandled rejection reaches the page', { message: 'the message, with links, numbers and quoted words taken out', code: 'its name or code', source: 'the file and line' }, { limit: 30 }),
    'long-tasks': t('page', "a session's main-thread tasks over 50 ms, summed (with each pulse and at the end)", { count: 'how many', totalMs: 'their total', maxMs: 'the longest' }, { limit: 20 }),
    frames: t('page', "a view's frame times, summed (Network Circle's Galaxy; with each pulse and at the end)", { view: 'the view', frames: 'frames drawn', p50: 'median frame ms', p95: '95th percentile', max: 'the slowest', slow: 'frames over 50 ms' }, { limit: 20 }),
    'api-failure': t('page', "a request to the app's own server fails or answers with an error", { route: 'the route, without its query', status: 'the status, 0 for no answer', method: 'GET, POST, ...' }, { limit: 30 }),
    dropped: t('server', 'events were dropped because they came too fast: counted by the pages (sent with their next batch) or by the server', { n: 'how many', where: "'page' or 'server'" }, { limit: 10 }),
  }),
  exposure: Object.freeze(Object.fromEntries(['separation', 'breach', 'class', 'focus', 'map', 'card', 'insights', 'reveal'].map((list) => [list,
    t('page', `the ${list} list as drawn, once it settles: who was shown, in order (the top 50)`, { list: 'the list', sort: 'its order or lens', context: 'the place, company or circle', shown: '[person, rank, snapshot] for each' }, { limit: 60, reserved: ['card', 'insights'].includes(list) })]))),
  outcome: Object.freeze({
    accepted: t('server', 'a request is seen accepted', { sentAt: 'when it was sent', acceptedAt: 'when it was seen', acceptedDay: "the connection's own date", days: 'days it took', warmth: 'the warmth band', via: "'promote' or 'check'" }, { person: true, essential: true }),
    withdrawn: t('server', 'a request is undone', { via: 'how', attempt: 'which attempt', sentAt: 'when it was sent' }, { person: true, essential: true }),
    'still-pending': t('server', 'a check finds a request still out (once a week each)', { attempt: 'which attempt', ageDays: 'its age' }, { person: true, essential: true }),
  }),
  load: Object.freeze({
    hour: t('server', "a finished hour of the scanner's searches, profile views and requests", { hour: 'the hour', searches: 'searches', profiles: 'profile views', invites: 'requests' }),
  }),
  snapshot: Object.freeze({
    person: t('server', "a person's facts as known, once per change, referenced by the events' snap hash", { '[vector]': 'SNAPSHOT_FIELDS in order' }, { essential: true }),
  }),
});

export const KINDS = Object.freeze(Object.keys(TAXONOMY));

/** The type's entry, or null. */
export const typeOf = (kind, type) => (Object.hasOwn(TAXONOMY, kind) && Object.hasOwn(TAXONOMY[kind], type) ? TAXONOMY[kind][type] : null);

/** Every [kind, type] the pages may send. */
export const PAGE_TYPES = Object.freeze(KINDS.flatMap((k) => Object.entries(TAXONOMY[k])
  .filter(([, d]) => d.from === 'page' || d.also === 'page').map(([type]) => `${k}/${type}`)));

/**
 * Kept with "Record my behaviour" off: the outcomes and the send log (and the
 * snapshots they point at), which the acceptance and warmth models need, and
 * the switch's own changes, so a gap in the log explains itself.
 */
export function isEssential(kind, type, data = null) {
  if (typeOf(kind, type)?.essential) return true;
  return kind === 'settings' && type === 'change' && data?.key === 'recordBehaviour';
}

// ── Settings → Your data → Record my behaviour ───────────────────────────────

export const BEHAVIOUR_KEY = 'recordBehaviour';
export const BEHAVIOUR_SETTING = Object.freeze({
  default: true,
  parse(value) {
    if (typeof value !== 'boolean') throw new Error('Record my behaviour is either on or off.');
    return value;
  },
});

// ── Values the pages compute ─────────────────────────────────────────────────

/** A window's size as a bucket, never its exact pixels: 'phone', 'small', 'medium', 'large', 'wide', each with portrait or landscape. */
export function sizeBucket(w, h) {
  const width = Number(w) || 0;
  const height = Number(h) || 0;
  const band = width < 640 ? 'phone' : width < 1024 ? 'small' : width < 1440 ? 'medium' : width < 1920 ? 'large' : 'wide';
  return `${band}-${height > width ? 'portrait' : 'landscape'}`;
}

// Words that make a query a company's or a sector's (kept as typed), a title's,
// or a place's (kept as a category and a length only).
const COMPANY_WORDS = /\b(inc|llc|ltd|corp|co|company|group|labs?|technologies|tech|holdings|partners|capital|ventures|bank|university|college|agency|studios?|systems|solutions|consulting|health|media)\b\.?$/i;
const SECTOR_WORDS = /\b(fintech|saas|software|healthcare|biotech|pharma|insurance|real estate|retail|ecommerce|e-commerce|marketing|advertising|education|edtech|government|defense|energy|oil|gas|manufacturing|logistics|construction|hospitality|legal|law|finance|banking|venture|private equity|nonprofit|media|entertainment|gaming|crypto|web3|ai|cybersecurity|security|telecom|automotive|aerospace|agriculture|food|fashion|sports|consulting|accounting|recruiting|staffing)\b/i;
const TITLE_WORDS = /\b(ceo|cto|cfo|coo|cmo|vp|svp|evp|head|director|manager|founder|co-founder|partner|engineer|designer|analyst|recruiter|president|chief|lead|principal|associate|intern|consultant|investor|owner|sales|product)\b/i;
const PLACE_WORDS = /\b(city|county|state|area|bay|valley|new york|london|paris|berlin|tokyo|texas|california|florida|remote)\b|,\s*[a-z]{2}\b/i;

/**
 * What a query was looking for, so the log can keep its kind and length without
 * a name in it. `known` may name the companies and sectors the page knows of
 * (lower case), which a query matching one makes a company or sector query.
 * A query that could be a person's name is 'person': two or three capitalised
 * words with nothing else to say what they are.
 */
export function queryCategory(text, { companies = null, sectors = null } = {}) {
  const q = String(text ?? '').trim();
  if (!q) return 'empty';
  const low = q.toLowerCase();
  if (sectors && (sectors.has?.(low) || (Array.isArray(sectors) && sectors.includes(low)))) return 'sector';
  if (companies && (companies.has?.(low) || (Array.isArray(companies) && companies.includes(low)))) return 'company';
  if (COMPANY_WORDS.test(q)) return 'company';
  if (TITLE_WORDS.test(q)) return 'title';
  if (SECTOR_WORDS.test(q)) return 'sector';
  if (PLACE_WORDS.test(q)) return 'place';
  const words = q.split(/\s+/);
  if (words.length >= 1 && words.length <= 4 && words.every((w) => /^[\p{L}'’.-]+$/u.test(w))) return 'person';
  return 'other';
}

/** Whether a query's words may be kept: company and sector queries only. */
export const keepsQueryText = (category) => category === 'company' || category === 'sector';

/**
 * An error message with nothing personal left in it: links, email addresses,
 * quoted words (where a name would be), long numbers and anything after 160
 * characters go.
 */
export function scrubMessage(message) {
  return String(message ?? '')
    .replace(/https?:\/\/\S+/gi, '<link>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/(["'“‘`])(?:(?!\1).){1,120}\1/g, '<text>')
    .replace(/\d{4,}/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// ── Cleaning what the pages send ─────────────────────────────────────────────

const MAX_STRING = 200;

function cleanValue(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  if (typeof v === 'string') return v.replace(/[\u0000-\u001f]/g, ' ').slice(0, MAX_STRING);
  if (depth >= 1) return undefined;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => cleanValue(x, depth + 1)).filter((x) => x !== undefined);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 20)) {
      const c = cleanValue(x, depth + 1);
      if (c !== undefined) out[String(k).slice(0, 40)] = c;
    }
    return out;
  }
  return undefined;
}

/**
 * One event from a page, held to the taxonomy: its kind and type known and
 * sent by pages, only its own fields (and `tab`), each a plain value, and a
 * search's words only when they're a company's or a sector's.
 * @returns { kind, type, data } or null when it's not one the log keeps.
 */
export function cleanPageEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { kind, type } = raw;
  const def = typeOf(kind, type);
  if (!def || !(def.from === 'page' || def.also === 'page')) return null;
  const data = {};
  const given = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
  for (const name of [...Object.keys(def.fields), 'tab']) {
    if (!Object.hasOwn(given, name)) continue;
    const c = cleanValue(given[name]);
    if (c !== undefined) data[name] = c;
  }
  if (kind === 'control' && type === 'search') {
    data.category = ['person', 'company', 'sector', 'title', 'place', 'other', 'empty'].includes(data.category) ? data.category : 'other';
    if (!keepsQueryText(data.category)) delete data.text;
  }
  if (kind === 'health' && type === 'error' && typeof data.message === 'string') data.message = scrubMessage(data.message);
  return { kind, type, data };
}
