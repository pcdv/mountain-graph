// @ts-check
/**
 * The report of a heap dump parse: what was read, what it cost, and what the
 * aggregation did with it. Shown in a floating pane so that a slow or
 * incomplete parse can be read after the fact.
 */
import {h} from '../lib/dom.js';
import {bytes, duration, percent} from '../lib/format.js';

/** @typedef {import('../hprof/jheap.js').ParseReport} ParseReport */

/**
 * The report as plain text: one `key: value` per line, raw numbers included,
 * so that it can be pasted into a chat and read back without guessing.
 *
 * @param {ParseReport} r
 * @returns {string}
 */
export function reportText(r) {
  const lines = [
    `file: ${r.fileName}`,
    `file-bytes: ${r.fileSize}`,
    `size: ${bytes(r.fileSize)}`,
    `format: ${r.version}`,
    `id-size: ${r.idSize}`,
    `pointers: ${r.pointers ?? 'unknown'}`,
    `pointers-guessed: ${r.pointersGuessed ?? false}`,
    `heap-span-bytes: ${r.heapSpan ?? 0}`,
    `heap-segments: ${r.heapSegmentCount}`,
    `heap-segment-bytes: ${r.heapSegmentBytes}`,
    `time-total-ms: ${Math.round(r.parseTimeMs)}`,
    `time-metadata-ms: ${Math.round(r.metadataTimeMs)}`,
    `time-objects-ms: ${Math.round(r.objectsTimeMs)}`,
    `time-graph-ms: ${Math.round(r.graphTimeMs)}`,
    `throughput-mib-s: ${(r.fileSize / 1024 / 1024 / (r.parseTimeMs / 1000)).toFixed(1)}`,
    `strings: ${r.stringCount}`,
    `classes: ${r.classCount}`,
    `instances: ${r.instanceCount}`,
    `object-arrays: ${r.objectArrayCount}`,
    `primitive-arrays: ${r.primitiveArrayCount}`,
    `objects-total: ${r.instanceCount + r.objectArrayCount + r.primitiveArrayCount}`,
    `roots: ${r.rootCount}`,
    ...Object.entries(r.rootsByType).sort((a, b) => b[1] - a[1]).map(([name, count]) => `root.${name}: ${count}`),
    `reachable-bytes: ${r.reachableSize}`,
    `unreachable-bytes: ${r.unreachableSize}`,
    `total-bytes: ${r.totalSize}`,
    `deepest-path: ${r.maxDepthReached}`,
    `depth-limit-hits: ${r.depthLimitHits}`,
    `distinct-paths: ${r.uniquePathCount}`,
  ];
  return lines.join('\n');
}

/**
 * Puts the report on the clipboard, or leaves a box to copy it from when the
 * browser refuses.
 *
 * @param {ParseReport} r
 * @param {HTMLElement} status where to say what happened
 */
async function copyReport(r, status) {
  const text = reportText(r);
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = 'Copied';
  }
  catch (e) {
    status.textContent = 'Select and copy:';
    const box = h('textarea', {class: 'report-copy', rows: 12, readonly: true});
    box.value = text;
    status.after(box);
    box.select();
    return;
  }
  setTimeout(() => status.textContent = '', 1500);
}

/**
 * @param {ParseReport} r
 * @returns {HTMLElement}
 */
export function parseReport(r) {
  const share = (/** @type {number} */ n) => percent(r.totalSize ? n / r.totalSize : 0);
  const status = h('span', {class: 'muted report-status'});
  return h('div', {class: 'report'},
    h('div', {class: 'report-actions'},
      h('button', {type: 'button', class: 'button', onclick: () => copyReport(r, status)}, 'Copy'),
      status),
    section('File', [
      row('Name', r.fileName ?? ''),
      row('Size', bytes(r.fileSize)),
      row('Format', r.version),
      row('Identifier size', `${r.idSize} bytes`),
      // a parse kept from before the layout was reported has none
      row('Pointers', r.pointers === undefined ? 'not known'
        : r.pointersGuessed ? `${r.pointers}, guessed from a heap spanning ${bytes(r.heapSpan)}` : r.pointers),
      row('Heap segments', `${r.heapSegmentCount.toLocaleString()}, ${bytes(r.heapSegmentBytes)}`),
    ]),
    section('Time', [
      row('Total', duration(r.parseTimeMs)),
      row('Strings and classes', duration(r.metadataTimeMs)),
      row('Objects', duration(r.objectsTimeMs)),
      row('Aggregating', duration(r.graphTimeMs)),
      row('Throughput', `${(r.fileSize / 1024 / 1024 / (r.parseTimeMs / 1000)).toFixed(1)} MiB/s`),
    ]),
    section('Read', [
      row('Strings', r.stringCount.toLocaleString()),
      row('Classes', r.classCount.toLocaleString()),
      row('Instances', r.instanceCount.toLocaleString()),
      row('Object arrays', r.objectArrayCount.toLocaleString()),
      row('Primitive arrays', r.primitiveArrayCount.toLocaleString()),
      row('Objects total', (r.instanceCount + r.objectArrayCount + r.primitiveArrayCount).toLocaleString()),
    ]),
    section('Roots', [
      row('GC roots', r.rootCount.toLocaleString()),
      ...Object.entries(r.rootsByType)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => row(name, count.toLocaleString())),
    ]),
    section('Graph', [
      row('Reachable', `${bytes(r.reachableSize)} (${share(r.reachableSize)})`),
      row('Unreachable', `${bytes(r.unreachableSize)} (${share(r.unreachableSize)})`),
      row('Deepest path', String(r.maxDepthReached)),
      row('Depth limit hits', r.depthLimitHits.toLocaleString()),
      row('Distinct paths', r.uniquePathCount.toLocaleString()),
    ]),
  );
}

/**
 * @param {string} title
 * @param {HTMLElement[][]} rows
 * @returns {HTMLElement}
 */
function section(title, rows) {
  return h('div', {class: 'report-section'},
    h('div', {class: 'report-title'}, title),
    h('table', {class: 'report-table'}, rows.map(r => h('tr', null, r))));
}

/**
 * @param {string} name
 * @param {string} value
 * @returns {HTMLElement[]}
 */
function row(name, value) {
  return [h('td', {class: 'muted'}, name), h('td', null, value)];
}
