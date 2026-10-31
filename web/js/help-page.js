// @ts-check
/**
 * The help page's contents: the link of the section being read is marked as the page scrolls, so that one
 * knows where one is in a long page, in the dialog or on its own.
 */

/** How far from the top a section starts to be the one read, px. */
const FROM_TOP = 96;

const links = /** @type {HTMLAnchorElement[]} */ ([...document.querySelectorAll('.contents a[href^="#"]')]);
const sections = links.map(a => document.getElementById(a.getAttribute('href')?.slice(1) ?? ''));

let waiting = false;

function mark() {
  waiting = false;
  const page = document.documentElement;
  const bottom = page.scrollTop + page.clientHeight >= page.scrollHeight - 2;
  // the last section that has started, the first before any has; the last at the foot of the page, which a
  // short one never reaches the top from
  let read = bottom ? sections.length - 1 : 0;
  if (!bottom)
    sections.forEach((s, i) => {
      if (s && s.getBoundingClientRect().top <= FROM_TOP)
        read = i;
    });
  links.forEach((a, i) => i === read ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current'));
}

addEventListener('scroll', () => {
  if (!waiting) {
    waiting = true;
    requestAnimationFrame(mark);
  }
}, {passive: true});
mark();
