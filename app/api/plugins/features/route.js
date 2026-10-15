import { appFeatures } from '../../../../lib/plugins-view';

// The app's features that come with a feature plugin, each on or off
// (lib/plugins-view.js appFeatures): { features: { 'linkedin-browser': true } }.
// The header asks, so the LinkedIn browser's button shows only with its plugin
// installed and plugins on. Under /api/plugins, so gated like the rest (lib/gate.js).

export async function GET() {
  try {
    return Response.json({ features: appFeatures() });
  } catch {
    // Unread is off: nothing of a plugin's shows on a guess.
    return Response.json({ features: {} });
  }
}
