// The tour's and the hints' look (lib/help.js). Every colour is the look's own
// (lib/themes.js CSS variables, Standard's values as fallbacks), so Daylight,
// Glass and the rest draw them their way; the card and the hint are glass
// panels (data-glass-panel) and their buttons take html[data-buttons] as every
// other button does. One <style>, as the guided setup carries its own.

export const HELP_CSS = `
.sdh { --sdh-dim: rgba(0, 0, 0, 0.58); --sdh-ink: var(--sd-ink, 255, 255, 255); --sdh-line: rgba(var(--sdh-ink), 0.12); }
html[data-mode="light"] .sdh { --sdh-dim: rgba(24, 28, 44, 0.34); }
.sdh, .sdh *, .sdh *::before, .sdh *::after { box-sizing: border-box; }

/* The tour: the whole window, a ring round what a step points at, and the card */
.sdh-tour { position: fixed; inset: 0; z-index: 1000; font-family: var(--sd-font); color: var(--sd-fg-1, #fff); }
.sdh-catch { position: absolute; inset: 0; }
.sdh-dim { position: absolute; inset: 0; background: var(--sdh-dim); pointer-events: none; }
.sdh-ring { position: absolute; border-radius: 14px; pointer-events: none; box-shadow: 0 0 0 200vmax var(--sdh-dim); outline: 2px solid var(--sd-accent, #3498db); outline-offset: 0; }
/* [data-glass-panel] makes a panel position: relative under frosted buttons (app/globals.css): these stay where they're put */
.sdh .sdh-card[data-glass-panel] { position: absolute; }
.sdh.sdh-hint[data-glass-panel] { position: fixed; }
.sdh-card { position: absolute; width: min(400px, calc(100vw - 32px)); padding: 20px 22px 16px; border-radius: 18px;
  background: var(--sd-panel, rgba(10, 15, 30, 0.86)); -webkit-backdrop-filter: var(--sd-panel-blur, blur(24px)); backdrop-filter: var(--sd-panel-blur, blur(24px));
  border: 1px solid var(--sdh-line); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45); }
.sdh-card.film { width: min(560px, calc(100vw - 32px)); }
.sdh-card.sheet { width: auto; right: 16px; max-height: calc(100vh - 32px); overflow-y: auto; }
.sdh-card.measuring { opacity: 0; }
.sdh-card:focus { outline: none; }
.sdh-head { display: flex; align-items: center; gap: 12px; }
.sdh-head .sdh-steps { margin-left: auto; }
.sdh-eyebrow { font-size: 11.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--sd-fg-3, #8e97aa); }
.sdh-title { font-size: 20px; line-height: 1.2; font-weight: 800; letter-spacing: -.01em; margin: 6px 0 8px; }
.sdh-body { font-size: 14px; line-height: 1.6; color: var(--sd-fg-2, #c3cbda); margin: 0; }
.sdh-foot { display: flex; align-items: center; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.sdh-spacer { flex: 1; }
.sdh-steps { display: flex; gap: 5px; align-items: center; }
.sdh-steps i { width: 6px; height: 6px; border-radius: 99px; background: rgba(var(--sdh-ink), 0.18); display: block; }
.sdh-steps i.done { background: rgba(var(--sdh-ink), 0.5); }
.sdh-steps i.now { width: 18px; background: var(--sd-fg-1, #fff); }

/* Buttons: plain, so a look's own button style (frosted or soft) does the rest */
.sdh-btn { height: 36px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--sdh-line); background: rgba(var(--sdh-ink), 0.07);
  color: var(--sd-fg-1, #fff); font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.sdh-btn.primary { background: var(--sd-fg-1, #fff); color: var(--sd-bg, #0a0a1a); border-color: transparent; }
.sdh-btn.quiet { height: 30px; padding: 0 10px; font-size: 12.5px; font-weight: 650; color: var(--sd-fg-3, #8e97aa); border-color: transparent; background: transparent; }
.sdh-btn.quiet:hover { color: var(--sd-fg-1, #fff); }
.sdh-btn:focus-visible { outline: 2px solid var(--sd-accent, #3498db); outline-offset: 2px; }
.sdh-btn:disabled { opacity: .45; cursor: default; }

/* The film, or the slot a later release fills */
.sdh-film { position: relative; aspect-ratio: 16 / 9; margin: 12px 0 14px; border-radius: 12px; overflow: hidden; border: 1px solid var(--sdh-line);
  background: radial-gradient(90% 80% at 80% 0%, color-mix(in srgb, var(--sd-tier-a, #9b59b6) 22%, transparent), transparent 60%),
              radial-gradient(80% 70% at 0% 100%, color-mix(in srgb, var(--sd-tier-b, #3498db) 16%, transparent), transparent 60%), rgba(var(--sdh-ink), 0.03); }
.sdh-film video { display: block; width: 100%; height: 100%; object-fit: cover; background: #000; }
.sdh-film svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.sdh-film-tag { position: absolute; left: 10px; bottom: 10px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700;
  color: var(--sd-fg-2, #c3cbda); background: color-mix(in srgb, var(--sd-bg, #0a0a1a) 72%, transparent); border: 1px dashed rgba(var(--sdh-ink), 0.4); }

/* A hint: one small card, out of the map's way */
.sdh-hint { position: fixed; right: 20px; bottom: 72px; z-index: 90; width: min(340px, calc(100vw - 24px)); display: flex; gap: 10px; align-items: flex-start;
  padding: 12px 12px 10px 14px; border-radius: 14px; font-family: var(--sd-font); font-size: 13px; line-height: 1.5; color: var(--sd-fg-2, #c3cbda);
  background: var(--sd-panel, rgba(10, 15, 30, 0.86)); -webkit-backdrop-filter: var(--sd-panel-blur, blur(24px)); backdrop-filter: var(--sd-panel-blur, blur(24px));
  border: 1px solid var(--sdh-line); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35); }
.sdh-hint-mark { color: var(--sd-gold, #ffd700); font-size: 14px; line-height: 1.45; flex-shrink: 0; }
html[data-mode="light"] .sdh-hint-mark { color: #b8860b; }
.sdh-hint p { margin: 0; color: var(--sd-fg-1, #fff); }
.sdh-hint-actions { display: flex; gap: 2px; margin: 6px 0 0 -10px; flex-wrap: wrap; }
@media (max-width: 599px) {
  .sdh-hint { left: 12px; right: 12px; bottom: 12px; width: auto; }
}

@keyframes sdhIn { from { opacity: 0; transform: translateY(6px) scale(.985); } }
@keyframes sdhFade { from { opacity: 0; } }
@media (prefers-reduced-motion: no-preference) {
  .sdh-card:not(.measuring) { animation: sdhIn .28s cubic-bezier(.2, .8, .2, 1) both; }
  .sdh-ring { transition: top .32s cubic-bezier(.2, .8, .2, 1), left .32s cubic-bezier(.2, .8, .2, 1), width .32s cubic-bezier(.2, .8, .2, 1), height .32s cubic-bezier(.2, .8, .2, 1); }
  .sdh-dim, .sdh-ring { animation: sdhFade .25s ease-out both; }
  .sdh-hint { animation: sdhIn .3s cubic-bezier(.2, .8, .2, 1) both; }
}
@media (prefers-contrast: more) {
  .sdh-ring { outline-width: 3px; }
  .sdh-card, .sdh-hint { border-color: rgba(var(--sdh-ink), 0.45); }
}
`;
