// @ts-check
// A heap's profile reduced to what the page draws (web/js/model/reduce.js), for a gallery:
//   node tools/reduce.js [--level 0-2] [--check] <in.json[.gz]> <out.json[.gz]>
// --level: how much may be lost (LEVELS), 1 by default. --check: what each view draws otherwise.
import {readFileSync, writeFileSync} from 'node:fs';
import {gzipSync, gunzipSync} from 'node:zlib';
import {decodeHeap, encode} from '../web/js/profile/heap.js';
import {reduce, compare, LEVELS} from '../web/js/model/reduce.js';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, name === '--check' ? 1 : 2)[name === '--check' ? 0 : 1];
};
const check = flag('--check') !== undefined;
const level = Number(flag('--level') ?? 1);
const [input, output] = args;
if (!input || !output || !LEVELS[level]) {
  console.error(`usage: node tools/reduce.js [--level 0-${LEVELS.length - 1}] [--check] <in> <out>`);
  process.exit(2);
}

let bytes = readFileSync(input);
if (bytes[0] === 0x1f && bytes[1] === 0x8b)
  bytes = gunzipSync(bytes);
const doc = JSON.parse(bytes.toString('utf8'));
const before = decodeHeap(doc);
const loss = LEVELS[level];
const after = reduce(before, loss);
// what a heap keeps beside the profile (jheap's report of the dump, duplicates) goes along
const FORMAT = ['version', 'minor', 'unit', 'weights', 'start', 'end', 'strings', 'stacks', 'samples', 'threads',
                'operations', 'meta'];
const beside = Object.fromEntries(Object.entries(doc).filter(([key]) => !FORMAT.includes(key)));
const json = JSON.stringify({...encode(after), ...beside, reduced: loss});
writeFileSync(output, output.endsWith('.gz') ? gzipSync(json, {level: 9}) : json);
console.log(`level ${level}: ${before.parent.length} nodes → ${after.parent.length}, ${json.length} bytes, `
            + `${gzipSync(json, {level: 9}).length} gzipped`);

if (check) {
  for (const d of compare(before, after, loss))
    console.log(`  ${d.view.padEnd(24)} peaks moved ${d.moved}, self ±${percent(d.self)}, total ±${percent(d.total)}, `
                + `depths changed ${d.depths}, ridges missing ${d.missing}/${d.ridges}, added ${d.added}, `
                + `worst ±${percent(d.worst)} of the top`);
}

/** @param {number} x */
function percent(x) {
  return `${(100 * x).toFixed(2)}%`;
}
