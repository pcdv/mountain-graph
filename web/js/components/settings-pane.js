// @ts-check
/**
 * The settings pane: docked at the right of the view, opened and closed from
 * the header, left as it was. The view shrinks beside it rather than hide
 * under it, so that a setting changed is seen at once.
 */
import {readSetting, writeSetting} from '../lib/settings.js';

const KEY = 'mountaingraph.float.settings';

/**
 * @param {HTMLElement} pane
 * @param {HTMLButtonElement} toggle the header's button
 * @param {() => void} [resized] called as the view's room changes, if the view does not follow it itself
 *        (the 2D and 3D views do, by observing their size: they are not built again)
 */
export function settingsPane(pane, toggle, resized = () => {}) {
  /** @param {boolean} open */
  const set = open => {
    pane.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    writeSetting(KEY, open ? 'open' : 'closed');
    resized();
  };
  pane.hidden = readSetting(KEY) !== 'open';
  toggle.setAttribute('aria-expanded', String(!pane.hidden));
  toggle.addEventListener('click', () => set(Boolean(pane.hidden)));
  pane.querySelector('.close')?.addEventListener('click', () => set(false));
  pane.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      set(false);
      toggle.focus();
    }
  });
}
