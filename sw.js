// Service worker de Mi Cancionero.
// Si cambias index.html, styles.css, app.js, music.js o config.js, sube el número de VERSION
// para que los teléfonos descarguen la versión nueva.
// Las canciones ya no se cachean aquí: vienen de Supabase y la app las guarda en localStorage.
var VERSION = 'cancionero-v13';
// La misma dirección (con versión fija) que está en index.html.
var LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
var APP = [
  './', 'index.html', 'styles.css', 'app.js', 'music.js', 'config.js',
  'manifest.json', LIB,
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  // Cada archivo por separado: si alguno falta, los demás se guardan igual
  // (con addAll, un solo archivo faltante hacía fallar toda la instalación).
  // cache: 'reload' pide cada archivo al servidor y no a la caché del navegador:
  // así no se mezcla un index.html nuevo con un app.js viejo.
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(APP.map(function (url) {
      return c.add(new Request(url, { cache: 'reload' })).catch(function (err) {
        console.warn('[sw] No se pudo guardar ' + url, err);
      });
    }));
  }));
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
  // Solo los archivos de la app y supabase-js. Las llamadas a la API de Supabase van siempre a la red.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin && req.url !== LIB) return;

  // supabase-js tiene versión fija: lo guardado no cambia nunca.
  if (req.url === LIB) {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
    return;
  }

  // Archivos de la app: se muestra lo guardado (rápido y sin conexión) y, al mismo tiempo,
  // se pide la copia nueva para la próxima vez. Si alguna vez quedó algo viejo, se corrige solo.
  // Con req.url y no con req: la página principal (navegación) no acepta opciones nuevas.
  var nueva = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
    if (!res.ok) return res;
    var copia = res.clone();
    return caches.open(VERSION).then(function (c) { return c.put(req, copia); }).then(function () { return res; });
  });
  e.waitUntil(nueva.catch(function () {}));
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || nueva;
    })
  );
});
