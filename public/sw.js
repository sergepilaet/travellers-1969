/* Travellers 1969 planner — offline helper (v257)
   - the app page itself: always fresh from the internet, saved copy when offline
   - scripts/styles/fonts (Firebase, Leaflet, MapLibre): saved copy first
   - map tiles you have looked at: saved copy first, max ~4000 tiles
   - data (trips, places) is saved by the page itself, not here */
var V='t69-v258', SHELL='t69-shell', LIB='t69-lib', TILES='t69-tiles', MAXT=4000;
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(SHELL).then(function(c){return c.addAll(['/','/manifest.json','/favicon.png']).catch(function(){});}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});
function isTile(u){return /tile\.openstreetmap\.org|arcgisonline\.com\/ArcGIS\/rest\/services\/.*\/tile\/|tiles\.openfreemap\.org/.test(u);}
function isLib(u){return /gstatic\.com\/firebasejs|unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u);}
function trim(){caches.open(TILES).then(function(c){c.keys().then(function(k){if(k.length>MAXT){for(var i=0;i<k.length-MAXT;i++)c.delete(k[i]);}});});}
var n=0;
self.addEventListener('fetch',function(e){
  var r=e.request;if(r.method!=='GET')return;
  var u=r.url, me=new URL(u).origin===self.location.origin;
  if(/googleapis\.com\/(v1|identitytoolkit)|cloudfunctions|firestore|securetoken|identitytoolkit/.test(u)&&!/fonts\.googleapis/.test(u))return; /* data: page handles it */
  var pth=new URL(u).pathname;
  if(me&&/^\/__\//.test(pth))return; /* Firebase sign-in pages */
  if(me&&(pth==='/'||pth==='/index.html')){
    e.respondWith(fetch(r).then(function(res){if(res.ok){var cp=res.clone();caches.open(SHELL).then(function(c){c.put('/',cp);});}return res;})
      .catch(function(){return caches.match('/',{cacheName:SHELL}).then(function(m){return m||Response.error();});}));return;}
  if(me&&/\/data\/|\.png$|\.svg$|\.json$/.test(u)&&!/\/sw\.js/.test(u)){
    e.respondWith(fetch(r).then(function(res){if(res.ok){var cp=res.clone();caches.open(SHELL).then(function(c){c.put(r,cp);});}return res;})
      .catch(function(){return caches.match(r).then(function(m){return m||Response.error();});}));return;}
  if(isLib(u)||isTile(u)){var C=isTile(u)?TILES:LIB;
    e.respondWith(caches.open(C).then(function(c){return c.match(r).then(function(m){
      if(m)return m;
      /* fetch as CORS so the saved copy is small (opaque copies take ~7 MB of storage each) */
      var go=fetch(u,{mode:'cors',credentials:'omit'}).catch(function(){return fetch(r);});
      return go.then(function(res){if(res.ok&&res.type!=='opaque'){c.put(r,res.clone());if(C===TILES&&++n%200===0)trim();}return res;});});}));}
});
