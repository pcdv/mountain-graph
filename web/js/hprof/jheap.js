// @ts-check
/**
 * jheap's parser, compiled to WebAssembly: `jheap.wasm`, built in the jheap
 * repository (github.com/pcdv/jheap), where the command line `jheap` shares it.
 *
 * The module reads the file through `readAt`, a slice at a time, so a dump is
 * never held whole: in the page, a Web Worker reads the `File` synchronously.
 * It gives back the profile document (jfr-web's version 4, which `decodeHeap`
 * reads) and the parse's report. The object graph stays in the module, whose
 * memory goes with the instance: one instance per parse.
 *
 * No DOM: run by the worker, and by the tests in Node.
 */

/**
 * Detailed report of the parsing process.
 *
 * @typedef {object} ParseReport
 * @property {string} fileName
 * @property {number} fileSize bytes
 * @property {number} idSize 4 or 8 bytes per object ID
 * @property {'compressed' | 'wide' | '32-bit'} pointers the layout the shallow sizes are counted in
 * @property {boolean} pointersGuessed the layout was guessed from the heap's span, not given
 * @property {number} heapSpan bytes between the lowest and the highest object address
 * @property {string} version HPROF version string
 * @property {number} parseTimeMs total parsing time
 * @property {number} metadataTimeMs time reading strings/classes
 * @property {number} objectsTimeMs time reading objects
 * @property {number} graphTimeMs time walking graph and aggregating
 * @property {number} stringCount strings in string table
 * @property {number} classCount classes found
 * @property {number} rootCount GC roots found
 * @property {Record<string, number>} rootsByType count per root type
 * @property {number} instanceCount instance objects
 * @property {number} objectArrayCount object arrays
 * @property {number} primitiveArrayCount primitive arrays
 * @property {number} heapSegmentCount heap dump segments
 * @property {number} heapSegmentBytes total bytes in heap segments
 * @property {number} maxDepthReached deepest path found
 * @property {number} depthLimitHits times depth limit stopped traversal
 * @property {number} uniquePathCount distinct paths after aggregation
 * @property {number} totalSize bytes of every object read
 * @property {number} reachableSize bytes reachable from roots
 * @property {number} unreachableSize bytes not reachable from roots
 */

/**
 * Progress callback during parsing.
 * @typedef {(phase: string, percent: number) => void} ProgressCallback
 */

/**
 * A file as the module reads it.
 *
 * @typedef {object} Source
 * @property {number} size bytes
 * @property {string} name for the report and the messages
 * @property {(offset: number, into: Uint8Array) => number} readAt fills `into` with the bytes
 *           from `offset`, as many as it can, and says how many
 * @property {'auto' | 'compressed' | 'wide'} [pointers] the width of a reference in the JVM,
 *           guessed from the heap's span by default
 * @property {ProgressCallback} [onProgress]
 * @property {number} [chunk] the bytes read at a time: small in tests, so that records fall
 *           across the window's edge
 */

/** The phases, by the number the module gives them. */
const PHASES = ['Reading strings and classes', 'Reading objects', 'Aggregating paths'];

/** The widths of a reference, by the number the module takes. */
const POINTERS = {auto: 0, compressed: 1, wide: 2};

/**
 * Parses a dump.
 *
 * @param {WebAssembly.Module} module jheap.wasm, compiled
 * @param {Source} source
 * @returns {Promise<{doc: any, report: ParseReport}>} the profile document, and the report
 * @throws {Error} for a file that is not a whole dump, with jheap's message
 */
export async function parseWithJheap(module, source) {
  /** @type {WebAssembly.Memory | undefined} */
  let memory;
  const instance = await WebAssembly.instantiate(module, {
    jheap: {
      // a view made at each call: the memory may have grown since the last
      read_at: (/** @type {number} */ offset, /** @type {number} */ ptr, /** @type {number} */ length) =>
        source.readAt(offset, new Uint8Array(/** @type {WebAssembly.Memory} */ (memory).buffer, ptr, length)),
      progress: (/** @type {number} */ phase, /** @type {number} */ percent) =>
        source.onProgress?.(PHASES[phase] ?? 'Parsing', percent),
      now: () => performance.now(),
    },
  });
  const exports = /** @type {any} */ (instance.exports);
  memory = /** @type {WebAssembly.Memory} */ (exports.memory);

  const name = new TextEncoder().encode(source.name);
  const at = exports.jheap_alloc(name.length);
  new Uint8Array(memory.buffer, at, name.length).set(name);
  const length = exports.jheap_parse(source.size, POINTERS[source.pointers ?? 'auto'], source.chunk ?? 0, at, name.length);
  exports.jheap_free(at, name.length);

  const answer = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, exports.jheap_result(), length)));
  if (answer.error)
    throw new Error(answer.error);
  return answer;
}
