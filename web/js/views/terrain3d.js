// @ts-check
/**
 * The terrain in 3D: the same grid as the map, a plane whose points are
 * raised to the heights of its cells, tinted and lined as on the map, lit
 * from the north-west, turned and zoomed with the mouse, its relief made
 * higher or flatter, built of blocks (blocks3d.js), or islands in a sea
 * (sea3d.js). The peaks in sight
 * are named, and the trails between related mountains; a frame
 * hovered is lit in every mountain, and a mountain clicked shows its callers
 * (terrain-frame.js), as on the map.
 *
 * three.js is loaded from a CDN (see the import map of index.html) when the
 * view is first shown: the rest of the page does without it.
 */
import {h, replace} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {terrainFrame, short} from '../components/terrain-frame.js';
import {FADE} from '../components/crossfade.js';
import {field} from '../components/form.js';
import {contour, levels} from '../model/contours.js';
import {zoneCells} from '../model/zones.js';
import {helpTip} from '../components/help.js';
import {palette, tint, hued, DEPTH, LINES} from './palette.js';
import {blocks, COLUMNS, FEWEST} from './blocks3d.js';
import {sea, sky, shores, bump, landColour, bedColour, LEVEL, DEEP, HAZE, SUN, SEA_TUNING} from './sea3d.js';
import {flamePanel} from './flame3d.js';
import {pinch} from './pinch.js';
import {tipOf, placeTip} from './flame-draw.js';

/** @typedef {import('../model/terrain.js').Terrain} Terrain */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/** The modules, resolved by the import map: strings, so that the type checker leaves them. */
const THREE = /** @type {string} */ ('three'), CONTROLS = /** @type {string} */ ('three/addons/controls/OrbitControls.js');

/** The height of the highest peak, as a share of the terrain's longer side: at first, and its range. */
const RELIEF = 0.16, FLATTEST = 0.04, HIGHEST = 0.5;

/** The highest the sea can be, as a share of the terrain's longer side. */
const HIGHEST_SEA = 0.12;

/** How much the distance changes per pixel of wheel: e^(100 ZOOM), about 15%, per notch of a mouse. */
const ZOOM = 0.0014;
/** Chrome and its kin: a full screen uses up the key press that asked for it, so the mouse is taken first. */
const CHROMIUM = typeof navigator !== 'undefined'
  && !!(/** @type {any} */ (navigator).userAgentData?.brands?.some((/** @type {{brand: string}} */ b) => /Chromium/.test(b.brand)));

/**
 * Where the camera is, and the point it turns around, in units of the
 * terrain's longer side: the same place over a terrain made larger or
 * smaller by a setting.
 *
 * @typedef {object} Viewpoint
 * @property {number[]} [position]
 * @property {number[]} [target]
 * @property {number} [relief] the height of the highest peak, as a share of the longer side
 * @property {boolean} [blocks] whether the land is built of blocks
 * @property {number} [columns] of blocks, along the longer side
 * @property {boolean} [islands] whether the plain is a sea, the mountains islands
 * @property {number} [level] of the sea, as a share of the longer side
 * @property {{x: number, y: number, k: number}} [map] where the 2D view is: the cell at its centre, and
 *           the zoom, 1 showing the whole terrain
 * @property {string[]} [flame] the names from the root down to the frame the flame graph is zoomed on
 * @property {boolean} [panel] whether a flame graph stands behind the terrain
 */

/**
 * What can be tuned of the 3D view, the islands' with it.
 *
 * @typedef {{curve: number} & import('./sea3d.js').SeaTuning} ViewTuning
 * curve: heights as the time to that power: 0.5, its square root, lets small peaks show; 1 makes them
 * as high as their time
 */

/** @type {ViewTuning} */
export const VIEW_TUNING = {curve: 0.65, ...SEA_TUNING};

const INVERT_KEY = 'mountaingraph.invertMouse';
let inverted = readSetting(INVERT_KEY) === '1';

/** @returns {boolean} whether the mouse moving up looks down when the mouse is locked to the view (key F) */
export const invertedMouse = () => inverted;

/** @param {boolean} on remembered */
export function invertMouse(on) {
  inverted = on;
  writeSetting(INVERT_KEY, on ? '1' : '0');
}

/**
 * How far the flame graph standing behind the terrain leans back from upright, toward the angle the camera
 * looks down at by default (about 37°).
 */
const PANEL_LEAN = Math.PI / 6;

/** How much of its colour the land keeps along the lines of the zones. */
const ZONE_LINE = 0.6;

/** Frees the view shown last, and those still being built before it: a page has few WebGL contexts. */
let release = () => {};

/** Stops the view being built, if it has not shown yet: another takes its place. */
let pending = () => {};

/** Frees the 3D view shown, if any: when another view takes its place. */
export function closeTerrainView() {
  pending();
  pending = () => {};
  release();
  release = () => {};
}

/**
 * @param {Terrain} t
 * @param {Frame[]} trees the mountains it was raised from, in its order
 * @param {import('../components/terrain-frame.js').Selection} selection the peak whose panel shows
 * @param {Viewpoint} viewpoint where the camera was, kept up to date as it moves, so that it stays
 *        there when the view is built again; empty at first, for a view of the whole terrain
 * @param {Float64Array | null} [hues] per node, the hue of its package (hues.js); none to colour by height only
 * @param {Partial<ViewTuning>} [tuning] the defaults (VIEW_TUNING) changed
 * @param {() => void} [shown] called once the view has drawn, or could not: it may then replace
 *        the one shown before, which is kept until it has faded out (crossfade.js) and not freed
 *        by this call
 * @param {HTMLElement | null} [knobsIn] where the controls of the relief, the islands and the blocks go
 *        (the settings pane), in place of those of the view before; none, over the view
 * @param {(() => Frame) | null} [flameOf] the tree of the whole profile, for a flame graph standing
 *        behind the terrain: made only when it is shown; none, and there is no such choice
 * @returns {HTMLElement}
 */
export function terrainView(t, trees, selection, viewpoint, hues = null, tuning = {}, shown = () => {},
                            knobsIn = null, flameOf = null) {
  const tuned = {...VIEW_TUNING, ...tuning};
  // the view before this one stays on show, so freed only once this one has taken over
  const before = release;
  let gone = false, disposed = false;
  // one built before this one showed is of no use any more
  pending();
  const abort = () => gone = true;
  pending = abort;
  const settle = () => {
    if (pending === abort)
      pending = () => {};
  };
  release = () => {
    gone = true;
    before();
  };
  let redraw = () => {};
  const frame = terrainFrame(t, trees, selection, () => redraw());
  const loading = h('p', {class: 'muted'}, 'Loading three.js…');
  frame.holder.append(loading);
  frame.holder.classList.add('three');

  build().catch(e => {
    loading.textContent = `three.js could not be loaded: ${e.message}`;
    settle();
    shown();
  });
  return frame.section;

  async function build() {
    /** @type {any} */
    const T = await import(THREE);
    const {OrbitControls} = await import(CONTROLS);
    if (gone)
      return;
    const colors = palette();
    const W = t.width, H = t.height, side = Math.max(W, H);
    let relief = viewpoint.relief ?? RELIEF;
    let level = viewpoint.level ?? LEVEL;
    /** @param {number} height ms @returns {number} its y */
    const lift = height => t.top > 0 && height > 0 ? (height / t.top) ** tuned.curve * relief * side : 0;

    // a point per cell, row 0 the farthest
    const geometry = new T.PlaneGeometry(W - 1, H - 1, W - 1, H - 1);
    geometry.rotateX(-Math.PI / 2);
    // smoothed over two cells, shape and tint, so that steps a cell wide do not stripe the slopes;
    // picking keeps the cells
    const position = geometry.attributes.position;
    const smooth = blur(blur(t.heights, W, H), W, H);

    // the map's contour lines, but of the smoothed heights: on the surface; their y set by raise()
    const steps = levels(t.top, LINES, t.top * DEPTH);
    const segments = steps.map(level => contour(smooth, W, H, level));
    const points = new Float32Array(segments.reduce((n, s) => n + s.length / 2 * 3, 0));
    let k = 0;
    for (const s of segments)
      for (let i = 0; i < s.length; i += 2, k += 3) {
        points[k] = s[i] - 0.5 - (W - 1) / 2;
        points[k + 2] = s[i + 1] - 0.5 - (H - 1) / 2;
      }
    const lines = new T.BufferGeometry();
    lines.setAttribute('position', new T.BufferAttribute(points, 3));

    // or the plain a sea, the mountains islands in it
    let islands = viewpoint.islands ?? false;
    /** @type {import('./sea3d.js').Shores | null} found when first shown */
    let shore = null;
    /** @param {number} i a cell @returns {number} its y */
    const ground = i => {
      if (!islands)
        return lift(smooth[i]);
      // the land keeps its shape under the water, bumps included, so that the sea changes only where
      // it stands; going down to the bed away from the land. Bumped less where the land is low
      const height = lift(smooth[i]), amplitude = tuned.bump * side;
      const low = Math.min(1, height / (2 * amplitude));
      const bumped = height + bump(i % W, Math.floor(i / W)) * amplitude * low * low * (3 - 2 * low);
      return shore?.inland[i] ? bumped : bumped - (shore?.depth[i] ?? 0) * DEEP * side;
    };

    /** sets the heights of the surface and of the lines to the relief */
    const raise = () => {
      // the land is what rises over the sea: lower, it is the bed, not a shelf under the water;
      // found again as the relief changes
      if (islands)
        shore = shores(Float64Array.from(smooth, h => lift(h) - level * side), W, H);
      for (let i = 0; i < W * H; i++)
        position.setY(i, ground(i));
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      let k = 1;
      segments.forEach((s, l) => {
        // a little above: a line across a square can cut under the two triangles drawing it
        const y = lift(steps[l]) + side / 2000;
        for (let i = 0; i < s.length; i += 2, k += 3) {
          // islands: on the land lowered toward their beaches
          const cell = Math.min(H - 1, Math.round(s[i + 1])) * W + Math.min(W - 1, Math.round(s[i]));
          points[k] = islands ? Math.min(y, ground(cell) + side / 2000) : y;
        }
      });
      lines.attributes.position.needsUpdate = true;
      lines.computeBoundingSphere();
    };
    raise();

    // the map's colours, in the linear space three.js lights in
    const linear = Float32Array.from({length: 256}, (_, c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const base = new Float32Array(3 * W * H);
    const paint = () => {
      for (let i = 0; i < W * H; i++) {
        const x = i % W, y = Math.floor(i / W);
        // how steep, from the heights around, raised: rock past a slope as tuned
        const slope = () => Math.hypot(position.getY(Math.min(i + 1, W * H - 1)) - position.getY(Math.max(i - 1, 0)),
                                       position.getY(Math.min(i + W, W * H - 1)) - position.getY(Math.max(i - W, 0))) / 2;
        const height = !islands || !shore ? tint(colors, smooth[i], t.top)
          : shore.inland[i] > 0 ? landColour((smooth[i] / t.top) ** tuned.curve, shore.inland[i],
                                       Math.max(0, Math.min(1, (slope() - tuned.rock) / tuned.rock)), x, y)
          : bedColour(shore.depth[i]);
        const c = hues && t.cells[i] >= 0 ? hued(height, hues[t.cells[i]]) : height;
        // darker along the lines of the zones, so that what a hover will pick is seen before it is
        const dark = edges[i] ? ZONE_LINE : 1;
        base[3 * i] = dark * linear[c[0]], base[3 * i + 1] = dark * linear[c[1]], base[3 * i + 2] = dark * linear[c[2]];
      }
    };
    const edges = zoneCells(t);
    paint();
    const lit = colors.lit.map(c => linear[c]);
    const color = new T.BufferAttribute(base.slice(), 3);
    geometry.setAttribute('color', color);

    const material = new T.MeshLambertMaterial({vertexColors: true, polygonOffset: true,
                                                polygonOffsetFactor: 1, polygonOffsetUnits: 1});
    const scene = new T.Scene();
    const surface = new T.Mesh(geometry, material);
    scene.add(surface);
    // the colour of the map's lines, its alpha as the opacity: three.js colours have none
    const [r, g, b, a = 1] = (colors.line.match(/[\d.]+/g) || []).map(Number);
    const lineMaterial = new T.LineBasicMaterial({color: new T.Color(r / 255, g / 255, b / 255).convertSRGBToLinear(),
                                                  transparent: true, opacity: a});
    const contours = new T.LineSegments(lines, lineMaterial);
    scene.add(contours);

    // the trails between related mountains, on the plain: the mountains hide them where they cross
    const trailLines = new T.BufferGeometry().setFromPoints(t.trails.flatMap(trail => {
      const [x1, y1, x2, y2] = trail.line;
      return [new T.Vector3(x1 - 0.5 - (W - 1) / 2, side / 1000, y1 - 0.5 - (H - 1) / 2),
              new T.Vector3(x2 - 0.5 - (W - 1) / 2, side / 1000, y2 - 0.5 - (H - 1) / 2)];
    }));
    const trailMaterial = new T.LineDashedMaterial({color: colors.text, dashSize: side / 150, gapSize: side / 200,
                                                    transparent: true, opacity: 0.7});
    const trailSegments = new T.LineSegments(trailLines, trailMaterial);
    trailSegments.computeLineDistances();
    scene.add(trailSegments);

    // or the land in blocks, built again as the relief changes
    /** @type {import('./blocks3d.js').Blocks | null} */
    let cubes = null;
    let blocky = viewpoint.blocks ?? false;
    let columns = viewpoint.columns ?? COLUMNS;
    const blockify = () => {
      if (cubes) {
        scene.remove(cubes.mesh);
        cubes.dispose();
        cubes = null;
      }
      if (blocky) {
        cubes = blocks(T, t, {lift, hues, colors, columns, linear: rgb => Array.from(rgb, c => linear[c]),
                              sea: islands ? {level: level * side, deep: DEEP * side, bed: bedColour,
                                              depths: (land, w, h) => shores(land, w, h).depth} : null});
        scene.add(cubes.mesh);
      }
      surface.visible = trailSegments.visible = !blocky;
      // islands without the lines: the land and the sea tell the heights
      contours.visible = !blocky && !islands;
      water.mesh.visible = islands;
      dome.mesh.visible = islands;
      scene.fog = islands ? haze : null;
      sun.color.set(islands ? SUN : 0xffffff);
    };
    const water = sea(T, side, level);
    scene.add(water.mesh);
    // a sky at sunset, hazy toward the horizon, the sun low and warm
    const dome = sky(T, side * 9);
    scene.add(dome.mesh);
    const haze = new T.Fog(HAZE, side * 1.6, side * 7);
    // or a flame graph standing behind the terrain, made when first shown
    /** @type {import('./flame3d.js').FlamePanel | null} */
    let panel = null;
    let flaming = Boolean(flameOf && viewpoint.panel);
    /** @returns {{foot: number, top: number, back: number}} where the panel stands: the y of its foot and of its
     *          top, and the z of its top, the farthest back it goes; its foot is at the far edge of the terrain */
    const panelSpan = () => {
      const h = panel?.height() ?? 0;
      // on the plain, or the sea: a peak near the far edge may hide its foot, which is fine
      const foot = (islands ? level * side : 0) + side / 100;
      return {foot, top: foot + h * Math.cos(PANEL_LEAN), back: -(H - 1) / 2 - side / 20 - h * Math.sin(PANEL_LEAN)};
    };
    // leaning back, facing the camera looking down on the terrain, its foot behind the terrain's far edge
    const placePanel = () => {
      if (!panel)
        return;
      const {foot} = panelSpan(), half = panel.height() / 2;
      panel.mesh.rotation.x = -PANEL_LEAN;
      panel.mesh.position.set(0, foot + half * Math.cos(PANEL_LEAN), -(H - 1) / 2 - side / 20 - half * Math.sin(PANEL_LEAN));
    };
    // the trails on the water, as sea lanes
    const flood = () => {
      trailSegments.position.y = islands ? level * side : 0;
      placePanel();
    };
    flood();
    scene.add(new T.HemisphereLight(0xffffff, 0x8a8170, 1.8));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 1.6, -0.6);
    scene.add(sun);
    blockify();

    // the mountain clicked, circled at its foot
    const ring = new T.LineLoop(
      new T.BufferGeometry().setFromPoints(Array.from({length: 96}, (_, k) =>
        new T.Vector3(Math.cos(k * Math.PI / 48), 0, Math.sin(k * Math.PI / 48)))),
      new T.LineBasicMaterial({color: colors.text}));
    scene.add(ring);

    const renderer = new T.WebGLRenderer({antialias: true, preserveDrawingBuffer: true}); // kept, for a screenshot
    /** shows the panel or takes it away, as the setting says */
    const stand = () => {
      if (flaming && !panel && flameOf) {
        // as wide as the terrain, a little behind its far edge
        panel = flamePanel(T, flameOf(), W, renderer.capabilities.getMaxAnisotropy());
        flood();
        scene.add(panel.mesh);
      }
      else if (!flaming && panel) {
        scene.remove(panel.mesh);
        panel.dispose();
        panel = null;
        tip.hidden = true;
      }
    };
    // what the panel's frame hovered is
    const tip = h('div', {class: 'flame-tip', hidden: true});
    renderer.setPixelRatio(devicePixelRatio || 1);
    renderer.setClearColor(colors.halo);
    const camera = new T.PerspectiveCamera(40, 1, side / 100, side * 14);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    // looking around from where the camera stands, the mouse locked to the view (key F)
    let looking = false;
    // not into the terrain, nor so close that zooming stops (it scales the distance), nor lost far away
    controls.minDistance = side / 10;
    controls.maxDistance = side * 4;
    // zoomed here in proportion to the wheel's delta: the controls zoom a whole step per event, and a
    // touchpad sends dozens of small ones per gesture
    controls.enableZoom = false;
    /** @param {number} factor what the distance to the target is multiplied by */
    const zoom = factor => {
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.max(controls.minDistance, Math.min(controls.maxDistance, offset.length() * factor));
      camera.position.copy(controls.target).add(offset.setLength(distance));
      controls.update();
    };
    renderer.domElement.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
      e.preventDefault();
      if (looking)
        return;
      zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1) * ZOOM));
    }, {passive: false});
    // two fingers moving apart come closer: the controls' own pinch went with their zoom
    pinch(renderer.domElement, ratio => !looking && zoom(1 / ratio));

    const labels = h('div', {class: 'peak-labels'});
    // the peaks, then the trails halfway, named after the caller they share
    const spots = [
      ...t.mountains.map(m => ({label: short(m.name), x: m.x, y: m.y, h: () => lift(t.nodes[m.node].total) + side / 60})),
      ...t.trails.map(({caller, line: [x1, y1, x2, y2]}) =>
        ({label: short(caller), x: (x1 + x2) / 2, y: (y1 + y2) / 2, h: () => side / 200})),
    ];
    const names = spots.map((s, k) => h('span', {class: k < t.mountains.length ? '' : 'trail'}, s.label));
    labels.append(...names);
    const slider = h('input', {type: 'range', min: FLATTEST, max: HIGHEST, step: 0.01, value: relief,
                               oninput: () => {
                                 viewpoint.relief = relief = Number(slider.value);
                                 raise();
                                 placePanel();
                                 if (islands) {
                                   // steeper or flatter: more rock or less
                                   paint();
                                   color.array.set(base);
                                 }
                                 if (blocky)
                                   blockify();
                                 redraw();
                               }});
    // built again once let go: many blocks take a while
    // by the size of the blocks, in cells, which are whole: by the columns, several steps would be the same size
    const fine = h('input', {type: 'range', min: 1, max: Math.max(1, Math.round(side / FEWEST)), step: 1,
                             value: Math.max(1, Math.round(side / columns)),
                             title: 'Smaller blocks: larger mountains beside the trees',
                             onchange: () => {
                               viewpoint.columns = columns = side / Number(fine.value);
                               blockify();
                               redraw();
                             }});
    const size = field('Block size', fine, 'The size of a block, in cells of the terrain: smaller blocks follow the '
                       + 'mountains more closely and take longer to build', 'blocks');
    size.hidden = !blocky;
    const cubed = h('input', {type: 'checkbox', checked: blocky, onchange: () => {
      viewpoint.blocks = blocky = cubed.checked;
      size.hidden = !blocky;
      blockify();
      redraw();
    }});
    const isles = h('input', {type: 'checkbox', checked: islands, onchange: () => {
      viewpoint.islands = islands = isles.checked;
      tide.hidden = !islands;
      raise();
      paint();
      flood();
      blockify();
      redraw();
    }});
    // the sea higher or lower: more land under the water, or less
    const rising = h('input', {type: 'range', min: 0, max: HIGHEST_SEA, step: 0.002, value: level,
                               oninput: () => {
                                 viewpoint.level = level = Number(rising.value);
                                 water.level(level);
                                 raise();
                                 paint();
                                 color.array.set(base);
                                 flood();
                                 if (blocky)
                                   blockify();
                                 redraw();
                               }});
    const tide = field('Sea level', rising, 'How high the water is: a higher sea covers more of the land', 'sea');
    tide.hidden = !islands;
    // the ways to draw the land, and the flame graph beside it, on one line; under it the sliders, Relief first,
    // then those of the ways that are on
    const toggles = [helpTip(h('label', {class: 'check'}, isles, ' Islands'), 'islands',
                             'The plain becomes a sea and the mountains islands: sand, grass, and rock where it is steep'),
                     helpTip(h('label', {class: 'check'}, cubed, ' Blocks'), 'blocks', 'The land built of blocks')];
    if (flameOf) {
      const flamed = h('input', {type: 'checkbox', checked: flaming, onchange: () => {
        viewpoint.panel = flaming = flamed.checked;
        stand();
        // the camera stays where it is: the panel stands behind the terrain, and turning the view shows it
        redraw();
      }});
      // not a way of drawing the land, as islands and blocks are, but a second view beside it, with any of them
      toggles.push(helpTip(h('label', {class: 'check'}, flamed, ' Flame graph'), 'flame-panel',
                           'The whole profile as a flame graph, standing behind the terrain: a frame '
                           + 'hovered on either is lit on both'));
    }
    const knobs = [h('div', {class: 'toggles'}, toggles),
                   field('Relief', slider, 'The height of the highest peak, as a share of the terrain\'s size', 'relief'),
                   tide, size];
    if (knobsIn)
      knobsIn.replaceChildren(...knobs);
    loading.replaceWith(renderer.domElement, labels, tip, ...knobsIn ? [] : [h('div', {class: 'relief'}, knobs)]);
    stand();

    /**
     * @param {any} to a point, a Vector3
     * @returns {boolean} whether the surface stands between the camera and it, but for the last
     *          cells before it
     */
    const behind = to => {
      const from = camera.position, top = lift(t.top);
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      const steps = Math.ceil(Math.hypot(dx, dz));
      // from where the line goes under the highest peak
      const first = dy < 0 && from.y > top ? Math.floor((from.y - top) / -dy * steps) : 0;
      for (let s = first; s < steps - 3; s++) {
        const f = s / steps;
        const x = Math.round(from.x + f * dx + (W - 1) / 2), z = Math.round(from.z + f * dz + (H - 1) / 2);
        if (x >= 0 && z >= 0 && x < W && z < H && from.y + f * dy < position.getY(z * W + x))
          return true;
      }
      return false;
    };

    const render = () => {
      if (gone)
        return;
      renderer.render(scene, camera);
      // the labels over the peaks in sight, the highest first, then the trails', none over another
      const width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight;
      /** @type {number[][]} */
      const taken = [];
      spots.forEach((s, k) => {
        const at = new T.Vector3(s.x - 0.5 - (W - 1) / 2, s.h(), s.y - 0.5 - (H - 1) / 2);
        const p = at.clone().project(camera);
        const x = (p.x + 1) / 2 * width, y = (1 - p.y) / 2 * height;
        const w = names[k].offsetWidth || 8 * s.label.length;
        const box = [x - w / 2, y - 8, x + w / 2, y + 8];
        const shown = p.z < 1 && x > 0 && x < width && y > 0 && y < height
                      && !taken.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])
                      && !behind(at);
        names[k].hidden = !shown;
        if (shown) {
          taken.push(box);
          names[k].style.left = `${x}px`;
          names[k].style.top = `${y}px`;
        }
      });
    };
    redraw = () => {
      // the frames named as the one hovered, lit
      const arr = color.array;
      arr.set(base);
      if (frame.lit() >= 0)
        for (let i = 0; i < W * H; i++) {
          const n = t.cells[i];
          if (frame.isLit(n)) {
            const a = n === frame.lit() ? 0.9 : 0.55;
            for (let k = 0; k < 3; k++)
              arr[3 * i + k] = arr[3 * i + k] * (1 - a) + lit[k] * a;
          }
        }
      color.needsUpdate = true;
      cubes?.light(n => frame.lit() < 0 || !frame.isLit(n) ? 0 : n === frame.lit() ? 0.9 : 0.55);
      panel?.light(frame.lit() >= 0 ? t.nodes[frame.lit()].name : null);
      const chosen = frame.chosen();
      ring.visible = chosen >= 0;
      if (chosen >= 0) {
        const m = t.mountains[chosen];
        ring.position.set(m.x - 0.5 - (W - 1) / 2, side / 400, m.y - 0.5 - (H - 1) / 2);
        ring.scale.setScalar(m.r + 2);
      }
      render();
    };
    controls.addEventListener('change', () => {
      // turning around a point of the terrain, however far it was moved, or of the flame graph standing behind it:
      // the camera can be moved up and back to its top
      const target = controls.target;
      const span = panel ? panelSpan() : null;
      if (looking) {
        // the camera itself is kept as near the land as the view turning around it can be, above the ground: it
        // starts flying where it stood, and can go back out; the point it looks at follows
        const p = camera.position, reach = controls.maxDistance;
        const level = Math.hypot(p.x, p.z), inside = level > reach ? reach / level : 1;
        const at = new T.Vector3(p.x * inside, Math.max(side / 100, Math.min(reach, p.y)), p.z * inside);
        target.add(at.clone().sub(p));
        p.copy(at);
        viewpoint.position = p.toArray().map((/** @type {number} */ v) => v / side);
        viewpoint.target = target.toArray().map((/** @type {number} */ v) => v / side);
        render();
        return;
      }
      const x = Math.max(-W / 2, Math.min(W / 2, target.x));
      const z = Math.max(span ? span.back : -H / 2, Math.min(H / 2, target.z));
      const y = Math.max(0, Math.min(Math.max(lift(t.top), span?.top ?? 0), target.y));
      if (x !== target.x || y !== target.y || z !== target.z) {
        camera.position.add(new T.Vector3(x - target.x, y - target.y, z - target.z));
        target.set(x, y, z);
      }
      viewpoint.position = camera.position.toArray().map((/** @type {number} */ v) => v / side);
      viewpoint.target = target.toArray().map((/** @type {number} */ v) => v / side);
      render();
    });

    /** from the south, high, far enough for the whole width and depth to show, and the flame graph's top */
    const home = () => {
      const half = Math.tan(camera.fov * Math.PI / 360);
      const tall = panel ? panelSpan().top : 0;
      const far = 1.1 * Math.max(W / 2 / (half * camera.aspect), H / 2 / half, tall / half);
      controls.target.set(0, tall / 3, 0);
      camera.position.set(0, 0.6 * far, 0.8 * far);
      controls.update();
    };
    let framed = false;
    const resize = () => {
      const width = frame.holder.clientWidth || 800, height = frame.holder.clientHeight || 600;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (!framed) {
        if (viewpoint.position && viewpoint.target) {
          camera.position.fromArray(viewpoint.position.map(v => v * side));
          controls.target.fromArray(viewpoint.target.map(v => v * side));
          controls.update();
        }
        else
          home();
        framed = true;
        // drawn at its size: it can show over the view before it, which is freed once faded out
        render();
        settle();
        if (!gone) {
          shown();
          setTimeout(before, FADE + 50);
        }
      }
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(frame.holder);

    // picking: the mouse's ray marched over the heights, the first cell it goes under
    const raycaster = new T.Raycaster();
    /**
     * @param {MouseEvent} e
     * @returns {{node: number, distance: number}} the node under the mouse, -1 on the plain, and how far
     *          along the ray the ground is, Infinity if it misses the terrain
     */
    const groundAt = e => {
      const top = lift(t.top);
      const box = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new T.Vector2((e.clientX - box.left) / box.width * 2 - 1,
                                            1 - (e.clientY - box.top) / box.height * 2), camera);
      const {origin, direction} = raycaster.ray;
      if (direction.y >= 0)
        return {node: -1, distance: Infinity};
      const from = Math.max(0, (origin.y - top) / -direction.y), to = origin.y / -direction.y;
      for (let d = from; d <= to; d += 0.5) {
        const x = Math.round(origin.x + d * direction.x + (W - 1) / 2);
        const z = Math.round(origin.z + d * direction.z + (H - 1) / 2);
        if (x < 0 || z < 0 || x >= W || z >= H)
          continue;
        if (origin.y + d * direction.y <= lift(t.heights[z * W + x]))
          return {node: t.cells[z * W + x], distance: d};
      }
      return {node: -1, distance: Infinity};
    };
    /** @type {Map<string, number>} the first node of each name, for a frame of the panel to light the terrain */
    const named = new Map();
    t.nodes.forEach((n, i) => named.has(n.name) || named.set(n.name, i));
    /**
     * @param {MouseEvent} e
     * @returns {{node: number, box?: import('../model/flame.js').Box | null}} what is under the mouse: a node
     *          of the terrain, -1 for none, or the panel in front of it and its box there
     */
    const pointed = e => {
      const ground = groundAt(e);
      const on = panel?.hit(raycaster);
      return on && on.distance < ground.distance ? {node: -1, box: on.box} : {node: ground.node};
    };
    /** @type {number[] | null} where the mouse went down: a drag is no click */
    let down = null;
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => down = [e.clientX, e.clientY]);
    canvas.addEventListener('click', (/** @type {MouseEvent} */ e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) >= 4)
        return;
      const at = pointed(e);
      if (at.box === undefined)
        frame.click(at.node);
      else if (at.box && panel) {
        // zoomed on the frame or back out to it: told anew of what is under the mouse
        panel.click(at.box);
        // lower or higher as it shows fewer rows or more: its foot stays
        placePanel();
        hover(e);
        render();
      }
    });
    /** @param {MouseEvent} e */
    const hover = e => {
      const at = pointed(e);
      const box = at.box ?? null;
      if (panel?.hover(box))
        render();
      tip.hidden = !box || !panel;
      if (box && panel) {
        replace(tip, ...tipOf(panel.flame, box, panel.zoomed(), selection.unit ?? 'ms'));
        placeTip(tip, e);
      }
      // a frame of the panel lights the frames of its name on the terrain, if it has any
      frame.hover(box ? named.get(box.frame.name) ?? -1 : at.node);
    };
    canvas.addEventListener('mousemove', (/** @type {MouseEvent} */ e) => {
      if (e.buttons === 0 && !looking)
        hover(e);
    });
    canvas.addEventListener('mouseleave', () => {
      if (panel?.hover(null))
        render();
      tip.hidden = true;
      frame.hover(-1);
    });
    canvas.addEventListener('dblclick', () => {
      home();
      render();
    });

    // flying: the arrows slide the view over the land, Q and E lower and raise it, Shift speeds up (W A S D too
    // while looking around, as S would take a picture);
    // the camera and the point it looks at move together, the 'change' handler keeping the point in bounds
    /** @type {Set<string>} */
    const held = new Set();
    // by the place of the key, not its letter: W A S D are Z Q S D on an AZERTY keyboard
    const KEYS = {KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left',
                  KeyD: 'right', ArrowRight: 'right', KeyQ: 'down', KeyE: 'up'};
    let flying = 0, last = 0;
    const fly = (/** @type {number} */ now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const ahead = new T.Vector3().subVectors(controls.target, camera.position);
      const right = new T.Vector3(-ahead.z, 0, ahead.x).normalize();
      // looking around, forward goes where the view points, up or down; otherwise it stays level
      if (!looking)
        ahead.setY(0);
      if (held.size && ahead.lengthSq() > 0) {
        ahead.normalize();
        const step = new T.Vector3();
        if (held.has('forward')) step.add(ahead);
        if (held.has('back')) step.sub(ahead);
        if (held.has('right')) step.add(right);
        if (held.has('left')) step.sub(right);
        if (held.has('up')) step.y += 1;
        if (held.has('down')) step.y -= 1;
        // a crossing of the land in about 4 s, twice as fast with Shift
        step.multiplyScalar(dt * side / 4 * (held.has('fast') ? 2 : 1));
        camera.position.add(step);
        controls.target.add(step);
        camera.position.y = Math.max(side / 100, camera.position.y);
        controls.update();
      }
      flying = held.size && !gone ? requestAnimationFrame(fly) : 0;
    };
    const keyed = (/** @type {KeyboardEvent} */ e) => {
      const target = /** @type {HTMLElement | null} */ (e.target);
      if (e.ctrlKey || e.metaKey || e.altKey || !canvas.isConnected
          || target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return;
      if (e.key.toLowerCase() === 'f' && !e.repeat) {
        e.preventDefault();
        if (looking)
          document.exitPointerLock();
        else {
          // a game's screen: the whole display, the page's own bars and popups hidden (body.playing)
          // Firefox takes the mouse once the screen is: asked for in the middle of the switch, it is refused.
          // Chrome's full screen uses up the key press, and the mouse then needs another: it is taken first
          const lock = () => canvas.requestPointerLock?.()?.catch?.(() => {});
          const screen = () => document.documentElement.requestFullscreen?.();
          if (CHROMIUM) {
            lock();
            screen()?.catch(() => {});
          } else if (/** @type {any} */ (document.documentElement).requestFullscreen)
            screen()?.then(lock, lock);
          else
            lock();
        }
        return;
      }
      const move = KEYS[/** @type {keyof typeof KEYS} */ (e.code)];
      // S and C take pictures: the places of W A S D are the keys' only while looking around, and then the
      // letters are not heard by the page's shortcuts
      if (!move || !looking && /^Key[WASD]$/.test(e.code))
        return;
      e.preventDefault();
      e.stopPropagation();
      held.add(move);
      e.shiftKey ? held.add('fast') : held.delete('fast');
      if (!flying) {
        last = performance.now();
        flying = requestAnimationFrame(fly);
      }
    };
    const unkeyed = (/** @type {KeyboardEvent} */ e) => {
      const move = KEYS[/** @type {keyof typeof KEYS} */ (e.code)];
      if (move)
        held.delete(move);
      if (!e.shiftKey)
        held.delete('fast');
    };
    addEventListener('keydown', keyed, true);
    addEventListener('keyup', unkeyed);
    const dropped = () => held.clear();
    addEventListener('blur', dropped);
    // the mouse turns the view where the camera stands; the browser frees the mouse on Escape
    const LOOK = 0.0022, STRAIGHT = 0.996;
    const locked = () => {
      const on = document.pointerLockElement === canvas;
      if (on === looking)
        return;
      looking = on;
      document.body.classList.toggle('playing', on);
      if (!on && document.fullscreenElement)
        document.exitFullscreen().catch(() => {});
      controls.enabled = !on;
      tip.hidden = true;
      frame.hover(-1);
      if (on) {
        controls.maxPolarAngle = Math.PI - 0.05;
        return;
      }
      controls.maxPolarAngle = Math.PI / 2 - 0.05;
      // back to turning around a point: one on the ground ahead, the view not left looking up
      const d = new T.Vector3().subVectors(controls.target, camera.position);
      const level = Math.hypot(d.x, d.z);
      const length = d.length();
      if (d.y > -0.2 * level)
        d.y = -0.2 * level;
      controls.target.copy(camera.position).add(d.setLength(length));
      controls.update();
    };
    const looked = (/** @type {MouseEvent} */ e) => {
      if (!looking)
        return;
      const d = new T.Vector3().subVectors(controls.target, camera.position);
      d.applyAxisAngle(new T.Vector3(0, 1, 0), -e.movementX * LOOK);
      const right = new T.Vector3(-d.z, 0, d.x).normalize();
      const up = d.clone().applyAxisAngle(right, (inverted ? e.movementY : -e.movementY) * LOOK);
      if (Math.abs(up.y) / up.length() < STRAIGHT)
        d.copy(up);
      controls.target.copy(camera.position).add(d);
      controls.update();
    };
    // the mouse refused: no full screen to be left in
    const refused = () => {
      if (document.fullscreenElement)
        document.exitFullscreen().catch(() => {});
    };
    document.addEventListener('pointerlockchange', locked);
    document.addEventListener('pointerlockerror', refused);
    // the full screen left by the browser's own key: the mouse goes with it
    const unscreened = () => {
      if (!document.fullscreenElement && looking)
        document.exitPointerLock();
    };
    document.addEventListener('fullscreenchange', unscreened);
    document.addEventListener('mousemove', looked);

    release = () => {
      if (disposed)
        return;
      disposed = gone = true;
      removeEventListener('keydown', keyed, true);
      removeEventListener('keyup', unkeyed);
      removeEventListener('blur', dropped);
      document.removeEventListener('pointerlockchange', locked);
      document.removeEventListener('pointerlockerror', refused);
      document.removeEventListener('fullscreenchange', unscreened);
      document.body.classList.remove('playing');
      document.removeEventListener('mousemove', looked);
      if (document.pointerLockElement === canvas)
        document.exitPointerLock();
      before();
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      lines.dispose();
      lineMaterial.dispose();
      trailLines.dispose();
      trailMaterial.dispose();
      cubes?.dispose();
      panel?.dispose();
      water.dispose();
      dome.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
    redraw();
  }
}

/**
 * @param {Float64Array} heights row after row
 * @param {number} width
 * @param {number} height
 * @returns {Float64Array} each the mean of the 3 by 3 cells around it, those in the grid
 */
function blur(heights, width, height) {
  /** @param {Float64Array} from @param {number} dx @param {number} dy */
  const pass = (from, dx, dy) => {
    const to = new Float64Array(from.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let sum = from[y * width + x], n = 1;
        for (const s of [-1, 1]) {
          const nx = x + s * dx, ny = y + s * dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height)
            sum += from[ny * width + nx], n++;
        }
        to[y * width + x] = sum / n;
      }
    return to;
  };
  return pass(pass(heights, 1, 0), 0, 1);
}
