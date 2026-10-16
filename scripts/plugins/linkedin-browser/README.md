# LinkedIn browser

A Sixgree plugin. It adds a **LinkedIn** tab to Sixgree's header, in the
desktop app.

The tab's buttons in the notch, **Feed**, **Messaging**, **Notifications** and
**Jobs**, open that part of LinkedIn inside Sixgree's own window, live, for your
own browsing: scroll, click, search and message as you would anywhere. The bar
above it has **Back** and **Forward** (Cmd+[ and Cmd+] on a Mac, Ctrl+[ and
Ctrl+] elsewhere), and, once you've gone somewhere else, a way back to the part
you chose.

## What it does and doesn't do

- It is your own LinkedIn account, browsed by you. Sixgree reads nothing on
  its own and clicks nothing. Browsing the tab is not a scan and isn't counted
  against the scan budget.
- A profile you open from Sixgree (Connect, View profile, Outlink) opens in the
  same window and counts as one of the day's profile views, as it does without
  this plugin when a scanner plugin is installed.
- The window identifies as plain Chrome (its user agent with the Sixgree and
  Electron tokens taken out), and nothing more is changed.

## What's in the package

Only this README and the manifest. A feature plugin carries no code: the
feature is part of Sixgree, and shows only while this plugin is installed and
plugins are on (Settings → Plugins). Uninstalling it hides the tab again.
