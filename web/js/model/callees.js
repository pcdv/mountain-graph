// @ts-check
/**
 * What a peak called, down to what ran at the top of the stack, each top
 * tagged by the kind of work it does when known (compressing, writing to a
 * socket, parsing XML): a peak slow for those reasons is slow for its
 * callees, not its own code.
 *
 * No DOM: tested with Node.
 */
import {tree, mainType, SYNTHETIC} from '../profile/profile.js';
import {owner} from './peaks.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */
/** @typedef {import('../profile/profile.js').Filter} Filter */
/** @typedef {import('../profile/profile.js').Frame} Frame */
/** @typedef {import('./peaks.js').Grain} Grain */

/**
 * What kind of work a frame at the top of the stack does, when it is a well
 * known one: a peak whose time goes mostly there is slow for that reason
 * (compressing, writing to a socket), not for its own code.
 *
 * @type {[string, RegExp][]}
 */
const KINDS = [
  ['compression', /\.(Deflater|Inflater|GZIP\w*|ZipFile|CRC32|Adler32)\.|\.zip\.|zstd|lz4|snappy/i],
  ['network write', /SocketDispatcher\.write|socketWrite|SocketOutputStream|\.Net\.send|NioSocketImpl\.write|SocketChannelImpl\.write/],
  ['file I/O', /FileDispatcherImpl|FileOutputStream\.write|FileInputStream\.read|RandomAccessFile\.|FileDescriptor\.close|UnixNativeDispatcher|WindowsNativeDispatcher|WinNTFileSystem|UnixFileSystem|FileChannelImpl/],
  ['lock', /\.Unsafe\.park|\.Object\.wait|AbstractQueuedSynchronizer|\.locks\./],
  ['allocation', /Arrays\.copyOf|\.ensureCapacity|StringBuilder\.(append|<init>)|AbstractStringBuilder/],
  ['reflection', /^java\.lang\.(invoke|reflect)\.|LambdaForm|\$\$Lambda|GeneratedMethodAccessor|DirectMethodHandleAccessor|^jdk\.internal\.reflect\./],
  ['XML', /\.xerces\.|^javax\.xml\.|\.xml\.(parsers|stream|transform)\.|^org\.xml\.sax\.|^org\.w3c\.dom\./],
  ['regex', /^java\.util\.regex\./],
  ['collections', /^java\.util\.(HashMap|LinkedHashMap|TreeMap|ArrayList|HashSet|TreeSet|ArrayDeque|Collections|AbstractMap|AbstractList|ImmutableCollections|concurrent\.ConcurrentHashMap)\b/],
];

/**
 * @param {string} name of a method
 * @returns {string} the kind of work it does, '' for none known
 */
export function kindOf(name) {
  for (const [kind, re] of KINDS)
    if (re.test(name))
      return kind;
  return '';
}

/**
 * @typedef {object} Top
 * @property {string} name of the method at the top of the stack
 * @property {number} ms
 * @property {string} kind of work, as kindOf() tells it
 */

/**
 * What a peak called: from each frame of it nearest the root of a stack,
 * the frames above, no frame hidden (the JDK's say where the time went: a
 * gzip stream, a socket). For a class or a package, its methods called from
 * outside it first. And the methods those samples ran in, at the top of the
 * stack, the most first.
 *
 * @param {Profile} p
 * @param {Filter} filter that the peaks were found with: its hidden frames are shown
 * @param {string} name of the peak
 * @param {Grain} [grain] that the peaks were found with
 * @returns {{tree: Frame, tops: Top[], groups: {name: string, ms: number}[]}} its total is that of
 *          the samples the peak was in; the tops gathered by kind, or else by package (its first
 *          three parts), the most first
 */
export function callees(p, filter, name, grain = 'method') {
  const {root} = tree(p, {...filter, hide: '', merged: true, reversed: false});
  /** @typedef {{name: string, total: number, self: number, types: number[], children: Map<string, Merged>}} Merged */
  /** @param {string} n @param {number[]} types @returns {Merged} */
  const merged = (n, types) => ({name: n, total: 0, self: 0, types: types.map(() => 0), children: new Map()});
  const top = merged(name, root.types);
  /** @param {Merged} into @param {Frame} f */
  const add = (into, f) => {
    into.total += f.total;
    into.self += f.self;
    f.types.forEach((t, i) => into.types[i] += t);
    for (const c of f.children) {
      let to = into.children.get(c.name);
      if (!to)
        into.children.set(c.name, to = merged(c.name, c.types));
      add(to, c);
    }
  };
  /** @param {Frame} f */
  const find = f => {
    if (mainType(f) !== SYNTHETIC && owner(f.name, grain) === name) {
      if (grain === 'method')
        add(top, f);
      else {
        let method = top.children.get(f.name);
        if (!method)
          top.children.set(f.name, method = merged(f.name, f.types));
        add(method, f);
        top.total += f.total;
        f.types.forEach((t, i) => top.types[i] += t);
      }
      return;
    }
    f.children.forEach(find);
  };
  find(root);

  /** @type {Map<string, number>} */
  const tops = new Map();
  /** @param {Merged} m @returns {Frame} */
  const freeze = m => {
    if (m.self > 0)
      tops.set(m.name, (tops.get(m.name) ?? 0) + m.self);
    return {name: m.name, total: m.total, self: m.self, types: m.types,
            children: [...m.children.values()].map(freeze).sort((a, b) => b.total - a.total)};
  };
  const frozen = freeze(top);
  const list = [...tops].map(([n, ms]) => ({name: n, ms, kind: kindOf(n)})).sort((a, b) => b.ms - a.ms);
  /** @type {Map<string, number>} */
  const groups = new Map();
  for (const t of list) {
    const key = t.kind || owner(t.name, 'package').split('.').slice(0, 3).join('.');
    groups.set(key, (groups.get(key) ?? 0) + t.ms);
  }
  return {
    tree: frozen,
    tops: list,
    groups: [...groups].map(([n, ms]) => ({name: n, ms})).sort((a, b) => b.ms - a.ms),
  };
}
