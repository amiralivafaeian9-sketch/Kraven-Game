const CACHE_NAME='kraven-game-v26-glass-clean-2026-09';
const APP_SHELL=[
 './index.html','./manifest.json','./app.css','./app.js','./kraven-ui-bundle.css','./kraven-enhancements-bundle.js','./kraven-arcade.js','./arcade.css','./kraven-header.webp','./assets/sfx/kraven-click.mp3'
];
self.addEventListener('install',event=>event.waitUntil(
 caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL).catch(()=>{})).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
 caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
function isContent(req){const u=new URL(req.url);return u.pathname.includes('/data/')||u.pathname.includes('/assets/content/');}
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET') return;
 const req=event.request;
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).then(r=>{if(r&&r.ok){caches.open(CACHE_NAME).then(c=>c.put('./index.html',r.clone()));}return r;}).catch(()=>caches.match('./index.html')));return;
 }
 if(isContent(req)){
  event.respondWith(fetch(req).then(r=>{if(r&&r.ok)caches.open(CACHE_NAME).then(c=>c.put(req,r.clone()));return r;}).catch(()=>caches.match(req)));
  return;
 }
 event.respondWith(caches.match(req).then(c=>c||fetch(req).then(r=>{if(r&&r.ok&&r.type==='basic')caches.open(CACHE_NAME).then(x=>x.put(req,r.clone()));return r;}).catch(()=>caches.match('./index.html'))));
});
