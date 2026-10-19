'use client';

// Hooks for the learning log's page events (lib/learning-client.js), so a
// component reports what was seen and for how long in one line.

import { useEffect } from 'react';
import { track, visitNo } from '../../lib/learning-client';

/**
 * A section on screen (at least a third of it) for a second: section/seen,
 * once per visit to the tab. `ref` is the section's element.
 */
export function useSeen(ref, page, section, { off = false } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (off || !el || typeof IntersectionObserver === 'undefined') return undefined;
    let timer = null;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(timer);
      if (e?.isIntersecting) timer = setTimeout(() => track('section', 'seen', { page, section }, { key: `${page}:${section}:${visitNo()}` }), 1000);
    }, { threshold: 0.33 });
    io.observe(el);
    return () => { clearTimeout(timer); io.disconnect(); };
  }, [ref, page, section, off]);
}

/**
 * How long something about one person stays open (a card): the open as
 * interaction `openType` when given, and on close, or when another opens, its
 * dwell as `dwellType`. `row` is the person open now, or null.
 */
export function usePersonDwell(row, { where = null, openType = null, dwellType = 'card-dwell' } = {}) {
  const id = row?.id ?? row?.profile_url ?? null;
  const url = row?.profile_url ?? null;
  const rowId = row?.id ?? null;
  useEffect(() => {
    if (id == null) return undefined;
    const person = { id: rowId, profile_url: url };
    const at = Date.now();
    if (openType) track('interaction', openType, { where }, { person });
    return () => track('interaction', dwellType, { ms: Date.now() - at, where }, { person });
  }, [id, rowId, url, where, openType, dwellType]);
}
