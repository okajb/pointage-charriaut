const CACHE='pointage39h-charriaut-entreprise-v15-login-20261022';
const LOCAL_FILES=['./','./index.html','./styles.css?v=14','./app.js?v=14','./pompes-v15.css?v=15-release-20261020','./pompes-v15.js?v=15-login-20261022','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-180.png','./assets/logo-charriaut.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(LOCAL_FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;if(url.pathname.endsWith('/')||url.pathname.endsWith('/index.html')){
    event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});
