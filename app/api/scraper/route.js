import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, dataDir } from '../../../lib/paths';
import { resolveProfile, networkCounts } from '../../../lib/profile';
import { scanProgress } from '../../../lib/scan-progress';
import { linkedinState, writeLimits, liftCooldown } from '../../../lib/linkedin-limits';
import { pausedList, readProgress, readUnclear } from '../../../lib/paused';
import { getDb } from '../../../lib/db-client';
import { registerScanState } from '../../../lib/scan-state';
import { pendingImport } from '../../../lib/data-import';
import {
  pythonLooker, thisHostKey, scannerCommand, installSteps, downloadedPython, downloadVerified,
  placeDownloadedPython, sweepSetupLeftovers, megabytes, SETUP_WORK_PREFIX, ScannerSetupError,
} from '../../../lib/scanner-python';

// The app runs the scraper itself.
//
// It used to be a second Python HTTP server on port 5555 that the user had to
// start by hand in a second terminal before the Setup buttons did anything.
// That is the step everyone fell off — the app looked broken while it was
// simply waiting for a server nobody had been told to start clearly enough.
//
// This route is behind the same gate as the destructive ones (lib/gate.js): it
// spawns processes, which is more power than deleting a row, so it must never
// be reachable from another machine. Actions are a fixed enum — no part of a
// command line ever comes from the request.

const MAX_LOG = 500;

// Registered in lib/scan-state.js so other routes can see whether a job runs.
const state = registerScanState({
  running: false,
  action: null,
  log: [],
  startedAt: null,
  exitCode: null,
  child: null,
  abort: null,     // a step that runs inside this server (the Python download): its AbortController
  stopping: false,
  stderrTail: [],
  failure: null,   // the last lines of stderr from a run that failed — its reason
});

/** Stop the running job without orphaning the browser it opened.
 *
 *  The child is spawned into its own process group, so the negative pid
 *  signals Chrome too — killing only the Python process would leave a browser
 *  window open with a live LinkedIn session in it. SIGTERM first, because the
 *  scraper catches it and closes the browser itself; SIGKILL only if that is
 *  ignored. A step running inside this server (the Python download) stops at
 *  once, and nothing it fetched is kept.
 */
function stopChild() {
  if (state.abort) {
    state.stopping = true;
    push('Stopping…');
    state.abort.abort(new ScannerSetupError('Stopped.'));
    return;
  }
  const child = state.child;
  if (!child) return;
  state.stopping = true;
  push('Stopping…');
  const pid = child.pid;
  try { process.kill(-pid, 'SIGTERM'); }
  catch { try { child.kill('SIGTERM'); } catch {} }

  setTimeout(() => {
    if (state.child && state.child.pid === pid) {
      push('Still running — forcing it.');
      try { process.kill(-pid, 'SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch {} }
    }
  }, 20000);
}

function push(line) {
  for (const part of String(line).split('\n')) {
    const t = part.replace(/\s+$/, '');
    if (!t) continue;
    state.log.push(t);
  }
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

// Which Python runs the scanner is decided in lib/scanner-python.js
// (choosePython): the Mac app's own first (SIX_DEGREES_PYTHON, from the app),
// then the scanner's environment in the data folder, then a Python on this
// computer that already has the packages.
//
// The environment is what Install builds, never the machine's own Python, for
// two reasons that between them are why a hand-run install could appear to
// succeed and still leave nothing working (TRAPS §14):
//
//  1. `python3` on PATH is often Homebrew's, while the interpreter that already
//     has Playwright is /usr/bin/python3. Installing into one and running the
//     other looks identical to a broken install.
//  2. Homebrew and system Pythons are "externally managed" (PEP 668) and refuse
//     `pip install` outright, with an error most people read as a dead end.
//
// A virtualenv in the data directory has neither problem, is thrown away with
// the rest of the folder, and never touches the machine's Python. When the
// computer has no Python to build it from, "Set up the scanner" first downloads
// a standalone one into the data folder (a click, never by itself).

/** Who the scraper found to be private, so the app can report honestly.
 *
 *  This is scraper bookkeeping, not network data — it lives in a JSON file
 *  beside the database rather than in the schema. The profile page needs it to
 *  distinguish "not tried yet" from "will never work", which are very
 *  different numbers to show someone deciding whether they are finished.
 */
function bridgeSkips() {
  try {
    const raw = readFileSync(path.join(dataDir(), 'bridge-skips.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Object.entries(parsed).map(([profileUrl, v]) => ({
      profileUrl,
      name: v?.name ?? '',
      reason: v?.reason ?? '',
      at: v?.at ?? null,
    }));
  } catch {
    return [];
  }
}

// The machine checks (Python, Chrome, signed in) spawn processes, so they are
// cached for a few seconds, and callers that arrive while a look is under way
// share it rather than each starting their own Pythons. Everything about the
// running job — its log, how far it has got — and the counts are read fresh on
// every call: the page polls every 1.5 s, and a progress bar that moves every
// 4 s looks stuck.
let cached = { at: 0, value: null };
let looking = null;
let lookGeneration = 0;

/** Forget the last look, after something that changes its answer (a job starting or ending). */
function forgetChecks() {
  lookGeneration++;
  cached = { at: 0, value: null };
  looking = null;
}

// The Python the app ships can't change while this server runs, so once it has
// been seen to work it isn't started again to ask: each look costs a Python
// start, and the page asks every 1.5 seconds. Once it has failed it isn't
// started again at all until the server restarts (it used to be asked again
// every minute), so a Python macOS refuses to run can't keep bringing macOS's
// alert back; the page says what happened instead. (lib/scanner-python.js
// pythonLooker.) Kept once per server process, like the scan state
// (lib/scan-state.js): a second copy of this module (the bundler's, or a reload
// while developing) must not start a failed Python afresh.
const LOOKER = Symbol.for('six-degrees.python-looker');
const lookForPython = (globalThis[LOOKER] ??= pythonLooker());

let host;
function hostOnce() {
  if (host === undefined) host = thisHostKey();
  return host;
}

async function look() {
  const root = projectRoot();
  const python = await lookForPython(process.env.SIX_DEGREES_PYTHON || '', {
    app: process.env.SIX_DEGREES_APP || '',
    dataDir: dataDir(),
    host: hostOnce(),
  });

  // Where Playwright's "chrome" channel looks for Google Chrome (Chromium doesn't count).
  const chrome =
    process.platform === 'darwin' ? existsSync('/Applications/Google Chrome.app')
      : process.platform === 'linux' ? existsSync('/opt/google/chrome/chrome')
        : true; // elsewhere Playwright resolves the channel itself

  const signedIn = existsSync(path.join(dataDir(), 'chrome-profile', 'Default', 'Cookies'));

  return { root, python, chrome, signedIn };
}

function machineChecks() {
  if (Date.now() - cached.at < 4000 && cached.value) return Promise.resolve(cached.value);
  if (looking) return looking;
  const generation = lookGeneration;
  const current = look().then((value) => {
    // A job that started or ended meanwhile makes this look stale: don't keep it.
    if (generation === lookGeneration) cached = { at: Date.now(), value };
    return value;
  }).finally(() => {
    if (looking === current) looking = null;
  });
  looking = current;
  return current;
}

/** People whose list was only partly read, for the Scan page's Paused list. */
function paused(userId) {
  if (!userId) return [];
  try {
    const db = getDb();
    const first = db.prepare(
      `SELECT id, name, tier, profile_url, connected_date, created_at
         FROM linkedin_connections WHERE user_id = ? AND degree = 1`,
    ).all(userId);
    const mapped = new Set(db.prepare(
      `SELECT DISTINCT source_connection_id AS id FROM linkedin_connections
        WHERE user_id = ? AND degree = 2 AND source_connection_id IS NOT NULL`,
    ).all(userId).map((r) => r.id));
    return pausedList(first, mapped, readProgress(dataDir(), userId), readUnclear(dataDir()));
  } catch {
    return [];
  }
}

async function status() {
  const m = await machineChecks();

  // How much is already mapped, by degree, so the page can mark the scan step
  // done and offer the way to the galaxy instead of leaving someone on a form.
  let network = { first: 0, second: 0, third: 0 };
  let me = null;
  try {
    me = resolveProfile({ create: false });
    if (me) network = networkCounts(me.id);
  } catch {}

  const py = m.python;
  return {
    ready: Boolean(m.root && py.run && m.chrome),
    checks: {
      scriptsFound: Boolean(m.root),
      // A Python that runs the scanner, or one Install can build its environment from.
      python: Boolean(py.run || py.base),
      pythonPath: py.run?.path || py.base?.path || null,
      pythonVersion: py.run?.version || py.base?.version || null,
      // Where the one that runs it comes from: 'bundled' (the Mac app's own),
      // 'custom' (named in SIX_DEGREES_PYTHON), 'venv' or 'system'.
      pythonSource: py.run?.source || null,
      dependencies: Boolean(py.run),
      // The named Python, when it didn't work: { source, problem }.
      ownPython: py.own,
      // What Install would build the scanner's environment from: { source: 'system'|'downloaded', version }.
      installFrom: py.base ? { source: py.base.source, version: py.base.version } : null,
      // A Python this computer has that won't do, when there is no other: { version, venv }.
      systemPython: py.systemFound,
      // What "Set up the scanner" would download, when there is nothing to install from.
      download: py.download ? { version: py.download.version, size: py.download.size, from: 'github.com' } : null,
      chrome: m.chrome,
      signedIn: m.signedIn,
    },
    network,
    running: state.running,
    action: state.action,
    startedAt: state.startedAt,
    exitCode: state.exitCode,
    failure: state.running ? null : state.failure,
    progress: state.running ? scanProgress(state.log, state.action) : null,
    log: state.log.slice(-120),
    skips: bridgeSkips(),
    linkedin: linkedinState(dataDir()),
    paused: paused(me?.id),
  };
}

export async function GET() {
  return Response.json(await status());
}

// A fixed set. Anything taking a name uses `--flag=value`, a single argv token,
// so a name that begins with "-" can never be read as a flag of its own — and
// spawn takes an array, so there is no shell for it to escape into either.
const ACTIONS = {
  install:       { label: 'Installing the scanner’s Python packages' },
  // Only when this computer has no Python to install into: downloads the one
  // pinned for it (lib/scanner-python.js), then installs as above.
  setup:         { label: 'Setting up the scanner' },
  login:         { flag: '--login',       label: 'Opening LinkedIn so you can sign in' },
  full:          { flag: '--full',        label: 'Scanning your whole network' },
  refresh:       { flag: '--refresh',     label: 'Checking for new connections' },
  'auto-bridge': { flag: '--auto-bridge', label: 'Mapping every bridge in turn' },
  // Hidden profiles are remembered so they are not retried forever; this is
  // the way back in without a terminal.
  'auto-bridge-retry': { flag: '--auto-bridge --retry-private', label: 'Mapping every bridge, hidden ones included' },
  bridge:        { flag: '--bridge',   needsName: true, label: 'Mapping the circle behind' },
  // Carry on with one person whose read was cut short. By profile URL, not name:
  // two connections can share a name, and Resume must reach the one clicked.
  resume:        { flag: '--bridge-url', needsId: true, label: 'Carrying on with', searches: true },
  // Carry on with everyone whose read was cut short, and nobody new.
  'resume-all':  { flag: '--auto-bridge --only-unfinished', label: 'Carrying on with every paused list', searches: true },
  rescrape:      { flag: '--rescrape', needsName: true, label: 'Re-mapping the circle behind' },
  company:       { flag: '--company',  needsName: true, label: 'Scanning' },
};

/** Only a plain linkedin.com/in/ profile URL becomes an argument. */
function cleanProfileUrl(raw) {
  const url = String(raw ?? '').trim();
  if (url.length > 400 || /[\u0000-\u001f\s]/.test(url)) return null;
  // Any LinkedIn host (www., a country subdomain) and any profile slug, which
  // can be non-ASCII; passed as one --flag=value token, so no shell ever sees it.
  return /^https?:\/\/([a-z]{2,3}\.|www\.)?linkedin\.com\/in\/[^/?#]+\/?$/i.test(url) ? url : null;
}

/** Names come from the page, so they are checked before becoming an argument. */
function cleanName(raw) {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 120) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

/**
 * Install, and "Set up the scanner", as steps: { plan, cleanup }, or why not:
 * { error, status }. `found` is choosePython()'s answer. Every step is a fixed
 * command, or a `run` done inside this server; nothing comes from the request.
 *
 *   install  build the scanner's environment from `found.base` (this
 *            computer's Python, or the one a setup downloaded), install the
 *            pinned packages into it, and check that they load there, so a pip
 *            that put them elsewhere fails with its reason, not "Finished"
 *   setup    when there is nothing to build from: download the standalone
 *            Python pinned for this computer, check its SHA-256, unpack it into
 *            the data folder, then install as above. The download is checked
 *            before anything is unpacked: downloadVerified only names the file
 *            once it matches, and deletes it otherwise.
 */
function setupPlan(action, found, { root, data, say }) {
  if (found.run) {
    return {
      status: 409,
      error: found.run.source === 'bundled'
        ? 'The scanner is already set up: its Python comes with the app.'
        : 'The scanner is already set up.',
    };
  }
  const base = found.base;
  if (action === 'install' && !base) {
    return found.download
      ? { status: 409, error: 'This computer has no Python the scanner can use. Use Set up the scanner instead.' }
      : { status: 500, error: 'No Python 3.10 to 3.14 is installed, or none is on this app’s PATH.' };
  }
  if (action === 'setup' && base?.source === 'system') {
    return { status: 409, error: `This computer already has Python ${base.version}, so nothing needs downloading. Use Install instead.` };
  }
  if (action === 'setup' && !base && !found.download) {
    return { status: 409, error: 'There is no Python download for this computer. Install Python 3.10 to 3.14, then reload.' };
  }

  // The environment, the pinned packages without the pip settings that would
  // put them elsewhere, and a check that they load there
  // (lib/scanner-python.js installSteps).
  const requirements = path.join(root, 'scripts', 'requirements.txt');
  const install = (from) => installSteps({ base: from, dataDir: data, requirements });
  // A setup that already got as far as the download (it was stopped, or the
  // packages failed) carries on from its Python rather than fetching it again.
  if (base) return { plan: install(base), cleanup: null };

  const dl = found.download;
  mkdirSync(data, { recursive: true });
  sweepSetupLeftovers(data);
  const work = mkdtempSync(path.join(data, SETUP_WORK_PREFIX));
  const archive = path.join(work, dl.file);
  let tenths = -1;
  return {
    plan: [
      {
        note: `Downloading Python ${dl.version} from GitHub (${megabytes(dl.size)} MB)`,
        run: async ({ signal }) => {
          await downloadVerified(dl.url, archive, {
            sha256: dl.sha256,
            size: dl.size,
            signal,
            onProgress: (got, total) => {
              const t = Math.floor((got / total) * 10);
              if (t > tenths) {
                tenths = t;
                say(`Downloading Python ${dl.version}: ${megabytes(got)} of ${megabytes(total)} MB`);
              }
            },
          });
          say('Its checksum matches the one Six Degrees has for it.');
        },
      },
      { cmd: 'tar', args: ['-xzf', archive, '-C', work], note: 'Unpacking it' },
      { run: () => placeDownloadedPython(work, data, work) },
      ...install({ path: downloadedPython(data), source: 'downloaded' }),
    ],
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  const action = String(body.action || '');

  if (action === 'cancel') {
    stopChild();
    return Response.json({ ok: true, cancelled: true });
  }

  // The two settings a person changes here. Neither starts anything.
  if (action === 'set-limits') {
    const limits = writeLimits(dataDir(), { daily: body.daily, monthly: body.monthly });
    return Response.json({ ok: true, limits });
  }
  if (action === 'lift-cooldown') {
    liftCooldown(dataDir());
    return Response.json({ ok: true });
  }

  if (!Object.hasOwn(ACTIONS, action)) {
    return Response.json({ error: `Unknown action '${action}'` }, { status: 400 });
  }

  const spec = ACTIONS[action];
  const maxBridges = Number.isInteger(body.maxBridges) && body.maxBridges > 0
    ? Math.min(body.maxBridges, 500)
    : 0;
  // Tiers arrive as a list and become one --tiers=S,A token. Filtered to the
  // five that exist, so nothing from the request reaches a command line freely.
  const tiers = Array.isArray(body.tiers)
    ? body.tiers.map((t) => String(t).toUpperCase()).filter((t) => 'SABCD'.includes(t) && t.length === 1)
    : [];
  // Which of your connections to map first, and how deep to read each one. Both
  // are a fixed set, like everything else that reaches the command line. 100 is
  // every page: LinkedIn's search goes no further, and most lists end sooner.
  const order = body.order === 'score' ? 'score' : 'newest';
  const maxPages = [10, 25, 50, 100].includes(body.maxPages) ? body.maxPages : 100;
  const readsCircles = action.startsWith('auto-bridge') || ['bridge', 'rescrape', 'resume', 'resume-all'].includes(action);
  // Carry on with people already mapped, from the page each one stopped at.
  const deeper = body.deeper === true && (action.startsWith('auto-bridge') || action === 'bridge');
  let name = null;
  if (spec.needsName) {
    name = cleanName(body.name);
    if (!name) return Response.json({ error: 'A name is required for this action.' }, { status: 400 });
  }
  // Resume sends the connection's id; the URL is looked up here, for this
  // profile, so nothing from the request itself reaches the command line.
  let profileUrl = null;
  if (spec.needsId) {
    try {
      const me = resolveProfile({ create: false });
      const row = me && getDb().prepare(
        'SELECT profile_url FROM linkedin_connections WHERE id = ? AND user_id = ? AND degree = 1',
      ).get(String(body.id ?? ''), me.id);
      profileUrl = row?.profile_url && cleanProfileUrl(row.profile_url);
    } catch { profileUrl = null; }
    if (!profileUrl) return Response.json({ error: 'That connection could not be found.' }, { status: 400 });
  }
  // Nothing that searches LinkedIn starts during a cooldown; the scanner checks
  // too, this just says so before a process is spawned.
  // The 1st-degree scans aren't searches, but they open LinkedIn with automation too.
  const searches = spec.searches || action.startsWith('auto-bridge')
    || ['bridge', 'rescrape', 'company', 'full', 'refresh'].includes(action);
  // A staged import replaces the network at the next start, so anything scanned
  // now would land in the copy that is about to be set aside. Setting the
  // scanner up touches no network data.
  if (!['install', 'setup', 'login'].includes(action) && pendingImport(dataDir())) {
    return Response.json({ error: 'An import is waiting to finish. Restart Six Degrees first (Settings → Your data), then scan.' }, { status: 409 });
  }
  const cooldown = linkedinState(dataDir()).cooldown;
  if (searches && cooldown) {
    return Response.json({ error: `Scanning is paused until ${new Date(cooldown.until).toLocaleString()} — ${cooldown.reason}.`, cooldown }, { status: 409 });
  }
  if (state.running) {
    return Response.json({ error: 'Something is already running.', action: state.action }, { status: 409 });
  }

  const root = projectRoot();
  if (!root) {
    return Response.json({ error: 'Could not find scripts/scrape.py next to the app.' }, { status: 500 });
  }

  // Which Python, looked at afresh: what the page saw may be seconds old.
  forgetChecks();
  const found = (await machineChecks()).python;
  if (state.running) {
    return Response.json({ error: 'Something is already running.', action: state.action }, { status: 409 });
  }

  // Installing is several commands, so it runs as a small sequential plan
  // rather than a shell string — nothing here is ever concatenated from input.
  let plan;
  let cleanup = null;
  if (action === 'install' || action === 'setup') {
    const made = setupPlan(action, found, { root, data: dataDir(), say: push });
    if (made.error) return Response.json({ error: made.error }, { status: made.status });
    ({ plan, cleanup } = made);
  } else {
    if (!found.run) {
      return Response.json({ error: 'The scanner’s packages are not installed yet. Do step 1 first.' }, { status: 409 });
    }
    // The app's own Python runs isolated from this user's Python settings; any
    // Python runs it without writing bytecode beside scrape.py, which in the Mac
    // app is inside the signed app (lib/scanner-python.js scannerCommand).
    plan = [scannerCommand(found.run, path.join(root, 'scripts', 'scrape.py'), [
      // `--flag=value` is one token on purpose: a name beginning with
      // "-" can then never be read as a flag of its own.
      ...(name ? [`${spec.flag}=${name}`] : profileUrl ? [`${spec.flag}=${profileUrl}`] : spec.flag.split(' ')),
      ...(maxBridges && (action.startsWith('auto-bridge') || action === 'resume-all') ? [`--max-bridges=${maxBridges}`] : []),
      ...(tiers.length && action.startsWith('auto-bridge') ? [`--tiers=${tiers.join(',')}`] : []),
      ...(action.startsWith('auto-bridge') ? [`--order=${order}`] : []),
      // Resuming always reads to the end: a remembered "10 pages" would
      // otherwise leave everyone paused at page 11 and do nothing.
      ...(readsCircles ? [`--max-pages=${action.startsWith('resume') ? 100 : maxPages}`] : []),
      ...(deeper ? ['--deeper'] : []),
    ])];
  }

  // The scraper writes back through this very app, so point it at the port we
  // are actually being served on rather than guessing 3000.
  const hostHeader = request.headers.get('host') || '127.0.0.1:3000';
  const port = hostHeader.includes(':') ? hostHeader.split(':').pop() : '80';

  state.running = true;
  state.stopping = false;
  state.action = action;
  state.exitCode = null;
  state.startedAt = Date.now();
  state.log = [spec.label + (name ? ` ${name}…` : '…')];
  state.stderrTail = [];
  state.failure = null;
  forgetChecks();

  // Name the profile outright. The scraper would otherwise ask the app which one
  // to use; passing it means the page and the scrape cannot disagree.
  let profileId = '';
  try { profileId = resolveProfile().id; } catch {}

  const childEnv = {
    ...process.env,
    SIX_DEGREES_USER_ID: profileId,
    APP_URL: `http://127.0.0.1:${port}`,
    PYTHONUNBUFFERED: '1',
    SIX_DEGREES_ROOT: root,
    // So the scraper's hints name the Scan page's settings, not its flags.
    SIX_DEGREES_FROM_APP: '1',
  };

  function finish(code) {
    // A failure must say why. stderr is filtered while running because pip and
    // Playwright are noisy there, and that filter once swallowed the only line
    // explaining a failed scan, leaving just "exit 1". On a failure, show the
    // last of it whatever it says.
    if (code !== 0 && !state.stopping && state.stderrTail.length) {
      const shown = new Set(state.log);
      const unseen = state.stderrTail.filter((l) => !shown.has(l));
      if (unseen.length) push(unseen.join('\n'));
      // Kept apart for the page's red box. A reason is often more than its last
      // line — "more than one profile…" followed by "pick one with…" — so keep
      // the end of it, minus the Python warnings that are not the problem.
      const reason = state.stderrTail.filter((l) => !/Warning|warnings\.warn\(/.test(l)).slice(-6);
      state.failure = reason.length ? reason : null;
    }
    push(state.stopping ? 'Stopped.' : code === 0 ? 'Finished.' : `Stopped (exit ${code}).`);
    state.stopping = false;
    state.running = false;
    state.child = null;
    state.abort = null;
    state.exitCode = code;
    // A setup's private folder (the download and what was unpacked from it).
    if (cleanup) {
      try { cleanup(); } catch { /* swept at the next setup (sweepSetupLeftovers) */ }
    }
    forgetChecks();
  }

  function runStep(i) {
    if (i >= plan.length) return finish(0);
    const step = plan[i];
    if (step.note) push(step.note + '…');

    // A step done inside this server: the download, and moving what it unpacked
    // into place. Stop aborts it (stopChild).
    if (step.run) {
      const ctrl = new AbortController();
      state.abort = ctrl;
      Promise.resolve()
        .then(() => step.run({ signal: ctrl.signal }))
        .then(() => {
          state.abort = null;
          if (state.stopping) return finish(0);
          runStep(i + 1);
        }, (err) => {
          state.abort = null;
          if (state.stopping) return finish(0);
          // Kept where finish() looks for a failure's reason, for the page's red box.
          state.stderrTail.push(err instanceof ScannerSetupError ? err.message : `Could not finish: ${err.message}`);
          finish(1);
        });
      return;
    }

    let child;
    try {
      // Its own process group, so cancelling reaches the browser as well. A
      // step's env() makes its own environment from this one.
      child = spawn(step.cmd, step.args, { cwd: root, env: step.env ? step.env(childEnv) : childEnv, detached: true });
    } catch (err) {
      push(`Could not start: ${err.message}`);
      return finish(-1);
    }
    state.child = child;

    child.stdout.on('data', (d) => push(d.toString()));
    child.stderr.on('data', (d) => {
      // pip and playwright both chatter on stderr; only surface real trouble.
      const t = d.toString();
      for (const line of t.split('\n')) {
        const l = line.replace(/\s+$/, '');
        if (l) state.stderrTail.push(l);
      }
      if (state.stderrTail.length > 20) state.stderrTail.splice(0, state.stderrTail.length - 20);
      if (/error|Error|Traceback|No module|failed|externally-managed/.test(t)) push(t);
    });
    child.on('error', (err) => { push(`Could not start: ${err.message}`); finish(-1); });
    child.on('close', (code) => {
      if (state.stopping) return finish(code ?? 0);
      if (code !== 0 && !step.tolerant) return finish(code);
      runStep(i + 1);
    });
  }

  runStep(0);

  return Response.json({ ok: true, action });
}
