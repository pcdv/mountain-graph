// @ts-check
/**
 * The service worker of the page installed as an app: what the page loads is kept, so that it opens with no
 * network. The page's own files are fetched first, so that a new version is seen as soon as it is published,
 * and taken from what was kept only when the network fails; three.js, pinned, is taken from what was kept
 * first. The page sends what it loaded before the worker was there (main.js), to be kept too.
 */

/** @type {any} the worker's global scope: the DOM's types, which this project is checked against, lack it */
const worker = self;

const CACHE = 'mountaingraph';

/** Where three.js comes from, at a pinned version (index.html): what is kept there never changes. */
const CDN = 'https://cdn.jsdelivr.net/npm/three@';

/**
 * @param {string} url
 * @returns {boolean} whether it is kept: the page's own files, and three.js
 */
const kept = url => url.startsWith(worker.location.origin + '/') || url.startsWith(CDN);

worker.addEventListener('install', () => worker.skipWaiting());
worker.addEventListener('activate', (/** @type {any} */ e) => e.waitUntil(worker.clients.claim()));

worker.addEventListener('message', (/** @type {any} */ e) => {
  /** @type {string[]} */
  const urls = Array.isArray(e.data?.keep) ? e.data.keep.filter((/** @type {any} */ u) => typeof u === 'string' && kept(u)) : [];
  e.waitUntil(caches.open(CACHE).then(cache => Promise.all(urls.map(async url => {
    if (!await cache.match(url))
      await cache.add(url).catch(() => {});
  }))));
});

worker.addEventListener('fetch', (/** @type {any} */ e) => {
  /** @type {Request} */
  const request = e.request;
  if (request.method !== 'GET' || !kept(request.url))
    return;
  e.respondWith(request.url.startsWith(CDN) ? keptFirst(request, e) : networkFirst(request, e));
});

/**
 * @param {Request} request
 * @param {any} e the fetch event, which lives until the response is kept
 * @returns {Promise<Response>}
 */
async function networkFirst(request, e) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok)
      e.waitUntil(cache.put(request, response.clone()));
    return response;
  }
  catch (error) {
    // the page asked for with a query is the page
    const hit = await cache.match(request, {ignoreSearch: request.mode === 'navigate'});
    if (hit)
      return hit;
    throw error;
  }
}

/**
 * @param {Request} request
 * @param {any} e
 * @returns {Promise<Response>}
 */
async function keptFirst(request, e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit)
    return hit;
  const response = await fetch(request);
  if (response.ok)
    e.waitUntil(cache.put(request, response.clone()));
  return response;
}
