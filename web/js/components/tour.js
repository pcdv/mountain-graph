// @ts-check
/**
 * A tour of the file shown: views of it, each with a caption, shown one after the other. A view is taken as the
 * page shows it (T, or "Add this view" in the tour's section of the settings): the settings of the view, the
 * camera, the interval and the operation in focus, and the frame hovered with the box telling its path. The section
 * puts the views in order, gives them their captions, and sets how long a view stays and how long the camera flies.
 * Played (P), on its own or a view at a time, a bar at the foot of the window gives the caption and the steps, and
 * Escape ends it. Where two views differ only by the 3D camera and the frame hovered, it flies from one to the
 * other; otherwise the view is drawn again. A file saved with its tour plays it when opened.
 */
import {h, replace} from '../lib/dom.js';
import {captureView, setView} from '../view-state.js';
import {tourOf, keptTour, keepTour, onlyCamera, viewpointOf, captionParts, within,TOUR, MOST, STAY, FLY} from '../tour-state.js';
import {flyTo} from '../views/terrain3d.js';
import {hoverPath} from './terrain-frame.js';
import {field, folded} from './form.js';
import {say} from './toast.js';
import {PEAKS, paneOpen, openPane} from '../kinds/page.js';

/** @typedef {import('../tour-state.js').Slide} Slide */

/** The icons of the buttons, drawn with a stroke (.button svg). */
const ICONS = /** @type {const} */ ({
  previous: 'M10 3.5L5.5 8l4.5 4.5',
  next: 'M6 3.5L10.5 8 6 12.5',
  play: 'M5 3.5v9l7.5-4.5z',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  end: 'M4 4l8 8M12 4l-8 8',
  up: 'M3.5 10L8 5.5l4.5 4.5',
  down: 'M3.5 6L8 10.5 12.5 6',
  retake: 'M12.8 9.5A5 5 0 1 1 11.5 4.5M12 2v3h-3',
});

/** @typedef {keyof typeof ICONS} Icon */

/** @type {import('../kinds/page.js').Page | null} */
let page = null;
/** The name of the file the tour is of. */
let file = '';
/** @type {Slide[]} */
let slides = [];
/** How long a view stays once the camera is there, and how long it flies to the next, in seconds. */
let stay = STAY.usual, fly = FLY.usual;
/** @returns {import('../tour-state.js').Tour} the tour, to keep or to save */
const current = () => ({slides, stay, fly});
/** @returns {number} ms from a view to the next, when the tour plays */
const period = () => (fly + stay) * 1000;
/** The view of the tour shown, -1 when the tour is not. */
let at = -1;
/** Whether the tour goes on to the next view on its own. */
let playing = false;
/** @type {number | undefined} */
let timer;
/** Draws the tour's section again: the one in the settings pane now. */
let redraw = () => {};
/** How far the list of views is scrolled: kept for the section drawn again with the settings. */
let scrolled = 0;

/**
 * @param {Icon} name
 * @param {string} label what it does, and its key
 * @param {() => void} action
 * @returns {HTMLButtonElement}
 */
function icon(name, label, action) {
  const button = /** @type {HTMLButtonElement} */ (h('button', {type: 'button', class: 'button icon', title: label,
                                                                'aria-label': label, onclick: action}));
  draw(button, name);
  return button;
}

/** @param {HTMLElement} button @param {Icon} name */
function draw(button, name) {
  button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

/**
 * @typedef {object} Bar the bar that plays the tour, over whatever view is drawn under it
 * @property {HTMLElement} element
 * @property {HTMLElement} caption of the view shown
 * @property {HTMLElement} count which view it is, of how many
 * @property {HTMLElement} time the time left before the next view
 * @property {HTMLButtonElement} toggle plays or pauses the tour
 */

/** @type {Bar | null} made when the tour is first shown */
let bar = null;

/** @returns {Bar} */
function playerBar() {
  if (bar)
    return bar;
  const caption = h('p', {class: 'tour-caption'});
  const count = h('span', {class: 'tour-count'});
  const time = h('div', {class: 'tour-time'});
  const toggle = icon('play', 'Play (Space)', () => playing ? pause() : play());
  const element = h('div', {class: 'tour-player', role: 'region', 'aria-label': 'Tour'},
    caption,
    h('div', {class: 'tour-steps'},
      icon('previous', 'Previous view (←)', () => step(-1)),
      toggle,
      icon('next', 'Next view (→)', () => step(1)),
      count,
      icon('end', 'End the tour (Esc)', stop)),
    time);
  document.body.append(element);
  return bar = {element, caption, count, time, toggle};
}

/**
 * Puts a caption on the bar, its web addresses as links that open in another tab. The tour pauses when one is
 * followed, to be read on from where it was left.
 *
 * @param {HTMLElement} where
 * @param {string} text
 */
function tell(where, text) {
  replace(where, ...captionParts(text).map(part => typeof part === 'string' ? part
    : h('a', {href: part.href, target: '_blank', rel: 'noopener noreferrer', onclick: () => pause()}, part.text)));
}

/** Says on the bar which view is shown, its caption, and whether the tour goes on. */
function showPlayer() {
  if (at < 0) {
    if (bar)
      bar.element.hidden = true;
    return;
  }
  const {element, caption, count, time, toggle} = playerBar();
  element.hidden = false;
  tell(caption, slides[at]?.caption ?? '');
  count.textContent = `${at + 1} / ${slides.length}`;
  draw(toggle, playing ? 'pause' : 'play');
  toggle.title = playing ? 'Pause (Space)' : 'Play (Space)';
  toggle.setAttribute('aria-label', toggle.title);
  // what is at the foot of the view goes over it (app.css)
  document.body.style.setProperty('--tour-bar', `${element.offsetHeight}px`);
  // the time left before the next view, run down along the foot of the bar
  time.style.animation = 'none';
  if (playing && at + 1 < slides.length) {
    void time.offsetWidth;
    time.style.animation = `tour-time ${period()}ms linear forwards`;
  }
}

/** The tour changed: kept, and its section and its bar say so. */
function changed() {
  if (at >= slides.length)
    at = slides.length - 1;
  keepTour(file, current());
  redraw();
  showPlayer();
}

/** @returns {Slide | null} the view as the page shows it, none when it shows no file */
function take() {
  if (!page || !page.main.classList.contains('stage'))
    return null;
  page.remember();
  const peaks = paneOpen(PEAKS);
  return {settings: captureView(), moment: {...page.moment(), ...peaks !== undefined ? {peaks} : {}}, caption: ''};
}

/** Adds the view shown to the tour: after the view of the tour shown, if any, at its end otherwise. */
function add() {
  if (slides.length >= MOST) {
    say(`A tour holds ${MOST} views at most`);
    return;
  }
  const slide = take();
  if (!slide)
    return;
  const where = at >= 0 ? at + 1 : slides.length;
  slides.splice(where, 0, slide);
  if (at >= 0)
    at = where;
  changed();
  say(`View ${where + 1} of ${slides.length} added to the tour`);
}

/**
 * Shows a view of the tour: the camera flown there when only it moves, and the frame hovered changed; the view
 * drawn again as it was set otherwise.
 *
 * @param {number} i
 */
function show(i) {
  const slide = slides[i];
  if (!page || !slide)
    return;
  at = i;
  page.remember();
  const to = viewpointOf(slide.settings);
  if (slide.moment.peaks !== undefined)
    openPane(PEAKS, slide.moment.peaks);
  if (to && onlyCamera({settings: captureView(), moment: page.moment()}, slide) && flyTo(to, fly * 1000))
    hoverPath(slide.moment.hover ?? null);
  else {
    setView(slide.settings);
    page.redisplay(slide.moment);
  }
  redraw();
  showPlayer();
  wait();
}

/** Waits for the next view when the tour plays: stops on the last one. */
function wait() {
  clearTimeout(timer);
  if (playing)
    timer = setTimeout(() => at + 1 < slides.length ? show(at + 1) : pause(), period());
}

/** Plays the tour on: from the view shown, or from the first. */
function play() {
  if (!slides.length) {
    say('The tour has no views: T adds the view shown');
    return;
  }
  playing = true;
  if (at < 0 || at + 1 >= slides.length)
    show(0);
  else {
    showPlayer();
    wait();
  }
}

/** The tour stays on the view shown. */
function pause() {
  playing = false;
  clearTimeout(timer);
  showPlayer();
}

/** @param {number} by views forward, or back */
function step(by) {
  const to = Math.max(0, Math.min(slides.length - 1, (at < 0 ? -1 : at) + by));
  if (to !== at)
    show(to);
}

/** Ends the tour: the page stays as the view shown left it. */
function stop() {
  pause();
  at = -1;
  redraw();
  showPlayer();
}

/**
 * @param {number} from
 * @param {number} to
 */
function move(from, to) {
  const [slide] = slides.splice(from, 1);
  slides.splice(to, 0, slide);
  if (at === from)
    at = to;
  else if (at === to)
    at = from;
  changed();
}

/** @param {number} i the view to take again, as the page shows it now */
function retake(i) {
  const slide = take();
  if (slide) {
    slides[i].settings = slide.settings;
    slides[i].moment = slide.moment;
    changed();
    say(`View ${i + 1} taken again`);
  }
}

/** @param {number} i */
function remove(i) {
  slides.splice(i, 1);
  if (at > i)
    at--;
  else if (at === i)
    at = slides.length ? Math.min(i, slides.length - 1) : -1;
  changed();
}

/**
 * The tour's keys, and the bar's: T adds the view shown, P plays the tour or pauses it; while it is shown, the
 * arrows (and Page Up, Page Down) step through it, Space plays or pauses it, Escape ends it. A hand on the view
 * pauses it.
 *
 * @param {import('../kinds/page.js').Page} on
 */
export function installTour(on) {
  page = on;
  page.main.addEventListener('pointerdown', () => playing && pause());
  // before the 3D view's own keys, which move the camera with the arrows
  addEventListener('keydown', e => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    // a button with the focus is pressed by these, which would act twice
    const pressing = target?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter');
    if (e.ctrlKey || e.metaKey || e.altKey || typing || pressing || document.querySelector('dialog[open]'))
      return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 't' && !e.repeat)
      add();
    else if (key === 'p' && !e.repeat)
      playing ? pause() : play();
    else if (at < 0)
      return;
    else if (key === 'ArrowRight' || key === 'PageDown')
      step(1);
    else if (key === 'ArrowLeft' || key === 'PageUp')
      step(-1);
    else if (key === ' ')
      playing ? pause() : play();
    else if (key === 'Escape')
      stop();
    else
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}

/**
 * The tour of a file opened: the one it holds, played at once, or else the one kept for a file of its name. Called
 * once its view is shown.
 *
 * @param {string} name of the file
 * @param {unknown} [held] the tour the file holds, as read: checked here
 */
export function openTour(name, held) {
  stop();
  file = name;
  scrolled = 0;
  const own = tourOf(held);
  const tour = own.slides.length ? own : keptTour(name);
  ({slides, stay, fly} = tour);
  if (own.slides.length)
    keepTour(name, own);
  redraw();
  if (own.slides.length)
    play();
}

/** No file is shown: no tour either, until one is opened. The one kept stays kept, for the file opened again. */
export function closeTour() {
  stop();
  file = '';
  slides = [];
  stay = STAY.usual;
  fly = FLY.usual;
}

/** @returns {HTMLElement} the tour's section of the settings: its views in order, each with its caption */
export function tourSection() {
  const list = h('ol', {class: 'tour-list'});
  const empty = h('p', {class: 'muted tour-empty'},
    'Set the page as a view should be seen, then add it (T). Played (P), the tour shows its views one after the '
    + 'other, each with its caption, and a file saved with it plays it when opened.');
  const play = h('button', {type: 'button', class: 'button primary', title: 'Plays the tour from its first view (P)',
                            onclick: () => {
                              playing = true;
                              show(0);
                            }}, 'Play');
  const clear = h('button', {type: 'button', class: 'reset', title: 'Removes every view of the tour',
                             onclick: () => {
                               if (confirm(`Remove the ${slides.length} views of the tour?`)) {
                                 stop();
                                 slides = [];
                                 changed();
                               }
                             }}, 'Remove all');
  const row = (/** @type {Slide} */ slide, /** @type {number} */ i) => {
    const text = /** @type {HTMLTextAreaElement} */ (h('textarea', {rows: 1, spellcheck: true, placeholder: 'Caption',
                                                                     'aria-label': `Caption of view ${i + 1}`}));
    text.value = slide.caption;
    text.addEventListener('input', () => {
      slide.caption = text.value;
      keepTour(file, current());
      if (at === i && bar)
        tell(bar.caption, slide.caption);
    });
    const up = icon('up', 'Move it up', () => move(i, i - 1));
    const down = icon('down', 'Move it down', () => move(i, i + 1));
    up.disabled = i === 0;
    down.disabled = i === slides.length - 1;
    return h('li', {class: 'tour-slide', 'aria-current': at === i ? 'step' : null},
      h('button', {type: 'button', class: 'tour-number', title: 'Shows this view', onclick: () => show(i)}, String(i + 1)),
      text,
      h('span', {class: 'tour-tools'}, up, down,
        icon('retake', 'Takes the view shown in its place', () => retake(i)),
        icon('end', 'Removes it from the tour', () => remove(i))));
  };
  /**
   * @param {{usual: number, least: number, most: number}} range in seconds
   * @param {(seconds: number) => void} set
   * @returns {HTMLInputElement} a number of seconds, kept with the tour as it is changed
   */
  const seconds = (range, set) => {
    const input = /** @type {HTMLInputElement} */ (h('input', {type: 'number', min: range.least, max: range.most,
                                                               step: 0.5}));
    input.addEventListener('change', () => {
      set(within(input.valueAsNumber, range));
      changed();
    });
    return input;
  };
  const stays = seconds(STAY, s => stay = s);
  const flies = seconds(FLY, s => fly = s);
  const times = h('div', {class: 'tour-times'},
    field('Each view', h('span', {class: 'unit'}, stays, ' s'),
          'How long a view stays when the tour plays, once the camera is there'),
    field('Flight', h('span', {class: 'unit'}, flies, ' s'),
          'How long the 3D camera takes to fly to the next view, when only it moves'));
  const section = folded('Tour',
    h('div', {class: 'tour-actions'},
      h('button', {type: 'button', class: 'button', title: 'Adds the view as the page shows it now (T)', onclick: add},
        'Add this view'),
      play),
    empty, list, times, clear);
  redraw = () => {
    empty.hidden = slides.length > 0;
    play.disabled = slides.length === 0;
    clear.hidden = times.hidden = slides.length === 0;
    stays.value = String(stay);
    flies.value = String(fly);
    replace(list, slides.map(row));
    place();
    requestAnimationFrame(place);
  };
  // the list is drawn again at each change, and the whole section with the settings when a view is shown anew:
  // kept where it was scrolled, and moved only to show the view of the tour
  const place = () => {
    list.scrollTop = scrolled;
    const shown = /** @type {HTMLElement | undefined} */ (list.children[at]);
    // the list is positioned, so the offsets of its rows are within it
    if (shown && (shown.offsetTop < list.scrollTop || shown.offsetTop + shown.offsetHeight > list.scrollTop + list.clientHeight))
      list.scrollTop = shown.offsetTop;
  };
  list.addEventListener('scroll', () => scrolled = list.scrollTop);
  section.addEventListener('toggle', place);
  redraw();
  return section;
}

/**
 * The choice, in the file menu's Save, of keeping the tour in the file: shown when there is one, on at first.
 *
 * @returns {{element: HTMLElement, fit: () => void, members: () => object}} the checkbox; what fits it to the tour
 *          as it is now; and what to add to the page's member of the document
 */
export function withTour() {
  const box = h('input', {type: 'checkbox'});
  box.checked = true;
  const text = h('span');
  const element = h('label', {class: 'check', title: 'Keeps the tour: whoever opens the file is shown its views, '
                                + 'with their captions'}, box, text);
  const fit = () => {
    element.hidden = slides.length === 0;
    text.textContent = `With the tour (${slides.length} ${slides.length === 1 ? 'view' : 'views'})`;
  };
  fit();
  return {element, fit, members: () => box.checked && slides.length ? {[TOUR]: current()} : {}};
}
