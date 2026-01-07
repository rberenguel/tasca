const CACHE_NAME = "tasca-cache-v0.10.0";
const CACHE_FILES = [
  "./fonts/monoid-bold.woff2",
  "./fonts/monoid-italic.woff2",
  "./fonts/monoid-regular.woff2",
  "./fonts/monoid.css",
  "./fonts/phosphor/Phosphor-Light.woff2",
  "./fonts/phosphor/phosphor.css",
  "./icon.png",
  "./index.html",
  "./pwa-manifest.json",
  "./src/css/style.css",
  "./src/js/app.js",
  "./src/js/commands-data.js",
  "./src/js/commands-misc.js",
  "./src/js/commands-registry.js",
  "./src/js/commands-reports.js",
  "./src/js/commands-state.js",
  "./src/js/commands-tasks.js",
  "./src/js/commands-views.js",
  "./src/js/commands.js",
  "./src/js/context.js",
  "./src/js/db.js",
  "./src/js/icon-tags.js",
  "./src/js/input.js",
  "./src/js/list.js",
  "./src/js/logic.js",
  "./src/js/state.js",
  "./src/js/ui.js",
  "./src/js/undo.js",
  "./src/js/utils.js",
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
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Network failed and not in cache - for navigation, return cached index.html
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
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
