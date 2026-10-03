// Liquid Glass's lensing (Apple, WWDC25 "Meet Liquid Glass"; HIG → Materials):
// the edge of a pane of glass bends what's behind it, where frosted glass only
// blurs it. Done the way the good web versions do it in Chromium: a
// displacement map, drawn here for a panel's exact size, used by an SVG
// feDisplacementMap that the panel's backdrop-filter runs
// (app/components/LiquidGlass.js).
//
// The map's red channel shifts a pixel across, green up and down; 128 is no
// shift. Only a band along the edge (the bezel) moves, and it always pulls
// inward, since a backdrop is clipped to the panel and anything pulled from
// outside it would come back empty.

/**
 * How far, and which way, each pixel of a rounded rectangle w×h (corner r)
 * bends: [dx, dy] in -1…1 for (x, y), strongest at the edge and fading to
 * nothing `bezel` pixels in.
 */
export function lensAt(x, y, w, h, r, bezel) {
  const px = x + 0.5 - w / 2;
  const py = y + 0.5 - h / 2;
  const qx = Math.abs(px) - (w / 2 - r);
  const qy = Math.abs(py) - (h / 2 - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const o = Math.hypot(ox, oy);
  const dist = r - (o + Math.min(Math.max(qx, qy), 0));   // pixels in from the edge
  let nx = 0;
  let ny = 0;
  if (o > 0) { nx = ox / o; ny = oy / o; } else if (qx > qy) nx = 1; else ny = 1;
  nx *= -Math.sign(px) || 0;
  ny *= -Math.sign(py) || 0;
  const t = Math.max(0, 1 - dist / bezel);
  const m = t * t;
  return [nx * m, ny * m];
}

/** The displacement map for a w×h panel, as a PNG data URL (needs a canvas: the browser only). */
export function lensMap(w, h, r, bezel) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Most of a big panel is its middle, which never moves.
      const nearEdge = x < bezel + r || y < bezel + r || x >= w - bezel - r || y >= h - bezel - r;
      const [dx, dy] = nearEdge ? lensAt(x, y, w, h, r, bezel) : [0, 0];
      d[i] = 128 + 127 * dx;
      d[i + 1] = 128 + 127 * dy;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}
