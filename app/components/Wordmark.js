// The name as a logo: "Sixgree" in Manrope 800, solid in the look's tier-S
// gold, with the i's dot replaced by a column of six dots, one per degree.
// Blake, 2026-10-04: "have the 6 tiers dots be for the i dot and have the
// closest dot be yellow s tier and the other ones to the top get smaller",
// then "from the purple and up fade it out". So the dot nearest the stem is
// the largest and tier-S gold; above it A, B, C, D and a sixth, each smaller
// than the last and fading out from the purple up.
//
// Everything is in em, so it scales with the font size it's given; at 16 px
// the top dots run together and the gold one stays clear. The colours are the
// look's own (--sd-tier-*, lib/themes.js); on a light look the
// letters take a deeper gold so they read on white (app/globals.css
// .sd-wordmark). The font ships in public/fonts, never fetched at runtime.
//
// The site's header draws the same dots from fixed numbers
// (site/_partials/header.html): change DOTS there too.

// Measured from Manrope 800 in Chrome, in thousandths of an em: the glyph's
// baseline sits 880 below the top of a line-height:1 box, and the dotless i's
// stem reaches 540 above the baseline (its x-height).
const BASELINE = 880;
const STEM_TOP = 540;
const LIFT = 55;   // stem to first dot
const GAP = 18;    // between dots

// Bottom to top: diameter, colour, opacity. Gold, then the tiers in order,
// fading out from the purple up; the sixth has no tier of its own and takes
// D's colour, faintest of all. Only the gold dot is solid; the rest fade
// out quickly above it (Blake, 2026-10-04: "use the fade logo").
export const DOTS = [
  [140, 'var(--sd-tier-s, #ffd700)', 1],
  [115, 'var(--sd-tier-a, #9b59b6)', 0.6],
  [94, 'var(--sd-tier-b, #3498db)', 0.42],
  [77, 'var(--sd-tier-c, #95a5a6)', 0.28],
  [63, 'var(--sd-tier-d, #bdc3c7)', 0.17],
  [52, 'var(--sd-tier-d, #bdc3c7)', 0.09],
];
const W = DOTS[0][0];
const H = DOTS.reduce((h, [d]) => h + d, 0) + GAP * (DOTS.length - 1);
const CIRCLES = (() => {
  let y = H;
  return DOTS.map(([d, fill, opacity]) => {
    const c = { cy: y - d / 2, r: d / 2, fill, opacity };
    y -= d + GAP;
    return c;
  });
})();

const em = (n) => `${n / 1000}em`;

/**
 * @param {{ size?: number | string, style?: object, className?: string }} props
 *   `size` is the font size (px if a number); without it the wordmark takes the
 *   size of what it sits in.
 */
export default function Wordmark({ size, style, className = '' }) {
  return (
    <span className={`sd-wordmark ${className}`.trim()} role="img" aria-label="Sixgree"
      style={{ ...(size != null ? { fontSize: size } : {}), ...style }}>
      <span aria-hidden="true">S</span>
      <span aria-hidden="true" style={{ position: 'relative', display: 'inline-block', lineHeight: 1 }}>
        ı
        <svg viewBox={`0 0 ${W} ${H}`} width={em(W)} height={em(H)} focusable="false"
          style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: em(1000 - BASELINE + STEM_TOP + LIFT), overflow: 'visible', pointerEvents: 'none' }}>
          {CIRCLES.map((c, i) => (
            <circle key={i} cx={W / 2} cy={c.cy} r={c.r} style={{ fill: c.fill }} fillOpacity={c.opacity} />
          ))}
        </svg>
      </span>
      <span aria-hidden="true">xgree</span>
    </span>
  );
}
