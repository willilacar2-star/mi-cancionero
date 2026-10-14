// Service worker de Mi Cancionero.
// Si cambias index.html, styles.css, app.js o music.js, sube el número de VERSION
// para que los teléfonos descarguen la versión nueva.
var VERSION = 'cancionero-v4';
var APP = [
  './', 'index.html', 'styles.css', 'app.js', 'music.js',
  'manifest.json', 'canciones.json',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(APP); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // canciones.json: primero la red (para ver cambios), y sin conexión lo guardado.
  if (/canciones\.json$/.test(new URL(req.url).pathname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copia = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copia); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // El resto: primero lo guardado, y si no está, la red.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copia = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copia); });
        return res;
      });
    })
  );
});
