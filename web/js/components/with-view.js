// @ts-check
/**
 * The choice, in the file menu's Save, of saving how the view is set with the profile: the view, the
 * peaks counted, the camera. The file then opens as it is shown now (view-state.js).
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {MEMBER} from '../view-state.js';

/** Whether the choice is on, kept. */
const KEY = 'mountaingraph.export.view';

/**
 * @param {() => Record<string, string>} capture the settings of the view, as they are now
 * @returns {{element: HTMLElement, members: () => object}} the checkbox, and the members of the document
 *          to add to it: the settings when it is checked, none otherwise
 */
export function withView(capture) {
  const box = h('input', {type: 'checkbox'});
  box.checked = readSetting(KEY) === 'true';
  box.addEventListener('change', () => writeSetting(KEY, String(box.checked)));
  return {
    element: h('label', {class: 'check',
                         title: 'Keeps how the view is set: the view, the shape of the land, the peaks counted, the '
                           + 'camera. Whoever opens the file sees it as it is shown now. The anonymizing settings '
                           + 'are not kept'},
              box, 'With the settings of the view'),
    members: () => box.checked ? {[MEMBER]: capture()} : {},
  };
}
