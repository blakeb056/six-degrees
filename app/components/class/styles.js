// Sixgree Classes' look: one stylesheet for the class pick, This or That,
// Never show me, the reveal and the class tab. Every colour is the look's own
// (lib/themes.js CSS variables, Standard's values as fallbacks), so Daylight,
// Glass and the rest draw it their way; the class colours are the class's,
// the tier colours the theme's (S gold, A purple). Narrow windows fold the
// grids to one column, and every control is a real button with a focus ring.

export const CLASS_CSS = `
.cl {
  --cl-fg1: var(--sd-fg-1, #fff); --cl-fg2: var(--sd-fg-2, #c3cbda); --cl-fg3: var(--sd-fg-3, #8e97aa); --cl-fg4: var(--sd-fg-4, #646b80);
  --cl-ink: var(--sd-ink, 255, 255, 255);
  --cl-line: rgba(var(--cl-ink), 0.1); --cl-line2: rgba(var(--cl-ink), 0.18);
  --cl-surface: rgba(var(--cl-ink), 0.04); --cl-surface2: rgba(var(--cl-ink), 0.07);
  --cl-card: var(--sd-card, #14162c);
  --cl-s: var(--sd-tier-s, #f6c344); --cl-a: var(--sd-tier-a, #a78bfa); --cl-b: var(--sd-tier-b, #60a5fa); --cl-c: var(--sd-tier-c, #4caf63); --cl-d: var(--sd-tier-d, #6b7280);
  --cl-green: var(--sd-green, #00ff88); --cl-red: var(--sd-red, #ff6b6b); --cl-gold: var(--sd-gold, #FFD700);
  color: var(--cl-fg1); font-family: var(--sd-font);
}
.cl *, .cl *::before, .cl *::after { box-sizing: border-box; }
.cl button { font: inherit; color: inherit; cursor: pointer; }
.cl button:focus-visible, .cl a:focus-visible, .cl input:focus-visible { outline: 2px solid color-mix(in srgb, var(--cl-fg1) 70%, transparent); outline-offset: 2px; }
.cl-eyebrow { font-size: 11.5px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--cl-fg3); }
.cl-h1 { font-size: 30px; line-height: 1.12; letter-spacing: -.02em; font-weight: 800; margin: 8px 0 8px; }
.cl-h2 { font-size: 18px; font-weight: 750; margin: 0 0 6px; }
.cl-lede { font-size: 15px; line-height: 1.6; color: var(--cl-fg2); margin: 0 0 14px; max-width: 640px; }
.cl-quiet { font-size: 12.5px; color: var(--cl-fg3); line-height: 1.5; }
.cl-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cl-spacer { flex: 1; }
.cl-error { font-size: 13.5px; color: var(--cl-red); padding: 9px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--cl-red) 35%, transparent); background: color-mix(in srgb, var(--cl-red) 7%, transparent); }

.cl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 42px; padding: 0 20px; border-radius: 11px; border: 0; font-size: 14.5px; font-weight: 700; white-space: nowrap; transition: transform .15s ease, background .2s, opacity .2s; }
.cl-btn.primary { background: var(--cl-fg1); color: var(--sd-bg, #0a0a1a); }
.cl-btn.primary:not(:disabled):hover { transform: translateY(-1px); }
.cl-btn.primary:disabled { background: var(--cl-surface2); color: var(--cl-fg4); cursor: default; }
.cl-btn.ghost { background: none; color: var(--cl-fg2); padding: 0 12px; }
.cl-btn.ghost:hover { color: var(--cl-fg1); background: var(--cl-surface); }
.cl-btn.secondary { background: var(--cl-surface2); color: var(--cl-fg1); border: 1px solid var(--cl-line2); }
.cl-btn.small { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 9px; }
.cl-kbd { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 5px; border: 1px solid var(--cl-line2); font-size: 11px; font-weight: 700; color: var(--cl-fg3); }

/* The class pick: six emblem cards that flip to show your own numbers */
.cl-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.cl-pick { position: relative; perspective: 1000px; min-height: 218px; border: 0; padding: 0; background: none; text-align: left; }
.cl-pick-in { position: absolute; inset: 0; transition: transform .55s cubic-bezier(.2,.8,.2,1); transform-style: preserve-3d; }
.cl-pick.flipped .cl-pick-in { transform: rotateY(180deg); }
.cl-face { position: absolute; inset: 0; width: 100%; height: 100%; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 16px; padding: 16px 16px 48px; border: 1px solid var(--cl-line); background: var(--cl-surface); display: flex; flex-direction: column; justify-content: flex-start; gap: 8px; overflow: hidden; }
.cl-flip { position: absolute; right: 10px; bottom: 10px; z-index: 2; }
.cl-face::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(90% 70% at 100% 0%, color-mix(in srgb, var(--cl-class) 20%, transparent), transparent 65%); }
.cl-face.back { transform: rotateY(180deg); background: color-mix(in srgb, var(--cl-class) 9%, var(--cl-card)); border-color: color-mix(in srgb, var(--cl-class) 45%, transparent); }
.cl-pick.sel .cl-face { border-color: color-mix(in srgb, var(--cl-class) 80%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cl-class) 22%, transparent); }
.cl-pick:hover .cl-face.front { border-color: var(--cl-line2); }
.cl-face .nm { font-size: 18px; font-weight: 800; display: flex; align-items: center; gap: 10px; position: relative; }
.cl-face .who { font-size: 13px; color: var(--cl-fg2); line-height: 1.45; position: relative; }
.cl-face .kv { font-size: 12px; color: var(--cl-fg3); line-height: 1.45; position: relative; }
.cl-face .kv b { color: var(--cl-fg2); font-weight: 650; }
.cl-face .big { font-size: 15px; font-weight: 750; line-height: 1.35; position: relative; }
.cl-face .tag { position: absolute; top: 12px; right: 12px; font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 3px 7px; border-radius: 999px; background: var(--cl-surface2); color: var(--cl-fg3); }
.cl-emblem { flex-shrink: 0; }
.cl-unsure { margin-top: 14px; padding: 14px; border-radius: 14px; border: 1px dashed var(--cl-line2); }
.cl-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.cl-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--cl-line2); background: var(--cl-surface); font-size: 13px; font-weight: 600; transition: background .15s, border-color .15s; }
.cl-chip[aria-pressed="true"] { background: color-mix(in srgb, var(--cl-class, var(--cl-fg1)) 18%, transparent); border-color: color-mix(in srgb, var(--cl-class, var(--cl-fg1)) 70%, transparent); }
.cl-field { display: flex; flex-direction: column; gap: 6px; margin: 12px 0 0; }
.cl-field label, .cl-label { font-size: 12px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--cl-fg3); }
.cl-input { height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--cl-line2); background: var(--cl-surface); color: var(--cl-fg1); font: inherit; font-size: 14px; }
.cl-input::placeholder { color: var(--cl-fg4); }

/* This or That */
.cl-duel-head { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.cl-duel-step { font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--cl-fg3); }
.cl-prompt { font-size: 22px; font-weight: 800; letter-spacing: -.01em; margin: 6px 0 2px; }
.cl-why { font-size: 13px; color: var(--cl-fg3); margin-bottom: 14px; }
.cl-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.cl-card { position: relative; text-align: left; border-radius: 18px; padding: 18px 18px 16px; border: 1px solid var(--cl-line2); background: var(--cl-card); min-height: 214px; display: flex; flex-direction: column; gap: 6px;
  box-shadow: 0 18px 50px rgba(0,0,0,.18); transition: transform .18s cubic-bezier(.2,.8,.2,1), border-color .18s, box-shadow .18s; }
.cl-card:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--cl-class) 70%, transparent); box-shadow: 0 22px 60px rgba(0,0,0,.24); }
.cl-card.chosen { border-color: var(--cl-class); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cl-class) 30%, transparent); transform: translateY(-3px) scale(1.01); }
.cl-card .sil { width: 40px; height: 40px; border-radius: 50%; background: var(--cl-surface2); display: grid; place-items: center; color: var(--cl-fg4); margin-bottom: 6px; }
.cl-card .t { font-size: 19px; font-weight: 800; line-height: 1.2; letter-spacing: -.01em; }
.cl-card .ex { font-size: 13px; color: var(--cl-fg3); }
.cl-card .co { font-size: 15px; font-weight: 650; color: var(--cl-fg2); }
.cl-card .co small { display: block; font-size: 12px; font-weight: 500; color: var(--cl-fg3); margin-top: 1px; }
.cl-card .meta { font-size: 13px; color: var(--cl-fg2); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: auto; }
.cl-card .pill { padding: 3px 9px; border-radius: 999px; background: var(--cl-surface2); font-size: 12px; font-weight: 650; }
.cl-card .same { opacity: .42; }
.cl-card .made { position: absolute; top: 14px; right: 14px; font-size: 10.5px; font-weight: 750; color: var(--cl-fg3); display: inline-flex; align-items: center; gap: 5px; }
.cl-card .made i { width: 6px; height: 6px; border-radius: 50%; background: var(--cl-fg3); display: block; }
.cl-card .key { position: absolute; bottom: 12px; right: 14px; }
.cl-answers { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 14px 0 6px; }
.cl-meter { height: 6px; border-radius: 99px; background: var(--cl-surface2); overflow: hidden; }
.cl-meter i { display: block; height: 100%; background: var(--cl-class, var(--cl-fg1)); border-radius: 99px; transition: width .6s cubic-bezier(.2,.8,.2,1); }
.cl-live { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 13px; color: var(--cl-fg2); margin-top: 10px; }
.cl-live b { color: var(--cl-fg1); }
.cl-new { color: var(--cl-s); font-weight: 750; }
@keyframes clIn { from { opacity: 0; transform: translateY(8px) scale(.985); } }
.cl-cards.in .cl-card { animation: clIn .32s cubic-bezier(.2,.8,.2,1) both; }
.cl-cards.in .cl-card:nth-child(2) { animation-delay: .05s; }

/* The build */
.cl-bars { display: flex; flex-direction: column; gap: 8px; }
.cl-bar { display: grid; grid-template-columns: 74px 1fr 40px; gap: 10px; align-items: center; font-size: 13px; }
.cl-bar .track { height: 10px; border-radius: 99px; background: var(--cl-surface2); overflow: hidden; }
.cl-bar .fill { height: 100%; border-radius: 99px; background: var(--cl-class, var(--cl-fg1)); transition: width .6s cubic-bezier(.2,.8,.2,1); }
.cl-bar .n { text-align: right; color: var(--cl-fg3); font-variant-numeric: tabular-nums; }
.cl-words { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.cl-word { font-size: 12.5px; font-weight: 650; padding: 4px 10px; border-radius: 999px; background: var(--cl-surface2); }
.cl-word.up { color: color-mix(in srgb, var(--cl-green) 70%, var(--cl-fg1)); }
.cl-word.down { color: color-mix(in srgb, var(--cl-red) 75%, var(--cl-fg1)); }
.cl-dials { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.cl-dial { padding: 10px 12px; border-radius: 12px; border: 1px solid var(--cl-line); background: var(--cl-surface); font-size: 12.5px; color: var(--cl-fg3); }
.cl-dial b { display: block; font-size: 15px; color: var(--cl-fg1); margin-bottom: 2px; }

/* People: the reveal and the class list */
.cl-people { display: flex; flex-direction: column; gap: 6px; }
.cl-person { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 13px; border: 1px solid var(--cl-line); background: var(--cl-surface); }
.cl-person .av { width: 36px; height: 36px; border-radius: 50%; background: var(--cl-surface2); display: grid; place-items: center; font-size: 12.5px; font-weight: 800; overflow: hidden; }
.cl-person .av img { width: 100%; height: 100%; object-fit: cover; }
.cl-person .nm { font-size: 14.5px; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cl-person .hl { font-size: 12.5px; color: var(--cl-fg3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cl-person .wy { font-size: 12px; color: var(--cl-fg2); margin-top: 2px; }
.cl-tier { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 800; letter-spacing: .03em; }
.cl-tier .shape { width: 14px; height: 14px; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
.cl-tier .dot { width: 8px; height: 8px; border-radius: 50%; }
.cl-tier.net { color: var(--cl-fg3); font-weight: 650; }

/* The class tab */
.cl-tab { max-width: 1120px; margin: 0 auto; padding: 32px 24px 64px; display: flex; flex-direction: column; gap: 18px; }
.cl-panel { border-radius: 20px; border: 1px solid var(--cl-line); background: var(--sd-panel, rgba(10, 15, 30, 0.65)); -webkit-backdrop-filter: var(--sd-panel-blur, blur(24px)); backdrop-filter: var(--sd-panel-blur, blur(24px)); padding: 20px 22px; }
.cl-hero { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.cl-hero .meta { flex: 1; min-width: 220px; }
.cl-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
.cl-quad { position: relative; width: 100%; aspect-ratio: 1.25; border-radius: 14px; border: 1px solid var(--cl-line); background: var(--cl-surface); overflow: hidden; }
.cl-quad svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.cl-zone { position: absolute; margin: 6px; font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--cl-fg2); padding: 5px 8px; border-radius: 8px;
  background: color-mix(in srgb, var(--sd-bg, #0a0a1a) 72%, transparent); pointer-events: none; }
.cl-zone small { display: block; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--cl-fg4); }
.cl-tabs { display: inline-flex; gap: 4px; padding: 3px; border-radius: 11px; background: var(--cl-surface); border: 1px solid var(--cl-line); }
.cl-tabs button { border: 0; background: none; padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 650; color: var(--cl-fg3); }
.cl-tabs button[aria-pressed="true"] { background: var(--cl-surface2); color: var(--cl-fg1); }
.cl-meters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.cl-meters > div { padding: 12px; border-radius: 12px; border: 1px solid var(--cl-line); background: var(--cl-surface); font-size: 12.5px; color: var(--cl-fg3); line-height: 1.45; }
.cl-meters b { display: block; font-size: 14.5px; color: var(--cl-fg1); margin-bottom: 2px; }
.cl-avoid { display: flex; flex-direction: column; gap: 8px; }
.cl-avoid-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--cl-line); background: var(--cl-surface); font-size: 14px; }
.cl-seg { display: inline-flex; border-radius: 9px; border: 1px solid var(--cl-line2); overflow: hidden; }
.cl-seg button { border: 0; background: none; padding: 6px 11px; font-size: 12.5px; font-weight: 700; color: var(--cl-fg3); }
.cl-seg button[aria-pressed="true"] { background: var(--cl-surface2); color: var(--cl-fg1); }
.cl-seg button[aria-pressed="true"].never { background: color-mix(in srgb, var(--cl-red) 18%, transparent); color: color-mix(in srgb, var(--cl-red) 70%, var(--cl-fg1)); }
.cl-modal { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.45); }
.cl-modal-in { width: min(940px, 100%); max-height: calc(100vh - 40px); overflow-y: auto; border-radius: 22px; border: 1px solid var(--cl-line2); background: var(--sd-card, #14162c); padding: 24px 26px; box-shadow: 0 40px 120px rgba(0,0,0,.45); }
.cl-offer { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 50; width: min(560px, calc(100% - 32px)); display: flex; gap: 14px; align-items: center;
  padding: 14px 16px; border-radius: 18px; border: 1px solid var(--cl-line2); background: var(--sd-surface, var(--cl-card)); box-shadow: 0 24px 70px rgba(0,0,0,.35); }

@media (max-width: 760px) {
  .cl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cl-two { grid-template-columns: 1fr; }
  .cl-meters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .cl-grid { grid-template-columns: 1fr; }
  .cl-cards { grid-template-columns: 1fr; }
  .cl-h1 { font-size: 25px; }
  .cl-prompt { font-size: 19px; }
  .cl-dials { grid-template-columns: 1fr; }
  .cl-tab { padding: 20px 16px 48px; }
  .cl-card { min-height: 168px; }
  .cl-modal { padding: 10px; }
  .cl-modal-in { padding: 18px 16px; border-radius: 18px; max-height: calc(100vh - 20px); }
}
/* In a narrow column (the setup's left side while the first scan reads): the cards stay side by side, smaller. */
.cl.compact .cl-card { min-height: 176px; padding: 14px; }
.cl.compact .cl-card .t { font-size: 16.5px; }
.cl.compact .cl-prompt { font-size: 18px; }
@media (prefers-reduced-motion: reduce) {
  .cl-pick-in, .cl-card, .cl-bar .fill, .cl-meter i { transition: none; }
  .cl-cards.in .cl-card { animation: none; }
}
`;
