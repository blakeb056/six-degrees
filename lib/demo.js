// The sample network that ships with the app.
//
// Every person in public/demo-data.json is invented — see scripts/gen-synthetic.mjs.
// It exists so a first run has something to show, so screenshots contain no real
// people, and so the Bridges view can be explored before you have data of your own.

import { saveSessionNetwork } from './csv';

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export const DEMO_USER = {
  id: 'synthetic-demo-user',
  name: 'You',
  headline: 'Sample network',
};

let _cache = null;

export async function loadDemoNetwork() {
  if (_cache) return _cache;
  const res = await fetch('/demo-data.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('demo-data.json not found — run: node scripts/gen-synthetic.mjs');
  const data = await res.json();
  _cache = { degree1: data.degree1 || [], degree2: data.degree2 || [] };
  return _cache;
}

// Loads the sample into this browser tab and reports how big it is. Nothing is
// written to the database, so it disappears when the tab closes.
export async function loadSampleIntoSession() {
  const net = await loadDemoNetwork();
  saveSessionNetwork({ degree1: net.degree1, degree2: net.degree2, source: 'sample' });
  return { degree1: net.degree1.length, degree2: net.degree2.length };
}
