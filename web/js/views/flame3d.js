// @ts-check
/**
 * The flame graph in the 3D world: a panel standing behind the terrain, its
 * root on the ground, painted as on the page (flame-draw.js) on a texture.
 * Hovered and clicked through the ray of the mouse, as the terrain is: a click
 * zooms on a frame, and the panel is cut down to it and its callees, its
 * caller kept on the foot, faded, which a click zooms back out to. A frame
 * lit on the terrain is coloured on the panel wherever it is called.
 */
import {layout, pick, deepest, range} from '../model/flame.js';
import {ROW, paintFlame} from './flame-draw.js';

/** @typedef {import('../model/flame.js').Box} Box */
/** @typedef {import('../model/flame.js').Flame} Flame */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/** The width the graph is painted at, px, and how many texture pixels each has: sharp when near. */
const WIDTH = 1400, SCALE = 2;

/** How opaque the panel is: the land and the sky show through a little, from either side. */
const OPACITY = 0.65;

/** The most levels shown: the texture's height has a limit; deeper frames are cut. */
const LEVELS = Math.floor(4096 / SCALE / ROW);

/**
 * @typedef {object} FlamePanel
 * @property {any} mesh the plane, facing the south, its foot at y 0 unless moved
 * @property {Flame} flame
 * @property {() => number} height of the plane, in the units of the world: lower when zoomed
 * @property {() => Box | null} zoomed
 * @property {(raycaster: any) => {box: Box | null, distance: number} | null} hit where the ray meets the
 *           panel, and the box there; null if it misses the panel
 * @property {(box: Box | null) => boolean} hover outlines the box, with a shape over the panel: the texture is not
 *           painted again, which is the slow part; whether it changed
 * @property {(box: Box) => void} click zooms on the box, or back out to it: the panel's height changes
 * @property {(name: string | null) => void} light colours the frames of that name, none for null
 * @property {() => void} dispose
 */

/**
 * @param {any} T three.js
 * @param {Frame} root the tree of the samples kept, as tree() in profile.js makes it
 * @param {number} width of the panel, in the units of the world
 * @param {number} anisotropy of the texture: the most the renderer has, for a panel seen at a slant
 * @returns {FlamePanel}
 */
export function flamePanel(T, root, width, anisotropy) {
  const flame = layout(root);
  // the most rows the panel shows: zoomed, it shows fewer, as high as the frame's callees go
  const most = Math.min(flame.levels.length, LEVELS);
  const high = most * ROW;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = high * SCALE;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  /** @type {import('./flame-draw.js').Look} */
  const look = {zoomed: null, hovered: null, pattern: null, dark};
  /** @type {string | null} the name coloured */
  let lit = null;

  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  // unlit and out of the haze: it reads the same from any distance; seen from behind it is mirrored, its text
  // reversed, but there. What a ray meets there is what is drawn at that place, mirrored too
  const material = new T.MeshBasicMaterial({map: texture, transparent: true, fog: false, toneMapped: false,
                                            side: T.DoubleSide, opacity: OPACITY, depthWrite: false});
  const full = width * high / WIDTH;
  const geometry = new T.PlaneGeometry(width, full);
  const mesh = new T.Mesh(geometry, material);
  mesh.position.y = full / 2;
  // after the water, which writes no depth either (sea3d.js): drawn before, the water behind showed over it
  mesh.renderOrder = 2;

  // the box hovered: a veil in the colour the frames found are, over it, the panel's child so that it follows it,
  // in the panel's own units before its height is scaled by the rows shown. Painting the box on the texture would
  // paint all of it again, and send it to the graphics card. Translucent, for the name to be read through it
  const veil = new T.Mesh(new T.PlaneGeometry(1, 1),
    new T.MeshBasicMaterial({color: dark ? 0x9a3d9a : 0xd462d4, transparent: true, opacity: 0.6, fog: false,
                             toneMapped: false, side: T.DoubleSide, depthWrite: false}));
  veil.renderOrder = 3;
  veil.visible = false;
  mesh.add(veil);

  // the rows shown: from the level on the panel's foot, as many as `rows`
  let first = 0, rows = most;
  const paint = () => {
    // zoomed, the frame's caller is kept on the foot, faded, to zoom back out by; the rows under it go
    const z = look.zoomed;
    first = z ? z.level - 1 : 0;
    rows = Math.min(LEVELS, (z ? deepest(flame, z) : flame.levels.length - 1) - first + 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(SCALE, SCALE);
    // the first level on the bottom row, the deepest frames cut at the top
    paintFlame(ctx, flame, look, WIDTH, high + first * ROW);
    // the plane as high as the rows shown, the texture's bottom on it
    texture.repeat.set(1, rows / most);
    mesh.scale.y = rows / most;
    texture.needsUpdate = true;
  };
  paint();

  /** @type {Box | null} the box outlined */
  let hovered = null;
  // puts the veil on the box hovered, as the rows shown now are: a row `rows` of them is `full / rows` high
  // before the panel's own scaling, from its foot
  const outline = () => {
    const b = hovered;
    const {from, span} = range(flame, look.zoomed);
    const k = WIDTH / span;
    const x = b ? Math.max((b.left - from) * k, 0) : 0;
    const w = b ? Math.min(b.frame.total * k, WIDTH - x) : 0;
    const row = b ? b.level - first : -1;
    veil.visible = Boolean(b) && w > 0 && row >= 0 && row < rows;
    if (!veil.visible)
      return;
    // in the panel's units: a pixel of the graph is `width / WIDTH` across and `full / rows / ROW` up
    const px = width / WIDTH, py = full / rows / ROW;
    veil.position.set((x + w / 2) / WIDTH * width - width / 2, -full / 2 + (row + 0.5) * full / rows, 0);
    veil.scale.set(Math.max(w - 1, 2) * px, (ROW - 1) * py, 1);
  };

  return {
    mesh,
    flame,
    height: () => full * rows / most,
    zoomed: () => look.zoomed,
    hit(raycaster) {
      // the panel alone: the outline is its child, and a ray meeting it would read a row off its own plate
      const [at] = raycaster.intersectObject(mesh, false);
      if (!at?.uv)
        return null;
      return {box: pick(flame, look.zoomed, at.uv.x, first + Math.floor(at.uv.y * rows)), distance: at.distance};
    },
    hover(box) {
      if (box === hovered)
        return false;
      hovered = box;
      outline();
      return true;
    },
    click(box) {
      look.zoomed = box !== flame.root ? box : null;
      paint();
      // the rows are not where they were: hovered again, by the next move
      hovered = null;
      outline();
    },
    light(name) {
      if (name === lit)
        return;
      lit = name;
      look.pattern = name === null ? null : new RegExp(exactly(name));
      paint();
    },
    dispose() {
      veil.geometry.dispose();
      veil.material.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/**
 * @param {string} name
 * @returns {string} a pattern finding that name only
 */
function exactly(name) {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}
