// @ts-check
/**
 * Reading a file the user picked or dropped, of whichever kind it is, told by
 * its content rather than its name. No DOM beyond the File given.
 *
 * - A heap dump (`.hprof`) is parsed by jheap in a Web Worker (hprof/dump.js),
 *   a slice at a time: it is never read whole.
 * - Anything else is read whole, unzipped when gzipped: a JFR recording
 *   (jfr.js), a profile of jfr-web (version 4, or 3), a heap's profile as jheap
 *   keeps it beside a dump (`<name>.jheap.json`), or collapsed stacks
 *   (collapsed.js).
 *
 * The kind says what the page shows: samples (time or allocations, by the
 * call paths that led there) or a heap (memory, by the references that hold it).
 */
import {decode, VERSION} from './profile/profile.js';
import {isCollapsed, readCollapsed} from './profile/collapsed.js';
import {isJfr, readJfr} from './profile/jfr.js';
import {anonymizer} from './model/anonymize.js';
import {heapOf, keptName, parseInWorker} from './hprof/dump.js';

/** @typedef {import('./profile/profile.js').Profile} Profile */
/** @typedef {import('./hprof/dump.js').Heap} Heap */
/** @typedef {import('./hprof/jheap.js').ParseReport} ParseReport */

/**
 * One way to count the samples of a file: a recording holds several, which weigh different things.
 *
 * @typedef {object} Sampling
 * @property {string} key stable, to remember the choice
 * @property {string} label for the user
 * @property {Profile} profile
 */

/**
 * A dump's parse, as the page keeps it in place of the dump: parsing it again
 * takes as long as the first time.
 *
 * @typedef {object} Parse
 * @property {string} name of the dump
 * @property {any} doc the heap's profile document, as jheap wrote it
 * @property {ParseReport | null} report
 */

/**
 * What a file holds, by kind. A heap parsed from a dump has its parse, to keep.
 *
 * @typedef {{kind: 'samples', samplings: Sampling[]}
 *         | {kind: 'heap', heap: Heap, parse: Parse | null}} Loaded
 */

/**
 * @typedef {object} Options
 * @property {import('./model/anonymize.js').Rules} [anonymous] what to replace in the names, if anything
 * @property {import('./hprof/jheap.js').ProgressCallback} [onProgress] told how a dump's parse goes
 * @property {import('./hprof/dump.js').Parser} [parse] where a dump is parsed: a worker by default
 */

/** What a heap dump starts with, whatever its version. */
const DUMP = 'JAVA PROFILE';

/**
 * A recording gives a sampling per kind of samples it holds, the wall clock first, so that the page
 * can switch without reading it again.
 *
 * @param {File} file
 * @param {Options} [options]
 * @returns {Promise<Loaded>}
 * @throws {Error} when the file is none of these, in words for the user; an `AbortError` when another
 *         file stopped the parse of a dump
 */
export async function loadFile(file, {anonymous, onProgress = () => {}, parse = parseInWorker} = {}) {
  const loaded = await read(file, onProgress, parse);
  if (!anonymous)
    return loaded;
  const anonymize = anonymizer(anonymous);
  return loaded.kind === 'heap'
    ? {...loaded, heap: anonymized(loaded.heap, anonymize)}
    : {...loaded, samplings: loaded.samplings.map(s => ({...s, profile: anonymize(s.profile)}))};
}

/**
 * A heap from the parse kept of a dump, as loadFile gave it.
 *
 * @param {Parse} parse
 * @param {import('./model/anonymize.js').Rules} [anonymous] what to replace in the names, if anything
 * @returns {Heap}
 */
export function loadParse(parse, anonymous) {
  const heap = heapOf(parse.doc, parse.report);
  return anonymous ? anonymized(heap, anonymizer(anonymous)) : heap;
}

/**
 * @param {Heap} heap
 * @param {(profile: Profile) => Profile} anonymize
 * @returns {Heap} its names replaced: its counts stay, as no two names become one
 */
function anonymized(heap, anonymize) {
  return {...heap, profile: anonymize(heap.profile)};
}

/**
 * @param {File} file
 * @param {import('./hprof/jheap.js').ProgressCallback} onProgress
 * @param {import('./hprof/dump.js').Parser} parse
 * @returns {Promise<Loaded>}
 */
async function read(file, onProgress, parse) {
  // the first bytes only: a dump is never read whole, whatever its size
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  if (startsAsDump(gzipped ? await unzippedHead(file) : new Uint8Array(await file.slice(0, DUMP.length).arrayBuffer()))) {
    if (gzipped)
      throw new Error(`${file.name} is a gzipped heap dump, which the page cannot read: unzip it first, `
        + `or run jheap on it, the command line, and open the ${keptName(file.name)} it keeps beside it.`);
    const {doc, report} = await parse(file, onProgress);
    return {kind: 'heap', heap: heapOf(doc, report), parse: {name: file.name, doc, report}};
  }
  const bytes = gzipped ? await unzipped(file) : new Uint8Array(await file.arrayBuffer());
  if (isJfr(bytes))
    return {kind: 'samples', samplings: fromRecording(file.name, bytes)};
  return fromText(file.name, new TextDecoder().decode(bytes));
}

/** @param {Uint8Array} bytes */
function startsAsDump(bytes) {
  return new TextDecoder().decode(bytes.subarray(0, DUMP.length)) === DUMP;
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
 * @returns {Loaded}
 */
function fromText(name, text) {
  if (!text.trimStart().startsWith('{')) {
    if (!isCollapsed(text))
      throw new Error(`${name} is none of what this page reads: a heap dump, a JFR recording, a profile of `
        + 'jfr-web or jheap, collapsed stacks.');
    try {
      return samples(readCollapsed(text));
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
  // a heap's: the report of jheap's parse, or the objects of each path, which no profile of samples has
  if (doc.heap || Array.isArray(doc.samples?.objects))
    return {kind: 'heap', heap: heapOf(doc, doc.heap?.report ?? null), parse: null};
  return samples(decode(doc));
}

/**
 * @param {Profile} profile
 * @returns {Loaded} the samples of a file that holds one kind
 */
function samples(profile) {
  return {kind: 'samples', samplings: [{key: 'samples', label: 'Samples', profile}]};
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
 * @param {File} file gzipped
 * @returns {Promise<Uint8Array>} its first bytes unzipped, the rest left unread
 */
async function unzippedHead(file) {
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  try {
    let head = new Uint8Array(0);
    while (head.length < DUMP.length) {
      const {done, value} = await reader.read();
      if (done)
        break;
      head = Uint8Array.from([...head, ...value.subarray(0, DUMP.length - head.length)]);
    }
    return head;
  }
  finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * @param {File} file gzipped
 * @returns {Promise<Uint8Array>} its bytes, unzipped
 */
async function unzipped(file) {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
