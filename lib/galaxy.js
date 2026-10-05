// The Galaxy's view, as numbers, kept apart from the drawing so it can be tested
// (app/components/ForceGraph.js).

/**
 * The same view in a box of a new size. It moves by half the change, at the
 * same zoom, so whatever was in the middle of the box is in the middle still.
 * Used for a window resized, and undone exactly by resizing it back. A panel
 * opening beside the map uses reframe, below, which moves nothing.
 */
export function recentre({ x, y, k }, from, to) {
  return { x: x + (to.width - from.width) / 2, y: y + (to.height - from.height) / 2, k };
}

/**
 * The same view after the Galaxy's box has changed: `from` and `to` are the box
 * on screen and the window it was in, { left, top, width, height, vw, vh }.
 *
 * A panel opening or closing beside the map (the window the same size) moves
 * nothing: every dot stays where it is on screen, and the panel covers or
 * uncovers the map's edge. The view moves only by however far the box's corner
 * moved, which for the Filters panel on the left is its whole width and for
 * Details on the right is nothing at all. Re-centring there (Blake, 2026-10-05:
 * "it shouldn't be moving my positions") slid the whole map half a panel over.
 *
 * A window resized keeps whatever was in the middle in the middle (recentre).
 */
export function reframe(t, from, to) {
  if (!from || !to) return t;
  if (from.vw !== to.vw || from.vh !== to.vh) return recentre(t, from, to);
  return { x: t.x + (from.left - to.left), y: t.y + (from.top - to.top), k: t.k };
}
