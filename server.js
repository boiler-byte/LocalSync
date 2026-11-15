/*
 * LocalSync HTTP/SSE signaling server (Node >= 18, no dependencies).
 * Data is transferred peer-to-peer with WebRTC, NOT through this server.
 * Local demo only: no authentication, rate limiting, production TURN or HTTPS.
 */
'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const rooms = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8' };
function sendJson(res, code, body) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function validRoom(room) { return typeof room === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(room); }
function validClient(client) { return typeof client === 'string' && /^[a-f0-9]{24}$/.test(client); }
function publish(target, data) { if (target && !target.writableEnded && !target.destroyed) target.write('data: ' + JSON.stringify(data) + '\n\n'); }
function notify(room) {
  const clients = rooms.get(room);
  if (!clients) return;
  for (const res of clients.values()) publish(res, { kind: 'presence', clients: Array.from(clients.keys()) });
}
function onEvents(req, res, url) {
  const room = url.searchParams.get('room'), client = url.searchParams.get('client');
  if (!validRoom(room) || !validClient(client)) return sendJson(res, 400, { error: 'Invalid room/client.' });
  const clients = rooms.get(room) || new Map();
  if (clients.size >= 2 && !clients.has(client)) return sendJson(res, 409, { error: 'Room full.' });
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(': ready\n\n');
  if (clients.has(client)) { const old = clients.get(client); old.end(); }
  clients.set(client, res); rooms.set(room, clients); notify(room);
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': heartbeat\n\n'); }, 18000);
  res.on('close', () => {
    clearInterval(ping);
    if (clients.get(client) !== res) return;
    clients.delete(client);
    if (!clients.size) rooms.delete(room);
    else notify(room);
  });
}
function onSignal(req, res) {
  let body = '', size = 0, denied = false;
  req.on('data', chunk => { size += chunk.length; if (size > 128000) { denied = true; req.destroy(); return; } body += chunk; });
  req.on('end', () => {
    if (denied) return;
    let data;
    try { data = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'Invalid JSON.' }); }
    if (!validRoom(data.room) || !validClient(data.from) || !validClient(data.to)) return sendJson(res, 400, { error: 'Invalid identifiers.' });
    const clients = rooms.get(data.room);
    if (!clients || !clients.has(data.from) || !clients.has(data.to) || !data.payload || !['offer', 'answer', 'ice'].includes(data.payload.kind)) return sendJson(res, 403, { error: 'Not authorized in this room.' });
    publish(clients.get(data.to), { kind: 'signal', from: data.from, payload: data.payload });
    sendJson(res, 200, { ok: true });
  });
}
function onStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error: 'Invalid pathname.' }); }
  if (pathname === '/') pathname = '/index.html';
  const allowed = /^\/(index\.html|manifest\.webmanifest|sw\.js|css\/style\.css|js\/(app|storage|files|peer|qr)\.js|assets\/icon-(180|192|512|maskable-512)\.png)$/;
  if (!allowed.test(pathname)) return sendJson(res, 404, { error: 'Not found.' });
  const file = path.join(ROOT, pathname);
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': pathname === '/sw.js' ? 'no-cache' : 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    res.end(data);
  });
}
const handler = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/events') return onEvents(req, res, url);
  if (req.method === 'POST' && url.pathname === '/signal') return onSignal(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return onStatic(req, res, url);
  sendJson(res, 405, { error: 'Method not allowed.' });
};
const tls = process.env.TLS_CERT && process.env.TLS_KEY;
const server = tls ? https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, handler) : http.createServer(handler);
server.listen(PORT, HOST, () => {
  console.log('LocalSync signaling server: ' + (tls ? 'https' : 'http') + '://localhost:' + PORT);
  console.log('Andere Geräte: lokale IP statt localhost verwenden; für Clipboard über LAN vertrauenswürdiges HTTPS erforderlich.');
});
