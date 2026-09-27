'use client';

// Small shared pieces for the Settings page and anything that joins it later
// (UpdatePanel uses them). The Scan page still keeps its own private copies;
// new screens should use these rather than adding another.

export const LINE = '1px solid rgba(255,255,255,0.1)';
export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** One titled block of settings. `id` makes it linkable (/settings#id). */
export function Section({ id, title, intro, children }) {
  return (
    <section id={id} style={{ padding: '24px 0', borderBottom: LINE, scrollMarginTop: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 650, margin: '0 0 6px' }}>{title}</h2>
      {intro && <Body style={{ marginTop: 0, marginBottom: 12 }}>{intro}</Body>}
      {children}
    </section>
  );
}

export function Body({ children, style }) {
  return (
    <div style={{ fontSize: 13.5, color: '#8b9a9a', lineHeight: 1.6, marginTop: 4, ...style }}>
      {children}
    </div>
  );
}

export function Mono({ children }) {
  return (
    <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, wordBreak: 'break-all' }}>
      {children}
    </code>
  );
}

/** The answer to an action, where it can't be missed. tone: 'ok' | 'bad' | undefined. */
export function Status({ children, tone }) {
  const color = tone === 'ok' ? '#00ff88' : tone === 'bad' ? '#ff7676' : '#e8e8ee';
  const bg = tone === 'ok' ? 'rgba(0,255,136,0.08)' : tone === 'bad' ? 'rgba(255,80,80,0.08)' : 'rgba(255,255,255,0.05)';
  const border = tone === 'ok' ? 'rgba(0,255,136,0.3)' : tone === 'bad' ? 'rgba(255,80,80,0.3)' : 'rgba(255,255,255,0.12)';
  return (
    <div role="status" style={{
      marginTop: 10, padding: '10px 14px', borderRadius: 8, fontSize: 13.5, lineHeight: 1.6,
      color, background: bg, border: `1px solid ${border}`,
    }}>{tone === 'ok' && '✓ '}{children}</div>
  );
}

export function Btn({ children, onClick, disabled, primary, tone, type = 'button' }) {
  const bg = tone === 'bad' ? 'rgba(255,80,80,0.15)'
    : primary ? 'linear-gradient(135deg, #9B59B6, #3498DB)'
    : 'rgba(255,255,255,0.08)';
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      padding: '9px 18px', borderRadius: 7, fontSize: 13.5, fontWeight: 650,
      color: disabled ? '#667' : '#fff', border: LINE,
      background: disabled ? 'rgba(255,255,255,0.05)' : bg,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{children}</button>
  );
}
