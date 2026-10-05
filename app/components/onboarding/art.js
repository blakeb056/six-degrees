'use client';

// The pictures on the right of each setup step, and the icons the steps use.
// Drawn here, from the look's colours (styles.js), so they turn with it: a
// galaxy that fills in as your connections are read, System Settings with the
// switch to turn on, Sixgree and your LinkedIn joined once you're signed
// in, and the daily budget against what got an account restricted. Nobody's
// name is drawn: the galaxy is a picture, not your network.

import { useEffect, useState } from 'react';
import { PACES, paceSeconds, searchesPerHour, durationText } from '../../../lib/scan-pace';
import { RESTRICTED_AT, RISKY_DAILY } from '../../../lib/search-risk';

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' };
export const Ico = {
  check: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="3" {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  globe: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" /></svg>,
  radar: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12l6-6" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></svg>,
  shield: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M9 12.2l2.2 2.2L15.5 10" /></svg>,
  lock: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.9" {...p}><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" /></svg>,
  ext: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="2.2" {...p}><path d="M9 6h9v9M18 6L7 17" /></svg>,
  right: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="2.2" {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  left: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="2.2" {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>,
  person: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.9" {...p}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6" /></svg>,
  info: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.9" {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".7" fill="currentColor" /></svg>,
  play: (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M8 5.5v13l10.5-6.5z" /></svg>,
  stop: (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></svg>,
  eye: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  pause: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.9" {...p}><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></svg>,
  csv: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" {...p}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 15.5h6" /></svg>,
  spark: (p) => <svg viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" {...p}><circle cx="12" cy="12" r="2.2" fill="currentColor" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="9.5" strokeDasharray="2 3" /></svg>,
};

/** The app's own icon: public/app-icon.svg, a copy of desktop/icon/icon.svg
 * (tests/app-icon.test.mjs keeps the two the same), cropped to its squircle. */
export function AppIcon(props) {
  return (
    <svg viewBox="100 100 824 824" aria-hidden="true" {...props}>
      <image href="/app-icon.svg" x="0" y="0" width="1024" height="1024" />
    </svg>
  );
}

// ── The galaxy ───────────────────────────────────────────────────────────────
// You in the middle, rings of people in the tier colours. Seeded, so it is the
// same picture every time. `progress` (0 to 1) is how much of it has arrived.

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const RINGS = [
  { tier: 's', n: 12, r: 23, size: 2.9 }, { tier: 'a', n: 26, r: 39, size: 2.35 },
  { tier: 'b', n: 40, r: 55, size: 1.95 }, { tier: 'c', n: 54, r: 71, size: 1.6 }, { tier: 'd', n: 62, r: 87, size: 1.3 },
];
const NODES = (() => {
  const r = seeded(5);
  const nodes = [];
  RINGS.forEach((ring, ri) => {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + (r() - 0.5) * (Math.PI * 2 / ring.n) * 0.7 + ri * 0.5;
      const rad = ring.r * (0.93 + r() * 0.14);
      nodes.push({ tier: ring.tier, x: Math.cos(a) * rad, y: Math.sin(a) * rad, size: ring.size * (0.85 + r() * 0.3), order: r(), tw: r() < 0.3, d: (r() * 4).toFixed(2) });
    }
  });
  return nodes;
})();

export function Galaxy({ progress = 1, ghost = false, bloom = false }) {
  // A bloom draws in from nothing: it starts empty and fills a frame later.
  const [grown, setGrown] = useState(!bloom);
  useEffect(() => {
    if (grown) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setGrown(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [grown]);
  const shown = grown ? progress : 0;
  const on = (n) => (n.order < shown ? ' on' : '');
  return (
    <svg className={`ob-galaxy${ghost ? ' ghost' : ''}${bloom ? ' bloom' : ''}`} viewBox="-104 -104 208 208" aria-hidden="true">
      {RINGS.map((g) => <circle key={g.r} className="ring" r={g.r} />)}
      <g>
        {NODES.map((n, i) => (
          <line key={i} className={`gl${on(n)}`} data-o={n.order} style={{ stroke: `var(--ob-${n.tier})`, '--o': n.order }}
            x1="0" y1="0" x2={n.x.toFixed(2)} y2={n.y.toFixed(2)} />
        ))}
      </g>
      <g>
        {NODES.map((n, i) => (
          <circle key={i} className={`gd${n.tw ? ' tw' : ''}${on(n)}`} data-o={n.order}
            style={{ fill: ghost ? undefined : `var(--ob-${n.tier})`, '--c': `var(--ob-${n.tier})`, '--d': `${n.d}s`, '--o': n.order }}
            cx={n.x.toFixed(2)} cy={n.y.toFixed(2)} r={n.size.toFixed(2)} />
        ))}
      </g>
      <circle className="you-glow" r="7.5" />
      <circle className="you" r="4" />
      <text className="you-label" y="11.5">You</text>
    </svg>
  );
}

// ── System Settings → Privacy & Security → App Management ───────────────────
// `answer`: null (not yet), 'opened' (its pane was opened from here), 'done'
// or 'skipped'. `name` is who macOS asks about: Sixgree in the Mac app,
// the app it was started from otherwise (lib/scanner-setup.js appManagementStep).

const SIDEBAR = [['#2f8cff', 'Wi‑Fi'], ['#2f8cff', 'Bluetooth'], ['#2f8cff', 'Network'], null, ['#ff453a', 'Notifications'], ['#7d5cf5', 'Focus'], null,
  ['#8e8e93', 'General'], ['#3a3a3c', 'Appearance'], ['#2f8cff', 'Privacy & Security', true], ['#2b2b2e', 'Desktop & Dock'], ['#2f8cff', 'Displays']];

export function MacSettings({ answer, name = 'Sixgree' }) {
  const on = answer === 'done';
  const skipped = answer === 'skipped';
  return (
    <div>
      <div className={`ob-macwrap${skipped ? ' dim' : ''}`}>
        <div className="ob-mac">
          <div className="side">
            <div className="lights"><i /><i /><i /></div>
            <div className="search">Search</div>
            {SIDEBAR.map((it, i) => (it
              ? <div key={i} className={`item${it[2] ? ' sel' : ''}`}><i style={{ background: it[0] }} />{it[1]}</div>
              : <div key={i} className="gap" />))}
          </div>
          <div className="main">
            <div className="mh"><span>‹</span>App Management</div>
            <div className="mp">Apps in this list can update or delete other apps on this Mac.</div>
            <div className="list">
              <div className="mrow">
                {name === 'Sixgree' ? <AppIcon className="appic" /> : <span className="appic" style={{ borderRadius: 7, background: '#2b2b2e' }} />}
                {name}
                <span className={`mt${on ? ' on' : skipped ? '' : ' pulse'}`} />
              </div>
            </div>
            <div className="pm"><span>+</span><span>−</span></div>
          </div>
        </div>
        {on && <div className="ob-callout ok ob-pop"><Ico.check />Allowed</div>}
        {!on && !skipped && <div className="ob-callout">Turn on {name}</div>}
        {!on && !skipped && (
          <svg className="ob-pointer" viewBox="0 0 22 30" aria-hidden="true">
            <path d="M2 2 L2 23 L7.5 18 L11.5 27.5 L15 26 L11 16.8 L18.5 16.8 Z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="ob-caption">
        {skipped ? 'Skipped. If macOS asks later, either answer is fine.'
          : <>System Settings <span>›</span> Privacy &amp; Security <span>›</span> <b>App Management</b></>}
      </div>
    </div>
  );
}

/** Off a Mac, or before macOS 13: the three things Get ready waits for. */
export function ChecksArt({ chrome, scanner, risk }) {
  const row = (ok, label) => (
    <div className={`c${ok ? ' ok' : ''}`}><span className="b">{ok ? <Ico.check className="ck" /> : null}</span>{label}</div>
  );
  return (
    <div>
      <div className="ob-checks-art">
        <div className="icon"><AppIcon /></div>
        {row(chrome, 'Google Chrome')}
        {row(scanner, 'The scanner')}
        {row(risk, 'Your “I understand”')}
      </div>
    </div>
  );
}

// ── Sixgree ⟷ your LinkedIn ──────────────────────────────────────────────

export function ConnectArt({ state, here = 'this computer' }) {
  const connected = state === 'connected';
  const waiting = state === 'waiting';
  return (
    <div>
      <div className="ob-conn">
        <div className="ob-cnode"><div className="ob-tile me"><AppIcon /></div><div className="nl">Sixgree</div><div className="ns">on {here}</div></div>
        {connected ? (
          <div className="ob-wire ok"><div className="track" /><div className="badge"><Ico.check /></div><div className="wl">Connected</div></div>
        ) : waiting ? (
          <div className="ob-wire waiting"><div className="track" /><div className="pulse" /><div className="wl">Waiting for you to sign in</div></div>
        ) : (
          <div className="ob-wire"><div className="track" /><div className="wl">Not connected</div></div>
        )}
        <div className="ob-cnode">
          <div className={`ob-tile li${connected ? ' ok' : waiting ? ' waiting' : ''}`}>
            <Ico.person />
            {connected && <span className="corner ob-pop"><Ico.check /></span>}
          </div>
          <div className="nl">Your LinkedIn</div>
          <div className={`ns${connected ? ' ok' : ''}`}>{connected ? 'Signed in' : 'Signed out'}</div>
        </div>
      </div>
      <div className="ob-btag">{connected ? 'Chrome, out of your way' : 'The Chrome window'}</div>
      <div className={`ob-browser${connected ? ' back' : ''}`} aria-hidden="true">
        <div className="bar"><i /><i /><i /><div className="url"><Ico.lock />linkedin.com/login</div></div>
        <div className="bb"><div className="bh">Sign in</div><div className="bi">Email or phone</div><div className="bi pw">••••••••••</div><div className="bbtn">Sign in</div></div>
      </div>
      <div className="ob-caption">
        {connected ? <><Ico.eye />It comes forward again only to sign in, or for a security check.</>
          : <><Ico.lock />You type into LinkedIn’s own page. Sixgree can’t see it.</>}
      </div>
    </div>
  );
}

// ── The daily budget, against what got an account restricted ───────────────

export function PaceArt({ daily, pace }) {
  const MAX = 400;
  const R = 170;
  const ang = (v) => Math.PI * (1 - Math.min(v, MAX) / MAX);
  const pt = (v, r = R) => [Math.cos(ang(v)) * r, -Math.sin(ang(v)) * r];
  const arc = (a, b, color, op = 1, gap = 1.6) => {
    const [x1, y1] = pt(a + gap); const [x2, y2] = pt(b - gap);
    return <path className="arc" stroke={color} strokeOpacity={op} d={`M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`} />;
  };
  const tick = (v, label, cls = '') => {
    const [x1, y1] = pt(v, R + 11); const [x2, y2] = pt(v, R + 18); const [tx, ty] = pt(v, R + 32);
    return (
      <g key={v}>
        <line x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke="var(--ob-fg4)" strokeWidth="1.5" />
        <text className={`lab ${cls}`} x={tx.toFixed(1)} y={(ty + 4).toFixed(1)} textAnchor="middle">{label}</text>
      </g>
    );
  };
  const zone = (v, label) => { const [x, y] = pt(v, R - 27); return <text className="zone" x={x.toFixed(1)} y={(y + 4).toFixed(1)} textAnchor="middle">{label}</text>; };
  const rot = 180 - (Math.min(daily, MAX) / MAX) * 180;
  const time = durationText(paceSeconds(pace, daily)).replace('about ', '~');
  return (
    <div>
      <div className="ob-gauge">
        <svg viewBox="-230 -215 460 230" aria-hidden="true">
          {arc(0, RISKY_DAILY, 'var(--ob-green)')}{arc(RISKY_DAILY, RESTRICTED_AT, 'var(--ob-gold)', 0.55)}{arc(RESTRICTED_AT, MAX, 'var(--ob-red)')}
          {tick(0, '0')}{tick(RISKY_DAILY, String(RISKY_DAILY))}{tick(RESTRICTED_AT, String(RESTRICTED_AT), 'red')}
          {zone(50, 'safe')}{zone(236, 'riskier')}
          <g className="needle" style={{ transform: `rotate(${-rot}deg)` }}><line x1="0" y1="0" x2="112" y2="0" stroke="var(--ob-fg1)" strokeWidth="4" strokeLinecap="round" /></g>
          <circle r="10" fill="var(--ob-fg1)" /><circle r="4" fill="var(--sd-bg, #0a0a1a)" />
        </svg>
        <div className={`ob-gval${daily > RISKY_DAILY ? ' warn' : ''}`}><b>{daily}</b><span>searches a day{daily === 50 ? ', the default' : ''}</span></div>
      </div>
      <div className="ob-stats">
        <div className="ob-stat"><b>{time}</b><span>of scanning a day at {PACES[pace]?.label || 'Fast'}, ~{searchesPerHour(pace)} searches an hour</span></div>
        <div className="ob-stat"><b style={{ color: 'var(--ob-red)' }}>{RESTRICTED_AT}</b><span>searches in 24 hours: when a real account was restricted</span></div>
      </div>
    </div>
  );
}
