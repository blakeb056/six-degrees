# Contributing

Thanks for taking a look. This is a small research project, so the bar is
"does it work and is it honest," not ceremony.

## Ground rule that matters most

**Never commit real network data.** No exported CSVs, no `public/avatars/`, no
`demo-data.json` built from a real account, no screenshots of real people, no
credentials. These describe identifiable individuals who did not opt in. CI
enforces this, but please don't rely on CI to catch it.

When filing an issue, redact names before attaching anything.

## Setup

The README's install line is for people who want to *use* the app. To change it,
run from source:

```bash
git clone https://github.com/blakeb056/six-degrees && cd six-degrees && npm install && npm run dev
```

The `&&`s matter: if the clone fails — most often because a `six-degrees` folder
from an earlier try is already there — nothing after it runs, instead of quietly
starting that older copy. Already have a clone? Update it with `npm run update`,
which also gets past the regenerated `package-lock.json` that makes a plain
`git pull` refuse.

Needs **Node 22.13+** (`nvm use` reads `.nvmrc`). Opens on <http://localhost:3000>.
Nothing to configure: no `.env`, no account, no keys. It uses the same data
folder as the installed app, `~/.six-degrees`; point `SIX_DEGREES_HOME` somewhere
else to develop against an empty one.

Scraper work also needs Python 3.9+ and Google Chrome — the Scan page sets up
the Python side. Read `docs/SCRAPING.md` and `docs/brain/TRAPS.md` first.

## Releasing

Bump the version, tag it, push the tag. `.github/workflows/release.yml` builds the
Mac app for Apple Silicon and Intel, publishes both `.dmg` files and a `SHA256SUMS`
file on a GitHub Release (which is what `install.sh` downloads), and publishes to
npm when an `NPM_TOKEN` secret is set.

```bash
npm version 0.2.0 --no-git-tag-version
git commit -am "Release 0.2.0" && git tag v0.2.0 && git push --follow-tags
```

To try a packaged build locally: `npm run build:app`, then
`SIX_DEGREES_DMG=dist/Six-Degrees-<version>-arm64.dmg bash install.sh`.

The picture behind the `.dmg` window is `scripts/dmg/background.html`. After changing
it, run `node scripts/make-dmg-background.mjs` (needs Google Chrome) and commit the
`.tiff` it writes; the build only copies that file. Its layout and the icon positions in
`scripts/build-app.mjs` are one design — change them together.

## Before opening a PR

```bash
npm run lint
npm test
npm run build
```

Keep changes focused. Match the surrounding style rather than reformatting:
this codebase is plain JavaScript with inline style objects, and consistency
beats personal preference.

## Screenshots

The images in the README are generated, never hand-captured, so they can never
accidentally contain a real person:

```bash
npm run dev
python3 scripts/screenshots.py        # writes docs/img/*.png
```

It runs against the sample network only. If you change the UI in a way the
README shows, regenerate rather than cropping a screenshot of your own data.

## Commit messages

Explain **why**, not just what. A one-line subject, then a body if the change
isn't self-evident.

## Scope

Bug fixes, accessibility, performance, and documentation are always welcome.
Before building a large feature, open an issue first — the project has a
deliberate shape and not every idea fits it.

## A note on scraping

Anything that automates LinkedIn carries Terms-of-Service risk for the person
running it. Contributions that make scraping more aggressive, add credential
handling, or work around LinkedIn's protections will be declined. The official
CSV export is the supported path.
