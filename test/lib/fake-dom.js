// @ts-check
/**
 * Just enough of the DOM for the panels to be built and clicked in Node: no
 * layout, no styles, only the elements, their attributes, their children and
 * their listeners. A wiring mistake in a panel — a tab that is not clickable,
 * a name with no listener — then fails in a test rather than in a browser.
 */

/** @param {string} tag */
class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    /** @type {Record<string, Function[]>} */
    this.listeners = {};
    this.hidden = false;
    this.textContent = '';
    this.style = {};
    this.classList = {
      /** @param {string} c */
      add: c => this.#setClass(c, true),
      /** @param {string} c */
      remove: c => this.#setClass(c, false),
      /** @param {string} c */
      contains: c => (this.attributes.class ?? '').split(' ').includes(c),
      /** @param {string} c @param {boolean} [on] */
      toggle: (c, on) => this.#setClass(c, on ?? !this.classList.contains(c)),
    };
  }

  /** @param {string} c @param {boolean} on */
  #setClass(c, on) {
    const set = new Set((this.attributes.class ?? '').split(' ').filter(Boolean));
    if (on)
      set.add(c);
    else
      set.delete(c);
    this.attributes.class = [...set].join(' ');
  }

  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  /** @param {string} name */
  getAttribute(name) {
    return this.attributes[name];
  }

  /** @param {Node} child */
  appendChild(child) {
    this.children.push(child);
    return child;
  }

  /** @param {...Node} children */
  append(...children) {
    for (const c of children)
      this.appendChild(c);
  }

  /** @param {...Node} children */
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  /** @param {string} type @param {Function} fn */
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  /** @param {string} type @param {Function} fn */
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn);
  }

  /** Clicks it, as a browser would: the listeners, and the event that stops there. */
  click() {
    const event = {stopPropagation: () => {}, preventDefault: () => {}, relatedTarget: null};
    for (const fn of this.listeners.click ?? [])
      fn(event);
  }

  getBoundingClientRect() {
    return {width: 400, height: 300, right: 400, bottom: 300, left: 0, top: 0};
  }

  setPointerCapture() {}

  /** @returns {number} */
  get clientWidth() {
    return 800;
  }

  /** @returns {number} */
  get clientHeight() {
    return 600;
  }

  /** @returns {number} */
  get childElementCount() {
    return this.children.length;
  }

  /** @returns {Node | null} */
  get firstChild() {
    return this.children[0] ?? null;
  }

  /** @returns {FakeNode[]} every element under this one, this one included */
  all() {
    /** @type {FakeNode[]} */
    const out = [this];
    for (const c of this.children) {
      if (c instanceof FakeNode)
        out.push(...c.all());
    }
    return out;
  }

  /** @returns {string} the text of this element and everything under it */
  get text() {
    return (this.textContent ?? '') + this.children.map(c => c instanceof FakeNode ? c.text : String(c)).join('');
  }
}

/** @param {string} text */
class FakeText {
  constructor(text) {
    this.data = text;
  }

  /** @returns {string} */
  toString() {
    return this.data;
  }
}

/** @param {string} text */
function textNode(text) {
  return new FakeText(text);
}

/**
 * Installs the fake DOM as globals, and gives back a way to undo it.
 *
 * @returns {() => void}
 */
export function installFakeDom() {
  const saved = {
    document: globalThis.document,
    Node: globalThis.Node,
  };
  // @ts-ignore the fake is close enough for the panels
  globalThis.Node = FakeNode;
  // @ts-ignore
  globalThis.document = {
    createElement: (/** @type {string} */ tag) => new FakeNode(tag),
    createTextNode: textNode,
    getElementById: () => null,
    body: new FakeNode('body'),
    addEventListener: () => {},
  };
  return () => {
    // @ts-ignore
    globalThis.document = saved.document;
    // @ts-ignore
    globalThis.Node = saved.Node;
  };
}

/**
 * The elements of a tree whose text is exactly this, the first found.
 *
 * @param {any} root
 * @param {string} text
 * @returns {any}
 */
export function byText(root, text) {
  return root.all().find((/** @type {any} */ e) => e.text.trim() === text);
}
