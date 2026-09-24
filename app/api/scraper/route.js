import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, dataDir } from '../../../lib/paths';
import { resolveProfile, networkCounts } from '../../../lib/profile';
import { scanProgress } from '../../../lib/scan-progress';

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

const state = {
  running: false,
  action: null,
  log: [],
  startedAt: null,
  exitCode: null,
  child: null,
  stopping: false,
  stderrTail: [],
  failure: null,   // the last lines of stderr from a run that failed — its reason
};

/** Stop the running job without orphaning the browser it opened.
 *
 *  The child is spawned into its own process group, so the negative pid
 *  signals Chrome too — killing only the Python process would leave a browser
 *  window open with a live LinkedIn session in it. SIGTERM first, because the
 *  scraper catches it and closes the browser itself; SIGKILL only if that is
 *  ignored.
 */
function stopChild() {
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

/** Run something short and tell me only whether it worked. */
function probe(cmd, args, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const c = spawn(cmd, args, { stdio: 'ignore' });
      const t = setTimeout(() => { try { c.kill(); } catch {} finish(false); }, timeoutMs);
      c.on('error', () => { clearTimeout(t); finish(false); });
      c.on('close', (code) => { clearTimeout(t); finish(code === 0); });
    } catch {
      finish(false);
    }
  });
}

// Load the compiled parts, not just the package names. `import PIL` succeeds even
// when its C extension is built for the other chip; `from PIL import Image` is
// what fails. The old check said "installed" and the scan then died on import —
// which is how a Rosetta-launched app showed up (TRAPS §30).
const IMPORTS = 'import requests; from PIL import Image; from playwright.sync_api import sync_playwright';

/** The interpreter we install into and run from: our own, inside the data dir.
 *
 *  Two traps make "just use python3" wrong, and between them they are why a
 *  hand-run install could appear to succeed and still leave nothing working:
 *
 *  1. `python3` on PATH is often Homebrew's, while the interpreter that already
 *     has Playwright is /usr/bin/python3. Installing into one and running the
 *     other looks identical to a broken install.
 *  2. Homebrew and system Pythons are "externally managed" (PEP 668) and refuse
 *     `pip install` outright, with an error most people read as a dead end.
 *
 *  A virtualenv in the data directory has neither problem, is thrown away with
 *  the rest of the folder, and never touches the machine's Python.
 */
function venvPython() {
  const base = path.join(dataDir(), 'venv');
  return process.platform === 'win32'
    ? path.join(base, 'Scripts', 'python.exe')
    : path.join(base, 'bin', 'python');
}

/** A Python that can actually run the scraper right now, or null. */
async function findUsablePython() {
  const venv = venvPython();
  if (existsSync(venv) && await probe(venv, ['-c', IMPORTS], 8000)) return venv;
  // Respect an existing working install rather than forcing a venv on someone
  // who already did this by hand.
  for (const c of ['/usr/bin/python3', 'python3', 'python']) {
    if (await probe(c, ['-c', IMPORTS], 8000)) return c;
  }
  return null;
}

/** Any Python at all — used to build the venv. */
async function findAnyPython() {
  for (const c of ['python3', '/usr/bin/python3', 'python']) {
    if (await probe(c, ['--version'], 4000)) return c;
  }
  return null;
}

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
// cached for a few seconds. Everything about the running job — its log, how far
// it has got — and the counts are read fresh on every call: the page polls
// every 1.5 s, and a progress bar that moves every 4 s looks stuck.
let cached = { at: 0, value: null };

async function machineChecks() {
  if (Date.now() - cached.at < 4000 && cached.value) return cached.value;

  const root = projectRoot();
  const usable = await findUsablePython();
  const anyPython = usable || await findAnyPython();

  const chrome =
    process.platform === 'darwin'
      ? existsSync('/Applications/Google Chrome.app')
      : true; // elsewhere Playwright resolves the channel itself

  const signedIn = existsSync(path.join(dataDir(), 'chrome-profile', 'Default', 'Cookies'));

  const value = { root, usable, anyPython, chrome, signedIn };
  cached = { at: Date.now(), value };
  return value;
}

async function status() {
  const m = await machineChecks();

  // How much is already mapped, by degree, so the page can mark the scan step
  // done and offer the way to the galaxy instead of leaving someone on a form.
  let network = { first: 0, second: 0, third: 0 };
  try {
    const me = resolveProfile({ create: false });
    if (me) network = networkCounts(me.id);
  } catch {}

  return {
    ready: Boolean(m.root && m.usable && m.chrome),
    checks: {
      scriptsFound: Boolean(m.root),
      python: Boolean(m.anyPython),
      pythonPath: m.usable || m.anyPython,
      dependencies: Boolean(m.usable),
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
  };
}

export async function GET() {
  return Response.json(await status());
}

// A fixed set. Anything taking a name uses `--flag=value`, a single argv token,
// so a name that begins with "-" can never be read as a flag of its own — and
// spawn takes an array, so there is no shell for it to escape into either.
const ACTIONS = {
  install:       { label: 'Installing the scraper’s Python packages' },
  login:         { flag: '--login',       label: 'Opening LinkedIn so you can sign in' },
  full:          { flag: '--full',        label: 'Scanning your whole network' },
  refresh:       { flag: '--refresh',     label: 'Checking for new connections' },
  'auto-bridge': { flag: '--auto-bridge', label: 'Mapping every bridge in turn' },
  // Hidden profiles are remembered so they are not retried forever; this is
  // the way back in without a terminal.
  'auto-bridge-retry': { flag: '--auto-bridge --retry-private', label: 'Mapping every bridge, hidden ones included' },
  bridge:        { flag: '--bridge',   needsName: true, label: 'Mapping the circle behind' },
  rescrape:      { flag: '--rescrape', needsName: true, label: 'Re-mapping the circle behind' },
  company:       { flag: '--company',  needsName: true, label: 'Scanning' },
};

/** Names come from the page, so they are checked before becoming an argument. */
function cleanName(raw) {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 120) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  const action = String(body.action || '');

  if (action === 'cancel') {
    stopChild();
    return Response.json({ ok: true, cancelled: true });
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
  const readsCircles = action.startsWith('auto-bridge') || action === 'bridge' || action === 'rescrape';
  // Carry on with people already mapped, from the page each one stopped at.
  const deeper = body.deeper === true && (action.startsWith('auto-bridge') || action === 'bridge');
  let name = null;
  if (spec.needsName) {
    name = cleanName(body.name);
    if (!name) return Response.json({ error: 'A name is required for this action.' }, { status: 400 });
  }
  if (state.running) {
    return Response.json({ error: 'Something is already running.', action: state.action }, { status: 409 });
  }

  const root = projectRoot();
  if (!root) {
    return Response.json({ error: 'Could not find scripts/scrape.py next to the app.' }, { status: 500 });
  }
  let python;
  if (action === 'install') {
    python = await findAnyPython();
    if (!python) {
      return Response.json({ error: 'Python 3 is not installed, or not on this app’s PATH.' }, { status: 500 });
    }
  } else {
    python = await findUsablePython();
    if (!python) {
      return Response.json({ error: 'The scraper’s packages are not installed yet. Do step 1 first.' }, { status: 409 });
    }
  }

  const venvDir = path.join(dataDir(), 'venv');
  const reqs = path.join(root, 'scripts', 'requirements.txt');

  // Installing is several commands, so it runs as a small sequential plan
  // rather than a shell string — nothing here is ever concatenated from input.
  const plan = action === 'install'
    ? [
        { cmd: python, args: ['-m', 'venv', venvDir], note: 'Creating a private Python environment' },
        { cmd: venvPython(), args: ['-m', 'pip', 'install', '--upgrade', 'pip'], note: 'Updating pip', tolerant: true },
        { cmd: venvPython(), args: ['-m', 'pip', 'install', '-r', reqs], note: 'Installing Playwright, requests and Pillow' },
      ]
    : [
        {
          cmd: python,
          args: [
            path.join(root, 'scripts', 'scrape.py'),
            // `--flag=value` is one token on purpose: a name beginning with
            // "-" can then never be read as a flag of its own.
            ...(name ? [`${spec.flag}=${name}`] : spec.flag.split(' ')),
            ...(maxBridges && action.startsWith('auto-bridge') ? [`--max-bridges=${maxBridges}`] : []),
            ...(tiers.length && action.startsWith('auto-bridge') ? [`--tiers=${tiers.join(',')}`] : []),
            ...(action.startsWith('auto-bridge') ? [`--order=${order}`] : []),
            ...(readsCircles ? [`--max-pages=${maxPages}`] : []),
            ...(deeper ? ['--deeper'] : []),
          ],
        },
      ];

  // The scraper writes back through this very app, so point it at the port we
  // are actually being served on rather than guessing 3000.
  const host = request.headers.get('host') || '127.0.0.1:3000';
  const port = host.includes(':') ? host.split(':').pop() : '80';

  state.running = true;
  state.stopping = false;
  state.action = action;
  state.exitCode = null;
  state.startedAt = Date.now();
  state.log = [spec.label + (name ? ` ${name}…` : '…')];
  state.stderrTail = [];
  state.failure = null;
  cached = { at: 0, value: null };

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
    state.exitCode = code;
    cached = { at: 0, value: null };
  }

  function runStep(i) {
    if (i >= plan.length) return finish(0);
    const step = plan[i];
    if (step.note) push(step.note + '…');

    let child;
    try {
      // Its own process group, so cancelling reaches the browser as well.
      child = spawn(step.cmd, step.args, { cwd: root, env: childEnv, detached: true });
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
