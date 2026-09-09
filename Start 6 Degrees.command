#!/bin/bash
# Double-click this to start 6 Degrees. Nothing to type.
#
# It starts the app and opens it in your browser. Everything else —
# installing the scraper, signing into LinkedIn, scanning your network —
# happens with buttons inside the app, on the Scan page.
#
# Leave this window open while you use it. Close it to stop.

cd "$(dirname "$0")" || exit 1

echo ""
echo "  ============================================"
echo "   6 Degrees"
echo "  ============================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed."
  echo "  Get it from https://nodejs.org (choose the LTS download),"
  echo "  then double-click this file again."
  echo ""
  read -r -p "  Press return to close. "
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  First run — installing. This takes a minute."
  echo ""
  npm install || { echo ""; echo "  Install failed. Scroll up for the reason."; read -r -p "  Press return to close. "; exit 1; }
fi

PORT="${PORT:-3000}"
echo "  Starting on http://localhost:$PORT"
echo "  Your browser will open in a few seconds."
echo ""
echo "  Keep this window open. Close it to stop 6 Degrees."
echo ""

( sleep 5; open "http://localhost:$PORT" ) &

npm run dev
