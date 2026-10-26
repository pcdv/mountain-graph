// @ts-check
/**
 * Gzip in the page, with the browser's own streams.
 *
 * @param {string} text
 * @returns {Promise<Uint8Array<ArrayBuffer>>} its gzip, level up to the browser
 */
export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
