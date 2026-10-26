// @ts-check
/**
 * A heap dump to a heap profile: parsed by jheap, compiled to WebAssembly, in
 * a Web Worker that reads the file a slice at a time, so that a dump is never
 * read whole whatever its size. And what the page says of a heap: its
 * objects, classes and bytes, from the parse's report or the profile.
 */
import {weightOf} from '../profile/profile.js';
import {decodeHeap} from '../profile/heap.js';

/** @typedef {import('../profile/heap.js').HeapProfile} HeapProfile */
/** @typedef {import('./jheap.js').ProgressCallback} ProgressCallback */
/** @typedef {import('./jheap.js').ParseReport} ParseReport */

/**
 * @typedef {object} HeapStats
 * @property {number} objectCount
 * @property {number} classCount
 * @property {number} totalSize
 * @property {number} reachableSize
 * @property {number} unreachableSize
 * @property {ParseReport | null} report null for a profile saved without one
 */

/**
 * What jheap says of a profile of duplicate Strings (`jheap <dump> dups --save`): its paths end
 * at a value, each weighing what keeping one copy of that value would save, so the profile's
 * bytes add up to `saving` and its objects to the copies.
 *
 * @typedef {object} HeapDuplicates
 * @property {number} count values held in more than one copy, those the profile does not name included
 * @property {number} copies Strings that hold them
 * @property {number} bytes taken by those copies, Strings and arrays
 * @property {number} saving bytes that keeping one copy of each would save
 * @property {number} named values the profile names; the others share one frame
 */

/**
 * A heap, as the page shows it.
 *
 * @typedef {object} Heap
 * @property {HeapProfile} profile its paths, each with its bytes and its objects
 * @property {HeapStats} stats
 * @property {HeapDuplicates | null} duplicates set when the profile is of duplicate Strings,
 *           not of the heap: its peaks are values, not classes
 */

/**
 * Where a dump is parsed: in a worker in the page, in the test's own thread in
 * a test.
 *
 * @typedef {(file: File, onProgress: ProgressCallback) => Promise<{doc: any, report: ParseReport}>} Parser
 */

/**
 * @param {string} name of a dump
 * @returns {string} what jheap names the parse it keeps beside it
 */
export function keptName(name) {
  return `${name.replace(/\.hprof(\.gz)?$|\.gz$/i, '')}.jheap.json`;
}

/**
 * A heap from a profile document: jheap's parse, kept beside a dump or
 * handed by the worker, or a heap the page exported.
 *
 * @param {any} doc
 * @param {ParseReport | null} report the parse's, when known
 * @returns {Heap}
 */
export function heapOf(doc, report) {
  const profile = decodeHeap(doc);
  return {profile, stats: statsOf(profile, report), duplicates: duplicatesOf(doc.duplicates)};
}

/**
 * @param {any} d the document's `duplicates` member, if it has one
 * @returns {HeapDuplicates | null}
 */
function duplicatesOf(d) {
  if (!d || typeof d !== 'object')
    return null;
  /** @param {string} key */
  const n = key => Number.isFinite(d[key]) ? d[key] : 0;
  return {count: n('count'), copies: n('copies'), bytes: n('bytes'), saving: n('saving'), named: n('named')};
}

/**
 * The numbers the page's header says: from the parse's report when there is
 * one, else from the profile, which knows less.
 *
 * @param {HeapProfile} p
 * @param {ParseReport | null} report
 * @returns {HeapStats}
 */
function statsOf(p, report) {
  if (report)
    return {
      // instances and arrays, as jheap's command counts them and the profile's objects do: the
      // classes are counted apart
      objectCount: report.instanceCount + report.objectArrayCount + report.primitiveArrayCount,
      classCount: report.classCount,
      totalSize: report.totalSize,
      reachableSize: report.reachableSize,
      unreachableSize: report.unreachableSize,
      report,
    };
  let totalSize = 0, unreachableSize = 0, objectCount = 0;
  /** @type {Set<string>} */
  const classes = new Set();
  for (let i = 0; i < p.stack.length; i++) {
    let node = p.stack[i];
    if (node < 0)
      continue;
    const w = weightOf(p, i);
    totalSize += w;
    objectCount += p.objects?.[i] ?? 0;
    classes.add(p.strings[p.frame[node] >>> 3]);
    while (p.parent[node] >= 0)
      node = p.parent[node];
    if (p.strings[p.frame[node] >>> 3] === '(unreachable)')
      unreachableSize += w;
  }
  return {objectCount, classCount: classes.size, totalSize, reachableSize: totalSize - unreachableSize,
          unreachableSize, report: null};
}

/** The worker parsing now, stopped when another file is opened. */
/** @type {{worker: Worker, stop: () => void} | null} */
let parsing = null;

/**
 * Parses a dump in a Web Worker: the page stays responsive, and the worker's
 * memory, the module's up to 4 GiB, goes with it. A file opened while another
 * parses stops that parse, whose promise rejects with an `AbortError`.
 *
 * @type {Parser}
 */
export function parseInWorker(file, onProgress) {
  parsing?.stop();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
    const done = () => {
      worker.terminate();
      if (parsing?.worker === worker)
        parsing = null;
    };
    parsing = {
      worker,
      stop: () => {
        done();
        reject(new DOMException(`The parse of ${file.name} stopped for another file.`, 'AbortError'));
      },
    };
    worker.addEventListener('message', ({data}) => {
      if (data.progress)
        onProgress(data.progress.phase, data.progress.percent);
      else {
        done();
        if (data.error)
          reject(new Error(data.error));
        else
          resolve(data.result);
      }
    });
    worker.addEventListener('error', e => {
      done();
      // a module that could not load, or memory that ran out
      reject(new Error(`The parser stopped: ${e.message || 'the worker failed'}`));
    });
    worker.postMessage({file});
  });
}

/** Stops the parse going on, if any: another file, which is no dump, was opened. */
export function stopParsing() {
  parsing?.stop();
}
