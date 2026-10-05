// The name as a logo: "Sixgree" in Manrope 800, solid in the look's tier-S
// gold, with the i's dot leading a level line of six dots, one per degree.
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

// The flat line (Blake, 2026-10-05, his brother's pick): the gold dot sits where
// the i's dot goes, and five more run level to the right, evenly spaced to the end
// of the word, each smaller and fainter: gold, then the tiers A, B, C, D and a
// sixth in D's colour. Left to right: diameter scale, colour, opacity.
export const DOTS = [
  [1, 'var(--sd-tier-s, #ffd700)', 1],
  [0.86, 'var(--sd-tier-a, #9b59b6)', 0.85],
  [0.74, 'var(--sd-tier-b, #3498db)', 0.68],
  [0.62, 'var(--sd-tier-c, #95a5a6)', 0.52],
  [0.5, 'var(--sd-tier-d, #bdc3c7)', 0.36],
  [0.4, 'var(--sd-tier-d, #bdc3c7)', 0.22],
];
const D0 = 140;     // the gold dot's diameter
const SPAN = 2760;  // from the i's centre to the last dot's centre (Manrope 800, -0.02em tracking)
const W = SPAN + D0;
const H = D0;
const CIRCLES = DOTS.map(([k, fill, opacity], i) => ({ cx: D0 / 2 + (SPAN * i) / (DOTS.length - 1), cy: H / 2, r: (D0 * k) / 2, fill, opacity }));

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
          style={{ position: 'absolute', left: `calc(50% - ${em(D0 / 2)})`, bottom: em(1000 - BASELINE + STEM_TOP + LIFT), overflow: 'visible', pointerEvents: 'none' }}>
          {CIRCLES.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r={c.r} style={{ fill: c.fill }} fillOpacity={c.opacity} />
          ))}
        </svg>
      </span>
      <span aria-hidden="true">xgree</span>
    </span>
  );
}
