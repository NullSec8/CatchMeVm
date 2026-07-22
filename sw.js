const CACHE_NAME = "catchmevm-v2";
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

const ISO_IDB_DB = "catchmevm-iso-cache";
const ISO_IDB_STORE = "isos";
const ISO_IDB_VERSION = 1;

function openIsoDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ISO_IDB_DB, ISO_IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ISO_IDB_STORE)) {
        db.createObjectStore(ISO_IDB_STORE, { keyPath: "url" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedIso(url) {
  try {
    const db = await openIsoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ISO_IDB_STORE, "readonly");
      const req = tx.objectStore(ISO_IDB_STORE).get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function putCachedIso(url, blob) {
  try {
    const db = await openIsoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ISO_IDB_STORE, "readwrite");
      tx.objectStore(ISO_IDB_STORE).put({ url, blob, ts: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

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

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "GET_VERSION") {
    e.source.postMessage({ type: "VERSION", version: CACHE_NAME });
  }
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
      (async () => {
        const cached = await getCachedIso(url.href);
        if (cached && cached.blob) {
          return new Response(cached.blob, {
            headers: { "Content-Type": "application/octet-stream" },
          });
        }
        try {
          const res = await fetch(e.request);
          if (res.ok) {
            const blob = await res.clone().blob();
            putCachedIso(url.href, blob);
          }
          return res;
        } catch {
          return new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
