/* LocalSync v9. PeerJS Cloud signaling + WebRTC DataConnection. Classic script, no ES modules. */
(function () {
  'use strict';
  const Storage = window.LocalBridgeStorage;
  const Files = window.LocalBridgeFiles;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const CHUNK = 8 * 1024, MAX_TRANSFER = 100 * 1024 * 1024;
  const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(x => x.toString(16).padStart(2, '0')).join('');
  // The public PeerJS signaling service is used automatically when no host is passed.
  // Session IDs are secret bearer tokens; prefixing avoids collisions with other PeerJS apps.
  const PEER_ID_PREFIX = 'localsync-';
  const ROOM_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{10,78}[a-zA-Z0-9]$/;
  let room = '', mode = null, peer = null, connection = null, connected = false;
  let lifecycle = 0, helloEpoch = 0;
  const incoming = new Map(), requests = new Map();
  let permissions = { localStorage: false, indexedDB: false, clipboard: false };
  const emptyPeerInfo = () => ({ permissions: { localStorage: false, indexedDB: false, clipboard: false }, files: [], localStorage: [], indexedDB: [] });
  let peerInfo = emptyPeerInfo();
  const emit = (event, detail) => window.dispatchEvent(new CustomEvent('lb:' + event, { detail }));
  function isOpen() { return !!connection && connection.open === true; }
  function clearConnection(status) {
    const previous = connection;
    connection = null;
    connected = false;
    helloEpoch++;
    incoming.clear();
    for (const requestId of requests.keys()) emit('request-error', { requestId, reason: 'Verbindung unterbrochen.' });
    requests.clear();
    peerInfo = emptyPeerInfo();
    if (previous) { try { previous.close(); } catch (_) {} }
    emit('peer-info', peerInfo);
    emit('connection', { status: status || (mode === 'create' ? 'waiting' : 'disconnected') });
  }
  function stop() {
    ++lifecycle; // Ignore callbacks from old PeerJS instances.
    const previousPeer = peer;
    mode = null; room = '';
    clearConnection('idle');
    peer = null;
    if (previousPeer) { try { previousPeer.destroy(); } catch (_) {} }
  }
  function dataChannel() {
    return connection && connection.dataChannel;
  }
  function bindConnection(conn, generation) {
    if (generation !== lifecycle || !peer || !conn) { try { conn?.close(); } catch (_) {} return; }
    // Only one peer may read this device's granted resources at once.
    if (connection && connection !== conn) { try { conn.close(); } catch (_) {} return; }
    connection = conn;
    const dc = dataChannel();
    if (dc) dc.bufferedAmountLowThreshold = 128 * 1024;
    conn.on('open', () => {
      if (generation !== lifecycle || connection !== conn) return;
      const openedChannel = conn.dataChannel;
      if (openedChannel) openedChannel.bufferedAmountLowThreshold = 128 * 1024;
      connected = true;
      emit('connection', { status: 'connected' });
      void sendHello();
    });
    conn.on('data', message => {
      if (generation !== lifecycle || connection !== conn) return;
      try { onData(typeof message === 'string' ? JSON.parse(message) : message); }
      catch (error) { emit('peer-error', 'Nachricht konnte nicht verarbeitet werden: ' + error.message); }
    });
    conn.on('close', () => {
      if (generation === lifecycle && connection === conn) clearConnection();
    });
    conn.on('error', error => {
      if (generation !== lifecycle || connection !== conn) return;
      emit('peer-error', 'WebRTC-Verbindung: ' + (error?.message || String(error)));
      if (!conn.open) clearConnection();
    });
    // Some peers open before the handlers can be attached.
    if (conn.open) {
      const openedChannel = conn.dataChannel;
      if (openedChannel) openedChannel.bufferedAmountLowThreshold = 128 * 1024;
      connected = true;
      emit('connection', { status: 'connected' });
      void sendHello();
    }
  }
  function start(newRoom, newMode) {
    stop();
    if (!ROOM_PATTERN.test(newRoom || '')) { emit('peer-error', 'Ungültige Sitzungs-ID.'); return; }
    if (newMode !== 'create' && newMode !== 'join') { emit('peer-error', 'Ungültiger Sitzungsmodus.'); return; }
    room = newRoom; mode = newMode;
    if (typeof window.Peer !== 'function') {
      emit('connection', { status: 'server-error' });
      emit('peer-error', 'PeerJS konnte nicht geladen werden. Internetverbindung oder CDN prüfen.');
      return;
    }
    const generation = lifecycle;
    try {
      // As in the older LocalLink app: let PeerJS use its public default signaling server.
      peer = mode === 'create'
        ? new window.Peer(PEER_ID_PREFIX + room, { debug: 0 })
        : new window.Peer({ debug: 0 });
    } catch (error) {
      emit('connection', { status: 'server-error' });
      emit('peer-error', 'PeerJS-Start fehlgeschlagen: ' + error.message);
      return;
    }
    emit('connection', { status: 'starting' });
    const instance = peer;
    instance.on('open', () => {
      if (generation !== lifecycle || peer !== instance) return;
      if (mode === 'create') {
        emit('connection', { status: 'waiting' });
        return;
      }
      emit('connection', { status: 'connecting' });
      try {
        const outgoing = instance.connect(PEER_ID_PREFIX + room, {
          reliable: true,
          serialization: 'json',
          metadata: { app: 'localsync', protocol: 1 }
        });
        bindConnection(outgoing, generation);
      } catch (error) {
        emit('connection', { status: 'server-error' });
        emit('peer-error', 'Beitritt fehlgeschlagen: ' + error.message);
      }
    });
    instance.on('connection', incomingConnection => {
      if (generation !== lifecycle || peer !== instance || mode !== 'create' ||
        (connection && connection !== incomingConnection) ||
        incomingConnection.metadata?.app !== 'localsync' || incomingConnection.metadata?.protocol !== 1) {
        try { incomingConnection.close(); } catch (_) {}
        return;
      }
      bindConnection(incomingConnection, generation);
    });
    instance.on('disconnected', () => {
      if (generation !== lifecycle || peer !== instance) return;
      // An established DataChannel can remain open when signaling is disconnected.
      if (!isOpen()) emit('connection', { status: 'server-error' });
    });
    instance.on('error', error => {
      if (generation !== lifecycle || peer !== instance) return;
      const errorType = error?.type || 'unknown';
      if (errorType === 'peer-unavailable') {
        emit('connection', { status: 'peer-unavailable' });
        emit('peer-error', 'Sitzung nicht gefunden. Der Host muss die Sitzung auf seinem Gerät zuerst erstellen.');
      } else if (errorType === 'unavailable-id') {
        emit('connection', { status: 'server-error' });
        emit('peer-error', 'Diese Session-ID ist bei PeerJS bereits belegt. Bitte eine neue Sitzung erstellen.');
      } else {
        if (!isOpen()) emit('connection', { status: 'server-error' });
        emit('peer-error', 'PeerJS (' + errorType + '): ' + (error?.message || String(error)));
      }
    });
    instance.on('close', () => {
      if (generation === lifecycle && peer === instance && !isOpen()) emit('connection', { status: 'disconnected' });
    });
  }
  function send(message) {
    if (!isOpen()) return false;
    try { connection.send(JSON.stringify(message)); return true; }
    catch (error) { emit('peer-error', 'Senden fehlgeschlagen: ' + error.message); return false; }
  }
  const length = value => enc.encode(String(value)).byteLength;
  async function sendHello() {
    const generation = ++helloEpoch;
    if (!isOpen()) return;
    const current = connection;
    const granted = { ...permissions };
    const base = { type: 'hello', permissions: granted, files: Files.list(), localStorage: [], indexedDB: [] };
    // Announce permissions quickly, before estimating IndexedDB sizes.
    send(base);
    try {
      if (granted.localStorage) {
        base.localStorage = Object.entries(Storage.localSnapshot().entries).slice(0, 500)
          .map(([key, value]) => ({ key, size: length(value) }));
      }
      if (granted.indexedDB) {
        const databases = await Storage.inspectDBs();
        for (const database of databases.slice(0, 150)) {
          let size = null;
          try {
            const exportData = await Storage.idbSnapshot([database.name]);
            size = length(JSON.stringify(exportData.databases[0] || {}));
          } catch (_) { /* Still expose the name when a database is not serializable. */ }
          base.indexedDB.push({ name: database.name, size });
        }
      }
      if (generation === helloEpoch && current === connection && isOpen()) send(base);
    } catch (error) {
      if (generation === helloEpoch && current === connection) emit('peer-error', 'Metadaten konnten nicht vollständig ermittelt werden: ' + error.message);
    }
  }
  function setPermissions(next) {
    permissions = { localStorage: !!next.localStorage, indexedDB: !!next.indexedDB, clipboard: !!next.clipboard };
    sendHello();
  }
  async function throttle() {
    if (!isOpen()) throw Error('Datenkanal geschlossen.');
    const dc = dataChannel();
    if (!dc) throw Error('PeerJS DataChannel ist nicht verfügbar.');
    if (dc.bufferedAmount <= 384 * 1024) return;
    await new Promise((resolve, reject) => {
      let timer;
      function finish(error) {
        dc.removeEventListener('bufferedamountlow', low);
        dc.removeEventListener('close', closed);
        clearTimeout(timer);
        error ? reject(error) : resolve();
      }
      function low() { finish(); }
      function closed() { finish(Error('Verbindung unterbrochen.')); }
      dc.addEventListener('bufferedamountlow', low, { once: true });
      dc.addEventListener('close', closed, { once: true });
      timer = setTimeout(() => finish(Error('Übertragung ist ins Stocken geraten.')), 20000);
    });
  }
  function b64(bytes) { let text = ''; for (let i = 0; i < bytes.length; i += 4096) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096)); return btoa(text); }
  function fromB64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
  async function sendBytes(requestId, resource, bytes, fileName) {
    if (bytes.length > MAX_TRANSFER) throw Error('Maximale Transfergröße: 100 MB.');
    const transferId = hex(12), parts = Math.ceil(bytes.length / CHUNK);
    if (!send({ type: 'transfer-start', transferId, requestId, resource, fileName: fileName || '', parts, size: bytes.length })) throw Error('Verbindung unterbrochen.');
    for (let i = 0; i < parts; i++) {
      await throttle();
      if (!send({ type: 'transfer-part', transferId, index: i, data: b64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) })) throw Error('Verbindung unterbrochen.');
    }
    if (!send({ type: 'transfer-end', transferId })) throw Error('Verbindung unterbrochen.');
  }
  async function serveRequest(message) {
    const resource = message.resource, requestId = message.requestId;
    try {
      if (!/^[a-f0-9]{24}$/.test(requestId || '')) return;
      if (resource === 'file') {
        const file = Files.get(message.fileId);
        if (!file) throw Error('Datei nicht mehr verfügbar.');
        if (file.size > MAX_TRANSFER) throw Error('Datei überschreitet die Transfergrenze (100 MB).');
        await sendBytes(requestId, resource, new Uint8Array(await file.arrayBuffer()), file.name);
      } else {
        if (!permissions[resource]) throw Error('Für ' + resource + ' ist keine Freigabe erteilt.');
        let payload;
        if (resource === 'localStorage') payload = Storage.localSnapshot();
        else if (resource === 'indexedDB') payload = await Storage.idbSnapshot();
        else if (resource === 'clipboard') payload = { text: Files.getClipboard() };
        else throw Error('Unbekannter Ressourcentyp.');
        await sendBytes(requestId, resource, enc.encode(JSON.stringify(payload)));
      }
    } catch (error) { send({ type: 'error', requestId, reason: error.message }); }
  }
  function onData(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello') {
      peerInfo = {
        permissions: {
          localStorage: !!message.permissions?.localStorage,
          indexedDB: !!message.permissions?.indexedDB,
          clipboard: !!message.permissions?.clipboard
        },
        files: Array.isArray(message.files) ? message.files.filter(f => f && typeof f.id === 'string' && typeof f.name === 'string' && Number.isFinite(f.size)).slice(0, 2000) : [],
        localStorage: !!message.permissions?.localStorage && Array.isArray(message.localStorage)
          ? message.localStorage.filter(e => e && typeof e.key === 'string' && Number.isFinite(e.size) && e.size >= 0).slice(0, 500) : [],
        indexedDB: !!message.permissions?.indexedDB && Array.isArray(message.indexedDB)
          ? message.indexedDB.filter(e => e && typeof e.name === 'string' && (e.size === null || (Number.isFinite(e.size) && e.size >= 0))).slice(0, 150) : []
      };
      emit('peer-info', peerInfo);
    } else if (message.type === 'request') {
      // Deliberately no command for remote writes, clipboard writes or remote imports.
      serveRequest(message);
    } else if (message.type === 'error') {
      if (message.requestId) requests.delete(message.requestId);
      emit('request-error', { requestId: message.requestId, reason: message.reason || 'Fehler auf dem anderen Gerät.' });
      emit('peer-error', message.reason || 'Fehler auf dem anderen Gerät.');
    } else if (message.type === 'transfer-start') {
      if (!['file', 'localStorage', 'indexedDB', 'clipboard'].includes(message.resource) || !requests.has(message.requestId)) return;
      if (!Number.isInteger(message.size) || message.size < 0 || message.size > MAX_TRANSFER || !Number.isInteger(message.parts) || message.parts < 0 || message.parts > Math.ceil(MAX_TRANSFER / CHUNK)) return;
      incoming.set(message.transferId, { resource: message.resource, fileName: message.fileName, requestId: message.requestId, chunks: new Array(message.parts), parts: message.parts, size: message.size });
    } else if (message.type === 'transfer-part') {
      const transfer = incoming.get(message.transferId);
      if (!transfer || !Number.isInteger(message.index) || message.index < 0 || message.index >= transfer.parts || typeof message.data !== 'string') return;
      if (!transfer.chunks[message.index]) transfer.chunks[message.index] = fromB64(message.data);
    } else if (message.type === 'transfer-end') {
      const transfer = incoming.get(message.transferId);
      if (!transfer) return;
      incoming.delete(message.transferId);
      const requested = requests.get(transfer.requestId);
      if (!requested) return;
      requests.delete(transfer.requestId);
      if (transfer.resource !== requested.resource) throw Error('Antworttyp stimmt nicht mit der Anfrage überein.');
      if (transfer.chunks.some(part => !part)) throw Error('Unvollständige Übertragung.');
      const bytes = new Uint8Array(transfer.size);
      let offset = 0;
      for (const chunk of transfer.chunks) { if (offset + chunk.length > bytes.length) throw Error('Ungültige Übertragungsgröße.'); bytes.set(chunk, offset); offset += chunk.length; }
      if (offset !== bytes.length) throw Error('Unvollständige Übertragung.');
      if (transfer.resource === 'file') {
        const safeName = (transfer.fileName || 'download').replace(/[\\/\x00-\x1f]/g, '_');
        if (requested.preview) {
          // A content preview is read-only and must NOT trigger a browser download.
          emit('received', { resource: 'file', fileName: safeName, size: bytes.length, requestId: transfer.requestId,
            preview: true, fileBlob: new Blob([bytes], { type: requested.mime || 'application/octet-stream' }) });
        } else {
          if (requested.attach) {
            Files.add([new File([bytes], safeName, { type: 'application/octet-stream' })]);
          } else {
            Files.download(bytes, safeName, 'application/octet-stream');
          }
          emit('received', { resource: 'file', fileName: safeName, size: bytes.length, requestId: transfer.requestId, attached: requested.attach });
        }
      } else {
        const payload = JSON.parse(dec.decode(bytes));
        emit('received', { resource: transfer.resource, data: payload, requestId: transfer.requestId });
      }
    }
  }
  function request(resource, fileId, options) {
    if (!isOpen()) throw Error('Noch keine Geräteverbindung aufgebaut.');
    if (resource !== 'file' && !peerInfo.permissions[resource]) throw Error('Die Gegenstelle hat diesen Download nicht freigegeben.');
    if (!['localStorage', 'indexedDB', 'clipboard', 'file'].includes(resource)) throw Error('Unbekannte Ressource.');
    if (resource === 'file' && (!peerInfo.files.some(f => f.id === fileId))) throw Error('Diese Datei wird von der Gegenstelle nicht mehr angeboten.');
    const requestId = hex(12);
    requests.set(requestId, { resource, attach: resource === 'file' && !!options?.attach,
      preview: resource === 'file' && !!options?.preview, mime: resource === 'file' && typeof options?.mime === 'string' ? options.mime : '' });
    if (!send({ type: 'request', resource, requestId, fileId })) {
      requests.delete(requestId); throw Error('Anfrage konnte nicht gesendet werden.');
    }
    return requestId;
  }
  window.LocalBridgePeer = { start, stop, request, setPermissions, sendHello, isOpen, getRoom: () => room, getInfo: () => peerInfo, newRoom: () => hex(16) };
}());
