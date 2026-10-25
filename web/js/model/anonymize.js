// @ts-check
/**
 * Anonymizing a profile as it is imported, to share a screenshot or a recording's look without the names of
 * the code: the packages of qualified names (com.acme.billing.Invoice.total) are replaced, each by the same
 * alias wherever it stands (com.bart.lisa.Invoice.total), and the strings the user lists are replaced too.
 * Classes and methods keep their names: list them to replace them.
 *
 * No DOM: tested with Node.
 */

/** The aliases, in the order they are given; then a, b, c… z, aa, ab… */
const NAMES = ['bart', 'lisa', 'homer', 'marge', 'maggie', 'ned', 'moe', 'apu', 'barney', 'milhouse', 'nelson',
               'ralph', 'krusty', 'skinner', 'lenny', 'carl', 'otto', 'edna', 'patty', 'selma', 'troy', 'lionel',
               'comic', 'wiggum', 'burns', 'smithers', 'flanders', 'rod', 'todd', 'jimbo', 'dolph', 'kearney',
               'martin', 'sherri', 'terri', 'willie', 'itchy', 'scratchy', 'duffman', 'snake'];

/** The packages left as they are unless the user says otherwise: the JDK's. */
export const KEPT = ['java', 'javax', 'jdk', 'sun', 'com.sun'];

/** First parts of package names that are a domain, not a package: they keep their name. */
const DOMAINS = new Set(['com', 'org', 'net', 'io', 'edu', 'gov', 'dev', 'app', 'co', 'me', 'eu',
                         'fr', 'de', 'uk', 'ch', 'it', 'nl', 'be', 'es', 'us', 'jp', 'cn', 'ru']);

/**
 * @typedef {object} Rules
 * @property {boolean} enabled whether anything is replaced: the rules below are kept, but ignored, when not
 * @property {boolean} packages whether the packages get aliases
 * @property {number} depth how many package segments get aliases, after the domain: 2 for com.x.y, the
 *           sub-packages under keep their names
 * @property {string[]} keep packages that keep their name, with those under them (org.apache)
 * @property {{from: string, to: string}[]} replace strings to replace by others, wherever they are
 */

/** A qualified name as a frame or a class has: nothing else gets aliases (not "GET /api/v1.2", not a thread's name). */
const QUALIFIED = /^[A-Za-z_$][\w$]*(?:\.[\w$<>]+)+(?:\[\])*$/;

/**
 * @param {number} n from 0
 * @returns {string} the n-th alias
 */
export function alias(n) {
  if (n < NAMES.length)
    return NAMES[n];
  let i = n - NAMES.length, s = '';
  do {
    s = String.fromCharCode(97 + i % 26) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

/**
 * @param {Rules} rules
 * @returns {boolean} whether they change anything
 */
export function active(rules) {
  return rules.enabled && (rules.packages || rules.replace.some(r => r.from !== ''));
}

/**
 * @param {Rules} rules
 * @returns {(profile: Profile) => Profile} the profiles given, anonymized: the aliases are the same from one to
 *          the next, so that the samplings of a recording agree. The profile itself when there is nothing to do.
 */
export function anonymizer(rules) {
  if (!active(rules))
    return p => p;
  const keep = new Set(rules.keep);
  const literals = rules.replace.filter(r => r.from !== '').sort((a, b) => b.from.length - a.from.length);
  const found = literals.length > 0 ? new RegExp(literals.map(r => escape(r.from)).join('|'), 'g') : null;
  /** @type {Map<string, string>} */
  const to = new Map(literals.map(r => [r.from, r.to]));
  /** @type {Map<string, string>} the alias of each package segment */
  const aliases = new Map();
  /** @type {Set<string>} the segments the profiles have: an alias is none of them, or two packages would merge */
  const taken = new Set(DOMAINS);
  let next = 0;

  /** @param {string} segment */
  const aliasOf = segment => {
    let a = aliases.get(segment);
    if (a === undefined) {
      do
        a = alias(next++);
      while (taken.has(a));
      aliases.set(segment, a);
    }
    return a;
  };

  /**
   * @param {string} s
   * @returns {{start: number, end: number, text: string}[]} what to put in place of parts of s, by position
   */
  const edits = s => {
    /** @type {{start: number, end: number, text: string}[]} */
    const list = [];
    if (found)
      for (const m of s.matchAll(found))
        list.push({start: m.index, end: m.index + m[0].length, text: /** @type {string} */ (to.get(m[0]))});
    if (rules.packages && QUALIFIED.test(s)) {
      const parts = s.split('.');
      let at = 0, kept = false, position = 0;
      for (let i = 0; i < parts.length - 1 && /^[a-z_]/.test(parts[i]); i++) {
        const start = at, end = at + parts[i].length;
        at = end + 1;
        kept ||= keep.has(parts.slice(0, i + 1).join('.'));
        // the domain, a package kept, one too deep, a string the user replaces: as written
        if (i === 0 && DOMAINS.has(parts[0]))
          continue;
        if (!kept && position < rules.depth && !list.some(e => e.start < end && start < e.end))
          list.push({start, end, text: aliasOf(parts[i])});
        position++;
      }
    }
    return list.sort((a, b) => a.start - b.start);
  };

  /**
   * @param {string} s
   * @returns {string}
   */
  const rename = s => {
    let out = '', at = 0;
    for (const e of edits(s)) {
      out += s.substring(at, e.start) + e.text;
      at = e.end;
    }
    return out + s.substring(at);
  };

  return p => {
    if (rules.packages)
      for (const s of p.strings)
        if (QUALIFIED.test(s))
          for (const part of s.split('.'))
            taken.add(part);
    return {...p, strings: p.strings.map(rename), threads: p.threads.map(t => ({...t, name: rename(t.name)}))};
  };
}

/**
 * @param {string} s
 * @returns {string} s to match literally in a regular expression
 */
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @typedef {import('../profile/profile.js').Profile} Profile */
