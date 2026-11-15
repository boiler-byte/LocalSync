/* LocalSync v4. WebRTC DataChannel; HTTP/SSE only for signaling. No module imports. */
(function () {
  'use strict';
  const Storage = window.LocalBridgeStorage;
  const Files = window.LocalBridgeFiles;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const CHUNK = 8 * 1024, MAX_TRANSFER = 100 * 1024 * 1024;
  const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(x => x.toString(16).padStart(2, '0')).join('');
  let clientId = hex(12), room = '', eventStream = null, pc = null, channel = null, otherId = null;
  let connecting = false, connected = false;
  const incoming = new Map(), requests = new Map();
  let helloEpoch = 0;
  let permissions = { localStorage: false, indexedDB: false, clipboard: false };
  let peerInfo = { permissions: { ...permissions }, files: [], localStorage: [], indexedDB: [] };
  const emit = (event, detail) => window.dispatchEvent(new CustomEvent('lb:' + event, { detail }));
  function isOpen() { return !!channel && channel.readyState === 'open'; }
  function resetPeer() {
    connected = false; connecting = false; otherId = null;
    if (channel) { try { channel.close(); } catch (_) {} }
    if (pc) { try { pc.close(); } catch (_) {} }
    channel = null; pc = null; incoming.clear(); requests.clear(); helloEpoch++;
    peerInfo = { permissions: { localStorage: false, indexedDB: false, clipboard: false }, files: [], localStorage: [], indexedDB: [] };
    emit('peer-info', peerInfo); emit('connection', { status: 'waiting' });
  }
  function stop() { if (eventStream) eventStream.close(); eventStream = null; resetPeer(); }
  // Resolve signaling below the application's current directory, also behind subpath reverse proxies.
  const signalUrl = () => new URL('./signal', location.href).href;
  const eventsUrl = () => new URL('./events', location.href);
  async function postSignal(to, payload) {
    const r = await fetch(signalUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room, from: clientId, to, payload }) });
    if (!r.ok) throw Error('Signaling-Server antwortet mit ' + r.status);
  }
  function createPC() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = e => { if (e.candidate && otherId) postSignal(otherId, { kind: 'ice', value: e.candidate }).catch(err => emit('peer-error', err.message)); };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        if (connected) resetPeer();
        else emit('connection', { status: 'waiting' });
      }
    };
    pc.ondatachannel = event => setupChannel(event.channel);
    return pc;
  }
  function setupChannel(dc) {
    channel = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 128 * 1024;
    dc.onopen = () => { connected = true; emit('connection', { status: 'connected' }); sendHello(); };
    dc.onclose = () => { if (connected) resetPeer(); };
    dc.onerror = () => emit('peer-error', 'Fehler im WebRTC-Datenkanal.');
    dc.onmessage = event => {
      try { onData(JSON.parse(event.data)); }
      catch (err) { emit('peer-error', 'Nachricht konnte nicht verarbeitet werden: ' + err.message); }
    };
  }
  async function onSignal(message) {
    if (!message || message.from === clientId) return;
    otherId = message.from;
    const data = message.payload;
    if (!data || !['offer', 'answer', 'ice'].includes(data.kind)) return;
    if (data.kind === 'offer') {
      createPC();
      await pc.setRemoteDescription(data.value);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await postSignal(otherId, { kind: 'answer', value: pc.localDescription });
      await flushIce();
    } else if (data.kind === 'answer' && pc) {
      await pc.setRemoteDescription(data.value);
      await flushIce();
    } else if (data.kind === 'ice') {
      if (!pc || !pc.remoteDescription) iceQueue.push(data.value);
      else await pc.addIceCandidate(data.value);
    }
  }
  let iceQueue = [];
  async function flushIce() {
    if (!pc || !pc.remoteDescription) return;
    for (const candidate of iceQueue.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
  }
  async function makeOffer(peerId) {
    if (connecting || pc || connected) return;
    connecting = true; otherId = peerId;
    const p = createPC();
    setupChannel(p.createDataChannel('localsync', { ordered: true }));
    const offer = await p.createOffer();
    await p.setLocalDescription(offer);
    await postSignal(peerId, { kind: 'offer', value: p.localDescription });
  }
  function start(newRoom) {
    stop(); room = newRoom; clientId = hex(12); iceQueue = [];
    if (!room || !/^[a-zA-Z0-9_-]{12,80}$/.test(room)) { emit('peer-error', 'Ungültige Sitzungs-ID.'); return; }
    if (!window.RTCPeerConnection || !window.EventSource) { emit('peer-error', 'Dieser Browser unterstützt WebRTC oder SSE nicht.'); return; }
    if (location.protocol === 'file:') { emit('peer-error', 'Für die Geräteverbindung muss server.js gestartet werden.'); return; }
    const url = eventsUrl();
    url.searchParams.set('room', room);
    url.searchParams.set('client', clientId);
    eventStream = new EventSource(url.href);
    eventStream.onopen = () => emit('connection', { status: 'waiting' });
    eventStream.onerror = () => emit('connection', { status: 'server-error' });
    eventStream.onmessage = evt => {
      try {
        const data = JSON.parse(evt.data);
        if (data.kind === 'presence') {
          const other = (data.clients || []).find(id => id !== clientId);
          if (!other) { if (pc || connected) resetPeer(); return; }
          if (clientId < other && !pc && !connecting) makeOffer(other).catch(error => emit('peer-error', error.message));
        } else if (data.kind === 'signal') onSignal(data).catch(error => emit('peer-error', error.message));
        else if (data.kind === 'room-full') emit('peer-error', 'Dieser Raum ist bereits mit zwei Geräten belegt.');
      } catch (error) { emit('peer-error', error.message); }
    };
  }
  function send(message) { if (!isOpen()) return false; channel.send(JSON.stringify(message)); return true; }
  const length = value => enc.encode(String(value)).byteLength;
  async function sendHello() {
    const generation = ++helloEpoch;
    if (!isOpen()) return;
    const current = channel;
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
      if (generation === helloEpoch && current === channel && isOpen()) send(base);
    } catch (error) {
      if (generation === helloEpoch && current === channel) emit('peer-error', 'Metadaten konnten nicht vollständig ermittelt werden: ' + error.message);
    }
  }
  function setPermissions(next) {
    permissions = { localStorage: !!next.localStorage, indexedDB: !!next.indexedDB, clipboard: !!next.clipboard };
    sendHello();
  }
  async function throttle() {
    if (!isOpen()) throw Error('Datenkanal geschlossen.');
    if (channel.bufferedAmount <= 384 * 1024) return;
    await new Promise((resolve, reject) => {
      const dc = channel;
      let timer;
      function finish(err) { dc.removeEventListener('bufferedamountlow', low); dc.removeEventListener('close', closed); clearTimeout(timer); err ? reject(err) : resolve(); }
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
    send({ type: 'transfer-start', transferId, requestId, resource, fileName: fileName || '', parts, size: bytes.length });
    for (let i = 0; i < parts; i++) {
      await throttle();
      send({ type: 'transfer-part', transferId, index: i, data: b64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
    }
    send({ type: 'transfer-end', transferId });
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
