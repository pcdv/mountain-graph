// @ts-check
/**
 * Reading a profile from a file the user picked or dropped. No DOM beyond
 * the File given.
 */
import {decode, VERSION} from './profile/profile.js';
import {isCollapsed, readCollapsed} from './profile/collapsed.js';
import {isJfr, readJfr} from './profile/jfr.js';
import {anonymizer} from './model/anonymize.js';

/** @typedef {import('./profile/profile.js').Profile} Profile */

/**
 * One way to count the samples of a file: a recording holds several, which weigh different things.
 *
 * @typedef {object} Sampling
 * @property {string} key stable, to remember the choice
 * @property {string} label for the user
 * @property {Profile} profile
 */

/**
 * A profile in the format of jfr-web (version 4, or 3), as /api/sessions/:id/profile
 * sends it or a static export holds it; collapsed stacks (collapsed.js); or a JFR recording
 * (jfr.js): gzipped or not. A recording gives a sampling per kind of samples it holds, the wall
 * clock first, so that the page can switch without reading it again.
 *
 * @param {File} file
 * @param {import('./model/anonymize.js').Rules} [anonymous] what to replace in the names, if anything
 * @returns {Promise<Sampling[]>} one at least
 * @throws {Error} when the file is none of these, in words for the user
 */
export async function loadProfiles(file, anonymous) {
  const bytes = await readBytes(file);
  const samplings = isJfr(bytes)
    ? fromRecording(file.name, bytes)
    : [{key: 'samples', label: 'Samples', profile: fromText(file.name, new TextDecoder().decode(bytes))}];
  if (!anonymous)
    return samplings;
  const anonymize = anonymizer(anonymous);
  return samplings.map(s => ({...s, profile: anonymize(s.profile)}));
}

/**
 * @param {string} name of the file
 * @param {Uint8Array} bytes
 * @returns {Sampling[]}
 */
function fromRecording(name, bytes) {
  let recording;
  try {
    recording = readJfr(bytes);
  }
  catch (e) {
    throw new Error(`${name}: ${/** @type {Error} */ (e).message}`);
  }
  /** @type {Sampling[]} */
  const list = [];
  if (recording.wall)
    list.push({key: 'wall', label: 'Wall clock', profile: recording.wall});
  if (recording.alloc)
    list.push({key: 'alloc', label: 'Allocations', profile: recording.alloc});
  if (list.length === 0)
    throw new Error(`${name} is a recording with no execution, native or allocation samples.`);
  return list;
}

/**
 * @param {string} name of the file
 * @param {string} text
 * @returns {Profile}
 */
function fromText(name, text) {
  if (!text.trimStart().startsWith('{')) {
    if (!isCollapsed(text))
      throw new Error(`${name} is neither a profile of jfr-web, nor collapsed stacks, nor a JFR recording.`);
    try {
      return readCollapsed(text);
    }
    catch (e) {
      throw new Error(`${name}: ${/** @type {Error} */ (e).message}`);
    }
  }
  let doc;
  try {
    doc = JSON.parse(text);
  }
  catch (e) {
    throw new Error(`${name} is not JSON: ${/** @type {Error} */ (e).message}`);
  }
  if (!doc || typeof doc !== 'object' || !('stacks' in doc) || !('samples' in doc))
    throw new Error(`${name} is not a profile: it has no stacks or samples.`);
  if (doc.version === 3)
    doc = fromVersion3(doc);
  if (doc.version !== VERSION)
    throw new Error(`${name} is a profile of version ${doc.version}: this page reads version ${VERSION}.`);
  return decode(doc);
}

/**
 * Version 4 added the unit of the weights and a weight for each sample; a profile of version 3 counts
 * time, with the weight of each kind of sample. Upgraded here, not in profile.js, which is jfr-web's.
 *
 * @param {any} doc a profile of version 3
 * @returns {any} the same, as version 4 tells it
 */
function fromVersion3(doc) {
  return {...doc, version: 4, unit: 'ms'};
}

/**
 * @param {File} file
 * @returns {Promise<Uint8Array>} its bytes, unzipped when it starts as a gzip stream does
 */
async function readBytes(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b)
    return new Uint8Array(await file.arrayBuffer());
  const unzipped = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(unzipped).arrayBuffer());
}
