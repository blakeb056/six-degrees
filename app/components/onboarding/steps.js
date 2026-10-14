'use client';

// The setup's steps and its last screen, one a screen (Onboarding.js moves
// between them). Each says what it is in a sentence or two, shows the live
// status of what it waits for, and has one primary button. What a button does
// is the Scan page's own (app/components/useScanStatus.js); the words for the
// scanner, App Management, the risks and the budget are the ones the Scan
// page uses (lib/scanner-setup.js, lib/scan-risk.js, lib/search-risk.js).
// Which steps there are follows the scanner plugin installed (lib/onboarding.js
// stepsFor): the step lines count them with stepEyebrow.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { appManagementHref, CHROME_DOWNLOAD } from '../../../lib/scanner-setup';
import {
  readyChecks, connectState, photosNote, escapeHatch, stepEyebrow, afterImport, scanWithoutCsv, FIRST_SCAN_PAGES,
} from '../../../lib/onboarding';
import { reachIndex, firstCirclePicks, circleScanCost } from '../../../lib/reach';
import { loadNetwork } from '../../../lib/network';
import { loadScanNotes } from '../../../lib/scraper-client';
import { useUser } from '../UserProvider';
import { RISK_POINTS } from '../../../lib/scan-risk';
import { PACE_NAMES, PACES, DEFAULT_PACE, searchesPerHour, firstCircleSeconds, paceSeconds, durationText } from '../../../lib/scan-pace';
import { SAFE_LIMITS, RESTRICTED_AT, limitNote } from '../../../lib/search-risk';
import { watchAllDay, allDayNow, setAllDay } from '../../../lib/experimental-client';
import { keptCsvProblem, importLines } from '../../../lib/csv';
import { INDUSTRIES } from '../../../lib/companies';
import { modeChoices } from '../../../lib/scanner-capabilities';
import { sectorByKey } from '../../../lib/sector-directory';
import { MAX_SECTORS } from '../../../lib/sector-focus';
import { saveField, skipField } from '../FieldStep';
import SectorPicker from '../settings/SectorPicker';
import { DailyLimitInput } from '../LinkedInLimits';
import ClusterSpinner from '../ClusterSpinner';
import { usePluginInstall, PluginCards } from '../settings/PluginBrowse';
import { fetchPlugins } from '../../../lib/plugins-client';
import { Ico, Galaxy, MacSettings, ChecksArt, ConnectArt, PaceArt } from './art';

// What the scanner uses when nothing is saved yet (lib/linkedin-limits.js DEFAULT_LIMITS).
const DEFAULT_LIMITS = { ...SAFE_LIMITS, pace: DEFAULT_PACE };

/** One step's screen: its words on the left, its picture on the right. */
export function Frame({ eyebrow, title, lede, foot, art, error, children }) {
  return (
    <>
      <div className="ob-left">
        <div className="ob-scroll">
          <div className="ob-eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          {lede && <p className="ob-lede">{lede}</p>}
          {children}
          {error && <div className="ob-error" role="alert">{error}</div>}
        </div>
        <div className="ob-foot">{foot}</div>
      </div>
      <div className="ob-ill" aria-hidden="true">{art}</div>
    </>
  );
}

export function Primary({ children, icon = Ico.right, ...props }) {
  const Icon = icon;
  return <button type="button" className="ob-btn primary lg" id="ob-primary" {...props}>{children}{Icon && <Icon />}</button>;
}

function Back({ onClick }) {
  return <button type="button" className="ob-btn ghost" onClick={onClick}><Ico.left />Back</button>;
}

const Spacer = () => <span className="ob-spacer" />;
const Waiting = ({ children }) => <button type="button" className="ob-btn primary lg" id="ob-primary" disabled><span className="ob-spin" />{children}</button>;

// ── 1. Welcome ───────────────────────────────────────────────────────────────

// The CSV import comes first, recommended and already chosen: the official
// export carries no risk to your account (2026-10-09). Then the sample.
// Scanning isn't offered here any more: the app carries no scanner, and a
// plugin brings one, from "Other ways to bring in your network" under the CSV import, whose
// result then offers Set up scanning (Blake, 2026-10-14). Import a CSV opens
// the import's own screen, here in the setup (ImportCsv).
export function Welcome({ ctx }) {
  const [choice, setChoice] = useState('csv');
  const [csvProblem, setCsvProblem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // A kept import that can't be read says so, never passes for no import (TRAPS §7).
  useEffect(() => {
    let off = false;
    keptCsvProblem().then((p) => { if (!off) setCsvProblem(p); });
    return () => { off = true; };
  }, []);

  async function go() {
    if (choice === 'csv') return ctx.openCsv();
    setLoading(true);
    setError('');
    const why = await ctx.openSample();
    if (why) { setError(why); setLoading(false); }
    return undefined;
  }

  const option = (key, icon, title, desc, { tag, note } = {}) => {
    const Icon = icon;
    return (
      <button type="button" className={`ob-choice${choice === key ? ' sel' : ''}`} onClick={() => setChoice(key)} aria-pressed={choice === key} id={`ob-choice-${key}`}>
        <span className="ci"><Icon /></span>
        <span>
          <span className="ct">{title}{tag && <span className="ob-tag rec">{tag}</span>}</span>
          <span className="cd">{desc}</span>
          {note && <span className="cn">{note}</span>}
        </span>
        <span className="ob-radio" />
      </button>
    );
  };

  return (
    <Frame
      eyebrow="Welcome to Sixgree"
      title={<>Your network,<br />drawn as a galaxy.</>}
      lede={`See who you know, who they know, and the shortest way to anyone. It all stays on ${ctx.here}: there’s no account with us, and nothing is uploaded.`}
      error={error}
      art={<div><div className="ob-art-galaxy"><Galaxy /></div><div className="ob-badge"><Ico.lock />Kept on {ctx.here}. Nothing is uploaded.</div></div>}
      foot={<>
        <span className="ob-quiet">Moving from another computer? <a className="ob-link" href="/settings#data">Bring your saved copy</a></span>
        <Spacer />
        <Primary onClick={go} disabled={loading}>{loading ? 'Loading…' : { csv: 'Import a CSV', sample: 'Open the sample' }[choice]}</Primary>
      </>}
    >
      {option('csv', Ico.csv, 'Import a connections CSV', 'The official export, by email in about ten minutes. The people you know, with no risk to your account.', {
        tag: 'Recommended', note: csvProblem,
      })}
      {option('sample', Ico.spark, 'Try the sample', '150 invented people and the 598 they know, to look around before you decide.')}
    </Frame>
  );
}

// ── 2. Get your Mac ready ────────────────────────────────────────────────────

export function GetReady({ ctx }) {
  const { s, settings, scan, gate } = ctx;
  const r = readyChecks(s);
  const [opened, setOpened] = useState(false);
  const mac = s?.checks?.mac;
  // On a Mac from macOS 13, which brought App Management: mandatory, and read
  // from macOS itself (lib/onboarding.js appManagementGate). Elsewhere, no row.
  const appShown = gate.shown;
  const who = mac?.app ? 'Sixgree' : 'the app you started Sixgree from';
  const asked = mac?.app ? 'Sixgree' : 'the app you started Sixgree from (Terminal, for example)';
  const href = appManagementHref(mac);
  const running = s?.running;
  const installing = running && ['install', 'setup'].includes(s.action);
  // Seen on: kept as the answer too, so the Scan page doesn't offer it again.
  const granted = gate.state === 'granted';
  const answered = settings?.appManagement;
  const { answerAppManagement } = scan;
  useEffect(() => {
    if (granted && settings && answered !== 'done') answerAppManagement('done');
  }, [granted, settings, answered, answerAppManagement]);

  // The escape hatch (lib/onboarding.js escapeHatch): when "I've allowed it"
  // was pressed, and how many checks have said off since the window came back
  // from System Settings. Rechecked with every check (every 2 s).
  const [claimedAt, setClaimedAt] = useState(null);
  const [returnedAt, setReturnedAt] = useState(null);
  // The moment the 20 s after "I've allowed it" ran out, set by a timer so render stays pure.
  const [tick, setTick] = useState(null);
  const checksNow = ctx.checks;
  useEffect(() => {
    if (!opened) return undefined;
    const back = () => { if (document.visibilityState !== 'hidden') setReturnedAt((at) => at ?? checksNow); };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [opened, checksNow]);
  useEffect(() => {
    if (claimedAt == null) return undefined;
    const t = setTimeout(() => setTick(Date.now()), ctx.overrideAfterMs + 50);
    return () => clearTimeout(t);
  }, [claimedAt, ctx.overrideAfterMs]);
  const hatch = escapeHatch(gate, { claimedAt, offSinceReturn: returnedAt == null ? null : checksNow - returnedAt, now: tick ?? claimedAt ?? 0 });

  const chrome = r.chrome === false ? (
    <div className="ob-mini no">
      <span className="ri"><Ico.globe /></span>
      <span><div className="rt">Google Chrome</div><div className="rd">Not on {ctx.here} yet</div></span>
      <span className="end"><a className="ob-btn secondary small" href={CHROME_DOWNLOAD} target="_blank" rel="noreferrer">Install<Ico.ext /></a></span>
    </div>
  ) : (
    <div className="ob-mini ok"><span className="ri"><Ico.check /></span><span><div className="rt">Google Chrome</div><div className="rd">Installed</div></span></div>
  );
  // The scanner a plugin brought (Auto scan, Manual scan), and in the desktop
  // apps the Python it runs on comes with the app: nothing to install.
  const plugin = r.scanner.plugin;
  const scannerLine = plugin
    ? `${plugin.name} ${plugin.version}${r.scanner.bundled ? '. Python comes with the app' : ', ready to scan'}`
    : r.scanner.bundled ? 'Built in, nothing to install' : 'Ready to scan';
  const scanner = r.scanner.done ? (
    <div className="ob-mini ok"><span className="ri"><Ico.check /></span><span><div className="rt">The scanner</div><div className="rd">{scannerLine}</div></span></div>
  ) : (
    <div className="ob-mini no"><span className="ri"><Ico.radar /></span><span><div className="rt">The scanner</div>
      <div className="rd">{r.scanner.missing ? 'Not installed' : installing ? 'Setting up…' : 'Not set up yet'}</div></span></div>
  );

  // Open System Settings: the step is kept first, since turning App Management
  // on makes macOS quit and reopen Sixgree, and the setup comes back here.
  // A System Settings address opens in place: the Mac app opens System Settings
  // itself, a browser asks first (app/setup/page.js Launch).
  const openSettings = (label, id) => (
    <a className={`ob-btn ${label === 'Open System Settings' ? 'secondary' : 'ghost'} small`} id={id} href={href}
      onClick={() => { ctx.keepStep(); setOpened(true); }}>{label}{label === 'Open System Settings' && <Ico.ext />}</a>
  );
  const why = `When the scanner starts Google Chrome, Chrome may update itself, and macOS then stops to ask whether ${asked} can manage apps. `
    + 'A scan can’t answer that, so it would stall halfway. '
    + `Allow ${who === 'Sixgree' ? 'Sixgree' : 'that app'} once in App Management and macOS won’t ask again.`;
  const restart = 'macOS may ask to quit and reopen Sixgree when you turn it on. That’s fine: the setup comes back right here.';

  let app = null;
  if (appShown && gate.state === 'granted') {
    app = (
      <div className="ob-row ok" id="ob-appm" data-state="granted">
        <span className="ri ob-pop"><Ico.check /></span>
        <span><div className="rt">App Management</div><div className="rd">On. macOS won’t stop a scan to ask while Chrome updates.</div></span>
        <span className="ob-chip ok ob-pop"><Ico.check />Allowed</span>
      </div>
    );
  } else if (appShown && gate.state === 'override') {
    app = (
      <div className="ob-row ok" id="ob-appm" data-state="override">
        <span className="ri ob-pop"><Ico.check /></span>
        <span><div className="rt">App Management</div><div className="rd">You said it’s on. Sixgree can’t tell, so it’s going on your word.</div></span>
        <span />
      </div>
    );
  } else if (appShown && gate.state === 'unknown' && gate.canContinue) {
    app = (
      <div className="ob-row ok" id="ob-appm" data-state="claimed">
        <span className="ri ob-pop"><Ico.check /></span>
        <span><div className="rt">App Management</div><div className="rd">You said it’s on. Sixgree couldn’t check it on {ctx.here}.</div></span>
        <button type="button" className="ob-btn ghost small" onClick={() => answerAppManagement(null)}>Undo</button>
      </div>
    );
  } else if (appShown && gate.state === 'unknown') {
    app = (
      <div className="ob-row attn" id="ob-appm" data-state="unknown">
        <span className="ri"><Ico.shield /></span>
        <span><div className="rt">App Management <span className="ob-tag opt">Required</span></div></span>
        <span />
        <div className="rx">
          <p>{why}</p>
          <p>Sixgree can’t check this setting on {ctx.here}, so it takes your word for it: turn on <b>{who}</b>, then say so. Why it can’t: {gate.why}</p>
          <div className="acts">
            {openSettings(opened ? 'Open it again' : 'Open System Settings', 'ob-appm-open')}
            <button type="button" className="ob-btn secondary small" id="ob-appm-done" onClick={() => answerAppManagement('done')}><Ico.check />I’ve allowed it</button>
          </div>
        </div>
      </div>
    );
  } else if (appShown) {
    const checking = gate.state === 'checking';
    app = (
      <div className="ob-row attn" id="ob-appm" data-state={gate.state}>
        <span className="ri"><Ico.shield /></span>
        <span><div className="rt">App Management <span className="ob-tag opt">Required</span></div></span>
        {checking ? <span className="ob-chip wait"><span className="ob-dotsl"><i /><i /><i /></span>Checking</span>
          : opened ? <span className="ob-chip wait"><span className="ob-dotsl"><i /><i /><i /></span>Waiting for macOS</span> : <span />}
        <div className="rx">
          <p>{opened
            ? <>Turn on <b>{who}</b> in the window that opened. This ticks itself the moment macOS has it on. {restart}</>
            : why}</p>
          <div className="acts">
            {openSettings(opened ? 'Open it again' : 'Open System Settings', 'ob-appm-open')}
            {opened && !checking && (
              <button type="button" className="ob-btn secondary small" id="ob-appm-done" disabled={claimedAt != null}
                onClick={() => { setClaimedAt(Date.now()); answerAppManagement('done'); }}>
                <Ico.check />{claimedAt != null ? 'Checking with macOS…' : 'I’ve allowed it'}
              </button>
            )}
          </div>
          {hatch && (
            <p><button type="button" className="ob-link" id="ob-appm-override" style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => ctx.overrideAppManagement()}>
              It’s on, but Sixgree can’t tell: continue anyway
            </button></p>
          )}
        </div>
      </div>
    );
  }

  const ready = r.done && gate.canContinue;
  const hint = ready ? null
    : r.chrome === false ? 'Waiting for Google Chrome'
      : r.scanner.missing ? 'Install a scanner first'
      : !r.scanner.done ? 'Set up the scanner first'
        : !r.risk ? 'Tick “I understand” to go on'
          : gate.state === 'checking' ? 'Checking App Management…'
            : gate.state === 'unknown' ? 'Say when App Management is on'
              : 'Turn on App Management to go on';
  const art = appShown
    ? <MacSettings answer={gate.canContinue ? 'done' : opened ? 'opened' : null} name={mac?.app ? 'Sixgree' : 'Terminal'} />
    : <ChecksArt chrome={r.chrome !== false} scanner={r.scanner.done} risk={r.risk} />;

  return (
    <Frame
      eyebrow={stepEyebrow('ready', ctx.caps)}
      title={`Get your ${ctx.here === 'this Mac' ? 'Mac' : 'computer'} ready`}
      lede="A few things the scanner needs. Each one ticks itself the moment it’s done."
      error={scan.error}
      art={art}
      foot={<>
        {/* Back to the CSV step (its result, once imported), where scanning is set up from. */}
        <Back onClick={ctx.openCsv} />
        <Spacer />
        {hint && <span className="ob-hint">{hint}</span>}
        <Primary onClick={() => ctx.next('ready')} disabled={!ready}>Continue</Primary>
      </>}
    >
      <div className={`ob-pair${r.chrome === false ? ' wide' : ''}`}>{chrome}{scanner}</div>
      {/* No scanner: the app carries none, a plugin brings it (Settings → Plugins, or the box under the CSV). */}
      {r.scanner.missing && (
        <div className="ob-row bad" id="ob-no-scanner"><span className="ri"><Ico.radar /></span>
          <span><div className="rt">No scanner is installed</div>
            <div className="rd">Scanning comes from a plugin. Install Auto scan or Manual scan from Settings → Plugins, or from Other ways to bring in your network, under the CSV import.</div></span><span />
          <div className="rx"><div className="acts">
            <button type="button" className="ob-btn secondary small" id="ob-to-plugins" onClick={ctx.openPlugins}>Show the plugins</button>
          </div></div>
        </div>
      )}
      {!r.scanner.done && !r.scanner.missing && (
        <div className="ob-row attn"><span className="ri"><Ico.radar /></span>
          <span><div className="rt">Set up the scanner</div></span><span />
          <div className="rx">
            <p>{r.scanner.text}</p>
            {installing && s.progress?.kind === 'download' && <p>Downloading Python: {s.progress.done.toFixed(1)} of {s.progress.total.toFixed(1)} MB</p>}
            {r.scanner.button && (
              <div className="acts">
                <button type="button" className="ob-btn secondary small" disabled={scan.busy || running} onClick={() => scan.run(r.scanner.button.action)}>
                  {installing && <span className="ob-spin" />}{r.scanner.button.label}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {r.scanner.note && <div className="ob-note"><Ico.info /><span>{r.scanner.note}</span></div>}
      {app}
      <label className={`ob-consent${r.risk ? ' on' : ''}`} id="ob-consent">
        <input type="checkbox" className="ob-sr" checked={r.risk} disabled={r.risk || scan.busy} onChange={() => scan.acceptRisk()} />
        <span className="ob-check" aria-hidden="true"><Ico.check /></span>
        <span>
          {/* Rather not: with your people in (the CSV), the map; before them, the CSV. */}
          <span className="ct">I understand what scanning risks{!r.risk && <> <button type="button" className="ob-link"
            onClick={(e) => { e.preventDefault(); if (ctx.people) ctx.finish(); else ctx.openCsv(); }}
            style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 500, background: 'none', border: 0, padding: 0 }}>
            {ctx.people ? 'Rather not? See your galaxy' : 'Rather not? Import a CSV'}</button></>}</span>
          <ul>{RISK_POINTS.map((p) => <li key={p}>{p}</li>)}</ul>
        </span>
      </label>
    </Frame>
  );
}

// ── 3. Connect your LinkedIn ─────────────────────────────────────────────────

export function Connect({ ctx }) {
  const { s, scan } = ctx;
  const state = connectState(s);
  const otherJob = s?.running && s.action !== 'login';
  let status;
  if (state === 'connected') {
    status = (
      <div className="ob-status ok ob-pop" role="status">
        <span className="orb"><Ico.check /></span>
        <span><div className="st">Connected</div>
          <div className="sd">LinkedIn is signed in on {ctx.here}. Chrome steps out of your way now, and comes back only if LinkedIn asks you to sign in again or check it’s you.</div></span>
      </div>
    );
  } else if (state === 'waiting') {
    status = (
      <div className="ob-status waiting ob-rise" role="status">
        <span className="orb"><Ico.person /></span>
        <span><div className="st">Waiting for you to sign in <span className="ob-dotsl"><i /><i /><i /></span></div>
          <div className="sd">Finish in the Chrome window, in front of this one. This ticks itself the moment you’re in.</div>
          <div className="sa"><button type="button" className="ob-link" onClick={scan.stop}>Cancel</button></div></span>
      </div>
    );
  } else {
    status = (
      <div className="ob-status">
        <span className="orb"><Ico.person /></span>
        <span><div className="st">{state === 'closed' ? 'Not signed in' : 'Not connected yet'}</div>
          <div className="sd">{state === 'closed'
            ? 'The sign-in window closed before LinkedIn was signed in. Sign in to LinkedIn to try again.'
            : 'Sign in to LinkedIn opens a Chrome window on LinkedIn’s own sign-in page.'}</div></span>
      </div>
    );
  }
  return (
    <Frame
      eyebrow={stepEyebrow('connect', ctx.caps)}
      title="Connect your LinkedIn"
      lede={`Sixgree reads LinkedIn as you, in a Chrome window on ${ctx.here}. Sign in there once, the way you always do.`}
      error={scan.error}
      art={<ConnectArt state={state} here={ctx.here} />}
      foot={<>
        <Back onClick={() => ctx.back('connect')} />
        <Spacer />
        {otherJob && <span className="ob-hint">Something else is running. One at a time.</span>}
        {state === 'connected' ? <Primary onClick={() => ctx.next('connect')}>Continue</Primary>
          : state === 'waiting' ? <Waiting>Waiting for you…</Waiting>
            : <Primary icon={Ico.ext} onClick={() => scan.run('login')} disabled={scan.busy || otherJob}>Sign in to LinkedIn</Primary>}
      </>}
    >
      {status}
      <div className="ob-promises">
        <div><Ico.check />Never asks for your password, and never sees it</div>
        <div><Ico.check />Never posts or messages anyone</div>
        <div><Ico.check />Signs in only in the scanner’s own Chrome, on {ctx.here}</div>
      </div>
      {state !== 'connected' && (
        // TRAPS §12: Google and Apple block their sign-in in automated browsers, so the fix is a password.
        <div className="ob-note"><Ico.info /><span>Sign in to LinkedIn with <b>Google or Apple</b>? Those can’t work in the scanner’s window, so set a LinkedIn password first: on LinkedIn’s sign-in page, <b>Forgot password</b> emails you a link to make one.</span></div>
      )}
    </Frame>
  );
}

// ── 4. Set your pace ─────────────────────────────────────────────────────────

const PACE_LINE = {
  slow: 'The quietest.',
  medium: 'Half the pace.',
  fast: 'How the scanner has always run.',
};

export function Pace({ ctx }) {
  const { s, scan } = ctx;
  const saved = { ...DEFAULT_LIMITS, ...(s?.linkedin?.limits || {}) };
  // What was picked here shows at once; the scanner's answer catches up.
  const [chosen, setChosen] = useState({});
  const limits = { ...saved, ...chosen };
  const auto = useSyncExternalStore(watchAllDay, allDayNow, () => false);
  const pace = PACES[limits.pace] ? limits.pace : DEFAULT_PACE;

  function set(change) {
    setChosen((c) => ({ ...c, ...change }));
    scan.setting('set-limits', { ...limits, ...change });
  }

  const note = limitNote(limits);
  const time = durationText(paceSeconds(pace, limits.daily));
  return (
    <Frame
      eyebrow={stepEyebrow('pace', ctx.caps)}
      title="Set your pace"
      lede="Every page the scanner reads is one LinkedIn search. Slower is quieter, and one daily limit stops a scan. You can change both anytime on the Scan page."
      error={scan.error}
      art={<PaceArt daily={Number(limits.daily)} pace={pace} />}
      foot={<>
        <Back onClick={() => ctx.back('pace')} />
        <Spacer />
        <Primary onClick={ctx.paced}>Continue</Primary>
      </>}
    >
      <div className="ob-label">Speed</div>
      <div className="ob-seg3" role="radiogroup" aria-label="Speed">
        {PACE_NAMES.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={pace === k} className={`ob-seg${pace === k ? ' sel' : ''}`} onClick={() => set({ pace: k })} id={`ob-pace-${k}`}>
            <div className="sn">{PACES[k].label}</div><div className="sv">~{searchesPerHour(k)} searches an hour</div>
          </button>
        ))}
      </div>
      <div className="ob-hintline">{PACE_LINE[pace]} Your first circle shows in {durationText(firstCircleSeconds(pace))}. Slower only adds waiting.</div>
      {/* One limit (Blake, 2026-10-05): a number, the default already in it. */}
      <label className="ob-label" htmlFor="ob-daily" style={{ marginTop: 10, display: 'block' }}>Searches a day</label>
      <div className="ob-dailyrow" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <DailyLimitInput id="ob-daily" value={Number(limits.daily)} onSave={(n) => set({ daily: n })} />
        {Number(limits.daily) === SAFE_LIMITS.daily && <span className="ob-hintline" style={{ margin: 0 }}>The default</span>}
      </div>
      {note ? (
        <div className="ob-warn" role="status">
          <span>{note}</span>
          <button type="button" className="ob-btn secondary small" onClick={() => set(SAFE_LIMITS)}>Back to {SAFE_LIMITS.daily} a day</button>
        </div>
      ) : (
        <div className="ob-hintline">
          {Number(limits.daily) === SAFE_LIMITS.daily ? 'The safe default.'
            : Number(limits.daily) < SAFE_LIMITS.daily ? 'Extra careful.' : 'Still on the safe side.'}
          {' '}At {PACES[pace].label}, a day’s searches are {time} of scanning. The Scan page can lift the limit for one session.
          {' '}A real account was restricted after {RESTRICTED_AT} searches in 24 hours.
        </div>
      )}
      {/* Auto scan only while circle scans run Automatic, never By hand (lib/scanner-capabilities.js modeChoices). */}
      {modeChoices(ctx.caps, limits.manual === true).autoScan && <button type="button" className="ob-auto" onClick={() => setAllDay(!auto)} aria-pressed={auto} id="ob-auto">
        <span>
          <div className="at">Auto scan <span className="ob-tag exp">Experimental</span></div>
          <div className="ad">Puts an Auto scan button in the top bar. Press it and the scanner maps who they know in small rounds while the app is open: 9:00 to 18:00, within your searches a day.</div>
        </span>
        <span className={`ob-toggle${auto ? ' on' : ''}`} />
      </button>}
    </Frame>
  );
}

// ── 5. First scan: one person's circle ───────────────────────────────────────
// Blake, 2026-10-14: the first scan used to be the walk of your own
// connections, which after a CSV import reads people you already have, and
// only Auto scan does. Now it maps one circle, which either scanner does:
// someone you know, picked for you (lib/reach.js firstCirclePicks), the first
// FIRST_SCAN_PAGES pages of their list, by their id like every Scan button.
// With Manual scan alone it's a manual read (the route makes it one): you
// scroll each page in the scanner's Chrome and click Next. Later, from the
// Scan tab, is always there.

/** How many people the picker offers: the one picked, and the next few under "Pick someone else". */
const PICKS = 6;

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'them';
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

/**
 * Who the first scan can start with, from your connections and what the
 * scanner has noted (hidden lists, lists read): null while it loads. Asked
 * again after a read that found nobody, so someone whose list turned out
 * hidden makes way for the next.
 */
function useCirclePicks(again) {
  const { userId } = useUser();
  const [picks, setPicks] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let off = false;
    Promise.all([loadNetwork(userId), loadScanNotes()])
      .then(([net, notes]) => {
        if (off) return;
        setPicks(firstCirclePicks(net.degree1, reachIndex(net.degree1, net.degree2, notes), PICKS));
        setError(null);
      })
      // Said, never passed off as nobody to pick (TRAPS §7).
      .catch((e) => { if (!off) { setPicks([]); setError(e.message || 'Your connections couldn’t be read.'); } });
    return () => { off = true; };
  }, [userId, again]);
  return { picks, error };
}

/** One of your connections, as a choice: initials, name, tier, and what they do. */
function Person({ person, selected, tag, onClick }) {
  const what = [person.role, person.company].filter(Boolean).join(' · ') || person.headline || '';
  const tier = String(person.tier || '').toLowerCase();
  return (
    <button type="button" className={`ob-choice ob-person${selected ? ' sel' : ''}`} onClick={onClick} aria-pressed={selected} data-person={person.id}>
      <span className="ci">{initials(person.name)}</span>
      <span style={{ minWidth: 0 }}>
        <span className="ct">{person.name}
          {person.tier && <span className="ob-tier" style={{ color: `var(--ob-${tier}, var(--ob-fg3))` }}>{person.tier}-tier</span>}
          {tag && <span className="ob-tag opt">{tag}</span>}
        </span>
        {what && <span className="cd">{what}</span>}
      </span>
      <span className="ob-radio" />
    </button>
  );
}

/** Your field, answered or skipped, during a first scan (the old first scan's question). */
function useFieldAnswer(scan) {
  const [picks, setPicks] = useState([]);
  const [narrow, setNarrow] = useState(false);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);
  async function pick() {
    setSaving('pick'); setError(null);
    const d = await saveField(picks);
    if (d.settings) scan.setSettings(d.settings); else setError(d.error);
    setSaving(null);
  }
  async function skip() {
    setSaving('skip'); setError(null);
    const next = await skipField();
    scan.setSettings((prev) => next || { ...(prev || {}), fieldAsked: true });
    setSaving(null);
  }
  return { picks, setPicks, narrow, setNarrow, saving, error, pick, skip };
}

/**
 * The first scan, by what's there (lib/onboarding.js firstScanOffer): your
 * people in, one person's circle; nobody yet with Auto scan, the walk of your
 * own connections; nobody yet with Manual scan alone, the way to bring them in.
 */
export function FirstScan({ ctx }) {
  const fs = ctx.firstScan;
  if (fs.kind === 'walk' && fs.state !== 'idle') return <FirstWalk ctx={ctx} />;
  if (ctx.offer === 'walk') return <FirstWalk ctx={ctx} />;
  if (ctx.offer === 'needs-people' || (ctx.offer === 'none' && !ctx.people)) return <NeedsPeople ctx={ctx} />;
  return <FirstCircle ctx={ctx} />;
}

function FirstCircle({ ctx }) {
  const { s, settings, scan } = ctx;
  const fs = ctx.firstScan;
  const { picks, error: picksError } = useCirclePicks(fs.state === 'empty');
  // The one picked: the highest scored until you pick someone else.
  const [chosenId, setChosenId] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const person = picks?.find((p) => p.id === chosenId) || picks?.[0] || null;
  const others = (picks || []).filter((p) => p !== person);
  const field = useFieldAnswer(scan);
  const answered = settings?.fieldAsked ? (settings.sectorFocus?.sectors || []) : null;
  // A job that isn't this scan: nothing starts until it's done, so the first scan never waits in the queue.
  const otherJob = Boolean(s?.running) && fs.state !== 'running';
  const unit = ctx.here === 'this Mac' ? 'Mac' : 'computer';
  const limits = s?.linkedin?.limits || {};
  // Manual: always with Manual scan alone (the route makes every circle scan
  // one), and with both scanners when manual mode is on (Scan → Scanner settings).
  const manual = ctx.kind === 'manual' || limits.manual === true;
  const cost = circleScanCost(FIRST_SCAN_PAGES, limits.pace, limits.gentle !== false);
  const who = firstName(fs.who || person?.name);

  const reading = fs.state === 'running' || fs.state === 'saving';
  const pct = Math.max(0, Math.min(100, Math.round((Math.min(fs.pages, fs.of) / fs.of) * 100)));
  const art = reading || fs.state === 'done'
    ? (
      <div>
        <div className="ob-art-galaxy"><Galaxy progress={fs.state === 'done' ? 1 : Math.max(0.08, pct / 100)} /></div>
        <div className="ob-badge">{fs.state === 'done' ? <Ico.check /> : <ClusterSpinner size={16} live glyph="" />}
          {fs.state === 'saving' ? `Saving to ${ctx.here}…` : fs.found > 0 ? `${fs.found.toLocaleString()} ${fs.found === 1 ? 'person' : 'people'} so far` : `Opening ${who}’s list…`}
        </div>
      </div>
    )
    : <div><div className="ob-art-galaxy"><Galaxy progress={0} ghost /></div><div className="ob-badge"><Ico.spark />Their people appear here as they’re read</div></div>;
  const bar = (
    <div className="ob-bar" role="progressbar" aria-valuemin={0} aria-valuemax={fs.of} aria-valuenow={Math.min(fs.pages, fs.of)}>
      <i style={{ width: `${fs.state === 'saving' || fs.state === 'done' ? 100 : pct}%` }} />
    </div>
  );
  const pageLine = `Page ${Math.min(fs.pages, fs.of)} of ${fs.of}`
    + (fs.found > 0 ? ` · ${fs.found.toLocaleString()} ${fs.found === 1 ? 'person' : 'people'}` : '');

  // Your field, while it reads: the old first scan's question, kept until answered.
  if (ctx.fieldOpen) {
    const done = fs.state === 'done';
    return (
      <Frame
        eyebrow={stepEyebrow('map', ctx.caps)}
        title={<>While it reads,<br />one question</>}
        error={field.error || scan.error}
        art={art}
        foot={<>
          <button type="button" className="ob-btn ghost" onClick={field.skip} disabled={Boolean(field.saving)}>Skip for now</button>
          <Spacer />
          <Primary onClick={field.pick} disabled={!field.picks.length || Boolean(field.saving)}>{field.saving === 'pick' ? 'Saving…' : done ? 'See my galaxy' : 'Continue'}</Primary>
        </>}
      >
        {done ? (
          <div className="ob-strip ok"><Ico.check /><span>{who}’s circle is mapped</span></div>
        ) : (
          <div className="ob-strip"><ClusterSpinner size={18} live glyph="" />
            <span>{fs.state === 'saving' ? 'Saving…' : manual ? `${pageLine}. Scroll each page in Chrome, then click Next` : pageLine}</span>{bar}</div>
        )}
        <FieldQuestion picks={field.picks} setPicks={field.setPicks} narrow={field.narrow} setNarrow={field.setNarrow} disabled={Boolean(field.saving)} />
      </Frame>
    );
  }

  if (reading) {
    return (
      <Frame
        eyebrow={stepEyebrow('map', ctx.caps)}
        title={`Mapping ${who}’s circle`}
        lede={manual
          ? `The scanner’s Chrome is open in front, at ${who}’s list. Scroll to the foot of each page and it’s read; then click Next. After ${FIRST_SCAN_PAGES} pages it’s done.`
          : `The scanner reads the first ${FIRST_SCAN_PAGES} pages of ${who}’s connections and saves everyone here.`}
        error={scan.error}
        art={art}
        foot={<>
          <button type="button" className="ob-btn ghost" onClick={scan.stop}><Ico.stop />Stop</button>
          <Spacer />
          <Waiting>{manual ? 'Your turn in Chrome…' : 'Scanning…'}</Waiting>
        </>}
      >
        {/* What LinkedIn needs of you at the scanner's Chrome (signing in, a check, or a manual read's next page). */}
        {s?.needsYou && <div className="ob-warn" role="status" id="ob-needs-you"><span>LinkedIn needs you: {s.needsYou}</span></div>}
        <div className="ob-prog" role="status">
          <div className="ph"><ClusterSpinner size={44} live glyph="" />
            <span><div className="pt">{fs.state === 'saving' ? `Saving ${who}’s circle to ${ctx.here}` : manual ? 'Waiting for you in Chrome' : `Reading ${who}’s connections`}</div>
              <div className="pd">{manual ? 'Each page you scroll to its foot is read and saved.' : `Chrome is working in the background. You can keep using your ${unit}.`}</div></span></div>
          {bar}
          <div className="ob-pnum">
            <span>{fs.state === 'saving' ? 'Saving…' : pageLine}</span>
            <span>{fs.state === 'saving' ? '' : `${pct}%`}</span>
          </div>
        </div>
        {answered && (
          <div className="ob-strip ok ob-rise"><Ico.check /><span>{answered.length ? `Your field: ${fieldLabel(answered)}. People are scored with it as they arrive.` : 'No field for now. You can pick one anytime in Settings.'}</span></div>
        )}
        <div className="ob-facts">
          <div><span className="fi"><Ico.pause /></span>Stop anytime. Everything found so far is kept.</div>
          <div><span className="fi"><Ico.lock /></span>Saved on {ctx.here} as it goes. Nothing is posted or sent.</div>
        </div>
      </Frame>
    );
  }

  // Not started, or ended without people to show: whom to start with, and Start.
  const failed = fs.state === 'failed';
  const again = failed && person && fs.who === person.name;
  const nobody = picks && picks.length === 0;
  const error = scan.error || picksError
    || (failed ? `The scan stopped before it finished.${fs.failure ? `\n${fs.failure}` : ''}` : null);
  return (
    <Frame
      eyebrow={stepEyebrow('map', ctx.caps)}
      title="Map your first circle"
      lede={`Start with one person you know: the first ${FIRST_SCAN_PAGES} pages of their connections, about ${FIRST_SCAN_PAGES * 10} people you could reach through them. One profile view and ${FIRST_SCAN_PAGES} searches, gentle on your account.`}
      error={error}
      art={art}
      foot={<>
        <Back onClick={() => ctx.back('map')} />
        <Spacer />
        {otherJob && <span className="ob-hint">Something else is running. One at a time.</span>}
        <button type="button" className="ob-btn ghost" id="ob-later" onClick={ctx.later}>Later, from the Scan tab</button>
        {nobody ? <Primary onClick={ctx.later}>Continue</Primary> : (
          <Primary icon={Ico.play} data-first-scan="" onClick={() => person && ctx.startFirstScan(person)} disabled={!person || scan.busy || otherJob}>
            {again ? 'Try again' : person ? `Map ${firstName(person.name)}’s circle` : 'Map their circle'}
          </Primary>
        )}
      </>}
    >
      {fs.state === 'empty' && (
        <div className="ob-note" id="ob-first-empty"><Ico.info /><span>{fs.hidden
          ? `${firstName(fs.who)}’s connections are hidden, so there was no one to map, and they’re skipped from now on. Start with someone else, or later from the Scan tab.`
          : `Nothing was read from ${firstName(fs.who)}’s list. Try again, start with someone else, or later from the Scan tab.`}</span></div>
      )}
      {picks === null && <div className="ob-quiet">Finding someone to start with…</div>}
      {nobody && !picksError && (
        <div className="ob-note"><Ico.info /><span>There’s nobody to start with: a first scan needs someone you know with a profile link whose circle isn’t mapped yet. Map one anytime from the Scan tab.</span></div>
      )}
      {person && (
        <div className="ob-people" data-first-pick={person.id}>
          <div className="ob-label">Start with</div>
          <Person person={person} selected tag={person === picks[0] ? 'Highest scored' : null} onClick={() => setListOpen(!listOpen)} />
          {others.length > 0 && (
            <button type="button" className="ob-link" id="ob-pick-other" onClick={() => setListOpen(!listOpen)}
              style={{ alignSelf: 'flex-start', fontSize: 13, background: 'none', border: 0, padding: 0 }}>
              {listOpen ? 'Keep this one' : 'Pick someone else'}
            </button>
          )}
          {listOpen && others.map((p) => (
            <Person key={p.id} person={p} selected={false} onClick={() => { setChosenId(p.id); setListOpen(false); }} />
          ))}
        </div>
      )}
      {person && (manual ? (
        <div className="ob-note" id="ob-manual-note"><Ico.info /><span>
          <b>You turn the pages.</b> The scanner’s Chrome opens in front of you at their list. Scroll to the foot of each page and it’s read; then click <b>Next</b>. After {FIRST_SCAN_PAGES} pages it’s done.
        </span></div>
      ) : (
        <div className="ob-facts">
          <div><span className="fi"><Ico.eye /></span>Chrome works in the background, about {cost.minutes} minutes at your pace. Keep using your {unit}.</div>
          <div><span className="fi"><Ico.pause /></span>Stop anytime. Everything found so far is kept.</div>
        </div>
      ))}
    </Frame>
  );
}

// ── 5b. First scan without a CSV ─────────────────────────────────────────────
// Blake, 2026-10-14: "if the user doesn't have a csv but wants to scan only
// for their connections to start we have to allow that". With nobody in yet
// and Auto scan installed, the first scan is the walk of your own connections
// (`full`), the setup's first scan from before, with its progress and the
// field question. Then the map, and one circle from the Scan tab next time.

function FirstWalk({ ctx }) {
  const { s, settings, scan } = ctx;
  const fs = ctx.firstScan;
  const field = useFieldAnswer(scan);
  const answered = settings?.fieldAsked ? (settings.sectorFocus?.sectors || []) : null;
  const otherJob = Boolean(s?.running) && !(fs.kind === 'walk' && (fs.state === 'running' || fs.state === 'saving'));
  const unit = ctx.here === 'this Mac' ? 'Mac' : 'computer';
  const pct = fs.total ? Math.max(0, Math.min(100, Math.round((fs.done / fs.total) * 100))) : null;
  const progress = fs.state === 'done' || fs.state === 'saving' ? 1 : pct != null ? pct / 100 : 0;
  const art = fs.state === 'idle' || fs.state === 'failed'
    ? <div><div className="ob-art-galaxy"><Galaxy progress={0} ghost /></div><div className="ob-badge"><Ico.spark />Your people appear here as they’re read</div></div>
    : (
      <div>
        <div className="ob-art-galaxy"><Galaxy progress={progress} /></div>
        <div className="ob-badge">{fs.state === 'done' ? <Ico.check /> : <ClusterSpinner size={16} live glyph="" />}
          {fs.state === 'saving' ? `Saving to ${ctx.here}…` : fs.state === 'done' ? `All ${fs.done.toLocaleString()} saved` : fs.done != null ? `${fs.done.toLocaleString()} people so far` : 'Opening your connections…'}
        </div>
      </div>
    );
  const bar = (
    <div className={`ob-bar${pct == null ? ' unknown' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={fs.total || 0} aria-valuenow={fs.done || 0}>
      <i style={{ width: pct == null ? undefined : `${pct}%` }} />
    </div>
  );

  if (ctx.fieldOpen) {
    const done = fs.state === 'done';
    return (
      <Frame
        eyebrow={stepEyebrow('map', ctx.caps)}
        title={<>While it reads,<br />one question</>}
        error={field.error || scan.error}
        art={art}
        foot={<>
          <button type="button" className="ob-btn ghost" onClick={field.skip} disabled={Boolean(field.saving)}>Skip for now</button>
          <Spacer />
          <Primary onClick={field.pick} disabled={!field.picks.length || Boolean(field.saving)}>{field.saving === 'pick' ? 'Saving…' : done ? 'See my galaxy' : 'Continue'}</Primary>
        </>}
      >
        {done ? (
          <div className="ob-strip ok"><Ico.check /><span>All {fs.done.toLocaleString()} connections saved</span></div>
        ) : (
          <div className="ob-strip"><ClusterSpinner size={18} live glyph="" />
            <span>{fs.state === 'saving' ? 'Saving…' : `${(fs.done || 0).toLocaleString()} of ${(fs.total || 0).toLocaleString()}`}</span>{bar}</div>
        )}
        <FieldQuestion picks={field.picks} setPicks={field.setPicks} narrow={field.narrow} setNarrow={field.setNarrow} disabled={Boolean(field.saving)} />
      </Frame>
    );
  }

  if (fs.state === 'running' || fs.state === 'saving') {
    return (
      <Frame
        eyebrow={stepEyebrow('map', ctx.caps)}
        title="Scanning your connections"
        lede="The scanner reads your connections list and saves everyone here. About a minute and a half for 750 people."
        error={scan.error}
        art={art}
        foot={<>
          <button type="button" className="ob-btn ghost" onClick={scan.stop}><Ico.stop />Stop</button>
          <Spacer />
          <Waiting>Scanning…</Waiting>
        </>}
      >
        {s?.needsYou && <div className="ob-warn" role="status"><span>LinkedIn needs you: {s.needsYou}</span></div>}
        <div className="ob-prog" role="status">
          <div className="ph"><ClusterSpinner size={44} live glyph="" />
            <span><div className="pt">{fs.state === 'saving' ? `Saving your people to ${ctx.here}` : 'Reading your connections'}</div>
              <div className="pd">Chrome is working in the background. You can keep using your {unit}.</div></span></div>
          {bar}
          <div className="ob-pnum">
            <span>{fs.state === 'saving' ? 'Saving, and fetching photos. This can take a minute.' : fs.total != null ? `${fs.done.toLocaleString()} of ${fs.total.toLocaleString()} connections` : 'Opening your connections…'}</span>
            <span>{pct != null && fs.state !== 'saving' ? `${pct}%` : ''}</span>
          </div>
        </div>
        {answered && (
          <div className="ob-strip ok ob-rise"><Ico.check /><span>{answered.length ? `Your field: ${fieldLabel(answered)}. People are scored with it as they arrive.` : 'No field for now. You can pick one anytime in Settings.'}</span></div>
        )}
        <div className="ob-facts">
          <div><span className="fi"><Ico.pause /></span>Stop anytime. Everything found so far is kept.</div>
          <div><span className="fi"><Ico.lock /></span>Saved on {ctx.here} as it goes. Nothing is posted or sent.</div>
        </div>
      </Frame>
    );
  }

  const failed = fs.state === 'failed';
  return (
    <Frame
      eyebrow={stepEyebrow('map', ctx.caps)}
      title="Scan your connections"
      lede="No CSV? The scanner reads your connections list and saves everyone here. About a minute and a half for 750 people."
      error={scan.error || (failed ? `The scan stopped before it finished.${fs.failure ? `\n${fs.failure}` : ''}` : null)}
      art={art}
      foot={<>
        <Back onClick={() => ctx.back('map')} />
        <Spacer />
        {otherJob && <span className="ob-hint">Something else is running. One at a time.</span>}
        <button type="button" className="ob-btn ghost" id="ob-later" onClick={ctx.later}>Later, from the Scan tab</button>
        <Primary icon={Ico.play} onClick={ctx.startWalk} disabled={scan.busy || otherJob} data-first-walk="">{failed ? 'Try again' : 'Scan your connections'}</Primary>
      </>}
    >
      <div className="ob-facts">
        <div><span className="fi"><Ico.eye /></span>Chrome works in the background. Keep using your {unit}.</div>
        <div><span className="fi"><Ico.pause /></span>Stop anytime. Everything found so far is kept.</div>
        <div><span className="fi"><Ico.spark /></span>Your galaxy fills in as it reads. Who they know comes after, a circle at a time.</div>
      </div>
      <div className="ob-quiet">Rather import the official export? <button type="button" className="ob-link" onClick={ctx.openCsv}
        style={{ background: 'none', border: 0, padding: 0, font: 'inherit' }}>Import a CSV instead</button>: no risk to your account.</div>
    </Frame>
  );
}

/**
 * Nobody in yet, with Manual scan alone: it reads the circles of people you
 * already know, so it can't bring them in by itself. Said plainly, with both
 * ways to bring them in, and Later: never a dead end.
 */
function NeedsPeople({ ctx }) {
  return (
    <Frame
      eyebrow={stepEyebrow('map', ctx.caps)}
      title="Bring in the people you know first"
      lede="Manual scan reads the circles of people you already know, so it can’t bring them in by itself. To bring in the people you know, import your Connections.csv or install Auto scan."
      error={ctx.scan.error}
      art={<div><div className="ob-art-galaxy"><Galaxy progress={0} ghost /></div><div className="ob-badge"><Ico.spark />Your people appear here first</div></div>}
      foot={<>
        <Back onClick={() => ctx.back('map')} />
        <Spacer />
        <button type="button" className="ob-btn ghost" id="ob-later" onClick={ctx.later}>Later, from the Scan tab</button>
        <Primary onClick={ctx.openCsv} icon={Ico.csv} data-needs-csv="">Import your Connections.csv</Primary>
      </>}
    >
      <div className="ob-row" id="ob-needs-people">
        <span className="ri"><Ico.csv /></span>
        <span><div className="rt">Import your Connections.csv</div><div className="rd">The official export: the people you know, with no risk to your account. Then Manual scan maps their circles.</div></span><span />
      </div>
      <div className="ob-row">
        <span className="ri"><Ico.radar /></span>
        <span><div className="rt">Or install Auto scan</div><div className="rd">It reads your connections list for you, then maps their circles by itself.</div></span>
        <button type="button" className="ob-btn secondary small" onClick={ctx.openPlugins} data-needs-auto="">Install Auto scan</button>
      </div>
    </Frame>
  );
}

/** The field question, asked while the first scan reads (lib/onboarding.js asksField). */
function FieldQuestion({ picks, setPicks, narrow, setNarrow, disabled }) {
  const full = picks.length >= MAX_SECTORS;
  return (
    <div className="ob-field">
      <div className="fe">Optional</div>
      <div className="ft">What field are you in?</div>
      <div className="fd">Pick up to three. People at companies in your field rank higher. You can change it anytime in Settings.</div>
      {/* The choices scroll inside the card, so the title and the question stay in sight in a small window. */}
      <div className="ob-picklist">
      {narrow ? (
        <SectorPicker sectors={picks} onChange={setPicks} disabled={disabled} />
      ) : (
        <div className="ob-picks">
          {INDUSTRIES.map((g) => {
            const on = picks.includes(g.key);
            return (
              <button key={g.key} type="button" className={`ob-pick${on ? ' sel' : ''}`} disabled={disabled || (!on && full)} aria-pressed={on} id={`ob-pick-${g.key}`}
                onClick={() => setPicks(on ? picks.filter((k) => k !== g.key) : [...picks, g.key])}>
                {on && <Ico.check />}{g.label}
              </button>
            );
          })}
        </div>
      )}
      </div>
      <div style={{ marginTop: 12, fontSize: 13 }}>
        <button type="button" className="ob-link" onClick={() => setNarrow(!narrow)}>{narrow ? 'Back to the twelve broad fields' : 'Something narrower? Search every sector'}</button>
      </div>
    </div>
  );
}

const fieldLabel = (sectors) => sectors.map((k) => sectorByKey(k).label).join(' · ');

// ── Import a connections CSV ─────────────────────────────────────────────────
// Off the five steps: the CSV's door (Blake, 2026-10-12). Drop or pick the
// file, see what it adds, Import, then the map, or, with a scanner installed,
// Set up scanning first (Blake, 2026-10-14). The import itself is
// useCsvImport's (Onboarding.js holds it, so a file dropped on any step lands
// here), the same as the Import page's.

const many = (n, one, more) => `${(Number(n) || 0).toLocaleString()} ${Number(n) === 1 ? one : more}`;

/** What the import would do, or did, one line each (lib/csv.js importLines). */
function ImportLines({ of, done }) {
  const lines = importLines(of, { done });
  if (!lines.length) return null;
  return (
    <div className="ob-facts" data-import-lines="">
      {lines.map((l) => (
        <div key={l.key} data-line={l.key}>
          <span className="fi">{l.key === 'noLink' || l.key === 'repeated' ? <Ico.info /> : <Ico.check />}</span>{l.text}
        </div>
      ))}
    </div>
  );
}

const importArt = (progress, badge) => (
  <div><div className="ob-art-galaxy"><Galaxy progress={progress} ghost={progress === 0} /></div><div className="ob-badge">{badge}</div></div>
);

// The scanners by what's installed (lib/onboarding.js scannerKind), for the CSV's result.
const SCANNERS = { auto: 'Auto scan is installed', manual: 'Manual scan is installed', both: 'Auto scan and Manual scan are installed' };

/**
 * The import's result. With a scanner installed (before the CSV, during it, or
 * here), Set up scanning, and Skip, see your galaxy beside it; with none, See
 * your galaxy, and Other ways to bring in your network, so a scanner can still be added
 * here. The box stays while you install one, though the result has changed.
 */
function ImportDone({ ctx }) {
  const { csv } = ctx;
  const [opening, setOpening] = useState(false);
  const [offer] = useState(() => ctx.kind === 'none' || ctx.toPlugins);
  const r = csv.result;
  const total = Number(r.network) || 0;
  const scanning = afterImport(ctx.caps) === 'ready';
  const finish = async () => { setOpening(true); await ctx.finish(); };
  return (
    <Frame
      eyebrow="Imported"
      title={<>Your people<br />are in.</>}
      lede={`${many(total, 'connection', 'connections')} in your network, scored and kept on ${ctx.here}.`}
      art={importArt(1, <><Ico.check />{many(total, 'person', 'people')} mapped</>)}
      foot={scanning ? <>
        <button type="button" className="ob-btn ghost" id="ob-skip-scanning" onClick={finish} disabled={opening}>{opening ? 'Opening…' : 'Skip, see your galaxy'}</button>
        <Spacer />
        <Primary onClick={ctx.setUpScanning} disabled={opening} data-set-up-scanning="">Set up scanning</Primary>
      </> : <>
        <Spacer />
        <Primary onClick={finish} disabled={opening}>{opening ? 'Opening…' : 'See your galaxy'}</Primary>
      </>}
    >
      <ImportLines of={{ counts: r.counts, leftOut: r.leftOut, repeated: csv.preview?.repeated }} done />
      {scanning && (
        <div className="ob-strip ok ob-rise" data-scanner-kind={ctx.kind}><Ico.check />
          <span>{SCANNERS[ctx.kind]}, so Sixgree can add who your connections know, a circle at a time. Setting it up takes a few minutes, before the map.</span>
        </div>
      )}
      <p className="ob-quiet" style={{ marginTop: 6 }}>Import a newer export anytime from the Import page: it adds anyone new and brings everyone else up to date, and never removes anyone.</p>
      {offer && <OtherWays onChanged={ctx.pluginsChanged} focus={ctx.toPlugins} onFocused={ctx.pluginsShown} />}
    </Frame>
  );
}

export function ImportCsv({ ctx }) {
  const { csv } = ctx;
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const pick = () => input.current?.click();
  const reading = csv.step === 'reading';
  const p = csv.preview;
  const art = importArt;

  if (csv.step === 'done') return <ImportDone ctx={ctx} />;

  if (csv.step === 'preview' || csv.step === 'importing') {
    const people = (p.counts?.add || 0) + (p.counts?.update || 0) + (p.counts?.promote || 0);
    const importing = csv.step === 'importing';
    return (
      <Frame
        eyebrow="Import a connections CSV"
        title="Ready to import"
        lede={`${many(p.received, 'person', 'people')} in ${p.fileName}. Here’s what importing it adds to your network on ${ctx.here}. Nothing has changed yet.`}
        error={csv.error}
        art={art(importing ? 1 : 0.6, importing ? <><span className="ob-spin" />Importing…</> : <><Ico.csv />{p.fileName}</>)}
        foot={<>
          <button type="button" className="ob-btn ghost" onClick={csv.again} disabled={importing}><Ico.left />Choose another file</button>
          <Spacer />
          {importing ? <Waiting>Importing…</Waiting>
            : <Primary onClick={csv.confirm} disabled={people === 0}>{people === 0 ? 'Nothing new to import' : `Import ${many(people, 'person', 'people')}`}</Primary>}
        </>}
      >
        <ImportLines of={p} />
      </Frame>
    );
  }

  return (
    <Frame
      eyebrow="Import a connections CSV"
      title="Bring in your connections"
      lede={`Drop the Connections.csv from your connections export. It’s read on ${ctx.here}, and you see what it adds before anything changes. Nothing is uploaded.`}
      error={csv.error}
      art={art(0, <><Ico.lock />Read on {ctx.here}. Nothing is uploaded.</>)}
      foot={<>
        <Back onClick={ctx.closeCsv} />
        <Spacer />
        {/* With a scanner installed the CSV is recommended, never a gate (Blake, 2026-10-14). */}
        {scanWithoutCsv(ctx.caps) && (
          <button type="button" className="ob-btn ghost" id="ob-without-csv" onClick={ctx.setUpScanning} disabled={reading}>
            Continue without a CSV: set up scanning
          </button>
        )}
        <Primary onClick={pick} disabled={reading} icon={null}>{reading ? 'Reading…' : 'Choose the file'}</Primary>
      </>}
    >
      <button type="button" className={`ob-drop${over ? ' over' : ''}`} id="ob-drop" onClick={pick} disabled={reading}
        onDragEnter={() => setOver(true)} onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}>
        <span className="ci"><Ico.csv /></span>
        <span className="dt">{reading ? 'Reading…' : 'Drop Connections.csv here'}</span>
        <span className="dd">or click to choose the file</span>
      </button>
      <input ref={input} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
        onChange={(e) => { csv.choose(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="ob-note"><Ico.info /><span>
        No file yet? On the platform: <b>Settings &amp; Privacy → Data privacy → Get a copy of your data</b>, pick <b>Connections</b>,
        and a download link arrives by email in about ten minutes. Unzip it and drop <b>Connections.csv</b> here.
        Its email addresses are never read.
      </span></div>
      <OtherWays onChanged={ctx.pluginsChanged} focus={ctx.toPlugins} onFocused={ctx.pluginsShown} />
    </Frame>
  );
}

// ── Other ways to bring in your network, under the CSV import ───────────────
// Blake, 2026-10-13: "in the onboarding we can push the csv mainly but also
// have a box below that ... shows the available plug ins which would be the
// scanners", and 10/14: "i dont want to make it that hard to see the plugins,
// and make a title that says alternative data import". A titled section, the
// two scanners' cards in it at once, from the copy of the official list that
// ships with the app (lib/plugins-shipped.js): nothing goes online to show
// them. A card's Install is the yes: it turns plugins on (POST
// /api/plugins/enabled, as Settings → Plugins does), fetches the real list,
// then downloads and checks the package, and the rest happens in the card
// (settings/PluginBrowse.js). It sits below the CSV, quieter, and nothing in
// the setup waits on it. It's on the import's result too while no scanner is
// installed, and Get ready's "Show the plugins" brings it into view
// (`focus`). Each change (`onChanged`) has the setup ask again what's
// installed at once, so a scanner installed here turns the result's button
// into Set up scanning without a reload.

function OtherWays({ onChanged, focus = false, onFocused }) {
  const box = useRef(null);
  // Whether plugins are on, and what is installed: from this computer, never online.
  const [view, setView] = useState(null);
  const install = usePluginInstall({ onView: (v) => { setView(v); onChanged?.(); }, enabled: view?.enabled === true });

  useEffect(() => {
    if (!focus) return;
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onFocused?.();
  }, [focus, onFocused]);

  useEffect(() => {
    let off = false;
    fetchPlugins().then((v) => { if (!off) setView(v); }).catch(() => { if (!off) setView({ enabled: false, plugins: [] }); });
    return () => { off = true; };
  }, []);

  return (
    <section className="ob-plugins" id="ob-plugins" ref={box} data-other-ways="" aria-labelledby="ob-other-ways">
      <div className="ob-label" id="ob-other-ways">Other ways to bring in your network</div>
      <p className="ob-plugins-d">
        Plugins add who your connections know, scanned with your own account. Install fetches one, and shows you what it is before anything installs.
      </p>
      <PluginCards install={install} installed={view?.plugins || []} quiet columns="1fr" />
    </section>
  );
}

// ── Your galaxy is ready ─────────────────────────────────────────────────────
// After a first circle scan, after Later, and with your people alone (no
// scanner): it says what's in, and only the pace there is. People in a circle
// show once there are some; the pace only with Auto scan, since with Manual
// scan alone you turn the pages; and what's next follows what's installed.

export function Final({ ctx, onFinish }) {
  const { s, settings, kind } = ctx;
  const [opening, setOpening] = useState(false);
  const count = Number(s?.network?.first) || 0;
  const circles = Number(s?.network?.second) || 0;
  const limits = { ...DEFAULT_LIMITS, ...(s?.linkedin?.limits || {}) };
  const sectors = settings?.sectorFocus?.sectors || [];
  // Photos are optional: not all of them in is said calmly, and never holds this back.
  const photos = photosNote(s);
  const walked = ctx.firstScan?.kind === 'walk' && ctx.firstScan.state === 'done';
  const next = kind === 'none'
    ? 'Want who they know too? A scanner adds them: Auto scan or Manual scan, from Settings → Plugins.'
    : walked
      ? 'Next time, map one person’s circle from the Scan tab: who they know, a circle at a time, at your pace.'
    : circles > 0
      ? 'Next, the rest of who they know. The scanner maps it a circle at a time, over days, at your pace. Carry on from the Scan tab whenever you like.'
      : 'Next, who they know. The scanner maps that a circle at a time, over days, at your pace. Start it from the Scan tab whenever you like.';
  return (
    <section className="ob-final" data-final={walked ? 'walk' : circles > 0 ? 'circle' : kind === 'none' ? 'csv' : 'later'}>
      <div className="fg"><Galaxy bloom /></div>
      <div className="scrim" />
      <div className="copy">
        <div className="ob-eyebrow">All set</div>
        <h1>Your galaxy<br />is ready.</h1>
        <p className="ob-lede">
          {count.toLocaleString()} people you know{circles > 0 ? `, and ${circles.toLocaleString()} ${circles === 1 ? 'person' : 'people'} they know,` : ''} mapped and kept on {ctx.here}.
        </p>
        {photos && <p className="ob-quiet" data-photos-note="" style={{ maxWidth: 440 }}>{photos}</p>}
        <div className="ob-tiles">
          <div><b>{count.toLocaleString()}</b>connections</div>
          {circles > 0 && <div><b>{circles.toLocaleString()}</b>in their circles</div>}
          {(kind === 'auto' || kind === 'both') && <div><b>{PACES[limits.pace]?.label || 'Fast'} · {limits.daily} a day</b>your pace</div>}
          {kind === 'manual' && <div><b>Manual scan</b>you turn the pages</div>}
          <div><b>{sectors.length ? fieldLabel(sectors) : 'None for now'}</b>your field</div>
        </div>
        <Primary onClick={async () => { setOpening(true); await onFinish(); }} disabled={opening}>{opening ? 'Opening…' : 'Open the map'}</Primary>
        <p className="next">{next}</p>
      </div>
    </section>
  );
}
