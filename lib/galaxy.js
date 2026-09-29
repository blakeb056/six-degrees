// The Galaxy's view, as numbers, kept apart from the drawing so it can be tested
// (app/components/ForceGraph.js).

/**
 * The same view in a box of a new size. It moves by half the change, at the
 * same zoom, so whatever was in the middle of the box is in the middle still.
 * Opening a 320-pixel panel slides the view 160 pixels left, and closing it
 * slides the view back to exactly where it was.
 */
export function recentre({ x, y, k }, from, to) {
  return { x: x + (to.width - from.width) / 2, y: y + (to.height - from.height) / 2, k };
}
