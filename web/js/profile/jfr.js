// @ts-check
/**
 * A JFR recording read in the page, with no server: its chunks, each with the description of its
 * types (metadata) and its constant pools (symbols, classes, methods, threads, stack traces), then
 * its events, of which the samples are kept. No official specification exists: this follows
 * the format the JDK writes since 11, where integers are compressed (LEB128).
 *
 * A recording holds two kinds of samples, which weigh different things: execution samples
 * (Java and native methods, weighing the time a sample stands for) and allocation samples
 * (weighing the bytes). Both are read in a single pass, each into a Profile, so that the page
 * can switch between them. What a recording lacks is left empty, as in collapsed.js.
 *
 * Operations are those jfr-web reads (Analysis.java): the requests of flak (`flak.Request`) and the
 * operations of its API (`jfrweb.Operation`, with `jfrweb.OperationSegment` for the threads of an
 * asynchronous one), not the events an application maps to operations by configuration. A sample
 * belongs to the innermost operation its thread was in at its time.
 *
 * No DOM: tested with Node.
 */
import {COMPILED, INLINED, INTERPRETED, NATIVE, SYNTHETIC, ALLOCATED} from './profile.js';

/** @typedef {import('./profile.js').Profile} Profile */

/** The events kept. */
const EXECUTION = 'jdk.ExecutionSample', NATIVE_SAMPLE = 'jdk.NativeMethodSample',
      ALLOCATION = 'jdk.ObjectAllocationSample', SETTING = 'jdk.ActiveSetting',
      FLAK_REQUEST = 'flak.Request', OPERATION = 'jfrweb.Operation', SEGMENT = 'jfrweb.OperationSegment';

const HEADER = 68;

/**
 * @param {Uint8Array} bytes
 * @returns {boolean} whether it starts as a JFR recording does
 */
export function isJfr(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x52 && bytes[3] === 0;
}

/**
 * @typedef {object} Recording
 * @property {Profile | null} wall the Java and native samples, weighing ms; null if it has none
 * @property {Profile | null} alloc the allocation samples, weighing bytes; null if it has none
 */

/**
 * @param {Uint8Array} bytes a recording, of one chunk or more
 * @returns {Recording}
 * @throws {Error} when it is not a recording this reads
 */
export function readJfr(bytes) {
  if (!isJfr(bytes))
    throw new Error('Not a JFR recording: it does not start with FLR.');
  const wall = new Builder('ms'), alloc = new Builder('bytes');
  /** @type {Chunk | undefined} */
  let first;
  /** @type {Map<string, Map<string, string>>} */
  const settings = new Map();
  let end = 0;
  for (let at = 0; at < bytes.length;) {
    const chunk = readChunk(bytes, at, first);
    first ??= chunk;
    end = chunk.endNanos - first.startNanos;
    chunk.settings.forEach((s, event) => settings.set(event, new Map([...settings.get(event) ?? [], ...s])));
    wall.chunk(chunk);
    alloc.chunk(chunk);
    at += chunk.size;
  }
  if (!first)
    throw new Error('Empty JFR recording.');
  const start = new Date(first.startNanos / 1e6).toISOString();
  return {
    wall: wall.profile(start, end, weights(settings, wall)),
    alloc: alloc.profile(start, end, [1, 1]),
  };
}

/**
 * @param {Map<string, Map<string, string>>} settings those of the events, by event
 * @param {Builder} wall
 * @returns {number[]} the ms a Java and a native sample stand for
 */
function weights(settings, wall) {
  return [
    weight(period(settings.get(EXECUTION)), observedRound(wall.times[0])),
    weight(period(settings.get(NATIVE_SAMPLE)), observedMean(wall.times[1])),
  ];
}

/**
 * @param {Map<string, string> | undefined} s the settings of an event
 * @returns {number | null} its period in ms, if enabled and told
 */
function period(s) {
  if (!s || s.get('enabled') !== 'true')
    return null;
  const m = /^\s*(\d+)\s*(ns|us|ms|s|m|h|d)\s*$/.exec(s.get('period') ?? '');
  if (!m)
    return null;
  return Number(m[1]) * {ns: 1e-6, us: 1e-3, ms: 1, s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7}[/** @type {'ms'} */ (m[2])];
}

/**
 * The time a sample stands for: the period actually observed, which on Windows can be much longer
 * than the one asked (as jfr-web's Analysis.weight).
 *
 * @param {number | null} periodMs
 * @param {number | null} observedMs
 * @returns {number}
 */
function weight(periodMs, observedMs) {
  let ms = periodMs ?? 1;
  if (observedMs !== null)
    ms = Math.max(ms, Math.round(observedMs));
  return Math.max(1, Math.floor(ms));
}

/**
 * The interval between rounds of Java samples. A round samples the threads running Java code at that
 * moment, so the rounds where none is are missing: the shortest gaps between rounds are the period.
 * The samples of a round are taken within a millisecond.
 *
 * @param {number[]} times of the samples, in ms
 * @returns {number | null} ms
 */
function observedRound(times) {
  const t = Float64Array.from(times).sort();
  /** @type {number[]} */
  const gaps = [];
  let roundStart = t.length === 0 ? 0 : t[0];
  for (let i = 1; i < t.length; i++)
    if (t[i] - t[i - 1] > 1) {
      gaps.push(t[i] - roundStart);
      roundStart = t[i];
    }
  if (gaps.length < 20)
    return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 10)];
}

/**
 * The mean interval between native samples: JFR samples one thread in native code per period, and
 * a server always has one (an idle selector, an acceptor).
 *
 * @param {number[]} times in ms
 * @returns {number | null} ms
 */
function observedMean(times) {
  if (times.length < 2)
    return null;
  let lo = Infinity, hi = -Infinity;
  for (const t of times) {
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return (hi - lo) / (times.length - 1);
}

// ---------------------------------------------------------------- the format

/**
 * @typedef {object} Field
 * @property {string} name
 * @property {number} type the id of its type
 * @property {boolean} pool whether its value is the key of an entry in the constant pool of its type
 * @property {number} dimension 0, or 1 for an array
 */

/**
 * @typedef {object} Type
 * @property {number} id
 * @property {string} name
 * @property {Field[]} fields
 */

/**
 * What a chunk gives the events: everything resolved, its keys local to it.
 *
 * @typedef {object} Chunk
 * @property {number} size
 * @property {number} startNanos since the epoch
 * @property {number} endNanos
 * @property {number} startTicks
 * @property {number} ticksPerSecond
 * @property {Map<string, Map<number, any>>} pools by the name of their type, then key
 * @property {Map<string, Map<string, string>>} settings of each event, by its name
 * @property {{name: string, time: number, thread: number, stack: number, cls: number, weight: number}[]} samples
 *           the samples of the chunk, the keys being those of its pools; time in ms since the
 *           first chunk started
 * @property {RawOperation[]} operations
 * @property {{id: number, thread: number, start: number, end: number}[]} segments the threads working for an
 *           asynchronous operation, by the id of its event; thread a key in the pools, times in ms as
 *           the samples'
 */

/**
 * @typedef {object} RawOperation
 * @property {number} id that its segments tell, -1 for a request
 * @property {number} thread a key in the pools of its chunk
 * @property {number} start ms since the first chunk started
 * @property {number} duration ms
 * @property {string} name
 * @property {string | null} detail
 * @property {number} status the HTTP status of a request, 0 for other operations
 * @property {boolean} failed
 * @property {string | null} error
 * @property {boolean} async
 * @property {number} bytesIn
 * @property {number} bytesOut
 */

/** A reader of the bytes of a chunk. */
class Reader {
  /** @param {Uint8Array} bytes @param {number} pos */
  constructor(bytes, pos) {
    this.u8 = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  byte() {
    return this.u8[this.pos++];
  }

  /**
   * An integer of any size, in the compressed form: groups of 7 bits, the lowest first, the high bit of a
   * byte telling that another follows; the ninth byte of a long holds 8 bits. A long beyond 2^53 loses
   * its lowest bits: only times and sizes are read, to the ms.
   */
  int() {
    let r = 0, mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8[this.pos++];
      r += (b & 0x7f) * mul;
      if (b < 0x80)
        return r;
      mul *= 128;
    }
    return r + this.u8[this.pos++] * mul;
  }

  /** @returns {string | Pooled | null} */
  string() {
    const e = this.byte();
    switch (e) {
      case 0: return null;
      case 1: return '';
      // in the pool of strings, which a checkpoint may write after the event
      case 2: return new Pooled(this.int());
      case 3: case 5: {
        const n = this.int();
        const s = e === 3 ? utf8.decode(this.u8.subarray(this.pos, this.pos + n))
                          : latin1.decode(this.u8.subarray(this.pos, this.pos + n));
        this.pos += n;
        return s;
      }
      case 4: {
        const n = this.int();
        let s = '';
        for (let i = 0; i < n; i++)
          s += String.fromCharCode(this.int());
        return s;
      }
      default:
        throw new Error(`Unknown string encoding ${e} at byte ${this.pos - 1} of the recording.`);
    }
  }
}

const utf8 = new TextDecoder('utf-8'), latin1 = new TextDecoder('latin1');

/** A string kept in the pool of strings of its chunk: the key of its entry. */
class Pooled {
  /** @param {number} key */
  constructor(key) {
    this.key = key;
  }
}

/**
 * @param {Map<string, Map<number, any>>} pools those of a chunk, all read
 * @returns {(v: any) => string | null} what gives the string of a value read: itself, or its entry in the pool
 *          of strings when it is a key to it; null when it is none
 */
function texter(pools) {
  const strings = pools.get('java.lang.String');
  return v => v instanceof Pooled ? String(strings?.get(v.key) ?? '') : typeof v === 'string' ? v : null;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at where the chunk starts
 * @param {Chunk | undefined} first the first chunk, which time is counted from
 * @returns {Chunk}
 */
function readChunk(bytes, at, first) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, bytes.byteLength - at);
  if (view.byteLength < HEADER || view.getUint32(0) !== 0x464c5200)
    throw new Error(`Byte ${at} of the recording does not start a chunk.`);
  const major = view.getUint16(4);
  if (major !== 2)
    throw new Error(`This reads recordings of version 2 (JDK 11 and later), not ${major}.`);
  const size = Number(view.getBigInt64(8));
  const metadata = Number(view.getBigInt64(24));
  const startNanos = Number(view.getBigInt64(32));
  const duration = Number(view.getBigInt64(40));
  const startTicks = Number(view.getBigInt64(48));
  const ticksPerSecond = Number(view.getBigInt64(56));
  const features = view.getInt32(64);
  if (!(features & 1))
    throw new Error('This reads recordings with compressed integers, which the JDK writes.');
  if (size <= HEADER || at + size > bytes.length)
    throw new Error(`The recording is cut: the chunk at byte ${at} tells ${size} bytes.`);

  const chunk = bytes.subarray(at, at + size);
  const types = readMetadata(new Reader(chunk, metadata));
  /** @type {Map<number, Type>} */
  const byId = new Map(types.map(t => [t.id, t]));
  /** @type {Map<string, Type>} */
  const byName = new Map(types.map(t => [t.name, t]));
  /** @type {Map<number, string>} the events kept, by the id of their type */
  const wanted = new Map();
  for (const n of [EXECUTION, NATIVE_SAMPLE, ALLOCATION, SETTING, FLAK_REQUEST, OPERATION, SEGMENT]) {
    const t = byName.get(n);
    if (t)
      wanted.set(t.id, n);
  }

  /** @type {Chunk} */
  const result = {
    size, startNanos, endNanos: startNanos + duration, startTicks, ticksPerSecond,
    pools: new Map(), settings: new Map(), samples: [], operations: [], segments: [],
  };
  const origin = first ? (startNanos - first.startNanos) / 1e6 : 0;
  const r = new Reader(chunk, HEADER);
  const values = new Values(r, byId);
  /** @type {Map<number, Map<string, string>>} the settings of each event, by the id of its type */
  const settings = new Map();
  /** @type {{id: number, name: any, value: any}[]} the settings as written: their strings are read once the pools are */
  const written = [];
  /** @type {{kind: string, e: Record<string, any>, start: number, duration: number}[]} likewise the operations */
  const found = [];
  while (r.pos < size) {
    const from = r.pos;
    const length = r.int();
    const type = r.int();
    if (type === 1) {
      readPools(r, values, byId, result.pools);
    }
    else if (wanted.has(type)) {
      const name = /** @type {string} */ (wanted.get(type));
      const e = values.struct(/** @type {Type} */ (byId.get(type)));
      if (name === SETTING) {
        written.push({id: e.id, name: e.name, value: e.value});
      }
      else if (name === FLAK_REQUEST || name === OPERATION || name === SEGMENT) {
        found.push({kind: name, e, start: origin + (e.startTime - startTicks) * 1000 / ticksPerSecond,
                    duration: (e.duration ?? 0) * 1000 / ticksPerSecond});
      }
      else {
        result.samples.push({
          name,
          time: origin + (e.startTime - startTicks) * 1000 / ticksPerSecond,
          thread: e.sampledThread ?? e.eventThread ?? 0,
          stack: e.stackTrace ?? 0,
          cls: e.objectClass ?? 0,
          weight: e.weight ?? 0,
        });
      }
    }
    r.pos = from + length;
  }
  const text = texter(result.pools);
  for (const w of written) {
    const k = text(w.name), v = text(w.value);
    if (k !== null && v !== null) {
      const s = settings.get(w.id) ?? new Map();
      s.set(k, v);
      settings.set(w.id, s);
    }
  }
  for (const {kind, e, start, duration} of found) {
    if (kind === SEGMENT)
      result.segments.push({id: e.id, thread: e.eventThread ?? 0, start, end: start + duration});
    else if (kind === OPERATION)
      result.operations.push({
        id: e.id, thread: e.eventThread ?? 0, start, duration, name: String(text(e.name)), detail: text(e.detail),
        status: 0, failed: !!e.failed, error: text(e.error), async: !!e.async,
        bytesIn: e.bytesIn ?? 0, bytesOut: e.bytesOut ?? 0,
      });
    else {
      // a request of flak, named as jfr-web names it
      const method = text(e.method), route = text(e.route);
      result.operations.push({
        id: -1, thread: e.eventThread ?? 0, start, duration,
        name: `${method} ${route === null ? '(no route)' : text(e.app) + route}`,
        detail: `${method} ${text(e.path)}`, status: e.status ?? 0, failed: e.status >= 500,
        error: e.status >= 500 ? `HTTP ${e.status}` : null, async: false,
        bytesIn: e.bytesIn ?? 0, bytesOut: e.bytesOut ?? 0,
      });
    }
  }
  settings.forEach((s, id) => {
    const t = byId.get(id);
    if (t)
      result.settings.set(t.name, s);
  });
  return result;
}

/**
 * @param {Reader} r at the metadata event
 * @returns {Type[]}
 */
function readMetadata(r) {
  r.int(); // its size
  r.int(); // its type
  r.int(); r.int(); r.int(); // start, duration, id
  /** @type {string[]} */
  const strings = [];
  for (let n = r.int(); n > 0; n--)
    strings.push(String(r.string() ?? ''));

  /**
   * @typedef {{name: string, attributes: Map<string, string>, children: Element[]}} Element
   * @returns {Element}
   */
  const element = () => {
    const name = strings[r.int()];
    /** @type {Map<string, string>} */
    const attributes = new Map();
    for (let n = r.int(); n > 0; n--) {
      const key = strings[r.int()];
      attributes.set(key, strings[r.int()]);
    }
    /** @type {Element[]} */
    const children = [];
    for (let n = r.int(); n > 0; n--)
      children.push(element());
    return {name, attributes, children};
  };
  const root = element();
  /** @type {Type[]} */
  const types = [];
  for (const meta of root.children.filter(c => c.name === 'metadata'))
    for (const c of meta.children.filter(c => c.name === 'class'))
      types.push({
        id: Number(c.attributes.get('id')),
        name: c.attributes.get('name') ?? '',
        fields: c.children.filter(f => f.name === 'field').map(f => ({
          name: f.attributes.get('name') ?? '',
          type: Number(f.attributes.get('class')),
          pool: f.attributes.get('constantPool') === 'true',
          dimension: Number(f.attributes.get('dimension') ?? 0),
        })),
      });
  return types;
}

/**
 * The values of the types, read as the metadata describes them.
 */
class Values {
  /** @param {Reader} r @param {Map<number, Type>} types */
  constructor(r, types) {
    this.r = r;
    this.types = types;
  }

  /**
   * @param {Type} type
   * @returns {Record<string, any>} its fields, a value in the constant pool being its key
   */
  struct(type) {
    /** @type {Record<string, any>} */
    const o = {};
    for (const f of type.fields)
      o[f.name] = this.field(f);
    return o;
  }

  /** @param {Field} f */
  field(f) {
    if (f.dimension === 0)
      return this.single(f);
    const n = this.r.int();
    const a = new Array(n);
    for (let i = 0; i < n; i++)
      a[i] = this.single(f);
    return a;
  }

  /** @param {Field} f */
  single(f) {
    const r = this.r;
    if (f.pool)
      return r.int();
    const t = /** @type {Type} */ (this.types.get(f.type));
    switch (t.name) {
      case 'boolean': case 'byte': return r.byte();
      case 'char': case 'short': case 'int': case 'long': return r.int();
      case 'float': {
        const v = r.view.getFloat32(r.pos);
        r.pos += 4;
        return v;
      }
      case 'double': {
        const v = r.view.getFloat64(r.pos);
        r.pos += 8;
        return v;
      }
      case 'java.lang.String': return r.string();
      default: return this.struct(t);
    }
  }
}

/**
 * Reads a checkpoint event into the pools.
 *
 * @param {Reader} r after the type of the event
 * @param {Values} values
 * @param {Map<number, Type>} types
 * @param {Map<string, Map<number, any>>} pools
 */
function readPools(r, values, types, pools) {
  r.int(); r.int(); r.int(); // start, duration, delta
  r.byte(); // the mask
  for (let n = r.int(); n > 0; n--) {
    const t = /** @type {Type} */ (types.get(r.int()));
    let pool = pools.get(t.name);
    if (!pool)
      pools.set(t.name, pool = new Map());
    for (let m = r.int(); m > 0; m--) {
      const key = r.int();
      pool.set(key, t.name === 'java.lang.String' ? r.string() : values.struct(t));
    }
  }
}

// ---------------------------------------------------------------- the profiles

/** The primitives of arrays, as the JVM writes them. */
const PRIMITIVES = {Z: 'boolean', B: 'byte', C: 'char', S: 'short', I: 'int', J: 'long', F: 'float', D: 'double'};

/**
 * @param {string} name as the JVM writes it: java/lang/String, [B, [Ljava/lang/Object;
 * @returns {string} java.lang.String, byte[], java.lang.Object[]
 */
export function javaName(name) {
  let dims = 0;
  while (dims < name.length && name[dims] === '[')
    dims++;
  let element = name.substring(dims).replace(/\//g, '.');
  if (dims > 0) {
    if (element.length === 1 && element in PRIMITIVES)
      element = PRIMITIVES[/** @type {'Z'} */ (element)];
    else if (element.startsWith('L') && element.endsWith(';'))
      element = element.substring(1, element.length - 1);
  }
  return element + '[]'.repeat(dims);
}

/** Builds the Profile of a kind of samples, a chunk at a time. */
class Builder {
  /** @param {'ms' | 'bytes'} unit */
  constructor(unit) {
    this.unit = unit;
    /** @type {string[]} */
    this.strings = [''];
    /** @type {Map<string, number>} */
    this.stringIndex = new Map();
    /** @type {number[]} */
    this.parent = [];
    /** @type {number[]} */
    this.frame = [];
    /** @type {Map<string, number>} */
    this.nodes = new Map();
    /** @type {{time: number, stack: number, thread: number, kind: number, weight: number}[]} */
    this.samples = [];
    /** @type {Map<string, number>} */
    this.threadIndex = new Map();
    /** @type {{name: string, id: number}[]} */
    this.threads = [];
    /** the times of the Java and of the native samples, in ms @type {number[][]} */
    this.times = [[], []];
    /** @type {RawOperation[]} the operations, their thread as indexed here */
    this.operations = [];
    /** @type {{id: number, thread: number, start: number, end: number}[]} */
    this.segments = [];
  }

  /** @param {string} s */
  name(s) {
    let i = this.stringIndex.get(s);
    if (i === undefined) {
      i = this.strings.push(s) - 1;
      this.stringIndex.set(s, i);
    }
    return i;
  }

  /** @param {number} parent @param {number} frame */
  node(parent, frame) {
    const key = `${parent}:${frame}`;
    let n = this.nodes.get(key);
    if (n === undefined) {
      n = this.parent.push(parent) - 1;
      this.frame.push(frame);
      this.nodes.set(key, n);
    }
    return n;
  }

  /** @param {Chunk} c */
  chunk(c) {
    /** @param {string} name */
    const pool = name => c.pools.get(name) ?? new Map();
    const symbols = pool('jdk.types.Symbol'), classes = pool('java.lang.Class'),
          methods = pool('jdk.types.Method'), stacks = pool('jdk.types.StackTrace'),
          threads = pool('java.lang.Thread'), frameTypes = pool('jdk.types.FrameType');
    const text = texter(c.pools);
    /** @param {number} key */
    const symbol = key => text(symbols.get(key)?.string) ?? '';
    /** @param {number} key */
    const className = key => javaName(symbol(classes.get(key)?.name));

    /** @type {Map<number, number>} the name of each method, by key */
    const methodNames = new Map();
    /** @type {Map<number, number>} the node of the top of each stack trace, by key */
    const stackNodes = new Map();
    const truncated = this.name('(truncated)') << 3 | SYNTHETIC;

    /** @param {number} key */
    const stack = key => {
      let node = stackNodes.get(key);
      if (node !== undefined)
        return node;
      node = -1;
      const st = stacks.get(key);
      if (st) {
        if (st.truncated)
          node = this.node(node, truncated);
        // JFR lists the frames from the top of the stack
        for (let i = st.frames.length - 1; i >= 0; i--) {
          const f = st.frames[i];
          let name = methodNames.get(f.method);
          if (name === undefined) {
            const m = methods.get(f.method);
            name = this.name(m ? `${className(m.type)}.${symbol(m.name)}` : '(unknown method)');
            methodNames.set(f.method, name);
          }
          node = this.node(node, name << 3 | typeOf(text(frameTypes.get(f.type)?.description) ?? ''));
        }
      }
      stackNodes.set(key, node);
      return node;
    };

    /** @type {Map<number, number>} */
    const threadOf = new Map();
    /** @param {number} key */
    const thread = key => {
      let i = threadOf.get(key);
      if (i === undefined) {
        const t = threads.get(key);
        const id = t ? Number(t.javaThreadId || t.osThreadId) : 0;
        const name = t ? text(t.javaName) ?? text(t.osName) ?? '' : '';
        // a thread is known by its id, which the chunks agree on, not by its key
        const known = `${id}:${name}`;
        i = this.threadIndex.get(known);
        if (i === undefined) {
          i = this.threads.push({name, id}) - 1;
          this.threadIndex.set(known, i);
        }
        threadOf.set(key, i);
      }
      return i;
    };

    for (const o of c.operations)
      this.operations.push({...o, thread: thread(o.thread)});
    for (const s of c.segments)
      this.segments.push({...s, thread: thread(s.thread)});

    for (const s of c.samples) {
      const allocation = s.name === ALLOCATION;
      if (allocation !== (this.unit === 'bytes'))
        continue;
      let node = stack(s.stack);
      if (allocation)
        node = this.node(node, this.name(classes.has(s.cls) ? className(s.cls) : '(unknown class)') << 3 | ALLOCATED);
      else
        this.times[s.name === EXECUTION ? 0 : 1].push(s.time);
      this.samples.push({
        time: s.time, stack: node, thread: thread(s.thread),
        kind: s.name === NATIVE_SAMPLE ? 1 : 0, weight: s.weight,
      });
    }
  }

  /**
   * @param {string} start ISO-8601
   * @param {number} end ns since the start
   * @param {number[]} weights ms of a Java and of a native sample
   * @returns {Profile | null} null when there is no sample
   */
  profile(start, end, weights) {
    if (this.samples.length === 0)
      return null;
    const s = this.samples.sort((a, b) => a.time - b.time);
    const ops = this.operations;
    const find = this.finder();
    const operation = Int32Array.from(s, x => find(x.thread, x.time));
    // the names are strings of this profile
    const name = Int32Array.from(ops, o => this.name(o.name));
    const detail = Int32Array.from(ops, o => o.detail === null ? -1 : this.name(o.detail));
    const error = Int32Array.from(ops, o => o.error === null ? -1 : this.name(o.error));
    const thread = Int32Array.from(ops, o => this.name(this.threads[o.thread]?.name ?? ''));
    return {
      strings: this.strings,
      parent: Int32Array.from(this.parent),
      frame: Int32Array.from(this.frame),
      time: Float64Array.from(s, x => x.time),
      stack: Int32Array.from(s, x => x.stack),
      thread: Int32Array.from(s, x => x.thread),
      operation,
      kind: Uint8Array.from(s, x => x.kind),
      weights,
      unit: this.unit,
      weight: this.unit === 'bytes' ? Float64Array.from(s, x => x.weight) : null,
      start,
      end,
      threads: this.threads,
      operations: {
        count: ops.length,
        name, thread, detail, error,
        // in ns since the start of the recording, as the server counts them
        start: Float64Array.from(ops, o => o.start * 1e6),
        duration: Float64Array.from(ops, o => o.duration * 1e6),
        status: Int32Array.from(ops, o => o.status),
        failed: Uint8Array.from(ops, o => o.failed ? 1 : 0),
        async: Uint8Array.from(ops, o => o.async ? 1 : 0),
        bytesIn: Float64Array.from(ops, o => o.bytesIn),
        bytesOut: Float64Array.from(ops, o => o.bytesOut),
      },
    };
  }

  /**
   * Finds the operation a thread worked for at a time, as jfr-web's OperationIndex does: a thread works
   * for one at a time, the whole of a synchronous one or a segment of an asynchronous one; when they
   * nest, for the innermost.
   *
   * @returns {(thread: number, time: number) => number} the index of the operation, -1 for none
   */
  finder() {
    /** @type {Map<number, number>} the operation of each asynchronous one, by its id */
    const byId = new Map();
    this.operations.forEach((o, i) => o.async && o.id >= 0 && byId.set(o.id, i));
    /** @type {{thread: number, start: number, end: number, op: number, outer: number}[]} */
    const all = [];
    this.operations.forEach((o, i) => {
      if (!o.async)
        all.push({thread: o.thread, start: o.start, end: o.start + o.duration, op: i, outer: -1});
    });
    for (const g of this.segments) {
      const op = byId.get(g.id);
      if (op !== undefined)
        all.push({thread: g.thread, start: g.start, end: g.end, op, outer: -1});
    }
    /** @type {Map<number, typeof all>} the segments of each thread, by start */
    const byThread = new Map();
    for (const g of all.sort((a, b) => a.start - b.start)) {
      const list = byThread.get(g.thread);
      if (list)
        list.push(g);
      else
        byThread.set(g.thread, [g]);
    }
    for (const list of byThread.values()) {
      /** @type {number[]} */
      const open = [];
      list.forEach((g, i) => {
        while (open.length > 0 && list[open[open.length - 1]].end < g.start)
          open.pop();
        g.outer = open.length > 0 ? open[open.length - 1] : -1;
        open.push(i);
      });
    }
    return (thread, time) => {
      const list = byThread.get(thread);
      if (!list)
        return -1;
      // the latest started
      let lo = 0, hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (list[mid].start <= time)
          lo = mid + 1;
        else
          hi = mid;
      }
      let g = lo - 1;
      // or, once it is over, the one it started in
      while (g >= 0 && time > list[g].end)
        g = list[g].outer;
      return g < 0 ? -1 : list[g].op;
    };
  }
}

/**
 * @param {string} description of a frame type, as JFR writes it
 * @returns {number} COMPILED...
 */
function typeOf(description) {
  switch (description) {
    case 'Inlined': return INLINED;
    case 'Interpreted': return INTERPRETED;
    case 'Native': return NATIVE;
    default: return COMPILED;
  }
}
