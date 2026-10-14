# Sixgree plugins: the package format

A plugin adds a feature to Sixgree from a package you install on your own computer.
This page is the package format, version 1: what a `.sgplugin` file holds, what
Sixgree checks before it installs one, and where an installed plugin lives. It is also
the plugin list's format, version 1: the list Browse shows, with one-click Install.

The first kind of plugin is a **scanner**. Other kinds come later.

## Turning plugins on

**Settings → Plugins → Enable plugins** is off until you turn it on.

- **Off:** installed plugins stay installed, and none of them is used. Sixgree works as it
  does without any.
- **On:** the section shows, in this order:
  - **Browse:** the plugin list's cards (name, what it does, its risk, version, size), each
    with *Install*, *Installed* or *Update*;
  - **Installed:** the plugins on this computer, each with *Uninstall*;
  - **Advanced** (closed until opened): *Install from a file* and *Install from a link*.

The guided setup has the same cards, under its CSV import: an **Allow plugins** box,
unticked until you tick it. Ticking it turns Enable plugins on and loads the list;
unticking it turns Enable plugins off.

Only Settings → Plugins and the setup's box change the switch (`POST /api/plugins/enabled`).
The general settings route refuses it, because the switch decides whose code runs on this
computer.

## Where an installed plugin lives

```
<data folder>/plugins/<id>/
  manifest.json
  ...the files the manifest lists, exactly as the package held them
```

The data folder is `~/.six-degrees`, or the folder `SIX_DEGREES_HOME` names. An install
writes nothing else of Sixgree's. Uninstalling removes that one folder: whatever the
plugin brought into your network stays.

## The package

A `.sgplugin` file is a zip archive, at most 8 MB, holding `manifest.json` at its top and
the plugin's files:

```
manifest.json
scanner/scrape.py
scanner/image_store.py
scanner/requirements.txt
```

Sixgree reads the zip itself (`lib/zip-read.js`) and refuses anything it doesn't fully
understand:

- Entries are **stored** or **deflate**. No encryption, no zip64, no archive split over
  several files.
- Every entry is a plain file or a folder. Symbolic links and other special files are refused.
- Names are relative paths in UTF-8, with `/` between folders: no `/` at the start, no
  `..` or `.` part, no empty part, no backslash, no `:`, no control characters, at most
  240 characters.
- No name twice. Two names that differ only in upper and lower case, or in how an accent
  is written, count as the same name, since many disks store them as one file. No name may
  be both a file and a folder.
- At most 256 entries, at most 32 MB unpacked, and no entry over 64 KB that expands to more
  than 100 times its packed size. Each entry is unpacked no further than the size it
  declares, and its CRC-32 must match.
- The list of files must sit where the archive's end record says, and no two entries may
  share bytes.

A folder entry is allowed only for a folder that holds a listed file.

## manifest.json

```json
{
  "format": "sixgree.plugin",
  "format_version": 1,
  "id": "manual-scan",
  "name": "Manual scan",
  "version": "1.0.0",
  "sixgree": ">=1.2.8",
  "about": "One or two sentences on what it does.",
  "risk": "Optional: anything a person should know before installing it.",
  "kind": "scanner",
  "unlocks": ["manual"],
  "files": {
    "scanner/scrape.py": "<sha256>",
    "scanner/image_store.py": "<sha256>",
    "scanner/requirements.txt": "<sha256>"
  }
}
```

| Field | Rule |
|---|---|
| `format` | Always `"sixgree.plugin"`. |
| `format_version` | `1`. A higher number means the package needs a newer Sixgree, and it says so. |
| `id` | `^[a-z0-9][a-z0-9-]{1,40}$`: 2 to 41 lowercase letters, digits and dashes. It names the plugin's folder. Installing a package with an id already installed replaces that plugin. |
| `name` | Shown in Settings. Up to 60 characters. |
| `version` | `MAJOR.MINOR.PATCH`, with an optional `-tag`. |
| `sixgree` | The versions of Sixgree it is for: one to four comparisons, all of which must hold, separated by spaces. Each is `>=`, `>`, `<=`, `<` or `=` (or none, meaning `=`) before `MAJOR.MINOR.PATCH`. Examples: `">=1.2.8"`, `">=2.0.0 <3.0.0"`. |
| `about` | What it does, shown before installing and in the list. Up to 400 characters. |
| `risk` | Optional. Shown before installing, beside the yes. Up to 1000 characters. |
| `kind` | `"scanner"`. |
| `unlocks` | What it turns on in the app: `["auto"]`, `["manual"]` or both. Stored and shown for now. |
| `files` | Every file in the package except `manifest.json`, each with its SHA-256 as 64 lowercase hex digits. Up to 200. |

Text fields are plain text: no control characters, and none of the characters that turn
text around on screen. Fields the format doesn't know are ignored, so a later version can
add some.

### Every file listed, every checksum matching

A package is refused when it holds a file `files` doesn't list, when `files` lists one it
doesn't hold, or when any file's SHA-256 differs from the one listed. The reason is said
in words.

## A scanner plugin

A plugin of `kind: "scanner"` must list `scanner/scrape.py`, the program a scan runs, and
`scanner/requirements.txt`, the Python packages it needs. Anything else under `scanner/`
is the scanner's own business.

While plugins are on and a sound scanner plugin is installed, scans run its
`scanner/scrape.py` instead of the copy built into Sixgree (`lib/scanner-files.js
findScanner`). With two installed, the newer version is used. One that is broken, or made
for another version of Sixgree, is never run: scans use the built-in copy, and the Scan
page's checks say why.

Sixgree starts a scanner plugin exactly as it starts the built-in scanner:

- the same Python, the same command-line flags, and the same lines read from its output;
- in the plugin's own folder (`<data folder>/plugins/<id>/`), so a relative path it writes
  to lands there, never inside the app;
- with the script's own folder first on Python's import path, so it can import files
  beside it;
- with the same environment: Sixgree's own, plus `SIX_DEGREES_USER_ID` (whose network it
  writes into), `APP_URL` (this Sixgree, on this computer, which it sends what it finds to),
  `SIX_DEGREES_FROM_APP`, `SIX_DEGREES_LIMITS_LIFTED`, and `SIX_DEGREES_ROOT` (Sixgree's own
  folder, when it has one). Everything it keeps belongs in the data folder:
  `SIX_DEGREES_HOME` when it is set, `~/.six-degrees` otherwise.

Install and *Set up the scanner* install the plugin's `scanner/requirements.txt` into the
scanner's Python.

## Installing from a file, step by step

1. **Check.** The page sends the package to `POST /api/plugins/install?check=1`. Sixgree
   reads it all the way through, writes nothing, and answers with its name, version, what
   it does, its risk, and the package's SHA-256.
2. **Yes.** The page shows that, with the line *"A plugin runs its own code on this
   computer, with the same access as Sixgree."* Nothing installs without a yes.
3. **Install.** The page sends the package again with the SHA-256 from step 1 in
   `X-Six-Degrees-Plugin-Sha256`. A package with any other checksum installs nothing.
   Sixgree unpacks it into a private working folder in the data folder, reads it back from
   the disk through the same checks, and only then moves it into `plugins/<id>/`.

A reinstall or an update moves the old copy aside and the new one into place; if the new
one can't be put in place, the old one goes back, so a plugin is never left half one
version and half another. A working folder a stopped server leaves behind is removed an
hour later.

Every change (install, uninstall, the switch) is refused while a scan or the scanner's
setup runs. Every route under `/api/plugins` answers only on this computer (`lib/gate.js`).

## Installing from the plugin list, or from a link

The same two steps, with the download in the first (`POST /api/plugins/download`):

1. **Install** (on a card, or *Install from the link* with an https link pasted). Sixgree
   downloads the package, on that press and no other, and checks it:
   - **From the list:** it must be exactly the size and SHA-256 the list gives, and the
     plugin and version the list names. Anything else is refused and nothing waits for a yes.
   - **From a link:** there is no list to match, so the package's own manifest checksums
     are the only check. The yes says so.

   Then it is read all the way through as a file is (above), nothing is written, and the
   package is kept in memory, by its SHA-256, for up to 15 minutes.
2. **Yes.** The same as a file's, plus where it was downloaded from (the host).
3. **Install.** Only with that SHA-256. What installs is exactly what was checked and shown;
   it is never downloaded a second time.

An **Update** is the same flow for a plugin the list has in a newer version than the one
installed. It replaces the plugin's folder whole, as a reinstall does.

## The plugin list

Browse shows one JSON file, the official list:

```
https://raw.githubusercontent.com/blakeb056/sixgree-plugins/main/catalog.json
```

```json
{
  "format": "sixgree.plugin-catalog",
  "format_version": 1,
  "plugins": [
    {
      "id": "auto-scan",
      "name": "Auto scan",
      "version": "1.0.0",
      "about": "What it does.",
      "risk": "Optional: anything a person should know before installing it.",
      "kind": "scanner",
      "unlocks": ["auto"],
      "sixgree": ">=1.2.8",
      "url": "https://…/auto-scan-1.0.0.sgplugin",
      "sha256": "<the package's SHA-256>",
      "size": 123456
    }
  ]
}
```

`id`, `name`, `version`, `about`, `risk`, `kind`, `unlocks` and `sixgree` follow the
manifest's rules. `url` is where the package is, https only. `sha256` is the whole
package's SHA-256, as 64 lowercase hex digits. `size` is its size in bytes, at most 8 MB.
Fields the format doesn't know are ignored.

Every entry is checked, and nothing in the list can stop the rest from showing:

- **Left out, with why** (listed under the cards): an entry that isn't an object, a bad id,
  name, version or text, a link that isn't https (or carries a name or password), a missing
  or malformed `sha256` or `size`, a package over 8 MB, a `sixgree` Sixgree can't read, and
  the second entry with an id already listed. A hostile id is never shown.
- **Shown as not for this version, with why, and no Install:** a `kind` or an `unlocks` this
  Sixgree doesn't know, and a `sixgree` range this version isn't in.

A list that isn't JSON, isn't `"format": "sixgree.plugin-catalog"`, has another
`format_version`, or is over 256 KB isn't shown: Browse says *The plugin list couldn't be
loaded*, why, and offers *Try again*. Only the first 200 entries are read.

### When Sixgree goes online for it

Never by itself. The list is fetched only when someone opens Settings → Plugins with plugins
on (the first time its Browse comes into view), presses *Try again*, or ticks *Allow plugins*
in the setup. A package is downloaded only when *Install* is pressed.

Both are fetched by Sixgree's server, never by the page:

- https only, and every redirect is checked the same way, so an https link can't hand the
  download to a plain http one;
- within a time limit (15 seconds for the list, 60 for a package) and a size cap (256 KB for
  the list, 8 MB or the list's own `size` for a package), refused the moment either is passed;
- with no cookies, and nothing about this computer but a `User-Agent` naming Sixgree's
  version (`Sixgree/1.2.8`).

Both routes are POSTs, gated with the rest of `/api/plugins`, so no other website can make
Sixgree fetch anything.

### A test's own list

`SIX_DEGREES_PLUGIN_CATALOG` points Browse at another list, the way
`SIX_DEGREES_TEST_RELEASES` points the updater at a test server. It is honoured when it is
an https address, or plain http on `127.0.0.1` with a port; then the list's packages may be
on `http://127.0.0.1` too. Anything else is ignored, the official list is used, and Browse
says it was ignored. Browse says whenever it shows a test's list.

```bash
node scripts/build-plugin.mjs --catalog http://127.0.0.1:4848   # dist/plugins/catalog.json too
# serve dist/plugins/ on 127.0.0.1:4848, then:
SIX_DEGREES_PLUGIN_CATALOG=http://127.0.0.1:4848/catalog.json npm run dev
```

## Checked again whenever it's used

Every time the plugins are listed, or a scan is about to start, each installed plugin is
read again: its manifest, and every file it lists, by checksum. A file changed or missing
since it was installed, or a link where a file should be, makes the plugin **broken**,
listed with why and never run. A plugin a newer Sixgree no longer fits is **switched off**:
kept, listed with why, and not used.

## Building the scanner's packages

```bash
npm run build:plugins                       # → dist/plugins/auto-scan-1.0.0.sgplugin, manual-scan-1.0.0.sgplugin
node scripts/build-plugin.mjs --version=1.0.1 --out=some/folder
node scripts/build-plugin.mjs --catalog http://127.0.0.1:4848   # also dist/plugins/catalog.json, naming both there
```

Both packages hold the same scanner, from the app's own `scripts/` files; they differ in
name, what they say they do, and what they unlock. The same files always make the same
package, byte for byte. Each package is read back through the installer's checks before
it is written.

## Not in version 1 yet

A plugin's own settings and page, and a message format between Sixgree and a plugin. A
scanner plugin talks to Sixgree the way the built-in scanner does.
