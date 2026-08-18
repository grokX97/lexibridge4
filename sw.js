const C='lexibridge4-v3';
const A=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon.svg','./vocab/meta.js',...Array.from({length:10},(_,i)=>`./vocab/part-${String(i).padStart(2,'0')}.js`)];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const cp=resp.clone();caches.open(C).then(c=>c.put(e.request,cp));return resp;}).catch(()=>caches.match('./index.html'))));});
