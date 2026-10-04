#!/bin/bash
# The Mac release's Developer ID, for .github/workflows/release.yml's Mac jobs
# (docs/brain/DESKTOP.md D4). Two commands:
#
#   ci-mac-signing.sh setup VERSION DRY_RUN    before the build
#   ci-mac-signing.sh cleanup                  after it, always (if: always())
#
# setup asks scripts/mac-sign.mjs whether this release signs (release-plan):
#   - all five secrets set: it signs, dry run or not;
#   - none set: ad hoc, as before 1.0, unless this is a real release of 1.0.0 or
#     later, which must be signed: then it fails here, before anything is built;
#   - some but not all: always a mistake, and it fails, naming the missing ones.
# When it signs, it decodes the certificate (.p12, which carries Apple's
# Developer ID G2 intermediate too) into a temporary keychain with a random
# password, finds the "Developer ID Application" identity in it, decodes the App
# Store Connect API key (.p8) for notarytool, and hands the build their places
# through $GITHUB_ENV: SIX_DEGREES_SIGN_IDENTITY (the identity's SHA-1: names
# can repeat across renewals, a hash can't), SIX_DEGREES_SIGN_KEYCHAIN and
# SIX_DEGREES_NOTARY_KEY. The key's id and issuer reach the build step straight
# from the secrets (release.yml), never through a file. MAC_SIGNING says which
# it was (developer-id or ad-hoc), for the smoke test and the release notes.
#
# The secrets arrive as environment variables, set by release.yml from GitHub's
# secrets and nowhere else. Nothing here prints one: values go to files made
# under umask 077, or to `security` itself, and GitHub masks them in the log
# besides. Never run this with `bash -x`. cleanup deletes the keychain, puts the
# keychain search list back as it was, and removes every decoded file.

set -euo pipefail

work="${RUNNER_TEMP:?RUNNER_TEMP is not set (this runs in GitHub Actions)}/six-degrees-signing"
keychain="$work/signing.keychain-db"
here="$(cd "$(dirname "$0")" && pwd)"

say() { printf '%s\n' "$*"; }
die() { printf '::error::%s\n' "$*"; exit 1; }

setup() {
  local version="${1:?usage: ci-mac-signing.sh setup VERSION DRY_RUN}" dry_run="${2:-false}" plan
  local genv="${GITHUB_ENV:?GITHUB_ENV is not set}"
  # release-plan reads only whether each secret is set, never a value.
  if ! plan="$(node "$here/mac-sign.mjs" release-plan "$version" "$dry_run")"; then
    die "The Mac app can't be built as asked: see the line above."
  fi
  if [ "$plan" != developer-id ]; then
    echo "MAC_SIGNING=ad-hoc" >> "$genv"
    say "Signing: ad hoc."
    return 0
  fi

  umask 077
  rm -rf "$work"
  mkdir -p "$work"

  # The certificate, for the keychain only; its file goes as soon as it's in.
  printf '%s' "$MACOS_SIGN_P12_BASE64" | base64 --decode > "$work/cert.p12" 2>/dev/null \
    || die "MACOS_SIGN_P12_BASE64 isn't base64 (set it again with scripts/set-signing-secrets.sh)."
  [ -s "$work/cert.p12" ] || die "MACOS_SIGN_P12_BASE64 decodes to nothing."
  # The API key, for notarytool, kept until cleanup.
  printf '%s' "$APPLE_API_KEY_P8_BASE64" | base64 --decode > "$work/AuthKey.p8" 2>/dev/null \
    || die "APPLE_API_KEY_P8_BASE64 isn't base64 (set it again with scripts/set-signing-secrets.sh)."
  grep -q -- '-----BEGIN PRIVATE KEY-----' "$work/AuthKey.p8" \
    || die "APPLE_API_KEY_P8_BASE64 doesn't decode to an App Store Connect API key (.p8)."

  # A keychain of its own, with a password nobody needs to know, unlocked for
  # the length of the job (6 hours), and codesign allowed to use the key without
  # asking (the partition list): there is nobody to click Allow on a runner.
  local kc_pass
  kc_pass="$(head -c 32 /dev/urandom | base64 | tr -d '\n=+/')"
  security create-keychain -p "$kc_pass" "$keychain"
  security set-keychain-settings -lut 21600 "$keychain"
  security unlock-keychain -p "$kc_pass" "$keychain"
  security import "$work/cert.p12" -k "$keychain" -f pkcs12 -P "$MACOS_SIGN_P12_PASSWORD" \
    -T /usr/bin/codesign -T /usr/bin/security > /dev/null \
    || die "The certificate wouldn't import: is MACOS_SIGN_P12_PASSWORD the .p12's password?"
  rm -f "$work/cert.p12"
  security set-key-partition-list -S apple-tool:,apple: -s -k "$kc_pass" "$keychain" > /dev/null
  kc_pass=""

  # codesign finds an identity only in a keychain on the search list. The list as
  # it was is kept, for cleanup to put back.
  security list-keychains -d user > "$work/search-list"
  local line orig=()
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%\"}"; line="${line#\"}"
    [ -n "$line" ] && orig+=("$line")
  done < "$work/search-list"
  security list-keychains -d user -s "$keychain" ${orig[@]+"${orig[@]}"}

  # By its kind, not its full name: whatever Developer ID Application identity
  # the certificate holds, and it must be valid (its chain reaches Apple's root).
  local found identity name
  found="$(security find-identity -v -p codesigning "$keychain" | grep '"Developer ID Application: ' | head -1 || true)"
  identity="$(printf '%s\n' "$found" | awk '{print $2}')"
  name="$(printf '%s\n' "$found" | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p')"
  if [ -z "$identity" ]; then
    say "The keychain holds these code-signing identities (valid or not):"
    security find-identity -p codesigning "$keychain" | sed 's/^/  /'
    die "No valid \"Developer ID Application\" identity in MACOS_SIGN_P12_BASE64. Export the Developer ID Application certificate with its private key (and Apple's intermediate) as the .p12."
  fi
  {
    echo "SIX_DEGREES_SIGN_IDENTITY=$identity"
    echo "SIX_DEGREES_SIGN_KEYCHAIN=$keychain"
    echo "SIX_DEGREES_NOTARY_KEY=$work/AuthKey.p8"
    echo "MAC_SIGNING=developer-id"
  } >> "$genv"
  say "Signing: $name, from a temporary keychain; notarized with the App Store Connect API key."
}

cleanup() {
  if [ -f "$work/search-list" ]; then
    local line orig=()
    while IFS= read -r line; do
      line="${line#"${line%%[![:space:]]*}"}"; line="${line%\"}"; line="${line#\"}"
      [ -n "$line" ] && orig+=("$line")
    done < "$work/search-list"
    security list-keychains -d user -s ${orig[@]+"${orig[@]}"} || true
  fi
  if [ -e "$keychain" ]; then security delete-keychain "$keychain" || true; fi
  rm -rf "$work"
  say "Signing: cleaned up (no keychain, key or certificate left)."
}

case "${1:-}" in
  setup)   shift; setup "$@" ;;
  cleanup) cleanup ;;
  *)       echo "usage: ci-mac-signing.sh setup VERSION DRY_RUN | cleanup" >&2; exit 2 ;;
esac
