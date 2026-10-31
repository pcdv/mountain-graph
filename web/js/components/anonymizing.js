// @ts-check
/**
 * The anonymizing settings, in the Advanced pane: what a profile's names are replaced with as it is imported
 * (model/anonymize.js), remembered. A change takes effect when the file is read again: Apply.
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {KEPT} from '../model/anonymize.js';
import {helpTip} from './help.js';

const KEY = 'mountaingraph.anonymize';

/** @typedef {import('../model/anonymize.js').Rules} Rules */

/** @returns {Rules} as last set; nothing replaced at first */
export function anonymizing() {
  /** @type {Rules} */
  const rules = {packages: false, depth: 2, keep: KEPT, replacing: false, replace: []};
  try {
    const kept = JSON.parse(readSetting(KEY) ?? '{}');
    // settings kept when one switch held both transforms: it still says whether they were on
    const before = typeof kept.enabled === 'boolean';
    rules.packages = kept.packages === true && (!before || kept.enabled);
    rules.replacing = before ? kept.enabled : kept.replacing === true;
    if (Number.isInteger(kept.depth) && kept.depth >= 1 && kept.depth <= 10)
      rules.depth = kept.depth;
    if (Array.isArray(kept.keep))
      rules.keep = kept.keep.filter((/** @type {any} */ k) => typeof k === 'string');
    if (Array.isArray(kept.replace))
      rules.replace = kept.replace.filter((/** @type {any} */ r) => r && typeof r.from === 'string' && typeof r.to === 'string');
  }
  catch (e) {
    // nothing replaced
  }
  return rules;
}

/**
 * @param {string} text one per line, or separated by commas
 * @returns {string[]}
 */
function words(text) {
  return text.split(/[\s,]+/).filter(w => w !== '');
}

/**
 * @param {() => void} apply called when the user asks to read the file again with the settings
 * @returns {HTMLElement}
 */
export function anonymizeControls(apply) {
  const rules = anonymizing();
  const save = () => writeSetting(KEY, JSON.stringify(rules));

  // the settings of a transform are there, dimmed, while it is off: they are kept, and ignored
  /**
   * @param {HTMLElement} fields
   * @param {boolean} on
   */
  const dim = (fields, on) => {
    fields.classList.toggle('off', !on);
    for (const el of fields.querySelectorAll('input, textarea'))
      /** @type {HTMLInputElement} */ (el).disabled = !on;
  };
  const fit = () => {
    dim(aliasing, rules.packages);
    dim(replacements, rules.replacing);
  };
  const packages = h('input', {type: 'checkbox', checked: rules.packages, onchange: () => {
    rules.packages = packages.checked;
    fit();
    save();
  }});
  const replacing = h('input', {type: 'checkbox', checked: rules.replacing, onchange: () => {
    rules.replacing = replacing.checked;
    fit();
    save();
  }});
  const depth = h('input', {type: 'number', min: 1, max: 10, value: rules.depth, onchange: () => {
    rules.depth = Math.min(10, Math.max(1, Math.round(Number(depth.value)) || 2));
    depth.value = String(rules.depth);
    save();
  }});
  const keep = h('textarea', {rows: 2, spellcheck: false, title: 'Packages that keep their name, with those under them: java, org.apache',
                              onchange: () => {
    rules.keep = words(keep.value);
    save();
  }}, rules.keep.join(' '));
  const replace = h('textarea', {rows: 4, spellcheck: false, placeholder: 'secret-project => project', 'aria-label': 'Texts to replace',
                                 title: 'One per line: the text, =>, what replaces it, wherever it is found in a name, whatever its case (foo => bar makes Foo Bar)',
                                 onchange: () => {
    rules.replace = replace.value.split('\n').flatMap(line => {
      const [from, ...to] = line.split('=>');
      return from.trim() === '' ? [] : [{from: from.trim(), to: to.join('=>').trim()}];
    });
    save();
  }}, rules.replace.map(r => `${r.from} => ${r.to}`).join('\n'));

  const aliasing = h('div', {class: 'anon-fields'},
    h('label', {class: 'inline', title: 'Segments after the domain that get aliases: 2 is com.x.y, what is under keeps its name'},
      'Depth ', depth),
    h('label', null, 'Packages kept', keep));
  const replacements = h('div', {class: 'anon-fields'}, replace);
  fit();

  // two transforms, each on its own: the packages by aliases, and the texts by others
  return h('div', {class: 'anonymizing'},
    h('div', {class: 'anon-group'},
      helpTip(h('label', {class: 'inline', title: 'com.acme.billing.Invoice becomes com.bart.lisa.Invoice, each package everywhere the same'},
                packages, 'Replace packages by aliases'), 'anonymizing',
              'Packages and texts replaced in the names, to share a picture without what they say; Apply reads the file again'),
      aliasing),
    h('div', {class: 'anon-group'},
      h('label', {class: 'inline', title: 'Texts replaced wherever they are found in a name or a thread\'s name'},
        replacing, 'Replace texts'),
      replacements),
    h('button', {type: 'button', class: 'button', onclick: apply, title: 'Reads the file again with these settings'}, 'Apply'));
}
