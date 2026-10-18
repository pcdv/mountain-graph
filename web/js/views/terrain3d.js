// @ts-check
/**
 * The terrain in 3D: the same grid as the map, a plane whose points are
 * raised to the heights of its cells, tinted as on the map, lit from the
 * north-west, turned and zoomed with the mouse. The peaks are named; a frame
 * hovered is lit in every mountain, and a mountain clicked shows its callers
 * (terrain-frame.js), as on the map.
 *
 * three.js is loaded from a CDN (see the import map of index.html) when the
 * view is first shown: the rest of the page does without it.
 */
import {h} from '../lib/dom.js';
import {terrainFrame, short} from '../components/terrain-frame.js';
import {palette, tint} from './palette.js';
import {HEIGHT} from './map.js';

/** @typedef {import('../model/terrain.js').Terrain} Terrain */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/** The modules, resolved by the import map: strings, so that the type checker leaves them. */
const THREE = /** @type {string} */ ('three'), CONTROLS = /** @type {string} */ ('three/addons/controls/OrbitControls.js');

/** The height of the highest peak, as a share of the terrain's longer side. */
const RELIEF = 0.16;

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
 * @param {{chosen: string}} selection the name of the peak whose callers show, '' for none
 * @returns {HTMLElement}
 */
export function terrainView(t, trees, selection) {
  closeTerrainView();
  let gone = false;
  release = () => gone = true;
  let redraw = () => {};
  const frame = terrainFrame(t, trees, selection,
                             'Drag to turn, right-drag to move, scroll to zoom, double-click to see it all again. '
                             + 'Hover: a frame, its path from the peak. '
                             + 'Click a mountain: its callers.',
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
    /** @param {number} height ms @returns {number} its y */
    const lift = height => t.top > 0 && height > 0 ? Math.sqrt(height / t.top) * RELIEF * side : 0;

    // a point per cell, row 0 the farthest
    const geometry = new T.PlaneGeometry(W - 1, H - 1, W - 1, H - 1);
    geometry.rotateX(-Math.PI / 2);
    // smoothed over two cells, shape and tint, so that steps a cell wide do not stripe the slopes;
    // picking keeps the cells
    const position = geometry.attributes.position;
    const smooth = blur(blur(t.heights, W, H), W, H);
    for (let i = 0; i < W * H; i++)
      position.setY(i, lift(smooth[i]));
    geometry.computeVertexNormals();

    // the map's colours, in the linear space three.js lights in
    const linear = Float32Array.from({length: 256}, (_, c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const base = new Float32Array(3 * W * H);
    for (let i = 0; i < W * H; i++) {
      const c = tint(colors, smooth[i], t.top);
      base[3 * i] = linear[c[0]], base[3 * i + 1] = linear[c[1]], base[3 * i + 2] = linear[c[2]];
    }
    const lit = colors.lit.map(c => linear[c]);
    const color = new T.BufferAttribute(base.slice(), 3);
    geometry.setAttribute('color', color);

    const material = new T.MeshLambertMaterial({vertexColors: true});
    const scene = new T.Scene();
    scene.add(new T.Mesh(geometry, material));
    scene.add(new T.HemisphereLight(0xffffff, 0x8a8170, 1.8));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 1.6, -0.6);
    scene.add(sun);

    // the mountain clicked, circled at its foot
    const ring = new T.LineLoop(
      new T.BufferGeometry().setFromPoints(Array.from({length: 96}, (_, k) =>
        new T.Vector3(Math.cos(k * Math.PI / 48), 0, Math.sin(k * Math.PI / 48)))),
      new T.LineBasicMaterial({color: colors.text}));
    scene.add(ring);

    const renderer = new T.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(devicePixelRatio || 1);
    renderer.setClearColor(colors.halo);
    const camera = new T.PerspectiveCamera(40, 1, side / 100, side * 10);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    // not into the terrain, nor so close that zooming stops (it scales the distance), nor lost far away;
    // a touchpad sends many wheel events
    controls.minDistance = side / 10;
    controls.maxDistance = side * 4;
    controls.zoomSpeed = 0.5;

    const labels = h('div', {class: 'peak-labels'});
    const names = t.mountains.map(m => h('span', null, short(m.name)));
    labels.append(...names);
    loading.replaceWith(renderer.domElement, labels);

    const render = () => {
      if (gone)
        return;
      renderer.render(scene, camera);
      // the labels over the peaks, the highest first, none over another
      const width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight;
      /** @type {number[][]} */
      const taken = [];
      t.mountains.forEach((m, k) => {
        const p = new T.Vector3(m.x - 0.5 - (W - 1) / 2, lift(t.nodes[m.node].total) + side / 60,
                                m.y - 0.5 - (H - 1) / 2).project(camera);
        const x = (p.x + 1) / 2 * width, y = (1 - p.y) / 2 * height;
        const w = names[k].offsetWidth || 8 * names[k].textContent.length;
        const box = [x - w / 2, y - 8, x + w / 2, y + 8];
        const shown = p.z < 1 && x > 0 && x < width && y > 0 && y < height
                      && !taken.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3]);
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
      const width = frame.holder.clientWidth || 800, height = Math.round(HEIGHT * innerHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (!framed) {
        home();
        framed = true;
      }
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(frame.holder);

    // picking: the mouse's ray marched over the heights, the first cell it goes under
    const raycaster = new T.Raycaster();
    const top = lift(t.top);
    /** @param {MouseEvent} e @returns {number} the node under the mouse, -1 on the plain */
    const nodeAt = e => {
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
