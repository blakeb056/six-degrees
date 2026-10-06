'use client';

// The strategy engine (experimental) for a component: { on, people, error, loading }.
// Off, it asks for nothing and `people` is null, so every caller shows nothing new.
// `people` is keyed as keyFor keys a row (lib/separation.js).

import { useEffect, useState, useSyncExternalStore } from 'react';
import { watchStrategy, strategyOnNow, strategyOnServer, loadStrategy } from '../../lib/strategy-client';
import { IS_DEMO } from '../../lib/demo';
import { useUser } from './UserProvider';

export default function useStrategy() {
  const switched = useSyncExternalStore(watchStrategy, strategyOnNow, strategyOnServer);
  const on = switched && !IS_DEMO;
  const { userId } = useUser();
  const [state, setState] = useState({ for: null, data: null, error: null });
  const want = on ? userId || '' : null;

  useEffect(() => {
    if (want == null) return undefined;
    let live = true;
    loadStrategy(want).then(
      (data) => { if (live) setState({ for: want, data, error: null }); },
      (err) => { if (live) setState({ for: want, data: null, error: err.message }); },
    );
    return () => { live = false; };
  }, [want]);

  if (!on) return { on: false, people: null, error: null, loading: false, measured: 0 };
  const current = state.for === want;
  return {
    on: true,
    people: current ? state.data?.people || null : null,
    measured: current ? state.data?.measured || 0 : 0,
    error: current ? state.error : null,
    loading: !current,
  };
}
