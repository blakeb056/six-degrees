// Demo mode: serves a static, read-only snapshot of Blake's network so anyone
// can experience the full graph with zero setup and no backend.
// Enabled by setting NEXT_PUBLIC_DEMO_MODE=true at build time. When on, the app
// never touches the database or the /api/* routes — it hydrates from public/demo-data.json.

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export const DEMO_USER = {
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  name: 'You',
  headline: 'Your network',
};

let _cache = null;

// Fetches the bundled snapshot once and returns { degree1, degree2 }.
export async function loadDemoNetwork() {
  if (_cache) return _cache;
  // 'no-cache' = always revalidate (cheap 304 when unchanged) so a re-exported
  // snapshot is picked up immediately instead of serving a stale cached copy.
  const res = await fetch('/demo-data.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('demo-data.json not found');
  const data = await res.json();
  _cache = { degree1: data.degree1 || [], degree2: data.degree2 || [] };
  return _cache;
}
