#!/bin/bash
# Put a new version of Six Degrees in place of the one that just quit, and open it.
#
# The app's server starts this (lib/updater-job.js) after it has downloaded the
# new version, checked it against the release's SHA256SUMS and checked that its
# code signature is intact, and copied it into a hidden folder beside the
# running app. Then the app quits. Everything slow or likely to fail has already
# happened by then. What is left:
#
#   1. Wait until the old app has gone: the processes the server named (--pid:
#      the app and the server itself) and every process whose *executable* is
#      inside the old app (Electron's helpers, and the server, which runs the
#      app's own node). After --wait seconds, stop what is left of those:
#      SIGTERM, then SIGKILL after --grace seconds. Nothing else is ever stopped:
#      a Terminal, an editor or a `tail -f` whose folder or file is inside the
#      app isn't the app (TRAPS §40). If the app can't be stopped, nothing
#      changes and it is opened again.
#   2. Rename the old app aside, in the same folder (it is never deleted first),
#      then rename the new one into its place, or copy it with ditto if a rename
#      can't do it.
#   3. Clear the quarantine flag and open it, with the app's own arguments. Then
#      wait for it to say it has started: its server writes --confirm when the
#      first page asks for /api/update, which every page does. A new version
#      that closes before that (it crashed, or its server couldn't start and the
#      error was dismissed) is taken out again, like one that can't be put in
#      place, and the old app is put back and opened.
#   4. Keep the old version, one copy, as a zip in --keep, and write the outcome
#      to --status. The app reads that file on its next start and shows it in
#      Settings → Updates.
#
# If anything fails after the old app was moved, the old app is put back and
# opened again. install.sh can't do that, because it deletes first. Nothing is
# deleted here before what replaces it is in place: the new version that failed
# is moved out of the way first, and removed only once the old one is back.
#
# Every value comes from the server. Nothing comes from a web page.
#
#   apply-update.sh --target APP --staged DIR --status FILE --from VERSION --to VERSION
#                   [--keep DIR] [--pid PID]... [--wait SECONDS] [--grace SECONDS]
#                   [--confirm FILE] [--confirm-wait SECONDS]
#                   [--log FILE] [--work DIR] [-- ARGUMENTS FOR THE NEW APP...]
#
# --staged must be the one place the server stages to, ".<app>.incoming" beside
# the app: it is removed after use, so nothing else is accepted.
#
# It handles both kinds of Mac app: the Electron app (Contents/MacOS/Six Degrees)
# and the classic launcher (a bash script, Contents/MacOS/six-degrees). It only
# moves whole bundles, so their insides don't matter.
#
# The tests (tests/apply-update.test.mjs) run it against pretend apps in a
# temporary folder. They swap `open` for a stand-in through
# SIX_DEGREES_UPDATER_OPEN, which is read only when SIX_DEGREES_UPDATER_TEST=1.
# The server starts this with a clean environment, so neither variable can
# reach a real update.
#
# macOS's /bin/bash is version 3.2: no associative arrays, and an empty array
# needs ${a[@]+"${a[@]}"} under `set -u`.

set -uo pipefail   # not -e: each failure is handled, so the old app can be put back

# ps and lsof print a name that isn't plain ASCII as escapes in the C locale,
# and then no path matches: an app in "Programmes Été" would never be found, and
# would be swapped while it still ran. The server starts this with the same
# setting (lib/updater-job.js helperEnv); it is set here too, for any other caller.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

OPEN=/usr/bin/open
if [ "${SIX_DEGREES_UPDATER_TEST:-}" = 1 ] && [ -n "${SIX_DEGREES_UPDATER_OPEN:-}" ]; then
  OPEN="$SIX_DEGREES_UPDATER_OPEN"
fi

target="" staged="" keep="" status="" from="" to="" wait=30 grace=5 log_file="" work=""
confirm="" confirm_wait=600
pids=()          # the processes the server named
starts=()        # when each of them started: with the pid, that names one process
relaunch=()
inside=""        # "<target>/Contents/", as given
inside_real=""   # the same with symlinks resolved, as lsof reports paths
staged_expected=""
kept=""
aside=""

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# A value for the status file, as a JSON string.
json_string() {
  local s nl=$'\n'
  # Control characters other than tab and newline can't appear in a path or a
  # message anyone should read; they would make the file unreadable.
  s="$(printf '%s' "$1" | tr -d '\000-\010\013-\037')"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//	/\\t}"; s="${s//$nl/\\n}"
  printf '"%s"' "$s"
}

# The outcome, for the app's next start (lib/updater.js lastUpdateReport).
write_status() {   # outcome [reason]
  local outcome="$1" reason="${2:-}" tmp="$status.$$.tmp"
  mkdir -p "$(dirname "$status")" 2>/dev/null
  {
    printf '{"outcome":%s,"from":%s,"to":%s,"at":%s' \
      "$(json_string "$outcome")" "$(json_string "$from")" "$(json_string "$to")" \
      "$(json_string "$(date -u '+%Y-%m-%dT%H:%M:%SZ')")"
    if [ -n "$reason" ]; then printf ',"reason":%s' "$(json_string "$reason")"; fi
    if [ -n "$kept" ]; then printf ',"previous":%s' "$(json_string "$kept")"; fi
    if [ -n "$log_file" ]; then printf ',"log":%s' "$(json_string "$log_file")"; fi
    printf '}\n'
  } > "$tmp" && mv -f "$tmp" "$status"
  log "Outcome: $outcome${reason:+ ($reason)}"
}

# Open an app with the arguments it was given (open drops both the environment
# and the command line of whoever calls it).
open_app() {   # app
  if [ ${#relaunch[@]} -gt 0 ]; then
    "$OPEN" "$1" --args "${relaunch[@]}"
  else
    "$OPEN" "$1"
  fi
}

# ── which processes are the app's ────────────────────────────────────────────

started_at() { ps -o lstart= -p "$1" 2>/dev/null; }

# Every process of this user whose executable is inside the app, one pid per
# line. The first "txt" file lsof lists for a process is its executable. Not its
# command line or working folder: a process can rewrite its command line (Next
# does, TRAPS §26), and anything can name a file in the app or sit in its
# folder, a Terminal or an editor above all (TRAPS §40). A fixed-string prefix:
# "Six Degrees (1).app" is never read as a pattern, and another copy of the app
# never matches. lsof sees only this user's processes; a copy another user has
# open is the server's to refuse before it hands over (lib/updater-job.js).
from_app() {
  lsof -d txt -Fpn 2>/dev/null | A="$inside" B="$inside_real" awk '
    /^p/ { pid = substr($0, 2); first = 1; next }
    /^n/ && first {
      first = 0
      exe = substr($0, 2)
      if (index(exe, ENVIRON["A"]) == 1 || index(exe, ENVIRON["B"]) == 1) print pid
    }'
}

# Is this process the old app's? Asked before a pid the server named is stopped:
# its executable, command or working folder is inside the app. (A named pid is
# already the same process the server named: see named_alive.)
belongs() {   # pid
  local exe cmd cwd
  exe="$(lsof -a -p "$1" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  case "$exe" in "$inside"*|"$inside_real"*) return 0 ;; esac
  cmd="$(ps -o command= -p "$1" 2>/dev/null)" || return 1
  case "$cmd" in "$inside"*|*" $inside"*|"$inside_real"*|*" $inside_real"*) return 0 ;; esac
  cwd="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  case "$cwd/" in "$inside"*|"$inside_real"*) return 0 ;; esac
  return 1
}

# The named processes still running, and still the ones the server named: a pid
# whose start time has changed was given to something else meanwhile.
named_alive() {
  local i=0
  while [ "$i" -lt ${#pids[@]} ]; do
    if [ -n "${starts[$i]}" ] && [ "$(started_at "${pids[$i]}")" = "${starts[$i]}" ]; then
      echo "${pids[$i]}"
    fi
    i=$((i + 1))
  done
}

as_line() { sort -un | tr '\n' ' ' | sed 's/ *$//'; }

# What is still to be waited for.
waiting_now() { { named_alive; from_app; } | as_line; }

# What may be stopped: a named process while it is still the old app's, and
# anything whose executable is inside the app. Nothing else, ever.
stoppable_now() {
  local p
  { for p in $(named_alive); do belongs "$p" && echo "$p"; done; from_app; } | as_line
}

# Wait for the app to be gone; stop what's left of it after $1 seconds, giving
# it $2 more after SIGTERM before SIGKILL.
wait_for_exit() {   # wait grace
  local deadline left
  deadline=$((SECONDS + $1))
  while :; do
    left="$(waiting_now)"
    [ -z "$left" ] && return 0
    [ "$SECONDS" -ge "$deadline" ] && break
    sleep 0.25
  done
  left="$(stoppable_now)"
  if [ -n "$left" ]; then
    log "Still running after ${1}s: $left. Asking them to stop."
    # shellcheck disable=SC2086  # a list of pids, split on purpose
    kill $left 2>/dev/null
    deadline=$((SECONDS + $2))
    while [ "$SECONDS" -lt "$deadline" ]; do
      sleep 0.25
      [ -z "$(stoppable_now)" ] && break
    done
    left="$(stoppable_now)"
    if [ -n "$left" ]; then
      log "Still running after ${2}s more: $left. Stopping them."
      # shellcheck disable=SC2086
      kill -9 $left 2>/dev/null
      sleep 1
    fi
  fi
  left="$(stoppable_now)"
  if [ -n "$left" ]; then
    log "Could not stop: $left."
    return 1
  fi
  # A named process that doesn't run from the app isn't one of its own any
  # more, and isn't this script's to stop. Nothing of the app is left.
  left="$(waiting_now)"
  [ -n "$left" ] && log "Not waiting for $left any longer: it doesn't run from the old app."
  return 0
}

# ── moving apps ──────────────────────────────────────────────────────────────

# A name beside the app that nothing has: ".<app>.<what>-<this pid>", with -2,
# -3… on the end if an earlier update left that one behind. `mv` onto a folder
# that exists moves *into* it, so a taken name must never be used.
unused_beside() {   # what
  local base name n=1
  base="$(dirname "$target")/.$(basename "$target").$1-$$"
  name="$base"
  while [ -e "$name" ] || [ -L "$name" ]; do
    n=$((n + 1))
    [ "$n" -gt 99 ] && return 1
    name="$base-$n"
  done
  printf '%s\n' "$name"
}

# The staged copy, removed only under its one possible name (checked in main).
remove_staged() {
  if [ -n "$staged" ] && [ "$staged" = "$staged_expected" ]; then rm -rf "$staged"; fi
}

# Something failed after the old app was moved aside: put it back and open it.
# What is at the app's place now (the new version, or part of a copy) is moved
# out of the way, never deleted, until the old app is back.
put_back() {   # reason
  local reason="$1" err="" failed=""
  trap '' TERM INT HUP   # two renames that must not be cut in half
  # Nothing may run from what is taken out: a new version that `open` said it
  # couldn't open, but did.
  wait_for_exit 3 2 || log "Something of the new version is still running."
  if [ -e "$target" ] || [ -L "$target" ]; then
    if ! failed="$(unused_beside failed)" || [ -e "$failed" ] || ! err="$(mv "$target" "$failed" 2>&1)"; then
      kept="$aside"
      write_status failed "$reason; the new version couldn't be moved out of the way (${err:-no free name for it})"
      return
    fi
  fi
  if err="$(mv "$aside" "$target" 2>&1)"; then
    trap - TERM INT HUP
    if [ -n "$failed" ]; then rm -rf "$failed"; fi   # only now: the old app is back
    remove_staged
    write_status rolled-back "$reason"
    open_app "$target" || log "Could not open the previous version either."
  else
    trap - TERM INT HUP
    kept="$aside"
    write_status failed "$reason; putting the previous version back failed too ($err)"
  fi
}

# Wait for the new version to say it has started: its server writes --confirm
# when the first page asks for /api/update. 0: it has. 1: it closed first
# (nothing runs from it, three looks in a row). 2: it still runs after
# --confirm-wait seconds without saying so, and is left be.
said_started() { [ -f "$confirm" ] && grep -qF "\"version\":$(json_string "$to")" "$confirm" 2>/dev/null; }
await_start() {
  local deadline gone=0
  deadline=$((SECONDS + confirm_wait))
  while :; do
    sleep 1
    said_started && return 0
    if [ -z "$(from_app)" ]; then
      gone=$((gone + 1))
      if [ "$gone" -ge 3 ]; then
        said_started && return 0
        return 1
      fi
    else
      gone=0
    fi
    [ "$SECONDS" -ge "$deadline" ] && return 2
  done
}

# Keep the old version, one copy, as a zip in --keep, until the next update.
# A zip, not the app itself: an app left in a folder can turn up in Spotlight
# beside the real one, and a Finder alias or a Dock icon may follow a moved
# folder rather than its old path (DESKTOP.md D4). Once the old folder is gone,
# both find the new one by its path, as they do after install.sh. It runs
# after the new version has started, at low priority, because it takes a while.
keep_previous() {
  local name version zip box="" f
  if [ -z "$keep" ]; then
    rm -rf "$aside"
    log "Removed the previous version."
    return
  fi
  name="$(basename "$target" .app)"
  version="${from//[^0-9A-Za-z._-]/}"
  zip="$keep/$name ${version:-previous}.zip"
  mkdir -p "$keep" 2>/dev/null
  # Under its own name, so unzipping it gives "Six Degrees.app". A fresh folder
  # each time: an old one of the same name would take the app inside it.
  if box="$(mktemp -d "$keep/.previous-XXXXXX" 2>/dev/null)" \
     && mv "$aside" "$box/$name.app" 2>/dev/null \
     && nice -n 10 ditto -c -k --sequesterRsrc --keepParent "$box/$name.app" "$zip.part" 2>/dev/null \
     && mv -f "$zip.part" "$zip"; then
    for f in "$keep/$name "*.zip; do
      if [ -e "$f" ] && [ "$f" != "$zip" ]; then rm -f "$f"; fi   # the one kept last time
    done
    kept="$zip"
    log "Kept a copy of the previous version: $zip"
  else
    rm -f "$zip.part"
    log "Could not keep a copy of the previous version in $keep; removing it."
  fi
  if [ -n "$box" ]; then rm -rf "$box"; fi
  rm -rf "$aside"
}

refuse() { log "Refusing: $*"; exit 2; }

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --target)       target="$2"; shift 2 ;;
      --staged)       staged="$2"; shift 2 ;;
      --keep)         keep="$2"; shift 2 ;;
      --status)       status="$2"; shift 2 ;;
      --from)         from="$2"; shift 2 ;;
      --to)           to="$2"; shift 2 ;;
      --pid)          pids+=("$2"); shift 2 ;;
      --wait)         wait="$2"; shift 2 ;;
      --grace)        grace="$2"; shift 2 ;;
      --confirm)      confirm="$2"; shift 2 ;;
      --confirm-wait) confirm_wait="$2"; shift 2 ;;
      --log)          log_file="$2"; shift 2 ;;
      --work)         work="$2"; shift 2 ;;
      --)             shift; relaunch=("$@"); break ;;
      *)              log "Unknown argument: $1"; exit 2 ;;
    esac
  done
  if [ -z "$target" ] || [ -z "$staged" ] || [ -z "$status" ] || [ -z "$to" ]; then
    log "Missing arguments: --target, --staged, --status and --to are needed."
    exit 2
  fi
  case "$target" in
    /*.app) ;;
    *) refuse "$target is not an app." ;;
  esac
  local n
  for n in "$wait" "$grace" "$confirm_wait" ${pids[@]+"${pids[@]}"}; do
    case "$n" in ''|*[!0-9]*) refuse "'$n' is not a whole number (--wait, --grace, --confirm-wait and --pid take one)." ;; esac
  done
  # Whatever is at --staged is removed after use, so it can only be the server's
  # staging folder beside the app (lib/updater.js stagingPath), never anything else.
  staged_expected="$(dirname "$target")/.$(basename "$target").incoming"
  [ "$staged" = "$staged_expected" ] || refuse "the new version must wait at $staged_expected, not $staged."
  case "$keep" in ''|/?*) ;; *) refuse "--keep must be a whole path." ;; esac
  case "$confirm" in ''|/*/update-confirmed.json) ;; *) refuse "--confirm must be a whole path to update-confirmed.json." ;; esac

  inside="$target/Contents/"
  # Both must be whole absolute paths: they are matched as prefixes of other
  # processes' executables, so a shortened one ("/Six Degrees.app/Contents/")
  # would match every copy of the app on this Mac.
  local parent_real
  if parent_real="$(cd "$(dirname "$target")" 2>/dev/null && pwd -P)" && [ "${parent_real#/}" != "$parent_real" ]; then
    inside_real="${parent_real%/}/$(basename "$target")/Contents/"
  else
    inside_real="$inside"
  fi
  # The server's folder for this run (the downloaded image, this script's copy).
  # Only ever one of its own.
  case "$(basename "${work:-x}")" in
    six-degrees-update-*) trap 'rm -rf "$work"' EXIT ;;
  esac
  # The named processes as they are now, so a number the system hands out again
  # later is never mistaken for them.
  local p
  for p in ${pids[@]+"${pids[@]}"}; do starts+=("$(started_at "$p")"); done

  log "Updating $target from ${from:-?} to $to."

  if ! wait_for_exit "$wait" "$grace"; then
    remove_staged
    write_status not-applied "the old version didn't close"
    open_app "$target" || log "Could not open it again."
    exit 1
  fi
  log "The old version has closed."

  if [ ! -d "$staged/Contents" ]; then
    write_status not-applied "the new version was missing when it was time to put it in place"
    open_app "$target"
    exit 1
  fi

  # Beside the old app, so this and putting it back are renames on one disk.
  local err=""
  if ! aside="$(unused_beside previous)"; then
    remove_staged
    write_status not-applied "there was no free name beside the app to move the old version to"
    open_app "$target"
    exit 1
  fi
  trap '' TERM INT HUP   # from here until something is in the app's place again
  if [ -e "$aside" ] || [ -L "$aside" ] || ! err="$(mv "$target" "$aside" 2>&1)"; then
    trap - TERM INT HUP
    remove_staged
    write_status not-applied "macOS didn't let Six Degrees move its old version aside (${err:-the name it chose was taken})"
    open_app "$target"
    exit 1
  fi
  log "Moved the old version aside, to $aside."

  if [ -e "$target" ] || [ -L "$target" ]; then
    put_back "something else appeared in the app's place"
    exit 1
  fi
  if ! err="$(mv "$staged" "$target" 2>&1)"; then
    log "Could not rename the new version into place ($err); copying it instead."
    if ! err="$(ditto "$staged" "$target" 2>&1)"; then
      put_back "it couldn't put the new version in place ($err)"
      exit 1
    fi
    remove_staged
  fi
  trap - TERM INT HUP
  log "The new version is in place."

  # Files the app downloads itself aren't normally quarantined; this is for the
  # case where the same image reached the Mac another way first.
  xattr -dr com.apple.quarantine "$target" 2>/dev/null

  if [ -n "$confirm" ]; then rm -f "$confirm"; fi   # an earlier update's word doesn't count
  if ! err="$(open_app "$target" 2>&1)"; then
    put_back "the new version wouldn't open ($err)"
    exit 1
  fi
  log "Opened the new version."

  # Until this is over, the status file still says "started" (the server wrote
  # it), which the new version, running, already reads as a success.
  if [ -n "$confirm" ]; then
    await_start
    case $? in
      0) log "The new version has started." ;;
      1) put_back "the new version closed before it finished starting"
         exit 1 ;;
      *) log "The new version hasn't said it has started after ${confirm_wait}s. Leaving it running." ;;
    esac
    rm -f "$confirm"
  fi

  keep_previous
  write_status installed
  exit 0
}

main "$@"
