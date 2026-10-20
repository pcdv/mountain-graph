// @ts-check
/**
 * Puts a view in place of the one shown without a blank frame between them: the new one is built
 * over the old, hidden, and fades in once it tells it has drawn; the old one is taken away
 * after. A 3D view builds a new WebGL canvas, which would flash the whole stage.
 */

/** How long the fade lasts, ms. */
export const FADE = 250;

/**
 * @param {HTMLElement} host holds the view shown
 * @param {(shown: () => void) => HTMLElement} make builds the new view, given what it calls once its
 *        first frame is drawn, or it failed
 * @param {...Node} extras added with the view once it shows (a legend)
 */
export function crossfade(host, make, ...extras) {
  const old = [...host.children];
  let revealed = false;
  /** @type {HTMLElement | null} */
  let view = null;
  const shown = () => {
    if (revealed || !view)
      return;
    revealed = true;
    // the old extras at once: new ones would be drawn over them
    old.filter(o => !o.classList.contains('terrain')).forEach(o => o.remove());
    host.append(...extras);
    view.classList.add('shown');
    setTimeout(() => old.forEach(o => o.remove()), FADE);
  };
  view = make(shown);
  view.classList.add('entering');
  host.append(view);
}
