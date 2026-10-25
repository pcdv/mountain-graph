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
  const rules = {enabled: false, packages: false, depth: 2, keep: KEPT, replace: []};
  try {
    const kept = JSON.parse(readSetting(KEY) ?? '{}');
    rules.enabled = kept.enabled === true;
    rules.packages = kept.packages === true;
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

  const enabled = h('input', {type: 'checkbox', checked: rules.enabled, onchange: () => {
    rules.enabled = enabled.checked;
    body.classList.toggle('off', !rules.enabled);
    for (const el of body.querySelectorAll('input, textarea'))
      /** @type {HTMLInputElement} */ (el).disabled = !rules.enabled;
    save();
  }});
  const packages = h('input', {type: 'checkbox', checked: rules.packages, onchange: () => {
    rules.packages = packages.checked;
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
  const replace = h('textarea', {rows: 4, spellcheck: false, placeholder: 'secret-project => project',
                                 title: 'One per line: the text, =>, what replaces it, wherever it is found in a name',
                                 onchange: () => {
    rules.replace = replace.value.split('\n').flatMap(line => {
      const [from, ...to] = line.split('=>');
      return from.trim() === '' ? [] : [{from: from.trim(), to: to.join('=>').trim()}];
    });
    save();
  }}, rules.replace.map(r => `${r.from} => ${r.to}`).join('\n'));

  const body = h('div', {class: 'anonymizing-body'},
    h('label', {class: 'inline', title: 'com.acme.billing.Invoice becomes com.bart.lisa.Invoice, each package everywhere the same'},
      packages, ' Replace the packages by aliases'),
    h('label', {class: 'inline', title: 'Segments after the domain that get aliases: 2 is com.x.y, what is under keeps its name'},
      'Depth ', depth),
    h('label', null, 'Packages kept', keep),
    h('label', null, 'Replace', replace));
  for (const el of body.querySelectorAll('input, textarea'))
    /** @type {HTMLInputElement} */ (el).disabled = !rules.enabled;
  body.classList.toggle('off', !rules.enabled);

  return h('div', {class: 'anonymizing'},
    helpTip(h('label', {class: 'inline'}, enabled, ' Replace names as the file is read'), 'anonymizing',
            'Packages and texts replaced in the names, to share a picture without what they say; Apply reads the file again'),
    body,
    h('button', {type: 'button', class: 'button', onclick: apply, title: 'Reads the file again with these settings'}, 'Apply'));
}
