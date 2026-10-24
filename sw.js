/* Service worker : met toute l'application en cache pour qu'elle s'ouvre et fonctionne sans réseau.
   Changer VERSION à chaque mise à jour de l'application pour que les appareils la reçoivent. */
const VERSION = "1.7.0";
const CACHE = "registre-troupeau-" + VERSION;
const FILES = [
  "./", "index.html", "config.js", "manifest.webmanifest",
  "css/app.css", "js/store.js", "js/scanner.js", "js/app.js",
  "vendor/supabase.js", "vendor/xlsx.full.min.js",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "fonts/ibm-plex-mono-latin-400-normal.woff2", "fonts/ibm-plex-mono-latin-600-normal.woff2",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))));
  // première installation : actif tout de suite ; mise à jour : attend le clic sur « Mettre à jour »
  if (!self.registration.active) self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("registre-troupeau-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("message", e => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase et autres services : jamais mis en cache
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null;
  // config.js : le réseau d'abord, pour qu'un réglage modifié soit pris en compte sans nouvelle version
  if (rel === "config.js") {
    e.respondWith(fetch(req, { cache: "no-store" }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put("config.js", copy)); }
      return r;
    }).catch(() => caches.match("config.js")));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(caches.match("index.html").then(r => r || fetch(req)).catch(() => fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(res => {
    if (res.ok && rel && !rel.startsWith("supabase/")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
