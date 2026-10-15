# LinkedIn browser

A Sixgree plugin. It adds a **LinkedIn** button to the top right of Sixgree's
header, beside the bell and Settings, in the desktop app.

The button opens LinkedIn inside Sixgree's own window for your own browsing:
scroll, click, search and message as you would anywhere. Beside it, on the
right, Sixgree's people list:

- find people in your own network by name, company or place, with their card;
- open someone's LinkedIn profile in the panel with one click;
- see who is on screen: on a profile (linkedin.com/in/...), the list shows what
  Sixgree already knows about that person (degree, tier, location, mutuals, who
  connects you), or says they aren't in your network data.

## What it does and doesn't do

- It is your own LinkedIn account, browsed by you. Sixgree reads nothing on
  its own and clicks nothing. Browsing is not a scan and isn't counted against
  the scan budget.
- A profile opened from the people list goes through Outlink: it counts as one
  of the day's profile views, against the same daily limit, and Sixgree writes
  down which profile and when. That needs a scanner plugin (1.0.5 or newer).
- The panel identifies as plain Chrome (its user agent with the Sixgree and
  Electron tokens taken out), and nothing more is changed.

## What's in the package

Only this README and the manifest. A feature plugin carries no code: the
feature is part of Sixgree, and shows only while this plugin is installed and
plugins are on (Settings → Plugins). Uninstalling it hides the button again.
