const VERSION = (() => {
    try { return new URL(self.location.href).searchParams.get('v') || 'dev' }
    catch { return 'dev' }
})()
const CACHE = `polymorphic-${VERSION}`
const PRECACHE = [
    '/',
    '/index.html',
    '/css/menu.css',
    '/css/touch.css',
    '/data/examples.json',
    '/img/polymorphic.png',
    '/manifest.webmanifest'
]
const NETWORK_ONLY = new Set([
    '/deployment-meta.json',
    '/data/examples.json'
])

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
    if (url.origin !== location.origin) return

    // Always-fresh paths: do not intercept at all
    if (NETWORK_ONLY.has(url.pathname)) return

    // Respect the request's cache directive
    if (e.request.cache === 'no-store' || e.request.cache === 'no-cache' || e.request.cache === 'reload') {
        return
    }

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
