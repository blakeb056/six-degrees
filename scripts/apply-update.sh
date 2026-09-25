#!/bin/bash
# Put a new version of Six Degrees in place of the one that just quit, and open it.
#
# The app's server starts this (lib/updater-job.js) after it has downloaded the
# new version, checked it against the release's SHA256SUMS and its signature,
# and copied it into a hidden folder beside the running app. Then the app quits.
# Everything slow or likely to fail has already happened by then. What is left:
#
#   1. Wait until nothing runs from the old app: the app and its server (the
#      --pid values), and anything else whose command or working folder is
#      inside it. The server can only be found by its folder, because Next
#      renames its process (TRAPS §26). After --wait seconds, stop what is left
#      of the old app: SIGTERM, then SIGKILL after --grace seconds.
#   2. Rename the old app aside, in the same folder (it is never deleted first),
#      then rename the new one into its place, or copy it with ditto if a rename
#      can't do it.
#   3. Clear the quarantine flag and open it, with the app's own arguments.
#   4. Keep the old version, one copy, as a zip in --keep, and write the outcome
#      to --status. The app reads that file on its next start and shows it in
#      Settings → Updates.
#
# If anything fails after the old app was moved, the old app is put back and
# opened again. install.sh can't do that, because it deletes first.
#
# Every value comes from the server. Nothing comes from a web page.
#
#   apply-update.sh --target APP --staged DIR --status FILE --from VERSION --to VERSION
#                   [--keep DIR] [--pid PID]... [--wait SECONDS] [--grace SECONDS]
#                   [--log FILE] [--work DIR] [-- ARGUMENTS FOR THE NEW APP...]
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

OPEN=/usr/bin/open
if [ "${SIX_DEGREES_UPDATER_TEST:-}" = 1 ] && [ -n "${SIX_DEGREES_UPDATER_OPEN:-}" ]; then
  OPEN="$SIX_DEGREES_UPDATER_OPEN"
fi

target="" staged="" keep="" status="" from="" to="" wait=30 grace=5 log_file="" work=""
pids=()
relaunch=()
inside=""        # "<target>/Contents/", as given
inside_real=""   # the same with symlinks resolved, as lsof reports working folders
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

# Is this process one of the old app's? Its command, or its working folder, is
# inside the app. Fixed-string comparisons: an app renamed "Six Degrees (1).app"
# must not be read as a pattern. And a path counts only where an argument
# starts with it: "/x/Six Degrees.app/Contents/" must not match inside
# "/Applications/x/Six Degrees.app/Contents/", another copy of the app.
belongs() {   # pid
  local cmd cwd
  cmd="$(ps -o command= -p "$1" 2>/dev/null)" || return 1
  case "$cmd" in "$inside"*|*" $inside"*|"$inside_real"*|*" $inside_real"*) return 0 ;; esac
  cwd="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  case "$cwd/" in "$inside"*|"$inside_real"*) return 0 ;; esac
  return 1
}

# Every other process running from inside the old app, one pid per line.
swept() {
  # By command: the app itself and Electron's helper processes. ps puts a space
  # between the pid and the command, so " <path>" finds a command or argument
  # that starts with the path. The paths reach awk through the environment, so
  # awk's own command line can't match them.
  ps -axo pid=,command= | A=" $inside" B=" $inside_real" awk -v me="$$" \
    '(index($0, ENVIRON["A"]) || index($0, ENVIRON["B"])) && $1 != me && index($0, "apply-update.sh") == 0 { print $1 }'
  # By working folder: the server, whose command line Next rewrites.
  lsof -a -d cwd -Fpn 2>/dev/null | A="$inside" B="$inside_real" awk '
    /^p/ { pid = substr($0, 2) }
    /^n/ { dir = substr($0, 2) "/"; if (index(dir, ENVIRON["A"]) == 1 || index(dir, ENVIRON["B"]) == 1) print pid }'
}

as_line() { sort -un | tr '\n' ' ' | sed 's/ *$//'; }

# What is still to be waited for: the processes the server named (the app and
# its server) for as long as they live, and anything else running from the app.
waiting_now() {
  local p
  {
    for p in ${pids[@]+"${pids[@]}"}; do kill -0 "$p" 2>/dev/null && echo "$p"; done
    swept
  } | as_line
}

# What may be stopped: only processes that are provably the old app's, so a
# named pid the system has since given to something else is never touched.
stoppable_now() {
  local p
  {
    for p in ${pids[@]+"${pids[@]}"}; do kill -0 "$p" 2>/dev/null && belongs "$p" && echo "$p"; done
    swept
  } | as_line
}

# Wait for the old app to be gone; stop what's left of it after --wait seconds.
wait_for_exit() {
  local deadline left
  deadline=$((SECONDS + wait))
  while :; do
    left="$(waiting_now)"
    [ -z "$left" ] && return 0
    [ "$SECONDS" -ge "$deadline" ] && break
    sleep 0.25
  done
  left="$(stoppable_now)"
  if [ -n "$left" ]; then
    log "Still running after ${wait}s: $left. Asking them to stop."
    # shellcheck disable=SC2086  # a list of pids, split on purpose
    kill $left 2>/dev/null
    deadline=$((SECONDS + grace))
    while [ "$SECONDS" -lt "$deadline" ]; do
      sleep 0.25
      [ -z "$(stoppable_now)" ] && break
    done
    left="$(stoppable_now)"
    if [ -n "$left" ]; then
      log "Still running after ${grace}s more: $left. Stopping them."
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
  # A named process that doesn't run from the old app isn't one of its own any
  # more, and isn't this script's to stop. Nothing of the old app is left.
  left="$(waiting_now)"
  [ -n "$left" ] && log "Not waiting for $left any longer: it doesn't run from the old app."
  return 0
}

# Something failed after the old app was moved aside: put it back and open it.
put_back() {   # reason
  local reason="$1" err
  # Whatever is at the target now is the new version or part of one (a copy
  # that stopped half-way leaves a partial folder). The old app is at $aside.
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf "$target" 2>/dev/null
    if [ -e "$target" ] || [ -L "$target" ]; then
      # Something in it can't be deleted: move it out of the way instead.
      mv "$target" "$(dirname "$target")/.$(basename "$target").failed-$$" 2>/dev/null
    fi
  fi
  if err="$(mv "$aside" "$target" 2>&1)"; then
    rm -rf "$staged" 2>/dev/null
    write_status rolled-back "$reason"
    open_app "$target" || log "Could not open the previous version either."
  else
    kept="$aside"
    write_status failed "$reason; putting the previous version back failed too ($err)"
  fi
}

# Keep the old version, one copy, as a zip in --keep, until the next update.
# A zip, not the app itself: an app left in a folder can turn up in Spotlight
# beside the real one, and a Finder alias or a Dock icon may follow a moved
# folder rather than its old path (DESKTOP.md D4). Once the old folder is gone,
# both find the new one by its path, as they do after install.sh. It runs
# after the new version is open, at low priority, because it takes a while.
keep_previous() {
  local name version zip box f
  if [ -z "$keep" ]; then
    rm -rf "$aside"
    log "Removed the previous version."
    return
  fi
  name="$(basename "$target" .app)"
  version="${from//[^0-9A-Za-z._-]/}"
  zip="$keep/$name ${version:-previous}.zip"
  box="$keep/.previous-$$"
  mkdir -p "$box" 2>/dev/null
  # Under its own name, so unzipping it gives "Six Degrees.app".
  if mv "$aside" "$box/$name.app" 2>/dev/null \
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
  rm -rf "$box" "$aside"
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --target) target="$2"; shift 2 ;;
      --staged) staged="$2"; shift 2 ;;
      --keep)   keep="$2"; shift 2 ;;
      --status) status="$2"; shift 2 ;;
      --from)   from="$2"; shift 2 ;;
      --to)     to="$2"; shift 2 ;;
      --pid)    pids+=("$2"); shift 2 ;;
      --wait)   wait="$2"; shift 2 ;;
      --grace)  grace="$2"; shift 2 ;;
      --log)    log_file="$2"; shift 2 ;;
      --work)   work="$2"; shift 2 ;;
      --)       shift; relaunch=("$@"); break ;;
      *)        log "Unknown argument: $1"; exit 2 ;;
    esac
  done
  if [ -z "$target" ] || [ -z "$staged" ] || [ -z "$status" ] || [ -z "$to" ]; then
    log "Missing arguments: --target, --staged, --status and --to are needed."
    exit 2
  fi
  case "$target" in
    /*.app) ;;
    *) log "Refusing: $target is not an app."; exit 2 ;;
  esac
  local n
  for n in "$wait" "$grace" ${pids[@]+"${pids[@]}"}; do
    case "$n" in ''|*[!0-9]*) log "Refusing: '$n' is not a whole number (--wait, --grace and --pid take one)."; exit 2 ;; esac
  done
  inside="$target/Contents/"
  # Both must be whole absolute paths: they are matched anywhere in a command
  # line, so a shortened one ("/Six Degrees.app/Contents/") would match every
  # copy of the app on this Mac.
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

  log "Updating $target from ${from:-?} to $to."

  if ! wait_for_exit; then
    rm -rf "$staged"
    write_status not-applied "the old version didn't close"
    exit 1
  fi
  log "The old version has closed."

  if [ ! -d "$staged/Contents" ]; then
    write_status not-applied "the new version was missing when it was time to put it in place"
    open_app "$target"
    exit 1
  fi

  # Beside the old app, so this and putting it back are renames on one disk.
  aside="$(dirname "$target")/.$(basename "$target").previous-$$"
  local err
  if ! err="$(mv "$target" "$aside" 2>&1)"; then
    rm -rf "$staged"
    write_status not-applied "macOS didn't let Six Degrees move its old version aside ($err)"
    open_app "$target"
    exit 1
  fi
  log "Moved the old version aside."

  if ! err="$(mv "$staged" "$target" 2>&1)"; then
    log "Could not rename the new version into place ($err); copying it instead."
    if ! err="$(ditto "$staged" "$target" 2>&1)"; then
      put_back "it couldn't put the new version in place ($err)"
      exit 1
    fi
    rm -rf "$staged"
  fi
  log "The new version is in place."

  # Files the app downloads itself aren't normally quarantined; this is for the
  # case where the same image reached the Mac another way first.
  xattr -dr com.apple.quarantine "$target" 2>/dev/null

  if ! err="$(open_app "$target" 2>&1)"; then
    put_back "the new version wouldn't open ($err)"
    exit 1
  fi
  log "Opened the new version."

  # Until this line the status file still says "started" (the server wrote it),
  # which the new version, running, already reads as a success.
  keep_previous
  write_status installed
  exit 0
}

main "$@"
