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
# (file, path, nav button to press, JavaScript to run before the shot)
OPEN_NORTHWIND = """() => { const g = [...document.querySelectorAll('svg g')]
  .find((el) => el.querySelector(':scope > title')?.textContent.startsWith('Northwind Labs'));
  g && g.dispatchEvent(new MouseEvent('click', { bubbles: true })); }"""
SHOTS = [
    ("galaxy.png",  "/",       "Network Circle", None),
    ("degrees.png", "/",       "Degrees",        None),
    ("paths.png",   "/paths",  None,             OPEN_NORTHWIND),
    ("import.png",  "/import", None,             None),
]


def compose_app_window(browser):
    """The README's top image: the network view inside a Mac app window, as the
    desktop app shows it. The frame is drawn here; what is inside it is the
    real screenshot taken above."""
    import base64
    shot = base64.b64encode((OUT / "galaxy.png").read_bytes()).decode()
    html = f"""<!doctype html><html><body style="margin:0;background:transparent">
<div id="stage" style="padding:56px 64px 72px;background:radial-gradient(ellipse at 50% 35%,#2a2350 0%,#12102a 55%,#0b0a1c 100%);display:inline-block">
  <div style="width:1440px;border-radius:12px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08)">
    <div style="height:30px;background:#1c1b2e;display:flex;align-items:center;position:relative;border-bottom:1px solid rgba(255,255,255,.06)">
      <span style="margin-left:14px;width:12px;height:12px;border-radius:50%;background:#ff5f57"></span>
      <span style="margin-left:8px;width:12px;height:12px;border-radius:50%;background:#febc2e"></span>
      <span style="margin-left:8px;width:12px;height:12px;border-radius:50%;background:#28c840"></span>
      <span style="position:absolute;left:0;right:0;text-align:center;font:600 13px -apple-system,BlinkMacSystemFont,sans-serif;color:rgba(255,255,255,.72)">Six Degrees</span>
    </div>
    <img src="data:image/png;base64,{shot}" style="display:block;width:1440px;height:900px">
  </div>
</div></body></html>"""
    page = browser.new_page(viewport={"width": 1700, "height": 1100}, device_scale_factor=2)
    page.set_content(html)
    page.locator("#stage").screenshot(path=str(OUT / "app-window.png"))
    page.close()
    print("  wrote docs/img/app-window.png")


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
        # The installed Chrome if there is one (no extra download); otherwise
        # Playwright's own Chromium.
        try:
            browser = p.chromium.launch(channel="chrome")
        except Exception:
            browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        # Seed identity + the sample network before any page script runs.
        ctx.add_init_script(f"""
            localStorage.setItem('six-degrees-user-id', 'sample-viewer');
            localStorage.setItem('six-degrees-user-name', 'You');
            sessionStorage.setItem('six-degrees-csv-network', {json.dumps(seed)});
        """)
        page = ctx.new_page()

        for name, path, tab, script in SHOTS:
            page.goto(f"{BASE}{path}", wait_until="networkidle")
            page.wait_for_timeout(2500)          # let the force simulation settle
            if tab:
                try:
                    page.get_by_role("button", name=tab).click()
                    page.wait_for_timeout(3000)
                except Exception:
                    print(f"  ! could not switch to {tab}")
            if script:
                page.evaluate(script)
                page.wait_for_timeout(1500)
            page.screenshot(path=str(OUT / name))
            print(f"  wrote docs/img/{name}")

        compose_app_window(browser)
        browser.close()

    print(f"\ndone — {len(SHOTS) + 1} images in {OUT}")
    print("every person shown is invented (see scripts/gen-synthetic.mjs)")


if __name__ == "__main__":
    main()
