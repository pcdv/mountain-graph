// @ts-check
/**
 * The flame graph in the 3D world: a panel standing behind the terrain, its
 * root on the ground, painted as on the page (flame-draw.js) on a texture.
 * Hovered and clicked through the ray of the mouse, as the terrain is: a click
 * zooms on a frame, a click on a faded one under it zooms back out. A frame
 * lit on the terrain is coloured on the panel wherever it is called.
 */
import {layout, pick} from '../model/flame.js';
import {ROW, paintFlame} from './flame-draw.js';

/** @typedef {import('../model/flame.js').Box} Box */
/** @typedef {import('../model/flame.js').Flame} Flame */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/** The width the graph is painted at, px, and how many texture pixels each has: sharp when near. */
const WIDTH = 1400, SCALE = 2;

/** The most levels shown: the texture's height has a limit; deeper frames are cut. */
const LEVELS = Math.floor(4096 / SCALE / ROW);

/**
 * @typedef {object} FlamePanel
 * @property {any} mesh the plane, facing the south, its foot at y 0 unless moved
 * @property {Flame} flame
 * @property {number} height of the plane, in the units of the world
 * @property {() => Box | null} zoomed
 * @property {(raycaster: any) => {box: Box | null, distance: number} | null} hit where the ray meets the
 *           panel, and the box there; null if it misses the panel
 * @property {(box: Box | null) => boolean} hover outlines the box; whether it changed
 * @property {(box: Box) => void} click zooms on the box, or back out to it
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
  const high = Math.min(flame.levels.length, LEVELS) * ROW;
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
  // unlit and out of the haze: it reads the same from any side and distance
  const material = new T.MeshBasicMaterial({map: texture, transparent: true, fog: false, toneMapped: false});
  const height = width * high / WIDTH;
  const geometry = new T.PlaneGeometry(width, height);
  const mesh = new T.Mesh(geometry, material);
  mesh.position.y = height / 2;

  const paint = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(SCALE, SCALE);
    // the root on the bottom row, the deepest frames cut at the top
    paintFlame(ctx, flame, look, WIDTH, high);
    texture.needsUpdate = true;
  };
  paint();

  return {
    mesh,
    flame,
    height,
    zoomed: () => look.zoomed,
    hit(raycaster) {
      const [at] = raycaster.intersectObject(mesh);
      if (!at?.uv)
        return null;
      return {box: pick(flame, look.zoomed, at.uv.x, Math.floor(at.uv.y * high / ROW)), distance: at.distance};
    },
    hover(box) {
      if (box === look.hovered)
        return false;
      look.hovered = box;
      paint();
      return true;
    },
    click(box) {
      look.zoomed = box !== flame.root ? box : null;
      paint();
    },
    light(name) {
      if (name === lit)
        return;
      lit = name;
      look.pattern = name === null ? null : new RegExp(exactly(name));
      paint();
    },
    dispose() {
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
