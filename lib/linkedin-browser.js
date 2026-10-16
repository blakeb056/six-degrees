// The LinkedIn browser plugin (Blake, 2026-10-15): it brings the LinkedIn tab
// (app/linkedin/page.js), whose notch buttons, Feed, Messaging, Notifications
// and Jobs, open Sixgree's own browser straight on that part of LinkedIn. The
// header's LinkedIn button and its people list are gone (Blake, 2026-10-15: "I
// want to remove the LinkedIn button at the top right and don't like the side
// panel idea"); Back and Forward are on the panel's bar for every page in it.
// No Node imports: the page reads it.

/** The plugin's id, and what it unlocks (lib/plugins.js PLUGIN_KIND_UNLOCKS). */
export const LINKEDIN_BROWSER = 'linkedin-browser';
