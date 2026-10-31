// @ts-check
/**
 * How the page is set to show a file (the view, the shape of the land, the peaks counted, the camera),
 * kept in a Flamepack beside the profile so that whoever opens the file sees what its author showed.
 *
 * Only the settings of the view are kept. The anonymizing rules and what is a habit of the person
 * (the mouse, the width of the panels, which panes are open, which rows of the peaks table are unfolded) are not: a file shared is not a way to
 * read or to change them. No DOM: the settings are read from, and written to, a `Storage`.
 */

/** The member of a Flamepack that holds the settings. */
export const MEMBER = 'mountaingraph';

/** What is kept: a setting by its exact key, or by the start of it when it ends with a dot. */
const KEPT = [
  'mountaingraph.view',
  'mountaingraph.sampling',
  'mountaingraph.tuning',
  'mountaingraph.timeline.hold',
  'mountaingraph.peaks.',
  'mountaingraph.heap.',
];

/** The most a setting's value may hold: the camera and the tuning are a few hundred characters. */
const MAX_VALUE = 4000;

/** @param {string} key */
const isKept = key => KEPT.some(k => k.endsWith('.') ? key.startsWith(k) : key === k);

/** What the page keeps of what is shown: the camera, the peak chosen, and the rows of the table unfolded. */
const SHOWN = 'mountaingraph.view';

/**
 * @param {string} key
 * @param {string} value
 * @returns {string} the value as a file keeps it: what is shown, without the rows of the table that were
 *          unfolded, which is how the person read, not how the view is set (and may be long)
 */
function kept(key, value) {
  if (key !== SHOWN)
    return value;
  try {
    const shown = JSON.parse(value);
    if (shown && typeof shown === 'object' && !Array.isArray(shown)) {
      delete shown.open;
      return JSON.stringify(shown);
    }
  }
  catch {
    // not what the page writes: kept as it is
  }
  return value;
}

/**
 * @param {Storage} [storage]
 * @returns {Record<string, string>} the settings of the view, by key
 */
export function captureView(storage = localStorage) {
  /** @type {Record<string, string>} */
  const settings = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      const value = key !== null && isKept(key) ? storage.getItem(key) : null;
      if (key !== null && value !== null)
        settings[key] = kept(key, value);
    }
  }
  catch {
    // storage unavailable: nothing to keep
  }
  return Object.fromEntries(Object.entries(settings).sort(([a], [b]) => a < b ? -1 : 1));
}

/**
 * Sets the page as a file says. What the file holds is not trusted: only the settings of the view,
 * as strings of a sane size, are taken.
 *
 * @param {unknown} settings the member of a document
 * @param {Storage} [storage]
 * @returns {number} how many settings were taken
 */
export function applyView(settings, storage = localStorage) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    return 0;
  let taken = 0;
  try {
    for (const [key, value] of Object.entries(settings)) {
      if (isKept(key) && typeof value === 'string' && value.length <= MAX_VALUE) {
        storage.setItem(key, kept(key, value));
        taken++;
      }
    }
  }
  catch {
    // storage unavailable or full: the file opens as the page is set
  }
  return taken;
}
