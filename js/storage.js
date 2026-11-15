/* Classic script: window.LocalBridgeStorage, no ES modules. */
(function () {
  'use strict';
  const FORMAT = 'localbridge/v1';
  const byteArrayToB64 = (bytes) => {
    let out = '';
    for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(out);
  };
  const b64ToByteArray = (text) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

  async function encode(value, seen = new WeakSet()) {
    if (value === undefined) return { __lb_type: 'Undefined' };
    if (typeof value === 'bigint') return { __lb_type: 'BigInt', value: value.toString() };
    if (typeof value === 'number' && !Number.isFinite(value)) return { __lb_type: 'SpecialNumber', value: String(value) };
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof RegExp) return { __lb_type: 'RegExp', source: value.source, flags: value.flags };
    if (value instanceof Date) return { __lb_type: 'Date', value: value.toISOString() };
    if (value instanceof File) return { __lb_type: 'File', name: value.name, mime: value.type, modified: value.lastModified, data: byteArrayToB64(new Uint8Array(await value.arrayBuffer())) };
    if (value instanceof Blob) return { __lb_type: 'Blob', mime: value.type, data: byteArrayToB64(new Uint8Array(await value.arrayBuffer())) };
    if (value instanceof ArrayBuffer) return { __lb_type: 'ArrayBuffer', data: byteArrayToB64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) return { __lb_type: 'TypedArray', className: value.constructor.name, data: byteArrayToB64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    if (seen.has(value)) throw new Error('Zyklische Datenstruktur kann nicht als JSON exportiert werden.');
    seen.add(value);
    let result;
    if (value instanceof Map) {
      result = { __lb_type: 'Map', entries: [] };
      for (const [k, v] of value) result.entries.push([await encode(k, seen), await encode(v, seen)]);
    } else if (value instanceof Set) {
      result = { __lb_type: 'Set', values: [] };
      for (const item of value) result.values.push(await encode(item, seen));
    } else if (Array.isArray(value)) {
      result = [];
      for (const item of value) result.push(await encode(item, seen));
    } else {
      result = {};
      for (const [k, v] of Object.entries(value)) {
        // "__proto__" is a normal own property in IndexedDB values.
        Object.defineProperty(result, k, { value: await encode(v, seen), enumerable: true, configurable: true, writable: true });
      }
    }
    seen.delete(value);
    return result;
  }

  function decode(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(decode);
    switch (value.__lb_type) {
      case 'Undefined': return undefined;
      case 'BigInt': return BigInt(value.value);
      case 'SpecialNumber': return Number(value.value);
      case 'RegExp': return new RegExp(value.source, value.flags);
      case 'Date': return new Date(value.value);
      case 'Blob': return new Blob([b64ToByteArray(value.data)], { type: value.mime || '' });
      case 'File': return new File([b64ToByteArray(value.data)], value.name, { type: value.mime || '', lastModified: value.modified });
      case 'ArrayBuffer': return b64ToByteArray(value.data).buffer;
      case 'TypedArray': {
        const bytes = b64ToByteArray(value.data);
        const allowed = { Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray, DataView };
        if (typeof BigInt64Array !== 'undefined') { allowed.BigInt64Array = BigInt64Array; allowed.BigUint64Array = BigUint64Array; }
        if (!allowed[value.className]) throw new Error('Unbekannter TypedArray-Typ.');
        return new allowed[value.className](bytes.buffer);
      }
      case 'Map': return new Map(value.entries.map(([k, v]) => [decode(k), decode(v)]));
      case 'Set': return new Set(value.values.map(decode));
    }
    const result = {};
    for (const [k, v] of Object.entries(value)) Object.defineProperty(result, k, { value: decode(v), enumerable: true, configurable: true, writable: true });
    return result;
  }
  function localSnapshot() {
    const entries = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      Object.defineProperty(entries, k, { value: localStorage.getItem(k), enumerable: true, configurable: true, writable: true });
    }
    return { format: FORMAT, resource: 'localStorage', origin: location.origin, exportedAt: new Date().toISOString(), entries };
  }
  function applyLocal(snapshot, mode = 'merge') {
    if (!snapshot || snapshot.format !== FORMAT || snapshot.resource !== 'localStorage' || !snapshot.entries || typeof snapshot.entries !== 'object' || Array.isArray(snapshot.entries)) throw new Error('Ungültiges localStorage-Backup.');
    if (mode === 'replace') localStorage.clear();
    for (const [key, value] of Object.entries(snapshot.entries)) localStorage.setItem(key, String(value));
    return Object.keys(snapshot.entries).length;
  }
  function reqPromise(request) {
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || Error('IndexedDB Fehler')); });
  }
  function openDB(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
      request.onupgradeneeded = (event) => { try { if (upgrade) upgrade(request.result, event.target.transaction); } catch (err) { request.transaction.abort(); reject(err); } };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Datenbank konnte nicht geöffnet werden.'));
      request.onblocked = () => reject(new Error('Datenbank durch einen anderen Tab blockiert. Bitte andere Tabs schließen.'));
    });
  }
  async function databaseList() {
    if (!indexedDB.databases) throw new Error('Dein Browser unterstützt indexedDB.databases() nicht. Bitte Chrome, Edge oder einen kompatiblen Browser verwenden.');
    const list = await indexedDB.databases();
    return list.filter(item => item.name).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function inspectDBs() {
    const list = await databaseList(), result = [];
    for (const info of list) {
      const db = await openDB(info.name);
      try { result.push({ name: db.name, version: db.version, stores: Array.from(db.objectStoreNames) }); }
      finally { db.close(); }
    }
    return result;
  }
  function readStore(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const indexes = Array.from(store.indexNames).map(name => {
        const index = store.index(name);
        return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
      });
      const records = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => { const cursor = cursorReq.result; if (cursor) { records.push({ key: cursor.primaryKey, value: cursor.value }); cursor.continue(); } };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve({ name: storeName, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, records });
    });
  }
  async function idbSnapshot(names) {
    const known = await databaseList();
    const wanted = names ? known.filter(x => names.includes(x.name)) : known;
    const databases = [];
    for (const item of wanted) {
      const db = await openDB(item.name);
      try {
        const stores = [];
        for (const name of db.objectStoreNames) {
          const store = await readStore(db, name);
          for (const record of store.records) { record.key = await encode(record.key); record.value = await encode(record.value); }
          stores.push(store);
        }
        databases.push({ name: db.name, version: db.version, stores });
      } finally { db.close(); }
    }
    return { format: FORMAT, resource: 'indexedDB', origin: location.origin, exportedAt: new Date().toISOString(), databases };
  }
  function deleteDB(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Löschen blockiert. Andere Tabs mit dieser Datenbank schließen.'));
    });
  }
  function missingSchema(existing, descriptor) {
    for (const store of descriptor.stores) {
      if (!existing.objectStoreNames.contains(store.name)) return true;
      const tx = existing.transaction(store.name, 'readonly');
      const current = tx.objectStore(store.name);
      for (const idx of store.indexes || []) if (!current.indexNames.contains(idx.name)) return true;
    }
    return false;
  }
  function createSchema(db, tx, descriptor) {
    for (const schema of descriptor.stores) {
      const store = db.objectStoreNames.contains(schema.name)
        ? tx.objectStore(schema.name)
        : db.createObjectStore(schema.name, { keyPath: schema.keyPath === undefined ? null : schema.keyPath, autoIncrement: !!schema.autoIncrement });
      for (const idx of schema.indexes || []) if (!store.indexNames.contains(idx.name)) store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique, multiEntry: !!idx.multiEntry });
    }
  }
  function putRecords(db, schema) {
    return new Promise((resolve, reject) => {
      if (!schema.stores.length) { resolve(); return; }
      let tx;
      try {
        tx = db.transaction(schema.stores.map(s => s.name), 'readwrite');
        for (const storeSchema of schema.stores) {
          const store = tx.objectStore(storeSchema.name);
          for (const record of storeSchema.records) {
            const value = decode(record.value), key = decode(record.key);
            if (store.keyPath === null) store.put(value, key);
            else store.put(value);
          }
        }
      } catch (err) { if (tx) tx.abort(); reject(err); return; }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || Error('Fehler beim Schreiben der Datenbank.'));
      tx.onabort = () => reject(tx.error || Error('Import abgebrochen.'));
    });
  }
  async function applyIDB(snapshot, mode = 'merge') {
    if (!snapshot || snapshot.format !== FORMAT || snapshot.resource !== 'indexedDB' || !Array.isArray(snapshot.databases)) throw new Error('Ungültiges IndexedDB-Backup.');
    // Validate the entire descriptor before modifying any database.
    for (const schema of snapshot.databases) {
      if (!schema || typeof schema.name !== 'string' || !Array.isArray(schema.stores)) throw new Error('Ungültige Datenbankstruktur.');
      for (const store of schema.stores) if (typeof store.name !== 'string' || !Array.isArray(store.records)) throw new Error('Ungültiger Object Store.');
    }
    for (const schema of snapshot.databases) {
      if (mode === 'replace') await deleteDB(schema.name);
      const targetVersion = mode === 'replace' ? Math.max(1, Number(schema.version) || 1) : undefined;
      let db = await openDB(schema.name, targetVersion, (next, tx) => createSchema(next, tx, schema));
      try {
        if (missingSchema(db, schema)) {
          const nextVersion = db.version + 1;
          db.close();
          db = await openDB(schema.name, nextVersion, (next, tx) => createSchema(next, tx, schema));
        }
        await putRecords(db, schema);
      } finally { db.close(); }
    }
    return snapshot.databases.length;
  }
  window.LocalBridgeStorage = { FORMAT, localSnapshot, applyLocal, databaseList, inspectDBs, idbSnapshot, applyIDB, deleteDB, reqPromise };
}());
