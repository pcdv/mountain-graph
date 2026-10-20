// @ts-check
/**
 * Reading a profile from a file the user picked or dropped. No DOM beyond
 * the File given.
 */
import {decode, VERSION} from './profile/profile.js';

/** @typedef {import('./profile/profile.js').Profile} Profile */

/**
 * A profile in the format of jfr-web (version 4, or 3), as /api/sessions/:id/profile
 * sends it or a static export holds it, gzipped or not.
 *
 * @param {File} file
 * @returns {Promise<Profile>}
 * @throws {Error} when the file is not such a profile, in words for the user
 */
export async function loadProfile(file) {
  const text = await readText(file);
  let doc;
  try {
    doc = JSON.parse(text);
  }
  catch (e) {
    throw new Error(`${file.name} is not JSON: ${/** @type {Error} */ (e).message}`);
  }
  if (!doc || typeof doc !== 'object' || !('stacks' in doc) || !('samples' in doc))
    throw new Error(`${file.name} is not a profile: it has no stacks or samples.`);
  if (doc.version === 3)
    doc = fromVersion3(doc);
  if (doc.version !== VERSION)
    throw new Error(`${file.name} is a profile of version ${doc.version}: this page reads version ${VERSION}.`);
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
 * @returns {Promise<string>} its text, unzipped when it starts as a gzip stream does
 */
async function readText(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b)
    return file.text();
  const unzipped = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(unzipped).text();
}
