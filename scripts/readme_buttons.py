#!/usr/bin/env python3
"""Draw the README's download buttons.

A GitHub README can't style links, so the buttons are pictures: drawn here from
HTML in Chrome, with the app icon inside, and saved at twice their shown size so
they stay sharp. Each has its own background, so it reads on GitHub's light and
dark themes alike. No server needed:

    python3 scripts/readme_buttons.py

Requires playwright (pip3 install playwright) and Google Chrome. Redraw whenever
the icon (desktop/icon/icon.svg) or the wording changes.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "img"
ICON = (ROOT / "desktop" / "icon" / "icon.svg").read_text()
# The icon's artwork sits in its 1024 canvas with a margin (the macOS grid).
# Cropping to the rounded square lets it fill its spot in the button.
ICON = ICON.replace('viewBox="0 0 1024 1024" width="1024" height="1024"',
                    'viewBox="100 100 824 824" width="56" height="56"')

ARROW = """<svg class="arrow" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
  <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/>
  <path d="M12 6.5v9M7.8 11.6 12 15.8l4.2-4.2" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/></svg>"""

# (file, top line, big line, bottom line, style)
BUTTONS = [
    ("download-apple-silicon.png", "Click to download for Mac", "Apple Silicon", "M1 or newer", "green"),
    ("download-intel.png",         "Click to download for Mac", "Intel",         "Macs with an Intel chip", "slate"),
]

CSS = """
* { box-sizing: border-box; margin: 0; }
body { background: transparent; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
       -webkit-font-smoothing: antialiased; }
.pad { display: inline-block; padding: 6px 8px 12px; }
.btn { display: flex; align-items: center; gap: 16px; width: 330px; padding: 13px 18px 13px 14px;
       border-radius: 16px; color: #fff; }
.green { background: linear-gradient(180deg, #2ea44f 0%, #1f883d 55%, #1a7f37 100%);
         box-shadow: 0 1px 0 rgba(255,255,255,.25) inset, 0 0 0 1px rgba(0,0,0,.12), 0 6px 16px rgba(26,127,55,.35); }
.slate { background: linear-gradient(180deg, #3a414a 0%, #2b3137 55%, #24292f 100%);
         box-shadow: 0 1px 0 rgba(255,255,255,.16) inset, 0 0 0 1px rgba(255,255,255,.14), 0 6px 16px rgba(0,0,0,.28); }
.icon { flex: none; width: 56px; height: 56px; border-radius: 13px; overflow: hidden;
        box-shadow: 0 0 0 1px rgba(255,255,255,.18), 0 2px 6px rgba(0,0,0,.35); }
.icon svg { display: block; }
.text { flex: 1; min-width: 0; line-height: 1.15; }
.top { font-size: 12.5px; font-weight: 600; letter-spacing: .02em; opacity: .92; }
.big { font-size: 25px; font-weight: 800; letter-spacing: -.01em; margin: 2px 0 3px; }
.sub { font-size: 13.5px; font-weight: 500; opacity: .88; }
.arrow { flex: none; color: #fff; }
"""


def button_html(top, big, sub, style):
    return f"""<!doctype html><html><head><style>{CSS}</style></head><body>
<div class="pad" id="shot"><div class="btn {style}">
  <div class="icon">{ICON}</div>
  <div class="text"><div class="top">{top}</div><div class="big">{big}</div><div class="sub">{sub}</div></div>
  {ARROW}
</div></div></body></html>"""


def main():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 600, "height": 200}, device_scale_factor=2)
        for name, top, big, sub, style in BUTTONS:
            page.set_content(button_html(top, big, sub, style))
            page.locator("#shot").screenshot(path=str(OUT / name), omit_background=True)
            print(f"  wrote docs/img/{name}")
        browser.close()


if __name__ == "__main__":
    main()
