const CACHE = 'polymorphic-v1'
const PRECACHE = [
    '/',
    '/index.html',
    '/css/menu.css',
    '/css/touch.css',
    '/data/examples.json',
    '/img/polymorphic.png',
    '/manifest.webmanifest'
]

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url)
    // Don't intercept the engine bundle / sharing / blaster — they have their own freshness
    if (url.origin !== location.origin) return
    e.respondWith((async () => {
        const cache = await caches.open(CACHE)
        const cached = await cache.match(e.request)
        const network = fetch(e.request).then(resp => {
            if (resp.ok) cache.put(e.request, resp.clone())
            return resp
        }).catch(() => cached)
        return cached || network
    })())
})
