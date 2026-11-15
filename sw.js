/* LocalSync v7 – offline shell only. Never cache peer signaling or user data. */
'use strict';
const CACHE_NAME = 'localsync-shell-v7';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/qr.js', './js/storage.js', './js/files.js', './js/peer.js', './js/app.js',
  './assets/icon-180.png', './assets/icon-192.png',
  './assets/icon-512.png', './assets/icon-maskable-512.png'
];
const SCOPE = self.registration.scope;
const STATIC_PATHS = new Set(SHELL.map(path => new URL(path, SCOPE).pathname));
const OFFLINE_PAGE = new URL('./index.html', SCOPE).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith('localsync-shell-') && name !== CACHE_NAME).map(name => caches.delete(name))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !STATIC_PATHS.has(url.pathname)) return;
  // Navigation is network-first; never cache room identifiers/query parameters.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => {
      const offline = await caches.match(OFFLINE_PAGE);
      return offline || Response.error();
    }));
    return;
  }
  // Explicit static allowlist; /events and /signal are always network-only.
  event.respondWith(fetch(req).then(async response => {
    if (response.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(new URL(url.pathname, self.location.origin).href, response.clone());
      } catch (_) { /* A full/disabled Cache Storage must not break online operation. */ }
    }
    return response;
  }).catch(async () => (await caches.match(new URL(url.pathname, self.location.origin).href)) || Response.error()));
});
