'use client';

// A short line beside a button that says why it didn't start: the scanner not
// set up, a refusal (one scan at a time, a cooldown, the one-time "I
// understand"), an error. It takes the place of the alert() and
// window.confirm() boxes the scan buttons used to raise (Blake, 2026-10-04:
// "we need to make it so theres no pop up or nothing … we want seamlessness").
// It fades by itself; nothing to press to get rid of it.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * [note, say]: say(text) shows `text` for `ms` and then lets it fade;
 * say(null) clears it at once. `note` is { text, key } or null; `key` changes
 * with every say, so the same words said twice fade in again.
 */
export function useFadingNote(ms = 7000) {
  const [note, setNote] = useState(null);
  const timer = useRef(null);
  const count = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = useCallback((text) => {
    clearTimeout(timer.current);
    if (!text) { setNote(null); return; }
    count.current += 1;
    setNote({ text: String(text), key: count.current, ms });
    timer.current = setTimeout(() => setNote(null), ms);
  }, [ms]);
  return [note, say];
}

// In quickly, out slowly over its last second and a bit.
const FADE_OUT = 1200;
const CSS = `
@keyframes inlineNoteIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
@keyframes inlineNoteOut { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .inline-note { animation: none !important; } }
`;

/**
 * The line itself, from useFadingNote's `note`. `float` hangs it under its
 * button (the header's), out of the layout; otherwise it sits in the flow.
 * `tone`: 'bad' (red, the default) or 'info'.
 */
export default function InlineNote({ note, tone = 'bad', float = false, align = 'right', style }) {
  if (!note) return null;
  const bad = tone === 'bad';
  return (
    <div key={note.key} role="status" aria-live="polite" className="inline-note" style={{
      fontSize: 11.5, lineHeight: 1.45, fontWeight: 500,
      color: bad ? 'var(--sd-fg-1, #ffd0d0)' : 'var(--sd-fg-2, #cfe6f7)',
      animation: `inlineNoteIn 180ms ease both, inlineNoteOut ${FADE_OUT}ms ease ${Math.max(0, (note.ms || 7000) - FADE_OUT)}ms forwards`,
      ...(float ? {
        position: 'absolute', top: 'calc(100% + 8px)', [align]: 0, zIndex: 70,
        width: 'max-content', maxWidth: 'min(300px, calc(100vw - 24px))', padding: '7px 10px', borderRadius: 8,
        background: 'var(--sd-surface, rgba(8,10,22,0.96))',
        border: `1px solid ${bad ? 'rgba(255,107,107,0.45)' : 'rgba(52,152,219,0.45)'}`,
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)', whiteSpace: 'normal', textAlign: 'left',
      } : { marginTop: 6, color: bad ? '#ff8080' : 'var(--sd-fg-3, #9aa)' }),
      ...style,
    }}>
      <style>{CSS}</style>
      {note.text}
    </div>
  );
}
