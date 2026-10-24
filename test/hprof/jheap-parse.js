// @ts-check
/**
 * The page's parser, jheap's in WebAssembly, in the shape the parse tests
 * read: the paths with their bytes and their objects, and the report.
 */
import {readFileSync} from 'node:fs';
import {parseWithJheap} from '../../web/js/hprof/jheap.js';
import {decodeHeap} from '../../web/js/profile/heap.js';
import {stacksOf} from '../../web/js/profile/heap.js';

const module = new WebAssembly.Module(readFileSync(new URL('../../web/js/hprof/jheap.wasm', import.meta.url)));

/**
 * Parses a dump. The file is read whole first, as Node reads a `File` only
 * asynchronously and the module reads it in step: the page's worker reads it
 * in slices.
 *
 * @param {File} file
 * @param {import('../../web/js/hprof/jheap.js').ProgressCallback} [onProgress]
 * @param {{chunk?: number, pointers?: 'auto' | 'compressed' | 'wide'}} [options]
 */
export async function parseHprof(file, onProgress, {chunk, pointers = 'auto'} = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const {doc, report} = await parseWithJheap(module, {
    size: bytes.length,
    name: file.name,
    pointers,
    chunk,
    onProgress,
    readAt: (offset, into) => {
      const part = bytes.subarray(offset, offset + into.length);
      into.set(part);
      return part.length;
    },
  });
  const p = decodeHeap(doc);
  /** @type {Map<string, number>} */
  const objects = new Map();
  for (let i = 0; i < p.stack.length; i++) {
    /** @type {string[]} */
    const frames = [];
    for (let n = p.stack[i]; n >= 0; n = p.parent[n])
      frames.unshift(p.strings[p.frame[n] >>> 3]);
    const key = frames.join(';');
    objects.set(key, (objects.get(key) ?? 0) + (p.objects?.[i] ?? 0));
  }
  return {stacks: stacksOf(p), objects, report};
}
