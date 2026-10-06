'use client';

// The setup's five steps and its last screen, one a screen (Onboarding.js
// moves between them). Each says what it is in a sentence or two, shows the
// live status of what it waits for, and has one primary button. What a button
// does is the Scan page's own (app/components/useScanStatus.js); the words for
// the scanner, App Management, the risks and the budget are the ones the Scan
// page uses (lib/scanner-setup.js, lib/scan-risk.js, lib/search-risk.js).

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { appManagementStep, askForField, CHROME_DOWNLOAD } from '../../../lib/scanner-setup';
import { readyChecks, connectState, firstScan, photosNote } from '../../../lib/onboarding';
import { RISK_POINTS } from '../../../lib/scan-risk';
import { PACE_NAMES, PACES, DEFAULT_PACE, searchesPerHour, firstCircleSeconds, paceSeconds, durationText } from '../../../lib/scan-pace';
import { SAFE_LIMITS, RISKY_DAILY, RESTRICTED_AT, limitNote } from '../../../lib/search-risk';
import { watchAllDay, allDayNow, setAllDay } from '../../../lib/experimental-client';
import { keptCsvProblem } from '../../../lib/csv';
import { INDUSTRIES } from '../../../lib/companies';
import { sectorByKey } from '../../../lib/sector-directory';
import { MAX_SECTORS } from '../../../lib/sector-focus';
import { saveField, skipField } from '../FieldStep';
import SectorPicker from '../settings/SectorPicker';
import ClusterSpinner from '../ClusterSpinner';
import { Ico, Galaxy, MacSettings, ChecksArt, ConnectArt, PaceArt } from './art';

// The budget picker's choices (app/components/LinkedInLimits.js).
const DAILY = [25, 50, 100, 200, 500];
// What the scanner uses when nothing is saved yet (lib/linkedin-limits.js DEFAULT_LIMITS).
const DEFAULT_LIMITS = { ...SAFE_LIMITS, profiles: 50, pace: DEFAULT_PACE };

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

export function Welcome({ ctx }) {
  const router = useRouter();
  const [choice, setChoice] = useState('scan');
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
    if (choice === 'scan') return ctx.start();
    if (choice === 'csv') { router.push('/import'); return undefined; }
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
        <Primary onClick={go} disabled={loading}>{loading ? 'Loading…' : { scan: 'Continue', csv: 'Import a CSV', sample: 'Open the sample' }[choice]}</Primary>
      </>}
    >
      {option('scan', Ico.radar, 'Scan my LinkedIn', 'The whole picture, including who your connections know. A few minutes to set up, and it needs Google Chrome.', {
        tag: 'Recommended', note: 'It runs your own LinkedIn account automatically, and LinkedIn may restrict accounts that do this.',
      })}
      {option('csv', Ico.csv, 'Import a LinkedIn CSV', 'LinkedIn’s own export, by email in about ten minutes. The people you know, not who they know.', { note: csvProblem })}
      {option('sample', Ico.spark, 'Try the sample', '150 invented people and the 598 they know, to look around before you decide.')}
    </Frame>
  );
}

// ── 2. Get your Mac ready ────────────────────────────────────────────────────

export function GetReady({ ctx }) {
  const { s, settings, scan } = ctx;
  const r = readyChecks(s);
  const [opened, setOpened] = useState(false);
  const mac = s?.checks?.mac;
  // On a Mac from macOS 13, which brought App Management (lib/scanner-setup.js).
  const appShown = Boolean(mac) && !(mac.version != null && mac.version < 13);
  const item = appManagementStep(s, settings);
  const answer = scan.appAnswer || settings?.appManagement || null;
  const who = mac?.app ? 'Sixgree' : 'the app you started Sixgree from';
  const running = s?.running;
  const installing = running && ['install', 'setup'].includes(s.action);

  const chrome = r.chrome === false ? (
    <div className="ob-mini no">
      <span className="ri"><Ico.globe /></span>
      <span><div className="rt">Google Chrome</div><div className="rd">Not on {ctx.here} yet</div></span>
      <span className="end"><a className="ob-btn secondary small" href={CHROME_DOWNLOAD} target="_blank" rel="noreferrer">Install<Ico.ext /></a></span>
    </div>
  ) : (
    <div className="ob-mini ok"><span className="ri"><Ico.check /></span><span><div className="rt">Google Chrome</div><div className="rd">Installed</div></span></div>
  );
  const scanner = r.scanner.done ? (
    <div className="ob-mini ok"><span className="ri"><Ico.check /></span><span><div className="rt">The scanner</div><div className="rd">{r.scanner.bundled ? 'Built in, nothing to install' : 'Ready to scan'}</div></span></div>
  ) : (
    <div className="ob-mini no"><span className="ri"><Ico.radar /></span><span><div className="rt">The scanner</div><div className="rd">{installing ? 'Setting up…' : 'Not set up yet'}</div></span></div>
  );

  let app = null;
  if (appShown && answer === 'done') {
    app = (
      <div className="ob-row ok">
        <span className="ri ob-pop"><Ico.check /></span>
        <span><div className="rt">App Management</div><div className="rd">macOS won’t stop to ask while Chrome updates.</div></span>
        <span className="ob-chip ok ob-pop"><Ico.check />Allowed</span>
      </div>
    );
  } else if (appShown && answer === 'skipped') {
    app = (
      <div className="ob-row">
        <span className="ri"><Ico.shield /></span>
        <span><div className="rt">App Management</div><div className="rd">Skipped. Scanning works either way.</div></span>
        <button type="button" className="ob-btn ghost small" onClick={() => scan.answerAppManagement(null)}>Set it up</button>
      </div>
    );
  } else if (appShown && item) {
    app = (
      <div className="ob-row attn">
        <span className="ri"><Ico.shield /></span>
        <span><div className="rt">App Management <span className="ob-tag opt">Optional</span></div></span>
        {opened ? <span className="ob-chip wait"><span className="ob-dotsl"><i /><i /><i /></span>In System Settings</span> : <span />}
        <div className="rx">
          <p>{opened
            ? <>Turn on <b>{who}</b> in the window that opened, then come back and say so. Sixgree can’t see this setting, so it takes your word for it.</>
            : item.text}</p>
          <div className="acts">
            {opened ? (
              <>
                <button type="button" className="ob-btn secondary small" id="ob-appm-done" onClick={() => scan.answerAppManagement('done')}><Ico.check />I’ve allowed it</button>
                <a className="ob-btn ghost small" href={item.href}>Open it again</a>
              </>
            ) : (
              // A System Settings address opens in place: the Mac app opens System
              // Settings itself, a browser asks first (app/setup/page.js Launch).
              <a className="ob-btn secondary small" id="ob-appm-open" href={item.href} onClick={() => setOpened(true)}>Open System Settings<Ico.ext /></a>
            )}
            <button type="button" className="ob-btn ghost small" onClick={() => scan.answerAppManagement('skipped')}>Skip</button>
          </div>
        </div>
      </div>
    );
  }

  const hint = r.done ? null
    : r.chrome === false ? 'Waiting for Google Chrome'
      : !r.scanner.done ? 'Set up the scanner first'
        : 'Tick “I understand” to go on';
  const art = appShown
    ? <MacSettings answer={answer || (opened ? 'opened' : null)} name={mac?.app ? 'Sixgree' : 'Terminal'} />
    : <ChecksArt chrome={r.chrome !== false} scanner={r.scanner.done} risk={r.risk} />;

  return (
    <Frame
      eyebrow="Step 2 of 5 · Get ready"
      title={`Get your ${ctx.here === 'this Mac' ? 'Mac' : 'computer'} ready`}
      lede="A few things the scanner needs. Each one ticks itself the moment it’s done."
      error={scan.error}
      art={art}
      foot={<>
        <Back onClick={() => ctx.go('welcome')} />
        <Spacer />
        {hint && <span className="ob-hint">{hint}</span>}
        <Primary onClick={() => ctx.go('connect')} disabled={!r.done}>Continue</Primary>
      </>}
    >
      <div className={`ob-pair${r.chrome === false ? ' wide' : ''}`}>{chrome}{scanner}</div>
      {r.scanner.missing && (
        <div className="ob-row bad"><span className="ri"><Ico.radar /></span>
          <span><div className="rt">The scanner’s files are missing</div><div className="rd">This copy of Sixgree is missing part of its scanner. Download it again from sixgree.com and put the new copy in place of this one.</div></span><span /></div>
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
          <span className="ct">I understand what scanning risks{!r.risk && <> <Link className="ob-link" href="/import" style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 500 }}>Rather not? Import a CSV</Link></>}</span>
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
      eyebrow="Step 3 of 5 · Connect"
      title="Connect your LinkedIn"
      lede={`Sixgree reads LinkedIn as you, in a Chrome window on ${ctx.here}. Sign in there once, the way you always do.`}
      error={scan.error}
      art={<ConnectArt state={state} here={ctx.here} />}
      foot={<>
        <Back onClick={() => ctx.go('ready')} />
        <Spacer />
        {otherJob && <span className="ob-hint">Something else is running. One at a time.</span>}
        {state === 'connected' ? <Primary onClick={() => ctx.go('pace')}>Continue</Primary>
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
      eyebrow="Step 4 of 5 · Pace"
      title="Set your pace"
      lede="Every page the scanner reads is one LinkedIn search. Fewer and slower is safer. You can change both anytime on the Scan page."
      error={scan.error}
      art={<PaceArt daily={Number(limits.daily)} pace={pace} />}
      foot={<>
        <Back onClick={() => ctx.go('connect')} />
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
      <div className="ob-label" style={{ marginTop: 10 }}>Searches a day</div>
      <div className="ob-daily" role="radiogroup" aria-label="Searches a day">
        {DAILY.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={Number(limits.daily) === n} id={`ob-daily-${n}`}
            className={`ob-dchip${Number(limits.daily) === n ? ' sel' : ''}${n > RISKY_DAILY ? ' risky' : ''}`} onClick={() => set({ daily: n })}>
            {n}{n === SAFE_LIMITS.daily && <small>Default</small>}
          </button>
        ))}
      </div>
      {note ? (
        <div className="ob-warn" role="status">
          <span>{note}</span>
          <button type="button" className="ob-btn secondary small" onClick={() => set(SAFE_LIMITS)}>Back to {SAFE_LIMITS.daily} a day, {SAFE_LIMITS.monthly} a month</button>
        </div>
      ) : (
        <div className="ob-hintline">
          {Number(limits.daily) === SAFE_LIMITS.daily ? `The safe default, with ${SAFE_LIMITS.monthly} a month on top.`
            : Number(limits.daily) < SAFE_LIMITS.daily ? 'Extra careful.' : 'The most that’s still on the safe side.'}
          {' '}At {PACES[pace].label}, a day’s budget is {time} of scanning. A real account was restricted after {RESTRICTED_AT} searches in 24 hours.
        </div>
      )}
      <button type="button" className="ob-auto" onClick={() => setAllDay(!auto)} aria-pressed={auto} id="ob-auto">
        <span>
          <div className="at">Auto scan <span className="ob-tag exp">Experimental</span></div>
          <div className="ad">Puts an Auto scan button in the top bar. Press it and the scanner maps who they know in small rounds while the app is open: 9:00 to 18:00, 40 searches a day at most.</div>
        </span>
        <span className={`ob-toggle${auto ? ' on' : ''}`} />
      </button>
    </Frame>
  );
}

// ── 5. Map your people ───────────────────────────────────────────────────────

/** The field question, asked while the first scan reads (lib/scanner-setup.js askForField). */
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

export function MapPeople({ ctx }) {
  const { s, settings, scan } = ctx;
  const fs = firstScan(s, ctx.follow);
  const [picks, setPicks] = useState([]);
  const [narrow, setNarrow] = useState(false);
  const [saving, setSaving] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const answered = settings?.fieldAsked ? (settings.sectorFocus?.sectors || []) : null;
  const ask = askForField(s, settings, { duringFirstScan: true }) === true;
  // Asked once the reading has begun (LinkedIn has said how many), not while Chrome opens.
  const showField = ask && (fs.total != null || fs.state === 'saving' || fs.state === 'done');
  const otherJob = s?.running && !['full', 'refresh'].includes(s.action);
  const unit = ctx.here === 'this Mac' ? 'Mac' : 'computer';

  async function pick() {
    setSaving('pick'); setFieldError(null);
    const d = await saveField(picks);
    if (d.settings) scan.setSettings(d.settings); else setFieldError(d.error);
    setSaving(null);
  }
  async function skip() {
    setSaving('skip'); setFieldError(null);
    const next = await skipField();
    scan.setSettings((prev) => next || { ...(prev || {}), fieldAsked: true });
    setSaving(null);
  }

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

  if (showField) {
    const done = fs.state === 'done';
    return (
      <Frame
        eyebrow="Step 5 of 5 · Map"
        title={<>While it reads,<br />one question</>}
        error={fieldError || scan.error}
        art={art}
        foot={<>
          <button type="button" className="ob-btn ghost" onClick={skip} disabled={Boolean(saving)}>Skip for now</button>
          <Spacer />
          <Primary onClick={pick} disabled={!picks.length || Boolean(saving)}>{saving === 'pick' ? 'Saving…' : done ? 'See my galaxy' : 'Continue'}</Primary>
        </>}
      >
        {done ? (
          <div className="ob-strip ok"><Ico.check /><span>All {fs.done.toLocaleString()} connections saved</span></div>
        ) : (
          <div className="ob-strip"><ClusterSpinner size={18} live glyph="" />
            <span>{fs.state === 'saving' ? 'Saving…' : `${(fs.done || 0).toLocaleString()} of ${(fs.total || 0).toLocaleString()}`}</span>{bar}</div>
        )}
        <FieldQuestion picks={picks} setPicks={setPicks} narrow={narrow} setNarrow={setNarrow} disabled={Boolean(saving)} />
      </Frame>
    );
  }

  if (fs.state === 'running' || fs.state === 'saving') {
    return (
      <Frame
        eyebrow="Step 5 of 5 · Map"
        title="Map the people you know"
        lede="The scanner reads your connections list and saves everyone here. About a minute and a half for 750 people."
        error={scan.error}
        art={art}
        foot={<>
          <button type="button" className="ob-btn ghost" onClick={scan.stop}><Ico.stop />Stop</button>
          <Spacer />
          <Waiting>Scanning…</Waiting>
        </>}
      >
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
      eyebrow="Step 5 of 5 · Map"
      title="Map the people you know"
      lede="The scanner reads your connections list and saves everyone here. About a minute and a half for 750 people."
      error={scan.error || (failed ? `The scan stopped before it finished.${fs.failure ? `\n${fs.failure}` : ''}` : null)}
      art={art}
      foot={<>
        <Back onClick={() => ctx.go('pace')} />
        <Spacer />
        {otherJob && <span className="ob-hint">Something else is running. One at a time.</span>}
        <Primary icon={Ico.play} onClick={() => scan.run('full')} disabled={scan.busy || otherJob}>{failed ? 'Try again' : 'Start my first scan'}</Primary>
      </>}
    >
      <div className="ob-facts">
        <div><span className="fi"><Ico.eye /></span>Chrome works in the background. Keep using your {unit}.</div>
        <div><span className="fi"><Ico.pause /></span>Stop anytime. Everything found so far is kept.</div>
        <div><span className="fi"><Ico.spark /></span>Your galaxy fills in as it reads.</div>
      </div>
      {failed && <div className="ob-quiet">Rather not try again? <Link className="ob-link" href="/import">Import a CSV instead</Link>.</div>}
    </Frame>
  );
}

// ── Your galaxy is ready ─────────────────────────────────────────────────────

export function Final({ ctx, onFinish }) {
  const { s, settings } = ctx;
  const [opening, setOpening] = useState(false);
  const count = Number(s?.network?.first) || 0;
  const limits = { ...DEFAULT_LIMITS, ...(s?.linkedin?.limits || {}) };
  const sectors = settings?.sectorFocus?.sectors || [];
  // Photos are optional: not all of them in is said calmly, and never holds this back.
  const photos = photosNote(s);
  return (
    <section className="ob-final">
      <div className="fg"><Galaxy bloom /></div>
      <div className="scrim" />
      <div className="copy">
        <div className="ob-eyebrow">All set</div>
        <h1>Your galaxy<br />is ready.</h1>
        <p className="ob-lede">{count.toLocaleString()} people you know, mapped and kept on {ctx.here}.</p>
        {photos && <p className="ob-quiet" data-photos-note="" style={{ maxWidth: 440 }}>{photos}</p>}
        <div className="ob-tiles">
          <div><b>{count.toLocaleString()}</b>connections</div>
          <div><b>{PACES[limits.pace]?.label || 'Fast'} · {limits.daily} a day</b>your pace</div>
          <div><b>{sectors.length ? fieldLabel(sectors) : 'None for now'}</b>your field</div>
        </div>
        <Primary onClick={async () => { setOpening(true); await onFinish(); }} disabled={opening}>{opening ? 'Opening…' : 'Open the map'}</Primary>
        <p className="next">Next, who they know. The scanner maps that a circle at a time, over days, at your pace. Start it from Scan whenever you like.</p>
      </div>
    </section>
  );
}
