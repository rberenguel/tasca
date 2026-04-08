// ── Tasca native bridge ────────────────────────────────────────────────────
// Injected by Swift at document start, before app.js runs.
// Sets up the auto-save hook and the tascaLoad entry point.

window.__TASCA_NATIVE__ = true;

// ── Auto-save (debounced) ──────────────────────────────────────────────────
// db.js calls this after any write. We wait 800 ms for bursts to settle
// (e.g. multi-ID done, import), then serialise and push to Swift.
let __saveTimer = null;
window.__tascaScheduleSave = function () {
  clearTimeout(__saveTimer);
  __saveTimer = setTimeout(async () => {
    try {
      if (!window.__tascaSerialize) return;
      const data = await window.__tascaSerialize();
      window.webkit.messageHandlers.autoSave.postMessage(JSON.stringify(data));
      window.__tascaMarkClean?.();
      window.__tascaSetLastSave?.(data.savedAt);
    } catch (e) {
      window.webkit?.messageHandlers?.log?.postMessage(
        "autoSave error: " + e.message,
      );
    }
  }, 800);
};

// ── tascaLoad (Swift → JS) ─────────────────────────────────────────────────
// Called by Swift on launch and on foreground resume with the iCloud JSON.
// Merges by modified timestamp: newer wins per UUID.
// If called before app.js is ready, queues the data in __pendingLoad.
window.tascaLoad = async function (json) {
  if (!json) return;
  try {
    const data = JSON.parse(json);
    if (window.__tascaImport) {
      await window.__tascaImport(data);
      window.__tascaRefresh?.();
    } else {
      // app.js not initialised yet — store for pickup after initDB resolves
      window.__pendingLoad = data;
    }
  } catch (e) {
    window.webkit?.messageHandlers?.log?.postMessage(
      "tascaLoad parse error: " + e.message,
    );
  }
};
