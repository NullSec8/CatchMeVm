const CACHE_NAME = "catchmevm-v1";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./main.js",
  "./state.js",
  "./utils.js",
  "./idb.js",
  "./files.js",
  "./snapshots.js",
  "./ui.js",
  "./vm.js",
  "./assets/v86/libv86.js",
  "./assets/v86/v86.wasm",
  "./assets/v86/seabios.bin",
  "./assets/v86/vgabios.bin",
  "./assets/v86/buildroot-bzimage68.bin",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== "GET") return;

  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  if (url.pathname.endsWith(".iso")) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const fetching = fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return res;
        });
        return cached || fetching;
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
