// @ts-check
/**
 * Parses a dropped dump away from the page, so that the page stays responsive
 * however long the dump takes, and a new file can stop the parse of the last.
 *
 * Given `{file}`, it posts `{progress: {phase, percent}}` as it goes, then
 * `{result: {doc, report}}` or `{error}`. The `File` is read synchronously, a
 * slice at a time, which only a worker can do.
 */
import {parseWithJheap} from './jheap.js';

/**
 * Reads a slice of a file in step, which only a worker can: the DOM's types,
 * which this project is checked against, do not have it.
 *
 * @type {new () => {readAsArrayBuffer(blob: Blob): ArrayBuffer}}
 */
const FileReaderSync = /** @type {any} */ (globalThis).FileReaderSync;

/** The bytes read at a time: each read costs a call and a copy, so fewer, larger ones. */
const CHUNK = 16 << 20;

/** jheap.wasm, compiled once for the worker's life: one parse, as the page uses it. */
/** @type {Promise<WebAssembly.Module> | null} */
let compiled = null;

addEventListener('message', async (/** @type {MessageEvent<{file: File}>} */ {data: {file}}) => {
  try {
    // fetched as bytes, not streamed: no server has to say application/wasm
    compiled ??= fetch(new URL('./jheap.wasm', import.meta.url))
      .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`jheap.wasm: ${r.status} ${r.statusText}`)))
      .then(bytes => WebAssembly.compile(bytes));
    const reader = new FileReaderSync();
    const result = await parseWithJheap(await compiled, {
      size: file.size,
      name: file.name,
      chunk: CHUNK,
      readAt: (offset, into) => {
        const bytes = new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + into.length)));
        into.set(bytes);
        return bytes.length;
      },
      onProgress: (phase, percent) => postMessage({progress: {phase, percent}}),
    });
    postMessage({result});
  }
  catch (e) {
    postMessage({error: e instanceof Error ? e.message : String(e)});
  }
});
