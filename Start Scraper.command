#!/bin/bash
# Double-click this file to start the scraper server.
# Then use the buttons on the Setup page — no terminal needed.

cd "$(dirname "$0")"
echo ""
echo "  ================================================"
echo "  Starting 6 Degrees Scraper Server..."
echo "  ================================================"
echo ""
echo "  Once you see 'Running on http://localhost:5555',"
echo "  go to the Setup tab on your site and use the buttons."
echo ""
echo "  Close this window to stop the server."
echo ""

python3 scripts/scrape.py --server
