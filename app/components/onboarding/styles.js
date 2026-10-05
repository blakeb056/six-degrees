// The guided setup's look. Every colour is the look's own (lib/themes.js CSS
// variables, with Standard's values as fallbacks), so Daylight, Glass, Analyst
// and the rest draw it their way, and html[data-buttons] shapes its buttons as
// it shapes every other. One <style> for the whole setup, as ClusterSpinner
// and the Scan page carry theirs.

export const ONBOARDING_CSS = `
.ob {
  --ob-fg1: var(--sd-fg-1, #fff); --ob-fg2: var(--sd-fg-2, #c3cbda); --ob-fg3: var(--sd-fg-3, #8e97aa); --ob-fg4: var(--sd-fg-4, #646b80);
  --ob-ink: var(--sd-ink, 255, 255, 255);
  --ob-line: rgba(var(--ob-ink), 0.09); --ob-line2: rgba(var(--ob-ink), 0.16);
  --ob-surface: rgba(var(--ob-ink), 0.035);
  --ob-green: var(--sd-green, #00ff88);
  --ob-green-soft: color-mix(in srgb, var(--ob-green) 11%, transparent);
  --ob-green-line: color-mix(in srgb, var(--ob-green) 40%, transparent);
  --ob-gold: var(--sd-gold, #FFD700);
  --ob-red: var(--sd-red, #ff6b6b);
  --ob-s: var(--sd-tier-s, #ffd700); --ob-a: var(--sd-tier-a, #9b59b6); --ob-b: var(--sd-tier-b, #3498db); --ob-c: var(--sd-tier-c, #95a5a6); --ob-d: var(--sd-tier-d, #bdc3c7);
  --ob-solid: var(--sd-card, #12142a);
  position: relative; min-height: 100vh; height: 100vh; display: flex; flex-direction: column;
  color: var(--ob-fg1); font-family: var(--sd-font); background: var(--sd-page);
}
.ob::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: -1;
  background: radial-gradient(70% 55% at 50% -10%, color-mix(in srgb, var(--sd-bg2, #1a1440) 70%, transparent), transparent 70%); }
.ob *, .ob *::before, .ob *::after { box-sizing: border-box; }
.ob button { font: inherit; color: inherit; cursor: pointer; }
.ob a { color: inherit; }

/* Top: the name, where you are, and the way out */
.ob-top { height: 68px; flex-shrink: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 36px; }
.ob-mark { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; white-space: nowrap; justify-self: start;
  background: linear-gradient(135deg, #FFD700, #9B59B6, #3498DB); -webkit-background-clip: text; background-clip: text; color: transparent; }
html[data-mode="light"] .ob-mark { background-image: linear-gradient(135deg, #d99a00, #8e44ad, #2f80ed); }
.ob-dots { display: flex; gap: 8px; align-items: center; }
.ob-dots button { width: 8px; height: 8px; padding: 0; border: 0; border-radius: 99px; background: rgba(var(--ob-ink), 0.16); transition: width .4s cubic-bezier(.2,.8,.2,1), background .4s; }
.ob-dots button.done { background: rgba(var(--ob-ink), 0.5); }
.ob-dots button.now { width: 30px; background: var(--ob-fg1); }
.ob-dots button:disabled { cursor: default; }
.ob-out { justify-self: end; font-size: 13px; color: var(--ob-fg3); white-space: nowrap; }
.ob-out a, .ob-out button { background: none; border: 0; padding: 0; color: var(--ob-fg2); text-decoration: underline; text-decoration-color: rgba(var(--ob-ink), 0.25); text-underline-offset: 3px; font-size: 13px; }

/* The card: words on the left, a picture of what's happening on the right */
.ob-card { flex: 1 1 auto; min-height: 0; width: min(1220px, calc(100% - 72px)); margin: 0 auto 36px; display: grid;
  grid-template-columns: minmax(0, 620px) minmax(0, 1fr); border-radius: 28px; overflow: hidden;
  background: var(--sd-panel, rgba(10, 15, 30, 0.65)); -webkit-backdrop-filter: var(--sd-panel-blur, blur(24px)); backdrop-filter: var(--sd-panel-blur, blur(24px));
  border: 1px solid var(--ob-line); box-shadow: 0 40px 120px rgba(0, 0, 0, 0.35); }
.ob-left { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.ob-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 44px 52px 8px 56px; display: flex; flex-direction: column; gap: 10px; }
.ob-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--ob-fg3); }
.ob h1 { font-size: 42px; line-height: 1.08; letter-spacing: -.028em; font-weight: 800; margin: 12px 0 14px; }
.ob-lede { font-size: 16.5px; line-height: 1.6; color: var(--ob-fg2); max-width: 500px; margin: 0 0 14px; }
.ob-foot { flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 16px 52px 28px 56px; }
.ob-foot .ob-spacer { flex: 1; }
.ob-hint { font-size: 13px; color: var(--ob-fg4); text-align: right; }
.ob-ill { margin: 14px; border-radius: 20px; position: relative; overflow: hidden; min-width: 0; border: 1px solid var(--ob-line);
  background: radial-gradient(110% 80% at 80% 0%, color-mix(in srgb, var(--ob-a) 22%, transparent), transparent 60%),
              radial-gradient(90% 70% at 0% 100%, color-mix(in srgb, var(--ob-b) 14%, transparent), transparent 60%), rgba(var(--ob-ink), 0.02); }
.ob-ill > div { position: absolute; inset: 0; }

/* Moving between steps */
@keyframes obIn { from { opacity: 0; transform: translateX(calc(28px * var(--dir, 1))); } }
@keyframes obOut { to { opacity: 0; transform: translateX(calc(-28px * var(--dir, 1))); } }
@keyframes obFade { from { opacity: 0; transform: scale(.985); } }
@keyframes obPop { from { opacity: 0; transform: scale(.6); } }
@keyframes obRise { from { opacity: 0; transform: translateY(10px); } }
.ob-step-in .ob-left { animation: obIn .36s cubic-bezier(.2,.8,.2,1) both; }
.ob-step-in .ob-ill > div { animation: obFade .42s cubic-bezier(.2,.8,.2,1) both; }
.ob-step-out .ob-left { animation: obOut .2s ease-in both; }
.ob-step-out .ob-ill > div { animation: obOut .2s ease-in both; }
.ob-pop { animation: obPop .45s cubic-bezier(.2,.9,.3,1.35) both; }
.ob-rise { animation: obRise .45s cubic-bezier(.2,.8,.2,1) both; }

/* Buttons */
.ob-btn { display: inline-flex; align-items: center; justify-content: center; gap: 9px; height: 46px; padding: 0 24px; border-radius: 12px; border: 0;
  font-size: 15.5px; font-weight: 700; white-space: nowrap; text-decoration: none; transition: transform .15s ease, opacity .2s, background .2s; }
.ob-btn.primary { background: var(--ob-fg1); color: var(--sd-bg, #0a0a1a); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18); }
.ob-btn.primary:not(:disabled):hover { transform: translateY(-1px); }
.ob-btn.primary:disabled { background: rgba(var(--ob-ink), 0.08); color: var(--ob-fg4); box-shadow: none; cursor: default; }
.ob-btn.lg { height: 52px; padding: 0 30px; font-size: 16.5px; border-radius: 14px; }
.ob-btn.ghost { background: none; color: var(--ob-fg2); padding: 0 14px; }
.ob-btn.ghost:hover { color: var(--ob-fg1); background: rgba(var(--ob-ink), 0.05); }
.ob-btn.secondary { background: rgba(var(--ob-ink), 0.07); color: var(--ob-fg1); border: 1px solid var(--ob-line2); }
.ob-btn.small { height: 34px; padding: 0 14px; font-size: 13.5px; border-radius: 9px; gap: 7px; }
.ob-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
.ob-btn.small svg { width: 14px; height: 14px; }
.ob-link { background: none; border: 0; padding: 0; color: var(--ob-fg2); text-decoration: underline; text-decoration-color: rgba(var(--ob-ink), 0.25); text-underline-offset: 3px; font-size: inherit; }

/* Small pieces */
.ob-ico { width: 18px; height: 18px; flex-shrink: 0; }
.ob-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 999px; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
.ob-chip.ok { color: var(--ob-green); background: var(--ob-green-soft); border: 1px solid var(--ob-green-line); }
.ob-chip.wait { color: var(--ob-fg2); background: rgba(var(--ob-ink), 0.05); border: 1px solid var(--ob-line2); }
.ob-chip svg { width: 13px; height: 13px; }
.ob-tag { display: inline-block; font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; vertical-align: 2px; }
.ob-tag.rec { background: var(--ob-gold); color: #0a0a1a; }
html[data-mode="light"] .ob-tag.rec { background: #f5c542; color: #3a2a00; }
.ob-tag.opt { background: rgba(var(--ob-ink), 0.07); color: var(--ob-fg3); }
.ob-tag.exp { background: color-mix(in srgb, var(--ob-gold) 12%, transparent); color: var(--ob-gold); border: 1px solid color-mix(in srgb, var(--ob-gold) 35%, transparent); }
.ob-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(var(--ob-ink), 0.18); border-top-color: var(--ob-fg1); animation: obSpin .8s linear infinite; display: inline-block; flex-shrink: 0; }
@keyframes obSpin { to { transform: rotate(360deg); } }
.ob-dotsl { display: inline-flex; gap: 4px; align-items: center; }
.ob-dotsl i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .25; animation: obLive 1.2s ease-in-out infinite; display: block; }
.ob-dotsl i:nth-child(2) { animation-delay: .18s; } .ob-dotsl i:nth-child(3) { animation-delay: .36s; }
@keyframes obLive { 40% { opacity: 1; transform: translateY(-2px); } }
.ob-error { font-size: 13.5px; line-height: 1.5; color: var(--ob-red); padding: 10px 14px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--ob-red) 35%, transparent); background: color-mix(in srgb, var(--ob-red) 7%, transparent); white-space: pre-wrap; }

/* Welcome */
.ob-choice { display: flex; gap: 14px; align-items: center; width: 100%; text-align: left; padding: 15px 18px; border-radius: 15px; border: 1px solid var(--ob-line); background: var(--ob-surface); transition: border-color .2s, background .2s; }
.ob-choice:hover { border-color: var(--ob-line2); }
.ob-choice.sel { border-color: rgba(var(--ob-ink), 0.55); background: rgba(var(--ob-ink), 0.06); box-shadow: 0 0 0 3px rgba(var(--ob-ink), 0.05); }
.ob-choice .ci { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: rgba(var(--ob-ink), 0.06); color: var(--ob-fg2); flex-shrink: 0; }
.ob-choice .ci svg { width: 21px; height: 21px; }
.ob-choice .ct { font-size: 16px; font-weight: 750; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.ob-choice .cd { display: block; font-size: 13.5px; color: var(--ob-fg3); line-height: 1.5; margin-top: 2px; }
.ob-choice .cn { display: block; font-size: 12.5px; color: var(--ob-gold); line-height: 1.45; margin-top: 4px; }
.ob-radio { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--ob-line2); margin-left: auto; flex-shrink: 0; display: grid; place-items: center; }
.ob-choice.sel .ob-radio { border-color: var(--ob-fg1); }
.ob-choice.sel .ob-radio::after { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--ob-fg1); }
.ob-quiet { font-size: 13px; color: var(--ob-fg3); }

/* Get ready */
.ob-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ob-pair.wide { grid-template-columns: minmax(0, 1fr) 170px; }
.ob-mini { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 15px; border: 1px solid var(--ob-line); background: var(--ob-surface); min-width: 0; }
.ob-mini.ok { border-color: var(--ob-green-line); }
.ob-mini.no { border-color: var(--ob-line2); }
.ob-mini .ri { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--ob-green-soft); color: var(--ob-green); flex-shrink: 0; }
.ob-mini.no .ri { background: rgba(var(--ob-ink), 0.06); color: var(--ob-fg2); }
.ob-mini .rt { font-size: 14.5px; font-weight: 750; white-space: nowrap; }
.ob-mini .rd { font-size: 12.5px; color: var(--ob-fg3); line-height: 1.4; }
.ob-pair.wide .ob-mini.ok .rd { display: none; }
.ob-mini .end { margin-left: auto; }
.ob-row { display: grid; grid-template-columns: 40px 1fr auto; column-gap: 14px; row-gap: 8px; align-items: center; padding: 12px 14px; border-radius: 15px; border: 1px solid var(--ob-line); background: var(--ob-surface); }
.ob-row .ri { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; background: rgba(var(--ob-ink), 0.06); color: var(--ob-fg2); }
.ob-row.ok { border-color: var(--ob-green-line); background: var(--ob-green-soft); }
.ob-row.ok .ri { background: var(--ob-green-soft); color: var(--ob-green); }
.ob-row.attn { border-color: rgba(var(--ob-ink), 0.26); background: rgba(var(--ob-ink), 0.05); }
.ob-row.bad { border-color: color-mix(in srgb, var(--ob-red) 35%, transparent); }
.ob-row .rt { font-size: 15px; font-weight: 750; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ob-row .rd { font-size: 13px; color: var(--ob-fg3); line-height: 1.45; margin-top: 1px; }
.ob-row .rx { grid-column: 2 / 4; }
.ob-row .rx p { font-size: 13px; color: var(--ob-fg3); line-height: 1.5; margin: 0; }
.ob-row .acts { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
.ob-consent { position: relative; display: grid; grid-template-columns: 22px 1fr; gap: 12px; padding: 14px 16px; border-radius: 15px; border: 1px solid var(--ob-line2); background: var(--ob-surface); text-align: left; width: 100%; }
.ob-consent.on { border-color: var(--ob-green-line); cursor: default; }
.ob-consent .ct { font-size: 15px; font-weight: 750; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ob-consent ul { margin: 7px 0 0; padding-left: 16px; color: var(--ob-fg3); font-size: 12.5px; line-height: 1.5; }
.ob-consent li { margin-bottom: 2px; }
.ob-check { width: 22px; height: 22px; border-radius: 7px; border: 2px solid var(--ob-line2); background: rgba(var(--ob-ink), 0.04); display: grid; place-items: center; transition: background .2s, border-color .2s; }
.ob-check svg { width: 14px; height: 14px; opacity: 0; transform: scale(.4); transition: opacity .2s, transform .25s cubic-bezier(.2,.9,.3,1.4); color: var(--sd-bg, #04140c); }
.ob-consent.on .ob-check { background: var(--ob-green); border-color: var(--ob-green); }
.ob-consent.on .ob-check svg { opacity: 1; transform: none; }
.ob-consent:not(.on) { cursor: pointer; }
.ob-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.ob-consent:has(.ob-sr:focus-visible) .ob-check { outline: 2px solid var(--sd-accent, #3498db); outline-offset: 2px; }

/* Connect */
.ob-status { display: flex; gap: 18px; align-items: center; padding: 20px 22px; border-radius: 18px; border: 1px solid var(--ob-line); background: var(--ob-surface); }
.ob-status .orb { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0; position: relative; background: rgba(var(--ob-ink), 0.06); color: var(--ob-fg3); }
.ob-status .orb svg { width: 26px; height: 26px; }
.ob-status .st { font-size: 21px; font-weight: 800; letter-spacing: -.01em; display: flex; align-items: center; gap: 10px; }
.ob-status .sd { font-size: 14px; color: var(--ob-fg3); line-height: 1.55; margin-top: 3px; }
.ob-status .sa { margin-top: 8px; }
.ob-status.waiting { border-color: var(--ob-line2); background: rgba(var(--ob-ink), 0.05); }
.ob-status.waiting .orb { color: var(--ob-fg1); }
.ob-status.waiting .orb::before, .ob-status.waiting .orb::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(var(--ob-ink), 0.5); animation: obRipple 2s ease-out infinite; }
.ob-status.waiting .orb::after { animation-delay: 1s; }
@keyframes obRipple { from { transform: scale(1); opacity: .9; } to { transform: scale(1.4); opacity: 0; } }
.ob-status.ok { border-color: var(--ob-green-line); background: var(--ob-green-soft); }
.ob-status.ok .orb { background: var(--ob-green); color: var(--sd-bg, #04140c); box-shadow: 0 0 0 6px var(--ob-green-soft); }
.ob-status.ok .st { color: var(--ob-green); }
.ob-promises { display: grid; gap: 8px; margin-top: 6px; padding: 2px 4px; }
.ob-promises div { display: flex; gap: 10px; align-items: center; font-size: 14px; color: var(--ob-fg2); }
.ob-promises svg { width: 16px; height: 16px; color: var(--ob-green); flex-shrink: 0; }
.ob-note { display: flex; gap: 12px; padding: 13px 16px; border-radius: 14px; background: rgba(var(--ob-ink), 0.035); border: 1px dashed var(--ob-line2); font-size: 13px; line-height: 1.55; color: var(--ob-fg3); margin-top: 6px; }
.ob-note svg { width: 18px; height: 18px; color: var(--ob-fg2); margin-top: 1px; flex-shrink: 0; }
.ob-note b { color: var(--ob-fg2); font-weight: 650; }

/* Pace */
.ob-label { font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--ob-fg3); margin: 4px 0 -2px; }
.ob-seg3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.ob-seg { text-align: left; padding: 12px 14px; border-radius: 13px; border: 1px solid var(--ob-line); background: var(--ob-surface); }
.ob-seg .sn { font-size: 15.5px; font-weight: 800; }
.ob-seg .sv { font-size: 12.5px; color: var(--ob-fg3); margin-top: 2px; }
.ob-seg.sel { border-color: rgba(var(--ob-ink), 0.6); background: rgba(var(--ob-ink), 0.07); box-shadow: 0 0 0 3px rgba(var(--ob-ink), 0.05); }
.ob-hintline { font-size: 13.5px; color: var(--ob-fg3); line-height: 1.5; padding: 0 2px; }
.ob-hintline.warn { color: var(--ob-gold); }
.ob-daily { display: flex; gap: 8px; flex-wrap: wrap; }
.ob-dchip { height: 40px; padding: 0 16px; border-radius: 11px; border: 1px solid var(--ob-line); background: var(--ob-surface); font-weight: 750; font-size: 14.5px; display: inline-flex; align-items: center; gap: 7px; }
.ob-dchip small { font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ob-fg3); }
.ob-dchip.sel { border-color: rgba(var(--ob-ink), 0.6); background: rgba(var(--ob-ink), 0.08); }
.ob-dchip.sel.risky { border-color: color-mix(in srgb, var(--ob-gold) 40%, transparent); background: color-mix(in srgb, var(--ob-gold) 10%, transparent); color: var(--ob-gold); }
.ob-warn { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 13.5px; line-height: 1.5; color: var(--ob-gold); padding: 10px 14px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--ob-gold) 35%, transparent); background: color-mix(in srgb, var(--ob-gold) 6%, transparent); }
.ob-warn span { flex: 1 1 260px; }
.ob-auto { display: flex; gap: 14px; align-items: center; padding: 13px 16px; border-radius: 15px; border: 1px solid var(--ob-line); background: var(--ob-surface); margin-top: 6px; width: 100%; text-align: left; }
.ob-auto .at { font-size: 15px; font-weight: 750; display: flex; gap: 8px; align-items: center; }
.ob-auto .ad { font-size: 13px; color: var(--ob-fg3); line-height: 1.45; margin-top: 2px; }
.ob-toggle { width: 42px; height: 25px; border-radius: 999px; background: rgba(var(--ob-ink), 0.16); position: relative; flex-shrink: 0; margin-left: auto; transition: background .25s; }
.ob-toggle::after { content: ""; position: absolute; top: 3px; left: 3px; width: 19px; height: 19px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .25s cubic-bezier(.3,.8,.3,1.2); }
.ob-toggle.on { background: var(--ob-green); }
.ob-toggle.on::after { transform: translateX(17px); }

/* Map */
.ob-prog { padding: 20px 22px; border-radius: 18px; border: 1px solid var(--ob-line2); background: rgba(var(--ob-ink), 0.045); }
.ob-prog .ph { display: flex; gap: 16px; align-items: center; }
.ob-prog .pt { font-size: 19px; font-weight: 800; }
.ob-prog .pd { font-size: 13.5px; color: var(--ob-fg3); margin-top: 2px; line-height: 1.5; }
.ob-bar { height: 8px; border-radius: 99px; background: rgba(var(--ob-ink), 0.08); overflow: hidden; margin: 16px 0 8px; position: relative; }
.ob-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--ob-a), var(--ob-b)); transition: width .6s ease; }
.ob-bar.unknown i { width: 35% !important; animation: obSlide 1.2s ease-in-out infinite; }
@keyframes obSlide { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
.ob-pnum { display: flex; justify-content: space-between; font-size: 13px; color: var(--ob-fg2); font-variant-numeric: tabular-nums; }
.ob-strip { display: flex; gap: 12px; align-items: center; padding: 11px 14px; border-radius: 14px; border: 1px solid var(--ob-line); background: var(--ob-surface); font-size: 13.5px; color: var(--ob-fg2); font-variant-numeric: tabular-nums; }
.ob-strip .ob-bar { flex: 1; margin: 0; height: 6px; }
.ob-strip.ok { border-color: var(--ob-green-line); color: var(--ob-green); }
.ob-strip svg { width: 16px; height: 16px; }
.ob-field { padding: 18px 20px 20px; border-radius: 18px; border: 1px solid var(--ob-line); background: var(--ob-surface); }
.ob-field .fe { font-size: 11.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--ob-fg3); }
.ob-field .ft { font-size: 20px; font-weight: 800; margin: 5px 0 3px; }
.ob-field .fd { font-size: 13.5px; color: var(--ob-fg3); line-height: 1.5; margin-bottom: 12px; }
.ob-picks { display: flex; flex-wrap: wrap; gap: 7px; }
/* The field question in a short window: the page holds still and its choices scroll (Blake, #175). */
.ob-scroll:has(> .ob-field) { overflow: hidden; }
.ob-field { display: flex; flex-direction: column; min-height: 0; flex: 0 1 auto; }
.ob-picklist { min-height: 72px; overflow-y: auto; flex: 0 1 auto; overscroll-behavior: contain; padding: 2px; margin: -2px; }
.ob-pick { height: 32px; padding: 0 12px; border-radius: 99px; border: 1px solid var(--ob-line2); background: rgba(var(--ob-ink), 0.03); font-size: 13px; font-weight: 600; color: var(--ob-fg2); display: inline-flex; align-items: center; gap: 6px; }
.ob-pick.sel { background: var(--ob-fg1); color: var(--sd-bg, #0a0a1a); border-color: var(--ob-fg1); }
.ob-pick svg { width: 12px; height: 12px; }
.ob-pick:disabled { opacity: .45; cursor: default; }
.ob-facts { display: grid; gap: 10px; margin-top: 4px; }
.ob-facts div { display: flex; gap: 12px; align-items: center; font-size: 14.5px; color: var(--ob-fg2); }
.ob-facts .fi { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: rgba(var(--ob-ink), 0.06); color: var(--ob-fg2); flex-shrink: 0; }
.ob-facts svg { width: 17px; height: 17px; }

/* Pictures */
.ob-art-galaxy { position: absolute; inset: 34px 40px 74px; }
.ob-badge { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); display: inline-flex; gap: 8px; align-items: center; padding: 9px 15px; border-radius: 99px;
  background: rgba(var(--ob-ink), 0.07); border: 1px solid var(--ob-line); font-size: 13px; font-weight: 600; color: var(--ob-fg2); white-space: nowrap; font-variant-numeric: tabular-nums;
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.ob-badge svg { width: 15px; height: 15px; }
.ob-caption { position: absolute; left: 16px; right: 16px; bottom: 30px; text-align: center; font-size: 13px; color: var(--ob-fg3); display: flex; gap: 7px; align-items: center; justify-content: center; flex-wrap: wrap; }
.ob-caption svg { width: 15px; height: 15px; }
.ob-caption b { color: var(--ob-fg2); font-weight: 650; }

.ob-galaxy { width: 100%; height: 100%; overflow: visible; display: block; }
.ob-galaxy .ring { fill: none; stroke: rgba(var(--ob-ink), 0.07); stroke-width: 0.25; stroke-dasharray: 0.6 1.6; }
.ob-galaxy .gl { stroke-width: 0.18; opacity: 0; transition: opacity .6s ease; }
.ob-galaxy .gl.on { opacity: 0.3; }
.ob-galaxy .gd { opacity: 0; transform: scale(.2); transform-box: fill-box; transform-origin: center; transition: opacity .5s ease, transform .55s cubic-bezier(.2,.9,.3,1.5), fill .5s; }
.ob-galaxy .gd.on { opacity: 1; transform: none; }
.ob-galaxy .gd.tw.on { animation: obTwinkle 4.5s ease-in-out infinite; animation-delay: var(--d); }
@keyframes obTwinkle { 50% { opacity: .55; } }
.ob-galaxy.ghost .gd { opacity: 1; transform: none; fill: rgba(var(--ob-ink), 0.16); }
.ob-galaxy.ghost .gd.on { fill: var(--c); }
.ob-galaxy .you { fill: var(--ob-fg1); }
.ob-galaxy .you-glow { fill: var(--ob-fg1); opacity: .18; }
.ob-galaxy .you-label { font-size: 4.4px; font-weight: 800; fill: var(--ob-fg1); text-anchor: middle; }
.ob-galaxy.bloom .gd { transition-delay: calc(var(--o) * 1.6s); }
.ob-galaxy.bloom .gl { transition-delay: calc(var(--o) * 1.6s + .2s); }

/* System Settings, drawn */
.ob-macwrap { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -56%); width: 500px; transition: opacity .4s, filter .4s; }
.ob-macwrap.dim { opacity: .5; filter: saturate(.4); }
.ob-mac { width: 500px; height: 360px; border-radius: 14px; background: #232336; border: 1px solid rgba(255,255,255,.08); box-shadow: 0 30px 70px rgba(0,0,0,.35); overflow: hidden;
  display: grid; grid-template-columns: 176px 1fr; font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e9e9f0; --mac-line: rgba(255,255,255,.08); --mac-fg2: #9a9ab0; --mac-side: #1c1c2e; --mac-list: rgba(255,255,255,.03); --mac-off: rgba(255,255,255,.2); }
html[data-mode="light"] .ob-mac { background: #fff; border-color: rgba(0,0,0,.08); box-shadow: 0 30px 70px rgba(30,40,80,.18); color: #1d1d22; --mac-line: rgba(0,0,0,.08); --mac-fg2: #6e6e78; --mac-side: #f1f1f5; --mac-list: #fafafc; --mac-off: rgba(0,0,0,.14); }
.ob-mac .side { background: var(--mac-side); border-right: 1px solid var(--mac-line); padding: 34px 8px 8px; position: relative; }
.ob-mac .lights { position: absolute; top: 12px; left: 12px; display: flex; gap: 7px; }
.ob-mac .lights i { width: 11px; height: 11px; border-radius: 50%; display: block; }
.ob-mac .lights i:nth-child(1) { background: #ff5f57; } .ob-mac .lights i:nth-child(2) { background: #febc2e; } .ob-mac .lights i:nth-child(3) { background: #28c840; }
.ob-mac .search { height: 24px; border-radius: 7px; background: var(--mac-list); border: 1px solid var(--mac-line); margin: 0 2px 10px; font-size: 11.5px; color: var(--mac-fg2); display: flex; align-items: center; padding-left: 9px; }
.ob-mac .item { display: flex; gap: 8px; align-items: center; height: 26px; padding: 0 6px; border-radius: 6px; font-size: 12px; white-space: nowrap; }
.ob-mac .item i { width: 18px; height: 18px; border-radius: 5px; display: block; flex-shrink: 0; }
.ob-mac .item.sel { background: #0a84ff; color: #fff; }
.ob-mac .gap { height: 8px; }
.ob-mac .main { padding: 14px 18px; }
.ob-mac .mh { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; margin: 2px 0 16px; }
.ob-mac .mh span { color: var(--mac-fg2); font-weight: 400; font-size: 18px; line-height: 1; }
.ob-mac .mp { font-size: 11.5px; color: var(--mac-fg2); line-height: 1.45; margin-bottom: 12px; }
.ob-mac .list { border-radius: 9px; border: 1px solid var(--mac-line); background: var(--mac-list); }
.ob-mac .mrow { display: flex; gap: 10px; align-items: center; height: 44px; padding: 0 12px; font-size: 12.5px; font-weight: 500; }
.ob-mac .mrow .appic { width: 26px; height: 26px; display: block; }
.ob-mac .mt { margin-left: auto; width: 32px; height: 19px; border-radius: 99px; background: var(--mac-off); position: relative; transition: background .3s; }
.ob-mac .mt::after { content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .3s cubic-bezier(.3,.8,.3,1.2); }
.ob-mac .mt.on { background: #0a84ff; }
.ob-mac .mt.on::after { transform: translateX(13px); }
.ob-mac .mt.pulse { animation: obMacPulse 1.8s ease-out infinite; }
@keyframes obMacPulse { 0% { box-shadow: 0 0 0 0 rgba(10,132,255,.6); } 70% { box-shadow: 0 0 0 10px rgba(10,132,255,0); } 100% { box-shadow: 0 0 0 0 rgba(10,132,255,0); } }
.ob-mac .pm { display: flex; margin-top: 8px; }
.ob-mac .pm span { width: 24px; height: 20px; display: grid; place-items: center; color: var(--mac-fg2); font-size: 14px; border: 1px solid var(--mac-line); }
.ob-callout { position: absolute; right: -6px; top: 158px; padding: 8px 12px; border-radius: 10px; background: var(--ob-fg1); color: var(--sd-bg, #0a0a1a); font-size: 12.5px; font-weight: 700; white-space: nowrap; box-shadow: 0 10px 24px rgba(0,0,0,.25); display: flex; align-items: center; gap: 6px; }
.ob-callout::before { content: ""; position: absolute; right: 26px; top: -5px; width: 10px; height: 10px; background: inherit; transform: rotate(45deg); }
.ob-callout.ok { background: var(--ob-green); }
.ob-callout svg { width: 14px; height: 14px; }
.ob-pointer { position: absolute; width: 20px; height: 28px; right: 26px; top: 121px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); animation: obNudge 1.8s ease-in-out infinite; }
@keyframes obNudge { 50% { transform: translate(-4px, -4px); } }

/* Off a Mac (or before macOS 13): the three things, drawn */
.ob-checks-art { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -55%); display: grid; gap: 14px; width: 340px; }
.ob-checks-art .icon { width: 96px; height: 96px; margin: 0 auto 10px; }
.ob-checks-art .icon svg { width: 96px; height: 96px; display: block; }
.ob-checks-art div.c { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 14px; background: rgba(var(--ob-ink), 0.05); border: 1px solid var(--ob-line); font-size: 14.5px; font-weight: 650; }
.ob-checks-art div.c.ok { border-color: var(--ob-green-line); }
.ob-checks-art div.c span.b { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: rgba(var(--ob-ink), 0.08); color: var(--ob-fg3); }
.ob-checks-art div.c.ok span.b { background: var(--ob-green); color: var(--sd-bg, #04140c); }
.ob-checks-art svg.ck { width: 14px; height: 14px; }

/* Connect, drawn */
.ob-conn { position: absolute; left: 44px; right: 44px; top: 96px; display: flex; align-items: flex-start; }
.ob-cnode { width: 130px; text-align: center; flex-shrink: 0; }
.ob-tile { width: 104px; height: 104px; margin: 0 auto; border-radius: 26px; display: grid; place-items: center; position: relative; }
.ob-tile.me svg { width: 104px; height: 104px; display: block; filter: drop-shadow(0 12px 24px rgba(0,0,0,.35)); }
.ob-tile.li { background: rgba(var(--ob-ink), 0.06); border: 1.5px solid var(--ob-line2); color: var(--ob-fg2); transition: border-color .4s, background .4s; }
.ob-tile.li > svg { width: 44px; height: 44px; }
.ob-tile.li.waiting::before, .ob-tile.li.waiting::after { content: ""; position: absolute; inset: -2px; border-radius: 28px; border: 2px solid rgba(var(--ob-ink), 0.45); animation: obPing 2s ease-out infinite; }
.ob-tile.li.waiting::after { animation-delay: 1s; }
@keyframes obPing { from { transform: scale(1); opacity: .8; } to { transform: scale(1.3); opacity: 0; } }
.ob-tile.li.ok { border-color: var(--ob-green); background: var(--ob-green-soft); color: var(--ob-green); box-shadow: 0 0 40px var(--ob-green-soft); }
.ob-tile .corner { position: absolute; right: -8px; bottom: -8px; width: 30px; height: 30px; border-radius: 50%; background: var(--ob-green); color: var(--sd-bg, #04140c); display: grid; place-items: center; border: 3px solid var(--ob-solid); }
.ob-tile .corner svg { width: 15px; height: 15px; }
.ob-cnode .nl { font-size: 15px; font-weight: 750; margin-top: 14px; }
.ob-cnode .ns { font-size: 12.5px; color: var(--ob-fg3); margin-top: 1px; }
.ob-cnode .ns.ok { color: var(--ob-green); font-weight: 650; }
.ob-wire { flex: 1; position: relative; height: 104px; }
.ob-wire .track { position: absolute; left: 6px; right: 6px; top: 50px; height: 4px; border-radius: 2px; background: repeating-linear-gradient(90deg, rgba(var(--ob-ink), .22) 0 8px, transparent 8px 16px); background-size: 16px 4px; }
.ob-wire.waiting .track { background: repeating-linear-gradient(90deg, rgba(var(--ob-ink), .55) 0 8px, transparent 8px 16px); background-size: 16px 4px; animation: obDash .7s linear infinite; }
@keyframes obDash { to { background-position: 16px 0; } }
.ob-wire .pulse { position: absolute; top: 46px; left: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--ob-fg1); box-shadow: 0 0 16px var(--ob-fg1); animation: obTravel 1.7s cubic-bezier(.5,0,.5,1) infinite; }
@keyframes obTravel { from { left: 6px; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } to { left: calc(100% - 18px); opacity: 0; } }
.ob-wire.ok .track { background: var(--ob-green); box-shadow: 0 0 18px var(--ob-green); transform-origin: left; animation: obGrow .55s cubic-bezier(.3,.8,.3,1) both; }
@keyframes obGrow { from { transform: scaleX(0); } }
.ob-wire .badge { position: absolute; left: 50%; top: 52px; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: var(--ob-green); color: var(--sd-bg, #04140c); display: grid; place-items: center;
  box-shadow: 0 0 0 7px var(--ob-solid), 0 0 34px var(--ob-green); animation: obPop .5s .4s cubic-bezier(.2,.9,.3,1.5) both; }
.ob-wire .badge svg { width: 22px; height: 22px; }
.ob-wire .wl { position: absolute; left: 0; right: 0; top: 76px; text-align: center; font-size: 12.5px; color: var(--ob-fg3); font-weight: 600; }
.ob-wire.ok .wl { color: var(--ob-green); top: 84px; }
.ob-browser { position: absolute; left: 50%; top: 352px; width: 380px; transform: translateX(-50%); border-radius: 13px; background: var(--ob-solid); border: 1px solid var(--ob-line2); box-shadow: 0 24px 60px rgba(0,0,0,.3); overflow: hidden; transition: transform .7s cubic-bezier(.3,.8,.2,1), opacity .7s; }
.ob-browser.back { transform: translateX(-50%) translateY(26px) scale(.9); opacity: .38; }
.ob-browser .bar { height: 34px; display: flex; align-items: center; gap: 6px; padding: 0 12px; background: rgba(var(--ob-ink), .05); border-bottom: 1px solid var(--ob-line); }
.ob-browser .bar > i { width: 9px; height: 9px; border-radius: 50%; background: rgba(var(--ob-ink), .22); display: block; }
.ob-browser .url { margin-left: 12px; flex: 1; height: 22px; border-radius: 99px; background: rgba(var(--ob-ink), .07); font-size: 11.5px; color: var(--ob-fg3); display: flex; align-items: center; gap: 5px; padding-left: 10px; }
.ob-browser .url svg { width: 11px; height: 11px; }
.ob-browser .bb { padding: 18px 26px 22px; }
.ob-browser .bh { font-size: 17px; font-weight: 800; margin-bottom: 12px; }
.ob-browser .bi { height: 34px; border-radius: 8px; border: 1px solid var(--ob-line2); font-size: 12px; color: var(--ob-fg4); display: flex; align-items: center; padding: 0 11px; margin-bottom: 8px; }
.ob-browser .bi.pw { color: var(--ob-fg2); letter-spacing: 2px; }
.ob-browser .bbtn { height: 34px; border-radius: 99px; background: rgba(var(--ob-ink), .14); font-size: 12.5px; font-weight: 700; color: var(--ob-fg2); display: grid; place-items: center; margin-top: 12px; }
.ob-btag { position: absolute; left: 50%; top: 318px; transform: translateX(-50%); font-size: 11.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--ob-fg4); white-space: nowrap; }

/* Pace, drawn */
.ob-gauge { position: absolute; left: 50%; top: 92px; transform: translateX(-50%); width: 460px; }
.ob-gauge svg { width: 460px; height: 230px; display: block; overflow: visible; }
.ob-gauge .arc { fill: none; stroke-width: 16; }
.ob-gauge .needle { transition: transform .7s cubic-bezier(.3,.9,.3,1.15); transform-origin: 0 0; }
.ob-gauge .lab { font-size: 11px; fill: var(--ob-fg3); font-weight: 650; }
.ob-gauge .lab.red { fill: var(--ob-red); }
.ob-gauge .zone { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; fill: var(--ob-fg4); }
.ob-gval { text-align: center; margin-top: 18px; }
.ob-gval b { font-size: 64px; font-weight: 800; letter-spacing: -.03em; display: block; line-height: 1; font-variant-numeric: tabular-nums; }
.ob-gval.warn b { color: var(--ob-gold); }
.ob-gval span { font-size: 14px; color: var(--ob-fg3); }
.ob-stats { position: absolute; left: 44px; right: 44px; bottom: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ob-stat { padding: 14px 16px; border-radius: 14px; background: rgba(var(--ob-ink), .05); border: 1px solid var(--ob-line); }
.ob-stat b { display: block; font-size: 19px; font-weight: 800; letter-spacing: -.01em; }
.ob-stat span { font-size: 12.5px; color: var(--ob-fg3); line-height: 1.4; display: block; margin-top: 2px; }

/* The last screen */
.ob-final { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.ob-final .fg { position: absolute; left: 50%; top: 50%; width: 820px; height: 820px; margin: -410px 0 0 -150px; }
.ob-final .scrim { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, var(--sd-bg, #0a0a1a) 0%, color-mix(in srgb, var(--sd-bg, #0a0a1a) 85%, transparent) 30%, transparent 58%); }
.ob-final .copy { position: absolute; left: 110px; top: 50%; transform: translateY(-50%); width: 520px; max-width: calc(100% - 64px); }
.ob-final h1 { font-size: 58px; margin: 14px 0 16px; }
.ob-final .ob-lede { font-size: 18px; }
.ob-tiles { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 30px; }
.ob-tiles div { padding: 11px 14px; border-radius: 13px; background: rgba(var(--ob-ink), .05); border: 1px solid var(--ob-line); font-size: 12.5px; color: var(--ob-fg3); }
.ob-tiles b { display: block; color: var(--ob-fg1); font-size: 15px; margin-bottom: 1px; }
.ob-final .next { margin-top: 22px; font-size: 13.5px; color: var(--ob-fg3); line-height: 1.6; max-width: 440px; }

/* The Mac app's smallest window, and anything shorter */
@media (max-width: 1180px) {
  .ob-card { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); width: calc(100% - 40px); margin-bottom: 20px; }
  .ob-scroll { padding: 34px 36px 8px 40px; }
  .ob-foot { padding: 14px 36px 22px 40px; }
  .ob h1 { font-size: 36px; }
  .ob-top { padding: 0 24px; }
  .ob-art-galaxy { inset: 24px 24px 64px; }
  .ob-macwrap, .ob-gauge { transform: translate(-50%, -56%) scale(.8); }
  .ob-gauge { transform: translateX(-50%) scale(.8); transform-origin: top center; top: 60px; }
  .ob-conn { left: 16px; right: 16px; top: 60px; }
  .ob-browser { top: 300px; width: 330px; }
  .ob-btag { top: 268px; }
  .ob-stats { left: 20px; right: 20px; bottom: 24px; }
  .ob-out .long { display: none; }
  .ob-final .copy { left: 56px; }
  .ob-final .fg { width: 640px; height: 640px; margin: -320px 0 0 -40px; }
}
@media (max-height: 760px) {
  .ob-top { height: 56px; }
  .ob-scroll { padding-top: 26px; }
  .ob h1 { font-size: 32px; margin: 8px 0 10px; }
  .ob-lede { font-size: 15px; margin-bottom: 8px; }
  .ob-foot { padding-bottom: 18px; }
  .ob-card { margin-bottom: 16px; }
  .ob-final h1 { font-size: 44px; }
}
@media (max-width: 900px) and (min-width: 761px) {
  .ob-conn .ob-cnode { width: 104px; }
}
/* A phone, or a narrow browser window: one column, the pictures left out, the page scrolls */
@media (max-width: 760px) {
  .ob { height: auto; min-height: 100vh; }
  .ob-top { grid-template-columns: 1fr auto; padding: 0 16px; height: 56px; }
  .ob-out { display: none; }
  .ob-card { display: block; width: auto; margin: 0 12px 12px; border-radius: 22px; }
  .ob-ill { display: none; }
  .ob-scroll { overflow: visible; padding: 24px 18px 8px; }
  .ob-scroll:has(> .ob-field) { overflow: visible; }
  .ob-picklist { overflow: visible; }
  .ob-foot { position: sticky; bottom: 0; padding: 12px 18px 16px; background: var(--ob-solid); border-top: 1px solid var(--ob-line); border-radius: 0 0 22px 22px; flex-wrap: wrap; }
  .ob-foot .ob-hint { display: none; }
  .ob h1 { font-size: 30px; }
  .ob-pair, .ob-pair.wide, .ob-seg3 { grid-template-columns: 1fr; }
  .ob-btn.lg { height: 48px; padding: 0 20px; font-size: 15.5px; }
  .ob-final { min-height: calc(100vh - 56px); }
  .ob-final .fg { width: 520px; height: 520px; left: 50%; top: 0; margin: -60px 0 0 -260px; opacity: .55; }
  .ob-final .scrim { background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--sd-bg, #0a0a1a) 80%, transparent) 40%, var(--sd-bg, #0a0a1a) 70%); }
  .ob-final .copy { position: relative; left: auto; top: auto; transform: none; margin: 220px 18px 32px; width: auto; max-width: none; }
  .ob-final h1 { font-size: 40px; }
}
@media (prefers-reduced-motion: reduce) {
  .ob *, .ob *::before, .ob *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; transition-duration: 0.001s !important; }
}
`;
