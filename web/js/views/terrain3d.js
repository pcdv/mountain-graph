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
import {h} from '../lib/dom.js';
import {terrainFrame, short} from '../components/terrain-frame.js';
import {contour, levels} from '../model/contours.js';
import {palette, tint, hued, DEPTH, LINES} from './palette.js';
import {blocks, COLUMNS, FEWEST, MOST} from './blocks3d.js';
import {sea, sky, shores, ramp, bump, landColour, bedColour, LEVEL, DEEP, HAZE, SUN, SEA_TUNING} from './sea3d.js';

/** @typedef {import('../model/terrain.js').Terrain} Terrain */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/** The modules, resolved by the import map: strings, so that the type checker leaves them. */
const THREE = /** @type {string} */ ('three'), CONTROLS = /** @type {string} */ ('three/addons/controls/OrbitControls.js');

/** The height of the highest peak, as a share of the terrain's longer side: at first, and its range. */
const RELIEF = 0.16, FLATTEST = 0.04, HIGHEST = 0.5;

/** How much the distance changes per pixel of wheel: e^(100 ZOOM), about 15%, per notch of a mouse. */
const ZOOM = 0.0014;

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
 */

/**
 * What can be tuned of the 3D view, the islands' with it.
 *
 * @typedef {{curve: number} & import('./sea3d.js').SeaTuning} ViewTuning
 * curve: heights as the time to that power: 0.5, its square root, lets small peaks show; 1 makes them
 * as high as their time
 */

/** @type {ViewTuning} */
export const VIEW_TUNING = {curve: 0.5, ...SEA_TUNING};

/** Frees the view shown last: a page has few WebGL contexts. */
let release = () => {};

/** Frees the 3D view shown, if any: when another view takes its place. */
export function closeTerrainView() {
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
 * @returns {HTMLElement}
 */
export function terrainView(t, trees, selection, viewpoint, hues = null, tuning = {}) {
  const tuned = {...VIEW_TUNING, ...tuning};
  closeTerrainView();
  let gone = false;
  release = () => gone = true;
  let redraw = () => {};
  const frame = terrainFrame(t, trees, selection,
                             'Drag to turn, right-drag to move, scroll to zoom, double-click to see it all again. '
                             + 'Hover: a frame, its path from the peak. '
                             + 'Click a mountain: its callers and callees.',
                             () => redraw());
  const loading = h('p', {class: 'muted'}, 'Loading three.js…');
  frame.holder.append(loading);
  frame.holder.classList.add('three');

  build().catch(e => loading.textContent = `three.js could not be loaded: ${e.message}`);
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
      if (smooth[i] <= 0)
        return -(shore?.depth[i] ?? 0) * DEEP * side;
      // bumped, less on the beaches
      const r = ramp(shore?.inland[i] ?? 0);
      return lift(smooth[i]) * r + bump(i % W, Math.floor(i / W)) * tuned.bump * side * r;
    };

    /** sets the heights of the surface and of the lines to the relief */
    const raise = () => {
      if (islands && !shore)
        shore = shores(smooth, W, H);
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
          : smooth[i] > 0 ? landColour((smooth[i] / t.top) ** tuned.curve * ramp(shore.inland[i]), shore.inland[i],
                                       Math.max(0, Math.min(1, (slope() - tuned.rock) / tuned.rock)), x, y)
          : bedColour(shore.depth[i]);
        const c = hues && t.cells[i] >= 0 ? hued(height, hues[t.cells[i]]) : height;
        base[3 * i] = linear[c[0]], base[3 * i + 1] = linear[c[1]], base[3 * i + 2] = linear[c[2]];
      }
    };
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
        cubes = blocks(T, t, {lift, hues, colors, columns, linear: rgb => Array.from(rgb, c => linear[c])});
        scene.add(cubes.mesh);
      }
      surface.visible = trailSegments.visible = !blocky;
      // islands without the lines: the land and the sea tell the heights
      contours.visible = !blocky && !islands;
      water.mesh.visible = islands && !blocky;
      dome.mesh.visible = islands;
      scene.fog = islands ? haze : null;
      sun.color.set(islands ? SUN : 0xffffff);
    };
    const water = sea(T, side);
    scene.add(water.mesh);
    // a sky at sunset, hazy toward the horizon, the sun low and warm
    const dome = sky(T, side * 9);
    scene.add(dome.mesh);
    const haze = new T.Fog(HAZE, side * 1.6, side * 7);
    // the trails on the water, as sea lanes
    const flood = () => trailSegments.position.y = islands ? LEVEL * side : 0;
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

    const renderer = new T.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(devicePixelRatio || 1);
    renderer.setClearColor(colors.halo);
    const camera = new T.PerspectiveCamera(40, 1, side / 100, side * 14);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    // not into the terrain, nor so close that zooming stops (it scales the distance), nor lost far away
    controls.minDistance = side / 10;
    controls.maxDistance = side * 4;
    // zoomed here in proportion to the wheel's delta: the controls zoom a whole step per event, and a
    // touchpad sends dozens of small ones per gesture
    controls.enableZoom = false;
    renderer.domElement.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.max(controls.minDistance, Math.min(controls.maxDistance,
                                                               offset.length() * Math.exp(delta * ZOOM)));
      camera.position.copy(controls.target).add(offset.setLength(distance));
      controls.update();
    }, {passive: false});

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
    const fine = h('input', {type: 'range', min: FEWEST, max: MOST, step: 20, value: MOST + FEWEST - columns,
                             title: 'Smaller blocks: larger mountains beside the trees',
                             onchange: () => {
                               viewpoint.columns = columns = MOST + FEWEST - Number(fine.value);
                               blockify();
                               redraw();
                             }});
    const size = h('label', {hidden: !blocky}, 'Block size ', fine);
    const cubed = h('input', {type: 'checkbox', checked: blocky, onchange: () => {
      viewpoint.blocks = blocky = cubed.checked;
      size.hidden = !blocky;
      blockify();
      redraw();
    }});
    const isles = h('input', {type: 'checkbox', checked: islands, onchange: () => {
      viewpoint.islands = islands = isles.checked;
      raise();
      paint();
      flood();
      blockify();
      redraw();
    }});
    loading.replaceWith(renderer.domElement, labels,
                        h('div', {class: 'relief'}, h('label', null, 'Relief ', slider), h('label', null, isles, ' Islands'),
                          h('label', null, cubed, ' Blocks'), size));

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
      // turning around a point of the terrain, however far it was moved
      const target = controls.target;
      const x = Math.max(-W / 2, Math.min(W / 2, target.x)), z = Math.max(-H / 2, Math.min(H / 2, target.z));
      const y = Math.max(0, Math.min(lift(t.top), target.y));
      if (x !== target.x || y !== target.y || z !== target.z) {
        camera.position.add(new T.Vector3(x - target.x, y - target.y, z - target.z));
        target.set(x, y, z);
      }
      viewpoint.position = camera.position.toArray().map((/** @type {number} */ v) => v / side);
      viewpoint.target = target.toArray().map((/** @type {number} */ v) => v / side);
      render();
    });

    /** from the south, high, far enough for the whole width and depth to show */
    const home = () => {
      const half = Math.tan(camera.fov * Math.PI / 360);
      const far = 1.1 * Math.max(W / 2 / (half * camera.aspect), H / 2 / half);
      controls.target.set(0, 0, 0);
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
      }
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(frame.holder);

    // picking: the mouse's ray marched over the heights, the first cell it goes under
    const raycaster = new T.Raycaster();
    /** @param {MouseEvent} e @returns {number} the node under the mouse, -1 on the plain */
    const nodeAt = e => {
      const top = lift(t.top);
      const box = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new T.Vector2((e.clientX - box.left) / box.width * 2 - 1,
                                            1 - (e.clientY - box.top) / box.height * 2), camera);
      const {origin, direction} = raycaster.ray;
      if (direction.y >= 0)
        return -1;
      const from = Math.max(0, (origin.y - top) / -direction.y), to = origin.y / -direction.y;
      for (let d = from; d <= to; d += 0.5) {
        const x = Math.round(origin.x + d * direction.x + (W - 1) / 2);
        const z = Math.round(origin.z + d * direction.z + (H - 1) / 2);
        if (x < 0 || z < 0 || x >= W || z >= H)
          continue;
        if (origin.y + d * direction.y <= lift(t.heights[z * W + x]))
          return t.cells[z * W + x];
      }
      return -1;
    };
    /** @type {number[] | null} where the mouse went down: a drag is no click */
    let down = null;
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => down = [e.clientX, e.clientY]);
    canvas.addEventListener('click', (/** @type {MouseEvent} */ e) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4)
        frame.click(nodeAt(e));
    });
    canvas.addEventListener('mousemove', (/** @type {MouseEvent} */ e) => {
      if (e.buttons === 0)
        frame.hover(nodeAt(e));
    });
    canvas.addEventListener('mouseleave', () => frame.hover(-1));
    canvas.addEventListener('dblclick', () => {
      home();
      render();
    });

    release = () => {
      gone = true;
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      lines.dispose();
      lineMaterial.dispose();
      trailLines.dispose();
      trailMaterial.dispose();
      cubes?.dispose();
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
