// Cache static shell only: never cache authenticated responses or home evidence.
const cacheName='spatialguard-shell-v1';
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(['/','/icon.svg'])))});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==cacheName).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/v1')||url.pathname==='/health')return;
 if(url.pathname==='/'||url.pathname.startsWith('/assets/')||url.pathname==='/icon.svg')event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(cacheName).then(c=>c.put(event.request,copy))}return response}).catch(()=>caches.match(event.request)));});
