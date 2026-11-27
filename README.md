<p align="center">
  <a href="https://sixgree.com/"><img src="https://sixgree.com/img/icon.svg" width="112" height="112" alt="Sixgree website"></a>
</p>

<h1 align="center">Sixgree</h1>

<p align="center">
  <strong>See your network as a galaxy.</strong><br>
  Who can introduce you, who only one of your connections can reach, and the shortest path to
  someone you haven't met. Free, and it runs on your own computer.
</p>

<p align="center">
  <a href="https://sixgree.com/"><strong>Website</strong></a> ·
  <a href="#download">Download</a> ·
  <a href="https://sixgree.com/docs/">Docs</a> ·
  <a href="https://sixgree.com/releases/">Release notes</a> ·
  <a href="https://github.com/blakeb056/six-degrees/issues">Report a problem</a>
</p>

This repository holds Sixgree's downloads, release notes and install script. Sixgree is
free to download and use; its source code is private (see [LICENSE](LICENSE)).

## Download

| Platform | Download | Needs |
|---|---|---|
| **macOS**, Apple Silicon (M1 or newer) | [Sixgree-Mac-Apple-Silicon.dmg](https://github.com/blakeb056/six-degrees/releases/latest/download/Sixgree-Mac-Apple-Silicon.dmg) | macOS 13.5 (Ventura) or later |
| **macOS**, Intel | [Sixgree-Mac-Intel.dmg](https://github.com/blakeb056/six-degrees/releases/latest/download/Sixgree-Mac-Intel.dmg) | macOS 13.5 (Ventura) or later |
| **Windows** (beta) | [Sixgree-Windows-Setup.exe](https://github.com/blakeb056/six-degrees/releases/latest/download/Sixgree-Windows-Setup.exe) | Windows 10 or 11, 64-bit |
| **Linux** (beta) | [Sixgree-Linux-x64.deb](https://github.com/blakeb056/six-degrees/releases/latest/download/Sixgree-Linux-x64.deb) or [.tar.gz](https://github.com/blakeb056/six-degrees/releases/latest/download/Sixgree-Linux-x64.tar.gz) | Ubuntu or Debian, 64-bit |

Every release has a `SHA256SUMS` file ([latest](https://github.com/blakeb056/six-degrees/releases/latest/download/SHA256SUMS)).
The Mac apps are signed by Blake Burford and notarized by Apple.

**Or install on a Mac from the Terminal** (it picks the right chip, checks the download
against `SHA256SUMS`, and running it again updates):

```
curl -fsSL https://raw.githubusercontent.com/blakeb056/six-degrees/main/install.sh | bash
```

How to install, what it needs and what to do if something's not right:
[sixgree.com/download](https://sixgree.com/download/).

## Privacy

- Your network is stored on your computer and nowhere else. No account, no server, no
  telemetry, no analytics, no crash reporting.
- A CSV import is read on your machine and never added to your network. It's kept in the
  data folder as `csv-network.json` (names, positions, companies, profile links and when
  you connected; never email addresses) until you click × beside *Your CSV*.
- The app contacts only these, and, apart from the daily update check, only when you act:
  - **Your networking platform**, while you scan, and when you press **Auto** (one
    connection request, sent from the scanner's Chrome). Each profile photo is saved on
    your computer as the scan reads it, and the app shows photos only from there, so
    looking at your network never contacts the platform. (Photos an older version kept
    as web links show initials until the next scan, or *Save photos* on the Scan page,
    saves them.)
  - Only without the Mac app (which carries the scanner's Python and add-ons inside it),
    once, when you set the scanner up: **PyPI** (the Python package library) for the
    scanner's add-ons, and, if the computer has no Python the scanner can use, **GitHub**
    for a copy of Python when you click *Set up the scanner*. Every file is checked
    against a checksum built into Sixgree.
  - **GitHub**, once a day while the app is open, and when you click *Check for updates*,
    to read the newest version number, and, with plugins on and one installed, the plugin
    list (also read when you open Settings → Plugins with plugins on). A newer version of
    the app or of a plugin leaves one notification; untick
    *Check for updates once a day* in **Settings → Updates** and it asks only when you
    click. In the Mac app, also when you then click *Install and restart*, to download
    that version and the file of checksums that proves it's the one published.
  
  Nothing about you is sent (GitHub sees an ordinary request from your computer). The daily
  update check is the only request the app makes by itself, and it never downloads anything.
- A **copy of your network** that you save (Settings → Your data) is a file you keep
  wherever you choose; the app never uploads it. It holds the names, headlines and profile
  links of the people in your network, their photos unless you leave them out, your
  settings, and the scanner's progress and budget. Your sign-in to the platform is never
  in it. Keep it private, and delete it once it's imported.
- The web framework's own anonymous usage stats are turned off.

See [SECURITY.md](SECURITY.md) for the threat model.

## How your data is stored

```
.six-degrees/               in your home folder (hidden)
├── six-degrees.sqlite      your network: connections, scores, tiers, queue, settings
├── backups/                backups of your network: daily, before each new version, before
│                           an import or a restore, and any you make (see Backups below)
├── avatars/                profile photos, if you scan
├── chrome-profile/         the scanner's Chrome sign-in, if you scan (see below)
├── venv/                   the scanner's Python add-ons, if you set it up without the Mac app
├── python/                 a private Python for them, if Set up the scanner downloaded one
├── pushback/               what the platform's page said if it ever pushed back
├── csv-network.json        a CSV import, kept until you remove it
└── *.json                  the scanner's budget, cooldown, progress and skip lists
```

**Settings → Your data** shows where this folder is (with *Copy the path* and *Show in
Finder*), what each part takes up, and the backups in it.

### Backups

A backup is your whole network in one `.sixdegrees` file: your connections, their profile
photos, your settings (the look and your saved Galaxy layouts too), and the scanner's
progress, skip lists and budget. Each one is checked as it's made, the same way a
restore would check it, so a backup that's listed would restore. Sixgree makes one:

- **each day** it's open with a network in it (when it starts, and after a scan, if the
  newest daily one is a day old; nothing runs on a timer), keeping the last 7;
- **before a new version** first opens your data, keeping the last 3;
- **when you click Back up now** in Settings → Your data. These are never deleted for you.

An import or a restore keeps what it replaced as well (`before-import-…`), keeping the
last 3, and never one that's under 30 days old. Anything else you put in `backups/`
yourself is never touched.

Settings → Your data says when the last backup was made and whether it passed its check
("Last backup: <time>, verified"), or what's wrong with it if it didn't. Each backup has
**Restore** and **Show in Finder**. Backups stay on this computer: to keep one safe if the
computer is lost, copy it somewhere else (Show in Finder, then drag it to a USB stick).

They take space. For a network of about 650 connections and 5,000 people beyond them,
with their photos, each backup is about 25 to 35 MB, so the kept ones add up to about
300 to 400 MB.

### Moving to a new computer

1. On the old computer, open **Settings → Your data** and click **Export backup
   file…**. You get one file, `Sixgree backup <date>.sixdegrees`, with your network,
   your settings, the scanner's progress, skip lists and budget, and the profile
   photos of the people in it (untick them to leave them out; they come back as you scan
   again).
2. Move that file to the new computer yourself (a USB stick, AirDrop). It holds other
   people's names and photos, so don't post it or share it.
3. On the new computer, install Sixgree, open **Settings → Your data**, click
   **Restore from a file…**, choose the file and click **Restore**. It's checked first, and nothing changes if it isn't a whole
   and undamaged Sixgree copy. If that computer already has a network, you're asked to
   confirm that the import replaces it. The two networks are never merged. Your search
   budget is the one thing that is: it belongs to your account on the platform, not to a
   computer, so searches made on either computer still count, a pause on scanning set on
   either stays until it ends, and budget limits already set on that computer stay.
4. The import finishes the next time Sixgree starts. The Mac app does that with
   **Restart now**. If another
   copy of Sixgree has the same folder open (one started from the Terminal, say), the
   import waits, and Settings says so. What was there before is kept in `backups/`
   (`before-import-…`), for at least 30 days: see [Undo an import](#undo-an-import).
5. Sign in to the platform again on the new computer before you scan. Your sign-in never
   goes into a copy. A CSV import kept on the old computer does go into it, and opens on
   the new one.

### Undo an import

An import, or a restore, keeps what it replaced in the data folder's `backups/`, named with
the time it finished: `before-import-<time>.sqlite`, your network as it was, and
`before-import-<time>-files/` beside it, with its profile photos, the scanner's notes
about it, and a CSV import kept with it if there was one.

To put it back, open **Settings → Your data**, open **The backups**, find **Before an import
or a restore** with that time, and click **Restore**. It's checked first, then finishes when
Sixgree restarts (**Restart now** in the app), and what's there now is kept in the same way, so you can go back
again. Your search budget stays as it is: it belongs to your account on the platform,
not to a network.

The same **Restore** puts back any other backup: yesterday's, or the one from before the
last update.

Don't put the live folder in iCloud Drive or Dropbox to share it between computers
instead. A sync service that copies the database while it's open can damage it, and it
would also sync your sign-in to the platform.

**To remove everything:** quit the app and drag **Sixgree** from Applications to the
Trash. Then in Finder choose **Go → Go to Folder…** (⇧⌘G), paste `~/.six-degrees` and
move that folder to the Trash. Do the same for
`~/Library/Application Support/Six Degrees`, the app window's own storage and cache.

> [!WARNING]
> `chrome-profile/` holds a **real, signed-in session** on the platform. It's the one thing
> here that grants access to your account. Never copy it, sync it or share it. Deleting it
> just means signing in again.


## Reporting a problem

[Open an issue](https://github.com/blakeb056/six-degrees/issues), and redact any names
before attaching anything. Report a security problem privately: see [SECURITY.md](SECURITY.md).

## Licence

Free to download and use; not open source. © 2026 Blake Burford. See [LICENSE](LICENSE).
Versions up to and including 2.10.0 were released under the MIT License.
