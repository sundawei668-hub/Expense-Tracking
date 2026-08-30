const CACHE_NAME = 'yi-ben-zhang-v5';
const BASE_URL = new URL('./', self.location.href);
const BASE_PATH = BASE_URL.pathname;
const STATIC_FILES = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'og.png']
  .map((file) => new URL(file, BASE_URL).pathname);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const pageResponse = await fetch(BASE_PATH);
    const html = await pageResponse.clone().text();
    await cache.put(BASE_PATH, pageResponse);

    const linkedAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => new URL(match[1], pageResponse.url))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => `${url.pathname}${url.search}`);

    await cache.addAll([...new Set([...STATIC_FILES, ...linkedAssets])]);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          event.waitUntil(cache.put(BASE_PATH, response.clone()));
        }
        return response;
      } catch {
        return (await cache.match(BASE_PATH)) ?? Response.error();
      }
    })());
    return;
  }

  const networkUpdate = (async () => {
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })();

  event.waitUntil(networkUpdate.then(() => undefined).catch(() => undefined));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    try {
      return await networkUpdate;
    } catch {
      return Response.error();
    }
  })());
});
