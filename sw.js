const CACHE_NAME = "tasca-cache-v0.1.5";
const CACHE_FILES = [
  "./index.html",
  "./src/css/style.css",
  "./src/js/app.js",
  "./src/js/commands.js",
  "./src/js/context.js",
  "./src/js/db.js",
  "./src/js/input.js",
  "./src/js/list.js",
  "./src/js/logic.js",
  "./src/js/state.js",
  "./src/js/ui.js",
  "./src/js/utils.js",
  "./fonts/iconoir/iconoir.css",
  "./fonts/monoid-regular.woff2",
  "./fonts/monoid-bold.woff2",
  "./manifest.json",
  "./icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_FILES).then(() => {
        // Activate immediately, don't wait for tabs to close
        return self.skipWaiting();
      });
    }),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        }),
      ).then(() => {
        // Take control of all pages immediately
        return self.clients.claim();
      });
    }),
  );
});
