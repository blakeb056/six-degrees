'use client';

import { TIE_COLOUR } from '../../lib/mutual-web';

/**
 * Show ties: the mutual web for the person selected, as thin lines to everyone
 * on the map they were seen with (lib/mutual-web.js). A tie is "seen together",
 * never "close": the title says so.
 */
export default function ShowTies({ on, onToggle, picked, count, ready, style = null }) {
  const said = !on ? 'Show who the person you pick was seen with: thin lines, for them only. A tie means seen together, not close'
    : !picked ? 'Pick someone to see who they were seen with'
    : !ready ? 'Loading the ties…'
    : count ? `${count.toLocaleString('en-US')} ${count === 1 ? 'tie' : 'ties'} on the map: seen together, not close`
    : 'No one on the map was seen with them yet';
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} title={said} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontFamily: 'inherit', fontSize: 12,
      cursor: 'pointer', pointerEvents: 'auto', color: 'var(--sd-fg-1, #e6edf5)', background: 'var(--sd-surface, rgba(10,15,30,0.8))',
      border: `1px solid ${on ? TIE_COLOUR : 'rgba(var(--sd-ink, 255, 255, 255), 0.15)'}`, ...style,
    }}>
      <svg width="16" height="10" aria-hidden="true"><line x1="1" y1="8" x2="15" y2="2" stroke={TIE_COLOUR} strokeWidth="1.4" /></svg>
      <b style={{ fontWeight: 650 }}>Show ties</b>
      {on && picked && ready && <span style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontVariantNumeric: 'tabular-nums' }}>{count.toLocaleString('en-US')}</span>}
    </button>
  );
}
