'use client';

// The one-time offer to someone who had a network before classes (Blake,
// 10/17: existing users are offered the class pick once, and can skip it). A
// small card at the foot of the map: Choose your class opens the pick, and
// Not now is kept, so it never comes back; the Class tab and Settings → Class
// stay there for later.

import { useEffect, useState } from 'react';
import { CLASS_CSS } from './styles';
import { Emblem } from './parts';
import { ClassFlowModal } from './ClassFlow';
import { loadClass, skipOffer } from '../../../lib/class-client';

export default function ClassOffer() {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let off = false;
    // A moment after the map is up, so it never competes with the map drawing.
    const t = setTimeout(() => loadClass().then((d) => { if (!off && !d.error) setState(d); }), 1500);
    return () => { off = true; clearTimeout(t); };
  }, []);
  if (gone || !state?.offerOpen) return null;
  return (
    <>
      <style>{CLASS_CSS}</style>
      {!open && (
        <div className="cl cl-offer" role="dialog" aria-label="Choose your class" data-class-offer="">
          <span style={{ display: 'flex', marginRight: -6 }}>
            {state.classes.slice(0, 3).map((c) => <Emblem key={c.key} cls={c.key} color={c.color} size={30} />)}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 800, fontSize: 14.5 }}>New: choose your class</span>
            <span className="cl-quiet" style={{ display: 'block' }}>Six ways to rank the same network for what you’re after. Your network tiers stay as they are.</span>
          </span>
          <button type="button" className="cl-btn ghost small" onClick={async () => { setGone(true); await skipOffer(); }}>Not now</button>
          <button type="button" className="cl-btn primary small" onClick={() => setOpen(true)}>Choose</button>
        </div>
      )}
      {open && (
        <ClassFlowModal start="pick" offer onClose={() => { setOpen(false); setGone(true); }}
          onDone={() => setGone(true)} onSkip={() => setGone(true)} />
      )}
    </>
  );
}
