// Reads Claude Code's local session logs directly in the browser via the
// File System Access API — no local script to run. Chromium-only (Chrome/Edge);
// callers should check isSupported() and show a fallback otherwise.
(function () {
  const DB_NAME = "cgih";
  const STORE = "handles";
  const HANDLE_KEY = "claude-projects-dir";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getStoredHandle() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function storeHandle(handle) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearStoredHandle() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function isSupported() {
    return typeof window.showDirectoryPicker === "function";
  }

  // Must be called synchronously from within a user gesture (click handler).
  async function connect() {
    const handle = await window.showDirectoryPicker({ id: "cgih-claude-projects" });
    await storeHandle(handle);
    return handle;
  }

  async function verifyPermission(handle, requestIfNeeded) {
    const opts = { mode: "read" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if (!requestIfNeeded) return false;
    return (await handle.requestPermission(opts)) === "granted";
  }

  // requestIfNeeded=true will prompt the user (must be called from a click
  // handler); false does a silent check only, safe to call on page load.
  async function getConnectedHandle(requestIfNeeded) {
    const handle = await getStoredHandle();
    if (!handle) return null;
    const ok = await verifyPermission(handle, requestIfNeeded);
    return ok ? handle : null;
  }

  async function* walkJsonlFiles(dirHandle) {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === "directory") {
        yield* walkJsonlFiles(entry);
      } else if (entry.kind === "file" && name.endsWith(".jsonl")) {
        yield entry;
      }
    }
  }

  // Returns { events, activity }:
  //   events   — assistant turns with usage: [{ timestamp(ms), model, usage }]
  //   activity — timestamps(ms) of EVERY turn (user + assistant), used to
  //              derive accurate 5-hour window boundaries (a window opens on
  //              the user's first message, which carries no usage object).
  async function readUsageEntries(dirHandle) {
    const events = [];
    const activity = [];
    for await (const fileHandle of walkJsonlFiles(dirHandle)) {
      let text;
      try {
        const file = await fileHandle.getFile();
        text = await file.text();
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.type !== "assistant" && obj.type !== "user") continue;
        const ts = Date.parse(obj.timestamp);
        if (Number.isNaN(ts)) continue;
        activity.push(ts);
        if (obj.type === "assistant") {
          const msg = obj.message;
          if (!msg || msg.model === "<synthetic>" || !msg.usage) continue;
          events.push({ timestamp: ts, model: msg.model, usage: msg.usage });
        }
      }
    }
    return { events, activity };
  }

  window.UsageSource = {
    isSupported,
    connect,
    getConnectedHandle,
    clearStoredHandle,
    readUsageEntries,
  };
})();
