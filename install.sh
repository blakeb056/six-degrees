#!/bin/bash
# Install 6 Degrees on a Mac with one line:
#
#   curl -fsSL https://raw.githubusercontent.com/blakeb056/six-degrees/main/install.sh | bash
#
# What it does, in order — nothing else:
#   1. finds the newest release on GitHub for your Mac's chip (Apple Silicon or Intel)
#   2. downloads it and checks it against the published SHA-256 checksum
#   3. copies "Six Degrees.app" into /Applications (or ~/Applications)
#   4. opens it
#
# Why a script and not just the .dmg: the app is not signed with a paid Apple
# developer certificate, so a .dmg downloaded in a browser makes macOS refuse the
# first launch until you approve it in System Settings. A file fetched with curl
# is not marked as "downloaded from the internet", so installed this way it
# simply opens. The .dmg on the Releases page still works; it just needs that
# one approval.
#
# Your data is never touched: it lives in ~/.six-degrees, not in the app, so
# running this again later is also how you update.
#
# Options (environment variables — put them after the pipe, where the installer
# runs: `curl -fsSL …/install.sh | SIX_DEGREES_VERSION=0.2.0 bash`):
#   SIX_DEGREES_VERSION=0.2.0   install a specific release instead of the newest
#   SIX_DEGREES_DEST=~/Apps     install somewhere else
#   SIX_DEGREES_NO_OPEN=1       do not open the app afterwards
#   SIX_DEGREES_DMG=./x.dmg     install a .dmg you already have (skips the download)

# Everything runs inside main(), called on the last line. If the download of
# this script is cut short, bash never reaches that line and nothing runs —
# a half-received installer must not half-install.

set -euo pipefail

REPO="blakeb056/six-degrees"
APP_NAME="Six Degrees"

say()  { printf '  %s\n' "$*"; }
fail() { printf '\n  ✗ %s\n\n' "$*" >&2; exit 1; }

# Pull one download URL out of the GitHub release JSON. No jq on a stock Mac.
asset_url() {
  printf '%s' "$1" | grep -o "\"browser_download_url\": *\"[^\"]*$2\"" | head -1 \
    | sed 's/.*"\(https[^"]*\)"$/\1/'
}

# Download the release for this chip into $2, verify it, and print its file name.
fetch_release() {
  local arch="$1" tmp="$2" api release dmg_url sums_url file want got

  if [ -n "${SIX_DEGREES_VERSION:-}" ]; then
    api="https://api.github.com/repos/$REPO/releases/tags/v${SIX_DEGREES_VERSION#v}"
  else
    api="https://api.github.com/repos/$REPO/releases/latest"
  fi

  release="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api")" \
    || fail "Could not find a release on GitHub. Check your connection, or see https://github.com/$REPO/releases"

  # Asset names are fixed by scripts/build-app.mjs: Six-Degrees-<version>-<arch>.dmg
  dmg_url="$(asset_url "$release" "-$arch\\.dmg")"
  sums_url="$(asset_url "$release" "SHA256SUMS")"
  [ -n "$dmg_url" ] || fail "That release has no download for this Mac ($arch). See https://github.com/$REPO/releases"

  file="$(basename "$dmg_url")"
  say "Release:  $file" >&2
  say "Downloading…" >&2
  curl -fL --progress-bar -o "$tmp/$file" "$dmg_url" || fail "The download failed. Try again."

  if [ -n "$sums_url" ]; then
    curl -fsSL -o "$tmp/SHA256SUMS" "$sums_url" || fail "Could not fetch the checksum file."
    want="$(grep " $file\$" "$tmp/SHA256SUMS" | awk '{print $1}')"
    got="$(shasum -a 256 "$tmp/$file" | awk '{print $1}')"
    [ -n "$want" ] || fail "The checksum file does not list $file."
    [ "$want" = "$got" ] || fail "Checksum mismatch — the download is not what was published. Nothing was installed."
    say "Verified: SHA-256 matches the release" >&2
  else
    say "Note:     this release has no checksum file, so the download was not verified" >&2
  fi

  printf '%s' "$file"
}

# A copy that is still running would keep serving the old version, so stop it
# first. Two processes: the launcher, found by its path, and the server, which
# cannot be — Next renames its process to "next-server", so no path appears in
# the process list. The server does sit in the app's folder, though, so find the
# node processes whose working directory is inside this app. Only those.
stop_running_copy() {
  local target="$1" pids p i
  pids="$(pgrep -f "$target/Contents/MacOS/" 2>/dev/null || true)"
  pids="$pids $(lsof -a -d cwd -c node -Fpn 2>/dev/null | awk -v t="$target/Contents/" '
    /^p/ { pid = substr($0, 2) }
    /^n/ { if (index(substr($0, 2), t) == 1) print pid }' || true)"
  pids="$(printf '%s\n' $pids | sort -u | grep -v '^$' || true)"
  [ -n "$pids" ] || return 0

  say "Stopping the running copy so it can be replaced…"
  # shellcheck disable=SC2086  # a list of pids, split on purpose
  kill $pids 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    for p in $pids; do kill -0 "$p" 2>/dev/null && break; p=""; done
    [ -z "$p" ] && return 0
    sleep 0.5
  done
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
}

main() {
  printf '\n  6 Degrees — installer\n\n'

  [ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS. On Linux, run it from source (see the README). Windows isn't supported yet."

  local arch
  # A Terminal running under Rosetta reports x86_64 even on Apple Silicon, and
  # would fetch the Intel build. Ask the hardware instead.
  case "$(uname -m)" in
    arm64)  arch="arm64" ;;
    x86_64) if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then arch="arm64"; else arch="x64"; fi ;;
    *)      fail "Unrecognised Mac chip: $(uname -m)" ;;
  esac
  say "Mac:      $arch"

  # Every release bundles Node 24, which needs macOS 13.5, and the Electron app
  # needs 13. Refuse plainly rather than install an app that cannot start: on an
  # older Mac it used to install fine and then fail with a generic alert.
  local macos major minor
  macos="$(sw_vers -productVersion 2>/dev/null || echo 0)"
  major="${macos%%.*}"
  minor="$(printf '%s' "$macos" | cut -d. -f2)"; minor="${minor:-0}"
  if [ "$major" -lt 13 ] 2>/dev/null || { [ "$major" -eq 13 ] && [ "$minor" -lt 5 ]; }; then
    fail "Six Degrees needs macOS 13.5 (Ventura) or later. This Mac runs $macos."
  fi
  say "macOS:    $macos"

  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand now: tmp is local and gone by exit time
  trap "hdiutil detach '$tmp/mnt' -quiet >/dev/null 2>&1 || true; rm -rf '$tmp'" EXIT

  # ---- get the disk image --------------------------------------------------
  local file
  if [ -n "${SIX_DEGREES_DMG:-}" ]; then
    [ -f "$SIX_DEGREES_DMG" ] || fail "No file at $SIX_DEGREES_DMG"
    file="$(basename "$SIX_DEGREES_DMG")"
    cp "$SIX_DEGREES_DMG" "$tmp/$file"
    say "Local:    $file (your own file, so no checksum to check)"
  else
    file="$(fetch_release "$arch" "$tmp")"
  fi

  # ---- where it goes -------------------------------------------------------
  local dest="${SIX_DEGREES_DEST:-/Applications}"
  dest="${dest/#\~/$HOME}"
  mkdir -p "$dest" 2>/dev/null || true
  if [ ! -w "$dest" ]; then
    dest="$HOME/Applications"
    mkdir -p "$dest"
    say "Note:     /Applications is not writable for you, using ~/Applications"
  fi
  local target="$dest/$APP_NAME.app"

  # ---- install -------------------------------------------------------------
  mkdir -p "$tmp/mnt"
  hdiutil attach "$tmp/$file" -nobrowse -readonly -mountpoint "$tmp/mnt" -quiet \
    || fail "Could not open the disk image."
  [ -d "$tmp/mnt/$APP_NAME.app" ] || fail "The disk image does not contain $APP_NAME.app."

  stop_running_copy "$target"

  rm -rf "$target"
  ditto "$tmp/mnt/$APP_NAME.app" "$target" || fail "Could not copy the app into $dest."
  hdiutil detach "$tmp/mnt" -quiet >/dev/null 2>&1 || true

  # curl does not mark files as downloaded, so normally there is nothing to
  # clear. This matters only if the same image reached the Mac another way first.
  xattr -dr com.apple.quarantine "$target" >/dev/null 2>&1 || true

  say "Installed: $target"
  say "Your data: ~/.six-degrees (unchanged)"

  if [ -z "${SIX_DEGREES_NO_OPEN:-}" ]; then
    open "$target"
    printf '\n  ✓ Opening 6 Degrees. Next time, open it from Applications or Spotlight.\n'
  else
    printf '\n  ✓ Done.\n'
  fi
  printf '    To update later, run the same command again.\n\n'
}

main "$@"
