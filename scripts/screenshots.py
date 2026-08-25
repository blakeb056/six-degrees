#!/usr/bin/env python3
"""Capture the README screenshots.

Runs against the sample network only, so nothing published here shows a real
person. Regenerate with the dev server running:

    npm run dev
    python3 scripts/screenshots.py

Requires playwright (pip3 install playwright && python3 -m playwright install chromium).
"""
import json
import pathlib
import sys
import urllib.request

BASE = "http://localhost:3000"
if len(sys.argv) > 1:
    BASE = sys.argv[1].rstrip("/")

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "img"
SHOTS = [
    ("galaxy.png",  "/",       "Network Circle"),
    ("bridges.png", "/",       "Bridges"),
    ("paths.png",   "/paths",  None),
    ("import.png",  "/import", None),
]


def main():
    from playwright.sync_api import sync_playwright

    try:
        with urllib.request.urlopen(f"{BASE}/demo-data.json", timeout=10) as r:
            demo = json.load(r)
    except Exception as e:
        sys.exit(f"Could not read {BASE}/demo-data.json — is the dev server running? ({e})")

    seed = json.dumps({
        "degree1": demo["degree1"],
        "degree2": demo["degree2"],
        "source": "sample",
        "importedAt": 0,
    })

    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        # Seed identity + the sample network before any page script runs.
        ctx.add_init_script(f"""
            localStorage.setItem('six-degrees-user-id', 'sample-viewer');
            localStorage.setItem('six-degrees-user-name', 'You');
            sessionStorage.setItem('six-degrees-csv-network', {json.dumps(seed)});
        """)
        page = ctx.new_page()

        for name, path, tab in SHOTS:
            page.goto(f"{BASE}{path}", wait_until="networkidle")
            page.wait_for_timeout(2500)          # let the force simulation settle
            if tab:
                try:
                    page.get_by_role("button", name=tab).click()
                    page.wait_for_timeout(3000)
                except Exception:
                    print(f"  ! could not switch to {tab}")
            page.screenshot(path=str(OUT / name))
            print(f"  wrote docs/img/{name}")

        browser.close()

    print(f"\ndone — {len(SHOTS)} screenshots in {OUT}")
    print("every person shown is invented (see scripts/gen-synthetic.mjs)")


if __name__ == "__main__":
    main()
