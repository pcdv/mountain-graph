// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {reportText} from '../../web/js/components/parse-report.js';

/** @returns {import('../../web/js/hprof/jheap.js').ParseReport} */
function report() {
  return {
    fileName: 'tiny.hprof',
    fileSize: 2048,
    idSize: 4,
    version: 'JAVA PROFILE 1.0.2',
    parseTimeMs: 12.4,
    metadataTimeMs: 8.2,
    objectsTimeMs: 3.1,
    graphTimeMs: 1.1,
    stringCount: 10,
    classCount: 2,
    rootCount: 3,
    rootsByType: {Unknown: 2, Thread: 1},
    instanceCount: 5,
    objectArrayCount: 1,
    primitiveArrayCount: 2,
    heapSegmentCount: 1,
    heapSegmentBytes: 1024,
    maxDepthReached: 7,
    depthLimitHits: 0,
    uniquePathCount: 4,
    totalSize: 512,
    reachableSize: 400,
    unreachableSize: 112,
  };
}

describe('reportText', () => {
  it('writes one key: value per line', () => {
    const lines = reportText(report()).split('\n');
    assert.ok(lines.every(l => /^[A-Za-z0-9. -]+: .+$/.test(l)));
  });

  it('keeps the raw numbers, not only the formatted ones', () => {
    const text = reportText(report());
    assert.match(text, /^file-bytes: 2048$/m);
    assert.match(text, /^time-total-ms: 12$/m);
    assert.match(text, /^reachable-bytes: 400$/m);
    assert.match(text, /^unreachable-bytes: 112$/m);
    assert.match(text, /^objects-total: 8$/m);
  });

  it('lists the roots per type, the most first', () => {
    const text = reportText(report());
    assert.match(text, /^root\.Unknown: 2$/m);
    assert.match(text, /^root\.Thread: 1$/m);
    assert.ok(text.indexOf('root.Unknown') < text.indexOf('root.Thread'));
  });
});
