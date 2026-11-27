# Security

## Reporting a problem

Please report security problems privately, through
[GitHub Security Advisories](https://github.com/blakeb056/six-degrees/security/advisories/new),
not in a public issue. Expect a first reply within a week.

## What Sixgree trusts

- Sixgree runs on your own computer, against your own data. Its window talks to a server
  on the same computer that listens on this computer only (127.0.0.1), never on your
  network, and its routes that change or hand over data answer only there.
- Your network is kept in `~/.six-degrees` and never uploaded. There is no account and no
  server of Sixgree's, and the app has no telemetry or analytics.
- The app goes online only to check for a new version (GitHub), for the plugin list and a
  plugin you choose to install, and, with a scanner plugin, to the platform you scan, from
  your own account. Plugins are checked file by file against their published checksums.
- Updates are checked against the release's `SHA256SUMS` and, on a Mac, Apple's code
  signature before they are put in place.
- `~/.six-degrees/chrome-profile/` holds the scanner's signed-in session: never copy,
  sync or share it.
