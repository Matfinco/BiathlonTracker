'use strict';
const CACHE='biathlon-field-v6-6';
const ASSETS=['./','index.html','styles/app.css','src/domain.js','src/storage.js','src/sync.js','src/updates.js','src/app.js','manifest.webmanifest','icons/target.svg','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))));
});
// The page requests activation at startup or after the user accepts a later update.
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE')self.skipWaiting();
  if(event.data?.type==='CLAIM')self.clients.claim();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('biathlon-field-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Cloud requests are never cached or replayed by the service worker.
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    if(event.request.mode==='navigate')return await cache.match(new URL('index.html',self.registration.scope).href)||fetch(event.request);
    return await cache.match(event.request)||fetch(event.request);
  }));
});
