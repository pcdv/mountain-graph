// @ts-check
/**
 * Two fingers on an element as a pinch: how much they moved apart or together since the last event,
 * and where, so that a view zooms about the middle of them. No DOM beyond the element's own events.
 */

/**
 * @param {HTMLElement} el
 * @param {(ratio: number, x: number, y: number) => void} onPinch the distance between the fingers over
 *        what it was at the last event (above 1, they moved apart), and the middle of them, in px
 *        from the element's top left
 * @returns {{pinching: () => boolean, touches: () => number}} whether two fingers are down, and how many
 *          pointers are
 */
export function pinch(el, onPinch) {
  /** @type {Map<number, {x: number, y: number}>} */
  const down = new Map();
  let last = 0;

  const span = () => {
    const [a, b] = [...down.values()];
    return {distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
  };
  el.addEventListener('pointerdown', e => {
    down.set(e.pointerId, {x: e.clientX, y: e.clientY});
    last = down.size === 2 ? span().distance : 0;
  });
  el.addEventListener('pointermove', e => {
    const at = down.get(e.pointerId);
    if (!at)
      return;
    at.x = e.clientX;
    at.y = e.clientY;
    if (down.size !== 2)
      return;
    const now = span();
    if (last > 0 && now.distance > 0) {
      const box = el.getBoundingClientRect();
      onPinch(now.distance / last, now.x - box.left, now.y - box.top);
    }
    last = now.distance;
  });
  const lift = (/** @type {PointerEvent} */ e) => {
    down.delete(e.pointerId);
    last = down.size === 2 ? span().distance : 0;
  };
  el.addEventListener('pointerup', lift);
  el.addEventListener('pointercancel', lift);
  return {pinching: () => down.size === 2, touches: () => down.size};
}
