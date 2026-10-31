// Serves web/ on http://localhost:8091, with no dependency: browsers refuse
// modules loaded from file://. Usage: node serve.js [port] [host]; the host is localhost, or 0.0.0.0
// to reach the page from a phone on the same network.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize, sep} from 'node:path';
import {networkInterfaces} from 'node:os';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('web/', import.meta.url));
const port = Number(process.argv[2] || 8091);
const host = process.argv[3] || 'localhost';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  }
  catch (e) {
    // a stray % in the address, which would otherwise throw out of the handler and stop the server
    res.writeHead(400).end('Bad request');
    return;
  }
  const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(body);
  }
  catch (e) {
    res.writeHead(404).end('Not found');
  }
}).listen(port, host, () => {
  if (host !== '0.0.0.0')
    return console.log(`MountainGraph on http://${host}:${port}/`);
  // every interface: the addresses a phone on the same network can use
  console.log(`MountainGraph on http://localhost:${port}/`);
  for (const [name, list] of Object.entries(networkInterfaces()))
    for (const a of list || [])
      if (a.family === 'IPv4' && !a.internal)
        console.log(`  from a phone: http://${a.address}:${port}/  (${name})`);
});
