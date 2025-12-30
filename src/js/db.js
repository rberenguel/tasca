const DB_NAME = "tasca_db";
const STORE_NAME = "tasks";
const PROJ_STORE_NAME = "projects";
let db = null;

export const initDB = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 5);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "uuid" });
        store.createIndex("project", "project", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains(PROJ_STORE_NAME)) {
        db.createObjectStore(PROJ_STORE_NAME, { keyPath: "name" });
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
  add: (task) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(task);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  update: (task) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(task);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  delete: (uuid) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(uuid);
      req.onsuccess = () => resolve(req.result);
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
  updateProject: (projData) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(PROJ_STORE_NAME, "readwrite");
      const store = tx.objectStore(PROJ_STORE_NAME);
      const req = store.put(projData);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
};
