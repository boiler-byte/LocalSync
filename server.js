/*
 * LocalSync v9 – optional local static HTTP server. Node.js 18+.
 * WebRTC signaling is handled by the default public PeerJS Cloud server.
 * This server does not relay signaling or user content.
 * GitHub Pages works without this file.
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8'
};
const allowed = /^\/(?:index\.html|manifest\.webmanifest|sw\.js|css\/style\.css|js\/(?:app|storage|files|peer|qr)\.js|assets\/icon-(?:180|192|512|maskable-512)\.png)$/;
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed'); return;
  }
  let requestPath;
  try { requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (_) { res.writeHead(400); res.end(); return; }
  if (requestPath === '/') requestPath = '/index.html';
  if (!allowed.test(requestPath)) { res.writeHead(404); res.end('Not found'); return; }
  const filepath = path.resolve(ROOT, '.' + requestPath);
  fs.readFile(filepath, (error, body) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'content-type': mime[path.extname(filepath)] || 'application/octet-stream',
      'cache-control': requestPath === '/sw.js' ? 'no-cache' : 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
});
server.listen(PORT, HOST, () => {
  console.log(`LocalSync static server: http://localhost:${PORT}`);
  console.log('PeerJS Cloud vermittelt die Verbindung. Kein eigener Signaling-Server erforderlich.');
});
