#!/bin/bash
# Put the Mac signing secrets into GitHub, for the release workflow (DESKTOP.md D4).
# Blake runs this himself, on his own Mac:
#
#   scripts/set-signing-secrets.sh <cert.p12> <AuthKey_XXXXXXXXXX.p8> <KEY_ID> <ISSUER_ID>
#
#   cert.p12    the Developer ID Application certificate with its private key
#               (Keychain Access → My Certificates → Export), Apple's intermediate
#               in it too
#   .p8         the App Store Connect API key notarytool uses (Users and Access →
#               Integrations → Team Keys); Apple lets you download it once
#   KEY_ID      that key's ID, 10 letters and digits (it's in the .p8's name)
#   ISSUER_ID   the issuer ID shown above the keys list (a UUID)
#
# It asks for the .p12's password (typed, not shown), checks that it opens the
# certificate, and sets five secrets on blakeb056/six-degrees with the GitHub CLI:
# MACOS_SIGN_P12_BASE64, MACOS_SIGN_P12_PASSWORD, APPLE_API_KEY_P8_BASE64,
# APPLE_API_KEY_ID and APPLE_API_ISSUER_ID. Each value goes to `gh secret set`
# on its standard input, never as an argument (where `ps` could see it), and is
# never printed or written to a file: it prints only which secrets it set.
# Running it again replaces them (a renewed certificate, a new key).

set -euo pipefail

REPO=blakeb056/six-degrees
OPENSSL=/usr/bin/openssl   # macOS's own (LibreSSL): it reads Keychain Access's .p12 files

say()   { printf '%s\n' "$*"; }
fail()  { printf '\n  ✗ %s\n\n' "$*" >&2; exit 1; }
usage() {
  printf 'usage: %s <cert.p12> <AuthKey_XXXXXXXXXX.p8> <KEY_ID> <ISSUER_ID>\n' "$(basename "$0")" >&2
  exit 2
}

[ $# -eq 4 ] || usage
p12="$1" p8="$2" key_id="$3" issuer="$4"

# The files first: nothing is asked or sent unless both are there.
for f in "$p12" "$p8"; do
  [ -f "$f" ] || fail "No file at $f. Nothing was set."
  [ -r "$f" ] || fail "Can't read $f. Nothing was set."
  [ -s "$f" ] || fail "$f is empty. Nothing was set."
done
case "$p12" in *.p12|*.pfx) ;; *) fail "The first file should be the certificate's .p12 (got $(basename "$p12")). Nothing was set." ;; esac
case "$p8" in *.p8) ;; *) fail "The second file should be the API key's .p8 (got $(basename "$p8")). Nothing was set." ;; esac
grep -q -- '-----BEGIN PRIVATE KEY-----' "$p8" || fail "$(basename "$p8") isn't an App Store Connect API key. Nothing was set."

# The two IDs, checked by their shape, never echoed.
[[ "$key_id" =~ ^[A-Z0-9]{10}$ ]] || fail "KEY_ID should be 10 capital letters and digits (it's in the .p8's name: AuthKey_<KEY_ID>.p8). Nothing was set."
if [[ "$(basename "$p8")" =~ ^AuthKey_([A-Z0-9]+)\.p8$ ]] && [ "${BASH_REMATCH[1]}" != "$key_id" ]; then
  fail "KEY_ID doesn't match the .p8's name ($(basename "$p8")): use that key's ID. Nothing was set."
fi
[[ "$issuer" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || fail "ISSUER_ID should be a UUID (8-4-4-4-12 letters and digits, above the keys list in App Store Connect). Nothing was set."

# GitHub, before the password is asked for.
command -v gh > /dev/null 2>&1 || fail "The GitHub CLI isn't installed (brew install gh). Nothing was set."
gh auth status > /dev/null 2>&1 || fail "The GitHub CLI isn't signed in: run gh auth login, then this again. Nothing was set."

# The password: typed, not shown, kept only in this shell's memory.
password=""
if [ -t 0 ]; then
  read -r -s -p "Password for $(basename "$p12"): " password
  printf '\n'
else
  IFS= read -r password || true
fi
[ -n "$password" ] || fail "No password given. Nothing was set."

# Does it open the certificate? printf is part of bash, so the password is never
# a program's argument; openssl reads it from its standard input.
if ! printf '%s\n' "$password" | "$OPENSSL" pkcs12 -in "$p12" -nokeys -passin stdin -noout > /dev/null 2>&1; then
  answer=""
  if [ -t 0 ]; then
    read -r -p "That password didn't open $(basename "$p12") (or this Mac's openssl can't read it). Set the secrets anyway? [y/N] " answer
  else
    IFS= read -r answer || true
  fi
  case "$answer" in y|Y|yes) ;; *) password=""; fail "Nothing was set." ;; esac
fi

# Each value on gh's standard input. base64 without line breaks, as the release
# workflow decodes it. (Each `gh secret set` is the last command of its pipe and
# reads it to the end.)
done_names=""
ok()   { done_names="${done_names:+$done_names, }$1"; say "  set $1"; }
stop() { password=""; fail "gh couldn't set $1 (does your account have admin rights on $REPO?). Set before it: ${done_names:-none}."; }
say "Setting the Mac signing secrets on $REPO:"
if base64 < "$p12" | tr -d '\n' | gh secret set MACOS_SIGN_P12_BASE64 --repo "$REPO" > /dev/null; then ok MACOS_SIGN_P12_BASE64; else stop MACOS_SIGN_P12_BASE64; fi
if printf '%s' "$password" | gh secret set MACOS_SIGN_P12_PASSWORD --repo "$REPO" > /dev/null; then ok MACOS_SIGN_P12_PASSWORD; else stop MACOS_SIGN_P12_PASSWORD; fi
password=""
if base64 < "$p8" | tr -d '\n' | gh secret set APPLE_API_KEY_P8_BASE64 --repo "$REPO" > /dev/null; then ok APPLE_API_KEY_P8_BASE64; else stop APPLE_API_KEY_P8_BASE64; fi
if printf '%s' "$key_id" | gh secret set APPLE_API_KEY_ID --repo "$REPO" > /dev/null; then ok APPLE_API_KEY_ID; else stop APPLE_API_KEY_ID; fi
if printf '%s' "$issuer" | gh secret set APPLE_API_ISSUER_ID --repo "$REPO" > /dev/null; then ok APPLE_API_ISSUER_ID; else stop APPLE_API_ISSUER_ID; fi
say "Done: all five are set. Check them with a dry run (it builds and notarizes, and publishes nothing):"
say "  gh workflow run release.yml --repo $REPO --ref <branch> -f dry_run=true"
