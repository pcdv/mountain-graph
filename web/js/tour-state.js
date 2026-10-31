// @ts-check
/**
 * A tour of a file: views of it in an order, each how the page was set (view-state.js), what it showed beyond its
 * settings (the interval and the operation in focus, the frame hovered) and a caption; and how long a view stays,
 * and how long the camera takes to fly to the next. Kept in the browser for the file it was made on, and in a
 * Flamepack saved with it, beside the settings of the view in the page's member. No DOM: the tour is read from, and
 * written to, a `Storage`.
 */
import {checkedView} from './view-state.js';

/** @typedef {import('./kinds/page.js').Moment} Moment */

/**
 * @typedef {object} Slide
 * @property {Record<string, string>} settings how the page was set, as captureView() gave them
 * @property {Moment} moment what the view showed beyond its settings
 * @property {string} caption what the view shows, in a sentence or two; empty for none
 */

/**
 * @typedef {object} Tour
 * @property {Slide[]} slides
 * @property {number} stay how long a view stays when the tour plays, in seconds, once the camera is there
 * @property {number} fly how long the camera takes to fly from a view to the next, in seconds
 */

/** The tour's name in the page's member of a Flamepack. */
export const TOUR = 'tour';

/** Where the tour is kept, with the name of the file it is of. */
const KEY = 'mountaingraph.tour';

/** The most views a tour has, and the longest caption: a file's are not trusted. */
export const MOST = 100;
const CAPTION = 1000;

/** How long a view stays, and the flight, by default and at the least and the most, in seconds. */
export const STAY = {usual: 5, least: 1, most: 120};
export const FLY = {usual: 2, least: 0, most: 20};

/** The setting that holds the camera, among the others of what is shown. */
const SHOWN = 'mountaingraph.view';

/** @returns {Tour} one with no views */
export function emptyTour() {
  return {slides: [], stay: STAY.usual, fly: FLY.usual};
}

/**
 * @param {unknown} held as a file or the browser holds it: a tour, or its views alone
 * @returns {Tour} its views, their settings those of the view only, and its times within reason
 */
export function tourOf(held) {
  const tour = /** @type {any} */ (Array.isArray(held) ? {slides: held} : held);
  if (!tour || typeof tour !== 'object' || !Array.isArray(tour.slides))
    return emptyTour();
  return {
    slides: tour.slides.slice(0, MOST)
      .filter((/** @type {any} */ s) => s && typeof s === 'object' && s.settings && typeof s.settings === 'object')
      .map((/** @type {any} */ s) => ({settings: checkedView(s.settings), moment: momentOf(s.moment),
                                       caption: typeof s.caption === 'string' ? s.caption.slice(0, CAPTION) : ''})),
    stay: within(tour.stay, STAY),
    fly: within(tour.fly, FLY),
  };
}

/**
 * @param {unknown} value
 * @param {{usual: number, least: number, most: number}} range
 * @returns {number} the value, a number in the range, or the usual one
 */
export function within(value, {usual, least, most}) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(most, Math.max(least, value)) : usual;
}

/**
 * @param {unknown} held
 * @returns {Moment} what it is of a moment: the interval as numbers (the view checks it against the recording), a
 *          name, a path of names
 */
function momentOf(held) {
  const m = /** @type {any} */ (held);
  /** @type {Moment} */
  const moment = {};
  if (!m || typeof m !== 'object')
    return moment;
  const i = m.interval;
  if (i && typeof i === 'object' && ['from', 'to'].every(k => i[k] === undefined || typeof i[k] === 'number'))
    moment.interval = {...i.from !== undefined ? {from: i.from} : {}, ...i.to !== undefined ? {to: i.to} : {}};
  if (typeof m.operation === 'string' && m.operation.length <= CAPTION)
    moment.operation = m.operation;
  if (Array.isArray(m.hover) && m.hover.length <= 1000 && m.hover.every((/** @type {unknown} */ n) => typeof n === 'string'))
    moment.hover = m.hover;
  if (typeof m.peaks === 'boolean')
    moment.peaks = m.peaks;
  return moment;
}

/**
 * @param {string} file the name of the file shown
 * @param {Storage} [storage]
 * @returns {Tour} the tour kept, when it was made on a file of that name: an empty one otherwise
 */
export function keptTour(file, storage = globalThis.localStorage) {
  try {
    const kept = JSON.parse(storage.getItem(KEY) ?? 'null');
    return kept?.file === file ? tourOf(kept.tour ?? kept.slides) : emptyTour();
  }
  catch {
    return emptyTour();
  }
}

/**
 * @param {string} file the name of the file the tour is of
 * @param {Tour} tour one with no views is forgotten
 * @param {Storage} [storage]
 */
export function keepTour(file, tour, storage = globalThis.localStorage) {
  try {
    if (tour.slides.length)
      storage.setItem(KEY, JSON.stringify({file, tour}));
    else
      storage.removeItem(KEY);
  }
  catch {
    // storage unavailable or full: the tour lasts as long as the page
  }
}

/**
 * @param {Record<string, string>} settings
 * @returns {import('./views/terrain3d.js').Viewpoint | null} the camera they hold
 */
export function viewpointOf(settings) {
  try {
    const v = JSON.parse(settings[SHOWN] ?? 'null')?.viewpoint;
    return v && typeof v === 'object' && Array.isArray(v.position) && Array.isArray(v.target) ? v : null;
  }
  catch {
    return null;
  }
}

/**
 * A caption as the bar tells it: the text, and the web addresses in it (http or https) as links.
 *
 * @param {string} caption
 * @returns {(string | {href: string, text: string})[]} its parts in order, a link for each address; the full stop,
 *          comma or bracket that closes a sentence after one is not part of it
 */
export function captionParts(caption) {
  /** @type {(string | {href: string, text: string})[]} */
  const parts = [];
  let from = 0;
  for (const found of caption.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const text = found[0].replace(/[.,;:!?)\]]+$/, '');
    if (!/^https?:\/\/[^/.\s]+\./.test(text))
      continue;
    if (found.index > from)
      parts.push(caption.slice(from, found.index));
    parts.push({href: text, text});
    from = found.index + text.length;
  }
  if (from < caption.length)
    parts.push(caption.slice(from));
  return parts;
}

/**
 * @param {{settings: Record<string, string>, moment: Moment}} a
 * @param {{settings: Record<string, string>, moment: Moment}} b
 * @returns {boolean} whether the views differ only where the 3D camera is, and in the frame hovered: then the camera
 *          flies from one to the other, where anything else is drawn again
 */
export function onlyCamera(a, b) {
  const keys = new Set([...Object.keys(a.settings), ...Object.keys(b.settings)]);
  for (const key of keys)
    if (key !== SHOWN && a.settings[key] !== b.settings[key])
      return false;
  /** @param {Moment} m */
  const rest = ({interval, operation}) => canonical({interval: interval ?? null, operation: operation ?? null});
  return canonical(withoutCamera(a.settings[SHOWN])) === canonical(withoutCamera(b.settings[SHOWN]))
         && rest(a.moment) === rest(b.moment);
}

/**
 * @param {string | undefined} shown the setting of what is shown
 * @returns {unknown} it read, without the camera's place
 */
function withoutCamera(shown) {
  try {
    const v = JSON.parse(shown ?? 'null');
    if (v?.viewpoint && typeof v.viewpoint === 'object') {
      delete v.viewpoint.position;
      delete v.viewpoint.target;
    }
    return v;
  }
  catch {
    return shown;
  }
}

/**
 * @param {unknown} value
 * @returns {string} as JSON, the members of each object in order: the same for two values that are equal
 */
function canonical(value) {
  return JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x < y ? -1 : 1)) : v);
}
