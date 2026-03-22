const DB_NAME = "tasca_db";
const STORE_NAME = "tasks";
const PROJ_STORE_NAME = "projects";
const SETTINGS_STORE_NAME = "settings";
let db = null;

export const initDB = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 7);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const txn = event.target.transaction;

      // Ensure object stores exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "uuid" });
        store.createIndex("project", "project", { unique: false });
        store.createIndex("status", "status", { unique: false });
      } else {
        const store = txn.objectStore(STORE_NAME);
        if (!store.indexNames.contains("status")) {
          store.createIndex("status", "status", { unique: false });
        }
        if (!store.indexNames.contains("project")) {
          store.createIndex("project", "project", { unique: false });
        }
      }

      if (!db.objectStoreNames.contains(PROJ_STORE_NAME)) {
        db.createObjectStore(PROJ_STORE_NAME, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => reject(event.target.error);
  });

export const dbOps = {
  check: () => {
    if (!db) throw new Error("Database loading...");
  },
  getAll: () =>
    new Promise((resolve, reject) => {
      if (!db) return reject("DB not init");
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  getByStatus: (status) =>
    new Promise((resolve, reject) => {
      if (!db) return reject("DB not init");
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("status");
      const req = index.getAll(status);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  add: (task) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      // If task has modified (e.g. restore/undo), keep it. Else set now.
      const taskWithMod = { ...task, modified: task.modified || Date.now() };
      const req = store.add(taskWithMod);
      req.onsuccess = () => { resolve(req.result); window.__tascaScheduleSave?.() };
      req.onerror = () => reject(req.error);
    }),
  update: (task, { touch = true } = {}) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const taskWithMod = { ...task };
      if (touch) taskWithMod.modified = Date.now();
      // If !touch, we preserve whatever 'modified' is in task (or undefined)
      const req = store.put(taskWithMod);
      // Only auto-save on real user edits (touch:false means import/restore)
      req.onsuccess = () => { resolve(req.result); if (touch) window.__tascaScheduleSave?.() };
      req.onerror = () => reject(req.error);
    }),
  delete: (uuid) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(uuid);
      req.onsuccess = () => { resolve(req.result); window.__tascaScheduleSave?.() };
      req.onerror = () => reject(req.error);
    }),
  get: (uuid) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(uuid);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  // Project Operations
  getAllProjects: () =>
    new Promise((resolve, reject) => {
      if (!db) return reject("DB not init");
      if (!db.objectStoreNames.contains(PROJ_STORE_NAME)) return resolve([]);
      const tx = db.transaction(PROJ_STORE_NAME, "readonly");
      const store = tx.objectStore(PROJ_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  updateProject: (projData, { touch = true } = {}) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(PROJ_STORE_NAME, "readwrite");
      const store = tx.objectStore(PROJ_STORE_NAME);
      const projWithMod = { ...projData };
      if (touch) projWithMod.modified = Date.now();
      const req = store.put(projWithMod);
      req.onsuccess = () => { resolve(req.result); if (touch) window.__tascaScheduleSave?.() };
      req.onerror = () => reject(req.error);
    }),
  deleteProject: (name) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(PROJ_STORE_NAME, "readwrite");
      const store = tx.objectStore(PROJ_STORE_NAME);
      const req = store.delete(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }),
  cleanupOrphanProjects: async () => {
    const tasks = await dbOps.getAll();
    const projects = await dbOps.getAllProjects();
    const usedProjects = new Set(
      tasks.filter((t) => t.project).map((t) => t.project),
    );
    for (const p of projects) {
      if (!usedProjects.has(p.name)) {
        await dbOps.deleteProject(p.name);
      }
    }
  },
  // Settings Operations
  getSetting: (key) =>
    new Promise((resolve, reject) => {
      if (!db) return reject("DB not init");
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME))
        return resolve(null);
      const tx = db.transaction(SETTINGS_STORE_NAME, "readonly");
      const store = tx.objectStore(SETTINGS_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    }),
  setSetting: (key, value) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE_NAME, "readwrite");
      const store = tx.objectStore(SETTINGS_STORE_NAME);
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  deleteSetting: (key) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE_NAME, "readwrite");
      const store = tx.objectStore(SETTINGS_STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  purgeAll: () =>
    new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, PROJ_STORE_NAME], "readwrite");
      const tasksStore = tx.objectStore(STORE_NAME);
      const projStore = tx.objectStore(PROJ_STORE_NAME);
      tasksStore.clear();
      projStore.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
};
