const CACHE='atelier-air-hockey-v24';
const CORE=['./','./index.html','./manifest.webmanifest','./assets/icon.svg','./src/styles.css','./src/themes.js','./src/scoreboards.js','./src/net.js','./src/game.js','./src/ui.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
    return res;
  }).catch(async()=>{
    const hit=await caches.match(e.request); if(hit)return hit;
    if(e.request.mode==='navigate')return caches.match('./index.html');
    return Response.error();
  }));
});
