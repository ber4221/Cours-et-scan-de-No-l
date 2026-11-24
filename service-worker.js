const CACHE = 'cherche-trouve-cours-v4';
const LOCAL = ['./','./index.html','./app.js','./style.css','./manifest.webmanifest','./pere-noel.png','./qr-appareil.svg','./icons/icon-192.png','./icons/icon-512.png'];
const SCANNER_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(SCANNER_LIB, {mode: 'no-cors', signal: controller.signal});
      clearTimeout(timer);
      if (response) await cache.put(SCANNER_LIB, response);
    } catch (_) { /* Le jeu reste accessible, le scanner requiert le réseau à la première ouverture. */ }
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('cherche-trouve-cours-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && url.href !== SCANNER_LIB) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') {
        const cache = await caches.open(CACHE);
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    } catch (_) {
      if (event.request.mode === 'navigate') return await caches.match('./index.html');
      throw _;
    }
  })());
});
