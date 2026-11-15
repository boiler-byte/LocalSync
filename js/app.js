/* LocalSync v6 UI. Classic script without ES modules. */
(function () {
  'use strict';
  const S = window.LocalBridgeStorage, F = window.LocalBridgeFiles, P = window.LocalBridgePeer;
  const el = id => document.getElementById(id);
  const encoder = new TextEncoder();
  const ACTIVITY_KEY = 'localsync:v3:action-history';
  const ACTION_LABELS = {
    download: 'Download (dieses Gerät)', import: 'Import (von Gegenstelle)',
    upload: 'Upload (dieses Gerät)', remove: 'Entfernen (dieses Gerät)',
    'remote-download': 'Download (von Gegenstelle)', add: 'Datei hinzugefügt'
  };
  const compareText = (a, b) => String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
  function readActivity() {
    const result = Object.create(null);
    try {
      const parsed = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, entry] of Object.entries(parsed)) {
          if (entry && Number.isSafeInteger(entry.count) && entry.count > 0 && Number.isFinite(entry.at)) {
            result[id] = { count: entry.count, at: entry.at, order: Number.isSafeInteger(entry.order) ? entry.order : 0 };
          }
        }
      }
    } catch (_) { /* Action history can be disabled in restricted/private contexts. */ }
    return result;
  }
  const state = {
    filter: 'all', search: '', entries: {}, databases: [], fileRows: [],
    remoteInfo: { permissions: {}, files: [], localStorage: [], indexedDB: [] },
    pending: new Map(), uploadTarget: null, refreshNumber: 0, focusBeforeDialog: null,
    sort: { key: null, direction: null }, activity: readActivity(), activityOrder: 0, knownFiles: new Map(),
    content: null, contentSequence: 0
  };
  state.activityOrder = Object.values(state.activity).reduce((max, entry) => Math.max(max, entry.order || 0), 0);
  function recordActions(changes) {
    if (!changes.length) return;
    const time = Date.now();
    for (const { type, key, action } of changes) {
      if (!Object.hasOwn(ACTION_LABELS, action)) continue;
      const id = JSON.stringify([type, key, action]);
      const previous = state.activity[id];
      state.activity[id] = { count: Math.min(Number.MAX_SAFE_INTEGER, (previous?.count || 0) + 1), at: time, order: ++state.activityOrder };
    }
    try {
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(state.activity));
      // The metadata key belongs to the same origin, so keep the localStorage table accurate.
      state.entries[ACTIVITY_KEY] = localStorage.getItem(ACTIVITY_KEY);
    } catch (_) {
      toast('Aktionshistorie nur im Arbeitsspeicher: localStorage nicht beschreibbar.', true);
    }
    renderStorage();
  }
  function recordAction(type, key, action) { recordActions([{ type, key, action }]); }
  function lastAction(row) {
    let last = null;
    for (const action of Object.keys(ACTION_LABELS)) {
      const item = state.activity[JSON.stringify([row.type, row.key, action])];
      if (item && (!last || item.at > last.at || (item.at === last.at && item.order > last.order))) last = { ...item, action };
    }
    return last;
  }
  function availableActions(row) {
    const remoteReady = P.isOpen() && !!row.remote;
    if (row.type === 'file') return [
      ['remove', 'Entfernen (dieses Gerät)', !row.local],
      ['remote-download', 'Download (von Gegenstelle)', !remoteReady]
    ];
    return [
      ['download', 'Download (dieses Gerät)', !row.local],
      ['import', 'Import (von Gegenstelle)', !remoteReady],
      ['upload', 'Upload (dieses Gerät)', false],
      ['remove', 'Entfernen (dieses Gerät)', !row.local]
    ];
  }
  function compareMissingNumber(a, b, direction) {
    // Unknown or missing values are always shown last, for both directions.
    const validA = Number.isFinite(a), validB = Number.isFinite(b);
    if (!validA && !validB) return 0;
    if (!validA) return 1;
    if (!validB) return -1;
    return (a - b) * direction;
  }
  function sortedRows(rows) {
    const { key, direction } = state.sort;
    if (!key || !direction) return rows;
    const factor = direction === 'asc' ? 1 : -1;
    return rows.map((row, index) => ({ row, index })).sort((a, b) => {
      const x = a.row, y = b.row;
      let result = 0;
      if (key === 'type' || key === 'key') result = compareText(x[key], y[key]) * factor;
      else if (key === 'local' || key === 'remote') result = compareMissingNumber(x[key]?.size, y[key]?.size, factor);
      else if (key === 'activity') result = compareMissingNumber(lastAction(x)?.at, lastAction(y)?.at, factor);
      else if (key === 'action') result = (availableActions(x).filter(item => !item[2]).length - availableActions(y).filter(item => !item[2]).length) * factor;
      return result || a.index - b.index;
    }).map(item => item.row);
  }
  function updateSortHeaders() {
    for (const button of document.querySelectorAll('[data-sort]')) {
      const chosen = button.dataset.sort === state.sort.key;
      const direction = chosen ? state.sort.direction : null;
      button.closest('th').setAttribute('aria-sort', direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none');
      button.querySelector('.sort-indicator').textContent = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕';
      button.title = direction === 'asc' ? 'Absteigend sortieren' : direction === 'desc' ? 'Sortierung aufheben' : 'Aufsteigend sortieren';
    }
  }
  const safeText = (value, length = 28000) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return (text || '').length > length ? text.slice(0, length) + '\n… (Vorschau gekürzt)' : (text || '');
  };
  function toast(message, error = false) {
    const node = document.createElement('div'); node.className = 'toast' + (error ? ' error' : ''); node.textContent = message;
    el('toasts').append(node); setTimeout(() => node.remove(), 5500);
  }
  const fail = error => toast(error instanceof Error ? error.message : String(error), true);
  async function run(action) { try { return await action(); } catch (error) { fail(error); } }
  function button(text, style, callback) {
    const item = document.createElement('button'); item.type = 'button'; item.className = style; item.textContent = text;
    item.addEventListener('click', callback); return item;
  }
  function confirmDialog(title, message, modePicker = false) {
    return new Promise(resolve => {
      el('confirm-title').textContent = title; el('confirm-message').textContent = message;
      el('confirm-okay').textContent = modePicker ? 'Ersetzen' : 'Fortfahren';
      el('confirm-merge').classList.toggle('hidden', !modePicker);
      el('confirm-modal').classList.remove('hidden'); el('confirm-cancel').focus();
      const finish = result => {
        el('confirm-modal').classList.add('hidden');
        el('confirm-okay').removeEventListener('click', okay);
        el('confirm-cancel').removeEventListener('click', cancel);
        el('confirm-merge').removeEventListener('click', merge);
        resolve(result);
      };
      const okay = () => finish(modePicker ? 'replace' : true);
      const cancel = () => finish(null);
      const merge = () => finish('merge');
      el('confirm-okay').addEventListener('click', okay);
      el('confirm-cancel').addEventListener('click', cancel);
      el('confirm-merge').addEventListener('click', merge);
    });
  }
  const importMode = kind => confirmDialog(kind + ' lokal importieren', 'Merge fügt Einträge hinzu oder überschreibt bestehende Records. Ersetzen löscht den vorhandenen Inhalt der betroffenen Datenbank bzw. des gesamten localStorage. Die Gegenstelle bleibt unverändert.', true);
  function bytes(value) { return encoder.encode(String(value)).byteLength; }
  function showTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'Zeitpunkt unbekannt';
    return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function meta(item) {
    if (!item) return null;
    if (!Number.isFinite(item.size) || item.size < 0) return { size: 'Größe n/v', time: 'Zeitpunkt unbekannt' };
    return { size: F.humanSize(item.size), time: showTime(item.modified) };
  }
  function makeRows() {
    const rows = [], info = state.remoteInfo, online = P.isOpen();
    const remoteLocal = online && info.permissions.localStorage ? info.localStorage || [] : [];
    const remoteIDB = online && info.permissions.indexedDB ? info.indexedDB || [] : [];
    const locals = new Map(), dbs = new Map();
    for (const [key, value] of Object.entries(state.entries)) locals.set(key, { size: bytes(value) });
    for (const entry of remoteLocal) if (entry && typeof entry.key === 'string' && !locals.has(entry.key)) locals.set(entry.key, null);
    for (const key of [...locals.keys()].sort((a, b) => a.localeCompare(b, 'de'))) {
      const remote = remoteLocal.find(item => item.key === key);
      rows.push({ type: 'localStorage', key, local: locals.get(key), remote });
    }
    for (const db of state.databases) dbs.set(db.name, { size: db.size });
    for (const db of remoteIDB) if (db && typeof db.name === 'string' && !dbs.has(db.name)) dbs.set(db.name, null);
    for (const key of [...dbs.keys()].sort((a, b) => a.localeCompare(b, 'de'))) {
      const remote = remoteIDB.find(db => db.name === key);
      rows.push({ type: 'indexedDB', key, local: dbs.get(key), remote });
    }
    const remoteFiles = online ? [...(info.files || [])] : [];
    const consumed = new Set();
    for (const item of F.list()) {
      const ix = remoteFiles.findIndex((r, i) => !consumed.has(i) && r.name === item.name);
      if (ix >= 0) consumed.add(ix);
      rows.push({ type: 'file', key: item.name, local: item, remote: ix >= 0 ? remoteFiles[ix] : null });
    }
    remoteFiles.forEach((item, i) => { if (!consumed.has(i)) rows.push({ type: 'file', key: item.name, local: null, remote: item }); });
    return rows;
  }
  function cellMeta(value, available, emptyText) {
    const cell = document.createElement('td'), info = meta(value);
    if (info) {
      const strong = document.createElement('strong'); strong.className = 'metric-size'; strong.textContent = info.size;
      const small = document.createElement('small'); small.className = 'metric-time'; small.textContent = info.time;
      cell.append(strong, small);
    } else {
      const blank = document.createElement('span'); blank.className = 'muted-cell';
      blank.textContent = available ? '—' : (emptyText || '—'); cell.append(blank);
    }
    return cell;
  }
  // A history entry belongs to each opened viewer. Browser-Back removes it and closes the dialog.
  // Closing via Escape/X also consumes that entry, so the next Back is a real page navigation.
  const CONTENT_HISTORY_KEY = '__localsyncContentViewer';
  const PREVIEW_CHAR_LIMIT = 350000;
  function contentIsCurrent(view) { return state.content === view && el('content-dialog').open; }
  function releaseContentUrl(view) {
    if (view?.objectUrl) { URL.revokeObjectURL(view.objectUrl); view.objectUrl = null; }
  }
  function closeContentDialog(fromHistory = false) {
    const view = state.content;
    if (!view) return;
    state.content = null;
    releaseContentUrl(view);
    if (el('content-dialog').open) el('content-dialog').close();
    // Avoid history.back() when a different navigation has already occurred.
    if (!fromHistory && history.state?.[CONTENT_HISTORY_KEY] === view.token) history.back();
  }
  function contentMessage(message, error = false) {
    const root = el('content-preview'); root.replaceChildren();
    const text = document.createElement('p'); text.className = 'content-placeholder' + (error ? ' content-error' : ''); text.textContent = message;
    root.append(text);
  }
  function contentText(value, kind) {
    const root = el('content-preview'); root.replaceChildren();
    const pre = document.createElement('pre'); pre.className = 'content-code';
    let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (typeof text !== 'string') text = String(value);
    const shortened = text.length > PREVIEW_CHAR_LIMIT;
    pre.textContent = shortened ? text.slice(0, PREVIEW_CHAR_LIMIT) + '\n\n… (Vorschau gekürzt; vollständige Daten können heruntergeladen werden)' : text;
    if (kind) { const tag = document.createElement('span'); tag.className = 'content-format-tag'; tag.textContent = kind; root.append(tag); }
    root.append(pre);
  }
  function prettyStorageValue(value) {
    // JSON is formatted for readability but never modified in localStorage.
    try { return { value: JSON.parse(value), label: 'JSON · formatiert' }; }
    catch (_) { return { value, label: 'Text · Original' }; }
  }
  async function contentFile(blob, name, view, serial = view.loadSequence) {
    if (!contentIsCurrent(view) || view.loadSequence !== serial) return;
    releaseContentUrl(view);
    const mime = (blob.type || '').toLowerCase().split(';')[0];
    const root = el('content-preview'); root.replaceChildren();
    el('content-summary').textContent = name + ' · ' + F.humanSize(blob.size) + ' · ' + (mime || 'unbekannter Dateityp');
    if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime)) {
      view.objectUrl = URL.createObjectURL(blob);
      const img = document.createElement('img'); img.className = 'content-image'; img.alt = 'Bildvorschau: ' + name; img.src = view.objectUrl;
      root.append(img);
    } else if (mime.startsWith('text/') || /^(application\/(json|xml|javascript|x-javascript|ld\+json)|image\/svg\+xml)$/.test(mime)
      || /\.(txt|json|md|csv|log|xml|html?|css|jsx?)$/i.test(name)) {
      const text = await blob.slice(0, 2_000_000).text();
      if (!contentIsCurrent(view) || view.loadSequence !== serial) return;
      contentText(text, 'Textansicht' + (blob.size > 2_000_000 ? ' · erste 2 MB' : ''));
    } else if (/^audio\//.test(mime) || /^video\//.test(mime)) {
      view.objectUrl = URL.createObjectURL(blob);
      const player = document.createElement(mime.startsWith('audio/') ? 'audio' : 'video');
      player.controls = true; player.preload = 'metadata'; player.src = view.objectUrl; player.className = 'content-media';
      root.append(player);
    } else if (mime === 'application/pdf') {
      view.objectUrl = URL.createObjectURL(blob);
      const frame = document.createElement('iframe'); frame.className = 'content-pdf'; frame.title = 'PDF-Vorschau: ' + name;
      frame.setAttribute('sandbox', ''); frame.src = view.objectUrl;
      root.append(frame);
    } else contentMessage('Für diesen binären Dateityp gibt es keine direkte Vorschau. Der Inhalt kann über die Download-Aktion gespeichert werden.');
  }
  function sourceButtons(view) {
    const row = view.row, local = el('content-source-local'), remote = el('content-source-remote');
    el('content-source-row').classList.toggle('hidden', !(row.local && row.remote && P.isOpen()));
    for (const [button, source] of [[local, 'local'], [remote, 'remote']]) {
      const active = view.source === source;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  async function loadContent(view, source) {
    if (!contentIsCurrent(view)) return;
    const row = view.row;
    view.source = source;
    ++view.loadSequence;
    const serial = view.loadSequence;
    releaseContentUrl(view);
    sourceButtons(view);
    el('content-summary').textContent = (source === 'local' ? 'Dieses Gerät' : 'Gegenstelle') + ' · Daten werden geladen …';
    contentMessage('Lade Inhalt …');
    try {
      if (source === 'remote') {
        if (!P.isOpen() || !row.remote) throw Error('Die Gegenstelle ist nicht mehr verfügbar.');
        const options = row.type === 'file' ? { preview: true, mime: row.remote.type || '' } : undefined;
        const requestId = P.request(row.type, row.type === 'file' ? row.remote.id : undefined, options);
        state.pending.set(requestId, { type: row.type, key: row.key, mode: 'content-preview', view, serial });
        return;
      }
      if (!row.local) throw Error('Auf diesem Gerät ist der Eintrag nicht vorhanden.');
      if (row.type === 'localStorage') {
        const value = localStorage.getItem(row.key);
        if (value === null) throw Error('Der Schlüssel wurde inzwischen entfernt.');
        const result = prettyStorageValue(value);
        if (!contentIsCurrent(view) || view.loadSequence !== serial) return;
        el('content-summary').textContent = 'Dieses Gerät · ' + F.humanSize(bytes(value));
        contentText(result.value, result.label);
      } else if (row.type === 'indexedDB') {
        const snapshot = await S.idbSnapshot([row.key]);
        if (!contentIsCurrent(view) || view.loadSequence !== serial) return;
        const database = snapshot.databases.find(item => item.name === row.key);
        if (!database) throw Error('Die Datenbank wurde inzwischen entfernt.');
        const records = database.stores.reduce((sum, store) => sum + store.records.length, 0);
        el('content-summary').textContent = 'Dieses Gerät · ' + database.stores.length + ' Stores · ' + records + ' Records';
        contentText(database, 'IndexedDB · JSON-Vorschau');
      } else if (row.type === 'file') {
        const file = F.get(row.local.id);
        if (!file) throw Error('Die Datei wurde inzwischen entfernt.');
        await contentFile(file, row.key, view);
      }
    } catch (error) {
      if (contentIsCurrent(view) && view.loadSequence === serial) contentMessage(error.message || String(error), true);
    }
  }
  function openContentDialog(row) {
    if (!row.local && !(row.remote && P.isOpen())) return;
    if (state.content) closeContentDialog();
    const dialog = el('content-dialog');
    const view = { row, token: Date.now() + '-' + (++state.contentSequence), source: row.local ? 'local' : 'remote', loadSequence: 0, objectUrl: null };
    state.content = view;
    const names = { localStorage: 'localStorage', indexedDB: 'IndexedDB', file: 'Dateitransfer' };
    el('content-title').textContent = row.key;
    el('content-description').textContent = names[row.type] + ' · nur lesen, ohne Speicherung auf der Gegenstelle';
    try {
      // Preserve room/query URL and any unrelated application history properties.
      const old = history.state && typeof history.state === 'object' ? history.state : {};
      history.pushState({ ...old, [CONTENT_HISTORY_KEY]: view.token }, '', location.href);
    } catch (_) { /* file:// and restrictive contexts may disallow pushState. Escape remains usable. */ }
    dialog.showModal();
    el('content-close').focus();
    run(() => loadContent(view, view.source));
  }
  function setupContentDialog() {
    const dialog = el('content-dialog');
    el('content-close').addEventListener('click', () => closeContentDialog());
    el('content-done').addEventListener('click', () => closeContentDialog());
    el('content-source-local').addEventListener('click', () => { if (state.content?.row.local) run(() => loadContent(state.content, 'local')); });
    el('content-source-remote').addEventListener('click', () => { if (state.content?.row.remote) run(() => loadContent(state.content, 'remote')); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeContentDialog(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const { left, right, top, bottom } = dialog.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) closeContentDialog();
    });
    window.addEventListener('popstate', () => {
      if (state.content && history.state?.[CONTENT_HISTORY_KEY] !== state.content.token) closeContentDialog(true);
    });
  }
  async function onContentReceived(pending, detail) {
    const { view, serial, key } = pending;
    if (!contentIsCurrent(view) || serial !== view.loadSequence || view.source !== 'remote') return;
    if (pending.type === 'file') {
      if (!detail.preview || !(detail.fileBlob instanceof Blob)) throw Error('Keine Dateivorschau empfangen.');
      await contentFile(detail.fileBlob, detail.fileName || key, view);
    } else if (pending.type === 'localStorage') {
      const entries = detail.data?.entries || {};
      if (!Object.prototype.hasOwnProperty.call(entries, key)) throw Error('Der Schlüssel wurde auf der Gegenstelle entfernt.');
      const result = prettyStorageValue(String(entries[key]));
      el('content-summary').textContent = 'Gegenstelle · ' + F.humanSize(bytes(entries[key]));
      contentText(result.value, result.label);
    } else if (pending.type === 'indexedDB') {
      const database = (detail.data?.databases || []).find(item => item.name === key);
      if (!database) throw Error('Die Datenbank wurde auf der Gegenstelle entfernt.');
      const records = database.stores.reduce((sum, store) => sum + store.records.length, 0);
      el('content-summary').textContent = 'Gegenstelle · ' + database.stores.length + ' Stores · ' + records + ' Records';
      contentText(database, 'IndexedDB · JSON-Vorschau');
    }
  }
  function renderStorage() {
    const rows = makeRows(), body = el('storage-body'); body.replaceChildren();
    const counts = { all: rows.length, localStorage: 0, indexedDB: 0, file: 0 };
    for (const item of rows) counts[item.type]++;
    for (const [name, id] of [['all', 'count-all'], ['localStorage', 'count-local'], ['indexedDB', 'count-idb'], ['file', 'count-files']]) el(id).textContent = String(counts[name]);
    const visible = sortedRows(rows.filter(r => (state.filter === 'all' || r.type === state.filter) && r.key.toLocaleLowerCase('de').includes(state.search)));
    el('table-count').textContent = visible.length + (visible.length === 1 ? ' EINTRAG' : ' EINTRÄGE');
    if (!visible.length) {
      const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 6; td.className = 'empty-cell';
      td.textContent = rows.length ? 'Keine passenden Einträge.' : 'Noch keine Einträge. Füge Dateien hinzu oder importiere JSON-Daten.';
      tr.append(td); body.append(tr); return;
    }
    for (const row of visible) {
      const tr = document.createElement('tr');
      const type = document.createElement('td'), symbol = document.createElement('span');
      const typeLabels = { localStorage: ['▤', 'localStorage', 'cyan'], indexedDB: ['◈', 'IndexedDB', 'purple'], file: ['⇪', 'Datei', 'blue'] };
      const [glyph, label, color] = typeLabels[row.type]; symbol.className = 'type-icon ' + color; symbol.textContent = glyph; symbol.title = label;
      const typeLabel = document.createElement('span'); typeLabel.className = 'type-label'; typeLabel.textContent = label;
      type.append(symbol, typeLabel);
      const keyCell = document.createElement('td');
      if (row.local || (row.remote && P.isOpen())) {
        const name = button(row.key, 'key-button', () => openContentDialog(row));
        name.title = row.local ? 'Inhalt anzeigen' : 'Freigegebenen Inhalt von der Gegenstelle anzeigen';
        name.setAttribute('aria-haspopup', 'dialog'); keyCell.append(name);
      } else { const span = document.createElement('span'); span.className = 'key-plain'; span.textContent = row.key; keyCell.append(span); }
      const local = cellMeta(row.local, true, ''), online = P.isOpen();
      const allowed = row.type === 'file' || !!state.remoteInfo.permissions[row.type];
      const remote = cellMeta(row.remote, online && allowed, !online ? 'Nicht verbunden' : 'Keine Freigabe');
      const activityCell = document.createElement('td');
      const activity = lastAction(row);
      if (activity) {
        const label = document.createElement('strong'); label.className = 'activity-action'; label.textContent = ACTION_LABELS[activity.action];
        const sub = document.createElement('small'); sub.className = 'activity-meta'; sub.textContent = showTime(activity.at) + ' · ';
        const count = document.createElement('span'); count.className = 'activity-count'; count.textContent = '×' + activity.count;
        sub.append(count); activityCell.append(label, sub);
        activityCell.title = Object.entries(ACTION_LABELS).map(([action, text]) => {
          const record = state.activity[JSON.stringify([row.type, row.key, action])];
          return record ? text + ': ' + record.count + '× · ' + showTime(record.at) : null;
        }).filter(Boolean).join('\n');
      } else {
        const blank = document.createElement('span'); blank.className = 'muted-cell'; blank.textContent = 'Noch keine Aktion'; activityCell.append(blank);
      }
      const actionCell = document.createElement('td'); actionCell.className = 'right';
      const select = document.createElement('select'); select.className = 'action-select'; select.setAttribute('aria-label', 'Aktion für ' + row.key);
      const options = [['', 'Aktion wählen', false], ...availableActions(row)];
      for (const [value, labelText, disabled] of options) {
        const option = document.createElement('option'); option.value = value; option.textContent = labelText; option.disabled = disabled;
        select.append(option);
      }
      select.addEventListener('change', () => {
        const action = select.value; select.value = '';
        if (action) run(() => actOnRow(row, action));
      });
      actionCell.append(select); tr.append(type, keyCell, local, remote, activityCell, actionCell); body.append(tr);
    }
  }
  async function actOnRow(row, action) {
    if (row.type === 'file') {
      if (action === 'remove') {
        if (!row.local || !F.get(row.local.id)) throw Error('Datei auf diesem Gerät nicht mehr vorhanden.');
        const confirmed = await confirmDialog('Lokalen Anhang entfernen?', '„' + row.key + '“ wird nur aus der lokalen Anhangsliste entfernt. Der Inhalt auf der Gegenstelle bleibt unverändert.');
        if (!confirmed) return;
        F.remove(row.local.id); // lb:files-changed logs the successful deletion.
        toast('Lokaler Anhang entfernt.');
      } else if (action === 'remote-download') {
        if (!row.remote) throw Error('Datei ist auf der Gegenstelle nicht abrufbar.');
        const id = P.request('file', row.remote.id); // Download only; never attach to this device.
        state.pending.set(id, { type: 'file', key: row.key, action: 'remote-download' });
        toast('Datei-Download von der Gegenstelle gestartet …');
      } else throw Error('Aktion für Dateitransfer nicht erlaubt.');
      return;
    }
    if (!['localStorage', 'indexedDB'].includes(row.type)) throw Error('Unbekannter Datentyp.');
    if (action === 'download') {
      if (!row.local) throw Error('Auf diesem Gerät ist der Eintrag nicht vorhanden.');
      if (row.type === 'localStorage') {
        const all = S.localSnapshot(), entries = {};
        Object.defineProperty(entries, row.key, { value: all.entries[row.key], enumerable: true });
        F.download(JSON.stringify({ ...all, entries }, null, 2), 'localsync-local-' + cleanName(row.key) + '.json');
      } else {
        F.download(JSON.stringify(await S.idbSnapshot([row.key]), null, 2), 'localsync-idb-' + cleanName(row.key) + '.json');
      }
      recordAction(row.type, row.key, 'download');
      toast('Download auf diesem Gerät gestartet.');
    } else if (action === 'import') {
      if (!row.remote) throw Error('Eintrag auf der Gegenstelle nicht abrufbar.');
      const id = P.request(row.type);
      state.pending.set(id, { type: row.type, key: row.key, action: 'import' });
      toast('Abruf von der Gegenstelle gestartet …');
    } else if (action === 'upload') {
      state.uploadTarget = { type: row.type, key: row.key };
      const picker = el('row-upload-picker'); picker.accept = row.type === 'indexedDB' ? '.json,application/json' : '';
      picker.click();
    } else if (action === 'remove') {
      if (!row.local) throw Error('Auf diesem Gerät ist der Eintrag nicht vorhanden.');
      const kind = row.type === 'indexedDB' ? 'IndexedDB-Datenbank' : 'localStorage-Schlüssel';
      const confirmed = await confirmDialog(kind + ' löschen?', '„' + row.key + '“ wird dauerhaft auf DIESEM Gerät entfernt. Die Gegenstelle bleibt unverändert.');
      if (!confirmed) return;
      if (row.type === 'localStorage') {
        localStorage.removeItem(row.key);
        if (row.key === ACTIVITY_KEY) {
          state.activity = Object.create(null); state.activityOrder = 0;
          // Delete the metadata without instantly recreating it.
        } else recordAction(row.type, row.key, 'remove');
      } else {
        await S.deleteDB(row.key);
        recordAction(row.type, row.key, 'remove');
      }
      await refreshAll(); P.sendHello();
      toast(kind + ' lokal entfernt.');
    } else throw Error('Unbekannte Aktion.');
  }
  function cleanName(value) { return String(value).replace(/[^a-z0-9äöüß_.-]+/gi, '_').slice(0, 80) || 'eintrag'; }
  async function refreshAll() {
    const current = ++state.refreshNumber;
    try { state.entries = S.localSnapshot().entries; el('stat-local').textContent = String(Object.keys(state.entries).length); }
    catch (error) { state.entries = {}; fail(error); }
    el('stat-origin').textContent = location.origin === 'null' ? 'file:// (eingeschränkt)' : location.origin;
    renderStorage();
    try {
      const dbs = await S.inspectDBs();
      const summaries = [];
      for (const db of dbs) {
        try {
          const data = await S.idbSnapshot([db.name]);
          summaries.push({ name: db.name, size: bytes(JSON.stringify(data.databases[0] || {})) });
        } catch (error) { summaries.push({ name: db.name, size: NaN }); }
      }
      if (current !== state.refreshNumber) return;
      state.databases = summaries; el('stat-idb').textContent = String(dbs.length);
      renderStorage();
    } catch (error) { if (current === state.refreshNumber) { state.databases = []; el('stat-idb').textContent = 'n/v'; fail(error); renderStorage(); } }
  }
  async function readImport(file, kind) {
    const data = JSON.parse(await file.text());
    const mode = await importMode(kind === 'localStorage' ? 'localStorage' : 'IndexedDB');
    if (!mode) return;
    const count = kind === 'localStorage' ? S.applyLocal(data, mode) : await S.applyIDB(data, mode);
    const names = kind === 'localStorage' ? Object.keys(data.entries || {}) : (data.databases || []).map(db => db.name);
    recordActions(names.map(key => ({ type: kind, key, action: 'upload' })));
    toast(count + ' Einheit(en) lokal importiert (' + mode + ').');
    await refreshAll(); P.sendHello();
  }
  async function readRowUpload(file, target) {
    if (target.type === 'localStorage') {
      const text = await file.text();
      if (Object.prototype.hasOwnProperty.call(state.entries, target.key)) {
        const confirm = await confirmDialog('Schlüssel überschreiben?', 'Der lokale Schlüssel „' + target.key + '“ wird durch den Inhalt der Datei ersetzt.');
        if (!confirm) return;
      }
      localStorage.setItem(target.key, text);
      recordAction(target.type, target.key, 'upload');
      toast('Dateiinhalt unter localStorage-Schlüssel „' + target.key + '“ gespeichert.');
    } else {
      const data = JSON.parse(await file.text());
      if (data.resource !== 'indexedDB' || !Array.isArray(data.databases)) throw Error('Bitte ein IndexedDB-Backup (JSON) auswählen.');
      const only = data.databases.filter(db => db.name === target.key);
      if (only.length !== 1) throw Error('Das Backup enthält keine Datenbank namens „' + target.key + '“.');
      const mode = await importMode('IndexedDB · ' + target.key);
      if (!mode) return;
      await S.applyIDB({ ...data, databases: only }, mode);
      recordAction(target.type, target.key, 'upload');
      toast('IndexedDB „' + target.key + '“ lokal eingelesen.');
    }
    await refreshAll(); P.sendHello();
  }
  function setupStorage() {
    el('refresh-storage').addEventListener('click', () => run(async () => { await refreshAll(); P.sendHello(); }));
    el('add-storage-files').addEventListener('click', () => el('file-picker').click());
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      for (const btn of document.querySelectorAll('[data-filter]')) { const active = btn === b; btn.classList.toggle('active', active); btn.setAttribute('aria-pressed', String(active)); }
      renderStorage();
    }));
    el('table-search').addEventListener('input', e => { state.search = e.target.value.toLocaleLowerCase('de').trim(); renderStorage(); });
    for (const header of document.querySelectorAll('[data-sort]')) header.addEventListener('click', () => {
      const key = header.dataset.sort;
      state.sort = state.sort.key !== key ? { key, direction: 'asc' }
        : state.sort.direction === 'asc' ? { key, direction: 'desc' }
        : { key: null, direction: null };
      updateSortHeaders(); renderStorage();
    });
    updateSortHeaders();
    for (const kind of ['local', 'idb']) {
      const picker = el(kind === 'local' ? 'local-import-picker' : 'idb-import-picker');
      el(kind === 'local' ? 'local-import-btn' : 'idb-import-btn').addEventListener('click', () => picker.click());
      picker.addEventListener('change', () => run(async () => { const file = picker.files[0]; picker.value = ''; if (file) await readImport(file, kind === 'local' ? 'localStorage' : 'indexedDB'); }));
    }
    el('row-upload-picker').addEventListener('change', () => run(async () => {
      const picker = el('row-upload-picker'), file = picker.files[0], target = state.uploadTarget;
      picker.value = ''; state.uploadTarget = null; if (file && target) await readRowUpload(file, target);
    }));
    run(refreshAll);
  }
  function setupFiles() {
    const picker = el('file-picker'), overlay = el('storage-drop-overlay');
    function attachFiles(files, verb = 'hinzugefügt und freigegeben') {
      const count = F.add(files);
      if (count) toast(count + ' Datei(en) ' + verb + '.');
    }
    picker.addEventListener('change', () => {
      if (picker.files.length) attachFiles(picker.files);
      picker.value = '';
    });
    // An overlay appears only for OS file drags, not dragged text or table selections.
    let dragDepth = 0;
    const hasFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
    function hideDrop() { dragDepth = 0; overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true'); }
    document.addEventListener('dragenter', event => {
      if (!hasFileDrag(event)) return;
      event.preventDefault(); dragDepth++;
      overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden', 'false');
    });
    document.addEventListener('dragover', event => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden', 'false');
    });
    document.addEventListener('dragleave', event => {
      if (!hasFileDrag(event)) return;
      if (--dragDepth <= 0 || (event.target === document.documentElement && !event.relatedTarget)) hideDrop();
    });
    document.addEventListener('drop', event => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      hideDrop();
      if (event.dataTransfer?.files?.length) attachFiles(event.dataTransfer.files);
    });
    document.addEventListener('dragend', hideDrop);
    window.addEventListener('blur', hideDrop);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideDrop(); });
    document.addEventListener('paste', e => {
      const focus = document.activeElement;
      if (focus?.matches('input,textarea,[contenteditable="true"]')) return;
      const items = Array.from(e.clipboardData?.items || []);
      const files = items.filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); attachFiles(files, 'angehängt'); return; }
      const text = e.clipboardData?.getData('text/plain');
      if (text) { e.preventDefault(); attachFiles([new File([text], 'zwischenablage.txt', { type: 'text/plain' })], 'angehängt'); }
    });
    state.knownFiles = new Map(F.list().map(item => [item.id, item.name]));
    window.addEventListener('lb:files-changed', () => {
      const currentFiles = new Map(F.list().map(item => [item.id, item.name]));
      const changes = [];
      for (const [id, name] of currentFiles) if (!state.knownFiles.has(id)) changes.push({ type: 'file', key: name, action: 'add' });
      for (const [id, name] of state.knownFiles) if (!currentFiles.has(id)) changes.push({ type: 'file', key: name, action: 'remove' });
      state.knownFiles = currentFiles;
      recordActions(changes);
      renderStorage(); P.sendHello();
    });
    const box = el('clipboard-box');
    box.addEventListener('input', () => F.setClipboard(box.value));
    el('clipboard-read').addEventListener('click', () => run(async () => {
      if (!navigator.clipboard?.readText) throw Error('Clipboard-Lesen braucht HTTPS/localhost und Browserberechtigung.');
      const text = await navigator.clipboard.readText(); box.value = text; F.setClipboard(text); toast('Zwischenablage eingelesen.');
    }));
    el('clipboard-write').addEventListener('click', () => run(async () => {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard-Schreiben braucht HTTPS/localhost.');
      await navigator.clipboard.writeText(box.value); F.setClipboard(box.value); toast('Text in die System-Zwischenablage kopiert.');
    }));
    el('clipboard-clear').addEventListener('click', () => run(async () => {
      box.value = ''; F.setClipboard('');
      if (!navigator.clipboard?.writeText) { toast('App-Text geleert; System-Zwischenablage benötigt HTTPS/localhost.', true); return; }
      try { await navigator.clipboard.writeText(''); toast('Zwischenablage geleert.'); }
      catch (_) { toast('App-Text geleert; System-Zwischenablage nicht freigegeben.', true); }
    }));
    el('remote-clipboard-fetch').addEventListener('click', () => run(async () => {
      const id = P.request('clipboard'); state.pending.set(id, { type: 'clipboard' });
      toast('Zwischenablage der Gegenstelle wird abgerufen …');
    }));
  }
  // Native clipboard modal: Escape, backdrop click and browser Back close the dialog.
  // Its transient history entry uses the same URL; payload stays only in memory.
  const CLIPBOARD_HISTORY_KEY = '__localsyncClipboardDialog';
  let clipboardOpenToken = null;
  let clipboardFocusOrigin = null;
  let clipboardTokenSequence = 0;
  function closeClipboardDialog(fromHistory = false) {
    const dialog = el('clipboard-dialog');
    if (!dialog.open) return;
    const token = clipboardOpenToken;
    clipboardOpenToken = null;
    dialog.close();
    const focusTarget = clipboardFocusOrigin?.isConnected ? clipboardFocusOrigin : el('clipboard-toggle');
    clipboardFocusOrigin = null;
    focusTarget.focus();
    if (!fromHistory && history.state?.[CLIPBOARD_HISTORY_KEY] === token) history.back();
  }
  function openClipboardDialog() {
    const dialog = el('clipboard-dialog');
    if (dialog.open) return;
    clipboardFocusOrigin = document.activeElement;
    clipboardOpenToken = Date.now() + '-' + (++clipboardTokenSequence);
    try {
      const old = history.state && typeof history.state === 'object' ? history.state : {};
      history.pushState({ ...old, [CLIPBOARD_HISTORY_KEY]: clipboardOpenToken }, '', location.href);
    } catch (_) { /* Escape and close button remain usable without History API. */ }
    dialog.showModal();
    el('clipboard-close').focus();
  }
  function setupClipboardDialog() {
    const dialog = el('clipboard-dialog');
    el('clipboard-toggle').addEventListener('click', openClipboardDialog);
    el('clipboard-close').addEventListener('click', () => closeClipboardDialog());
    el('clipboard-done').addEventListener('click', () => closeClipboardDialog());
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeClipboardDialog(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeClipboardDialog();
    });
    window.addEventListener('popstate', () => {
      if (dialog.open && history.state?.[CLIPBOARD_HISTORY_KEY] !== clipboardOpenToken) closeClipboardDialog(true);
    });
  }
  function refreshPermissions() {
    const permissions = { localStorage: el('permit-local').checked, indexedDB: el('permit-idb').checked, clipboard: el('permit-clipboard').checked };
    el('permission-count').textContent = Object.values(permissions).filter(Boolean).length + ' / 3';
    P.setPermissions(permissions);
  }
  function setupPermissions() {
    el('permission-toggle').addEventListener('click', () => {
      const open = el('permissions-menu').classList.toggle('hidden') === false;
      el('permission-toggle').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.permission-wrap')) { el('permissions-menu').classList.add('hidden'); el('permission-toggle').setAttribute('aria-expanded', 'false'); }
    });
    for (const id of ['permit-local', 'permit-idb', 'permit-clipboard']) el(id).addEventListener('change', refreshPermissions);
    refreshPermissions();
  }
  function openPair() {
    state.focusBeforeDialog = document.activeElement;
    el('pair-modal').classList.remove('hidden'); el('connection-toggle').setAttribute('aria-expanded', 'true');
    el('pair-close').focus();
  }
  function closePair() {
    el('pair-modal').classList.add('hidden'); el('connection-toggle').setAttribute('aria-expanded', 'false');
    (state.focusBeforeDialog?.isConnected ? state.focusBeforeDialog : el('connection-toggle')).focus();
  }
  function setupPairDialog() {
    el('connection-toggle').addEventListener('click', openPair);
    el('pair-close').addEventListener('click', closePair);
    el('pair-done').addEventListener('click', closePair);
    el('pair-modal').addEventListener('click', e => { if (e.target === el('pair-modal')) closePair(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (el('content-dialog').open || el('clipboard-dialog').open) return; // Native dialogs handle Escape and history.
        if (!el('confirm-modal').classList.contains('hidden')) { el('confirm-cancel').click(); return; }
        if (!el('pair-modal').classList.contains('hidden')) { closePair(); return; }
        el('permissions-menu').classList.add('hidden'); el('permission-toggle').setAttribute('aria-expanded', 'false');
      }
      if (e.key === 'Tab' && !el('pair-modal').classList.contains('hidden')) {
        const focusables = Array.from(el('pair-modal').querySelectorAll('button:not([disabled]),input:not([disabled])'));
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  // A session is only created after explicit action. Invitation URLs are auto-joined on load.
  let sessionMode = null; // 'create' | 'join' | null
  let bridgeConnectionStatus = 'idle';
  const ROOM_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{10,78}[a-zA-Z0-9]$/;
  // Use the directory where this app is currently served (also when opened as index.html).
  // This preserves installations below /tools/localsync/ instead of linking to the domain root.
  function appDirectoryUrl(base = location.href) {
    return new URL('./', base);
  }
  function invitationUrl(room) {
    const url = appDirectoryUrl();
    url.searchParams.set('room', room);
    return url.href;
  }
  function updateSessionUI() {
    const active = !!sessionMode;
    const created = sessionMode === 'create';
    el('session-output').classList.toggle('hidden', !created);
    el('session-empty').classList.toggle('hidden', created);
    el('disconnect-room').disabled = !active;
    el('active-room').textContent = active ? P.getRoom() : 'Keine Sitzung aktiv';
    el('session-role').textContent = created ? 'Sitzung erstellt' : sessionMode === 'join' ? 'Beigetreten' : '—';
    if (created) el('session-id').value = P.getRoom();
    else { el('session-id').value = ''; el('share-link').value = ''; el('qr-code').replaceChildren(); }
    el('bridge-status').textContent = !active ? 'Nicht verbunden' : P.isOpen() ? 'Verbunden' : bridgeConnectionStatus === 'server-error' ? 'PeerJS-Signaling nicht erreichbar' : bridgeConnectionStatus === 'peer-unavailable' ? 'Sitzung nicht gefunden' : bridgeConnectionStatus === 'starting' ? 'PeerJS-Sitzung wird gestartet …' : bridgeConnectionStatus === 'connecting' ? 'Verbinde mit Gegenstelle …' : bridgeConnectionStatus === 'disconnected' ? 'Verbindung getrennt' : 'Warte auf Gegenstelle';
  }
  function setRoomUrl(room) {
    if (!['http:', 'https:'].includes(location.protocol)) return;
    const url = new URL(location.href);
    if (room) url.searchParams.set('room', room);
    else url.searchParams.delete('room');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  function selectRoom(room, mode) {
    if (!ROOM_PATTERN.test(room)) throw Error('Ungültige Session-ID. Erwartet werden 12–80 Zeichen (Buchstaben, Zahlen, - oder _; Anfang/Ende alphanumerisch).');
    sessionMode = mode;
    setRoomUrl(room);
    P.start(room, mode);
    updateSessionUI();
    if (mode === 'create') makeLink();
  }
  function makeLink() {
    if (sessionMode !== 'create') return;
    const link = invitationUrl(P.getRoom());
    el('share-link').value = link;
    const qr = el('qr-code'); qr.replaceChildren();
    if (window.LocalBridgeQR) window.LocalBridgeQR.render(qr, link, 194);
    el('network-note').textContent = /^(localhost|127\.0\.0\.1)$/.test(new URL(link).hostname)
      ? 'Dieser Link enthält localhost und ist nur auf diesem Gerät erreichbar. Auf dem ersten Gerät LocalSync über eine im Netzwerk erreichbare Adresse öffnen.'
      : 'PeerJS Cloud vermittelt den Verbindungsaufbau; Nutzdaten fließen über WebRTC. Zwischenablage und PWA benötigen normalerweise HTTPS.';
  }
  async function copyValue(value, target, message) {
    if (!value) throw Error('Zuerst eine Sitzung erstellen.');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else { target.select(); if (!document.execCommand('copy')) throw Error('Bitte den Wert manuell kopieren.'); }
    toast(message);
  }
  function parseJoinInput(value) {
    const text = value.trim();
    if (ROOM_PATTERN.test(text)) return { room: text, url: null };
    let url;
    try { url = new URL(text); } catch (_) { throw Error('Bitte eine gültige Session-ID oder einen Einladungslink eingeben.'); }
    const room = url.searchParams.get('room');
    // Accept nested paths, but only canonical app entry points (directory or index.html).
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !(/\/$/.test(url.pathname) || /\/index\.html$/i.test(url.pathname)) || !room || !ROOM_PATTERN.test(room)) {
      throw Error('Ungültiger Einladungslink. Er muss eine gültige Session-ID als ?room= enthalten.');
    }
    return { room, url };
  }
  function joinSession(event) {
    event.preventDefault();
    const errorBox = el('join-error');
    errorBox.textContent = ''; errorBox.classList.add('hidden'); el('join-input').removeAttribute('aria-invalid');
    try {
      const target = parseJoinInput(el('join-input').value);
      // Open a foreign invitation at its actual URL so the intended app is loaded. For invitations from a
      // different path (even same origin), navigate to that deployment.
      if (target.url && (target.url.origin !== location.origin ||
          appDirectoryUrl(target.url.href).pathname !== appDirectoryUrl().pathname)) {
        const destination = appDirectoryUrl(target.url.href);
        destination.searchParams.set('room', target.room);
        location.assign(destination.href);
        return;
      }
      selectRoom(target.room, 'join');
      toast('Sitzung beigetreten. Warte auf die Gegenstelle.');
    } catch (error) {
      errorBox.textContent = error.message; errorBox.classList.remove('hidden');
      el('join-input').setAttribute('aria-invalid', 'true');
      el('join-input').focus();
    }
  }
  // Screen Wake Lock works only on supported secure contexts and while the page is visible.
  // It cannot prevent every operating-system suspension or browser background restriction.
  let wakeSentinel = null, wakeRequestPending = false, wakeEpoch = 0, wakeConnected = false;
  function wakeIndicator(text, active = false) {
    const badge = el('wake-status');
    badge.classList.toggle('hidden', !wakeConnected);
    badge.classList.toggle('active', active);
    badge.classList.toggle('unavailable', !active);
    el('wake-status-text').textContent = text;
    badge.title = active ? 'Wake Lock ist aktiv – Bildschirm bleibt nach Möglichkeit eingeschaltet.'
      : 'Wake Lock ist nicht aktiv; die Verbindung kann bei gesperrtem Bildschirm abbrechen.';
  }
  async function requestWakeLock() {
    if (!wakeConnected || document.visibilityState !== 'visible' || wakeSentinel || wakeRequestPending) return;
    if (typeof navigator.wakeLock?.request !== 'function') {
      wakeIndicator('Wachhaltung nicht verfügbar'); return;
    }
    wakeRequestPending = true;
    const epoch = wakeEpoch;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (epoch !== wakeEpoch || !wakeConnected || document.visibilityState !== 'visible') {
        await lock.release(); return;
      }
      wakeSentinel = lock;
      lock.addEventListener('release', () => {
        if (wakeSentinel === lock) {
          wakeSentinel = null;
          if (wakeConnected) wakeIndicator('Bildschirmsperre möglich');
        }
      });
      wakeIndicator('Bildschirm aktiv', true);
    } catch (_) {
      if (epoch === wakeEpoch && wakeConnected) wakeIndicator('Wachhaltung nicht verfügbar');
    } finally {
      wakeRequestPending = false;
      if (wakeConnected && epoch !== wakeEpoch) void requestWakeLock();
    }
  }
  function setConnectionWakeLock(online) {
    if (wakeConnected === online) return;
    wakeConnected = online;
    wakeEpoch++;
    if (!online) {
      const old = wakeSentinel;
      wakeSentinel = null;
      if (old) void old.release().catch(() => {});
      wakeIndicator('');
    } else {
      wakeIndicator('Aktivierung …');
      void requestWakeLock();
    }
  }
  function setupWakeLock() {
    document.addEventListener('visibilitychange', () => {
      if (!wakeConnected) return;
      if (document.visibilityState === 'visible') void requestWakeLock();
      else if (!wakeSentinel) wakeIndicator('Bildschirmsperre möglich');
    });
    window.addEventListener('pagehide', () => setConnectionWakeLock(false));
  }
  function updateConnection(status) {
    bridgeConnectionStatus = status;
    const online = status === 'connected';
    setConnectionWakeLock(online);
    el('status-text').textContent = online ? 'Gerät verbunden' : status === 'server-error' ? 'Signaling nicht erreichbar' : status === 'peer-unavailable' ? 'Sitzung nicht gefunden' : status === 'starting' || status === 'connecting' ? 'Verbindung läuft' : status === 'waiting' ? 'Warte auf Gegenstelle' : 'Nicht verbunden';
    el('bridge-status').textContent = !sessionMode ? 'Nicht verbunden' : online ? 'Verbunden' : status === 'server-error' ? 'PeerJS-Signaling nicht erreichbar' : status === 'peer-unavailable' ? 'Sitzung nicht gefunden' : status === 'starting' ? 'PeerJS-Sitzung wird gestartet …' : status === 'connecting' ? 'Verbinde mit Gegenstelle …' : status === 'disconnected' ? 'Verbindung getrennt' : 'Warte auf Gegenstelle';
    el('status-dot').className = 'status-dot ' + (online ? 'online' : ['waiting', 'starting', 'connecting'].includes(status) ? 'waiting' : '');
    if (!online) { state.remoteInfo = { permissions: {}, files: [], localStorage: [], indexedDB: [] }; state.pending.clear(); }
    updateRemote();
  }
  function updateRemote() {
    el('remote-clipboard-fetch').disabled = !P.isOpen() || !state.remoteInfo.permissions.clipboard;
    renderStorage();
  }
  async function onReceived(detail) {
    const pending = state.pending.get(detail.requestId);
    state.pending.delete(detail.requestId);
    if (!pending) return;
    if (pending.mode === 'content-preview') {
      try { return await onContentReceived(pending, detail); }
      catch (error) {
        if (contentIsCurrent(pending.view) && pending.view.loadSequence === pending.serial)
          contentMessage(error.message || String(error), true);
        return;
      }
    }
    if (detail.resource === 'file') {
      if (detail.attached) toast('Datei der Gegenstelle lokal angehängt: ' + detail.fileName);
      else toast('Datei der Gegenstelle heruntergeladen: ' + detail.fileName);
      recordAction('file', pending.key, pending.action || 'remote-download');
      return;
    }
    if (pending.type === 'clipboard') {
      const text = String(detail.data?.text || '');
      el('clipboard-box').value = text; F.setClipboard(text);
      toast('Zwischenablage-Text der Gegenstelle lokal übernommen. „Text kopieren“ schreibt ihn bei Berechtigung ins System.'); return;
    }
    if (pending.type === 'localStorage') {
      const source = detail.data;
      if (!Object.prototype.hasOwnProperty.call(source?.entries || {}, pending.key)) throw Error('Schlüssel ist auf der Gegenstelle nicht mehr vorhanden.');
      const hasLocal = localStorage.getItem(pending.key) !== null;
      if (hasLocal) {
        const yes = await confirmDialog('Lokalen Schlüssel überschreiben?', '„' + pending.key + '“ wird ausschließlich auf DIESEM Gerät überschrieben.');
        if (!yes) return;
      }
      const entries = {}; Object.defineProperty(entries, pending.key, { value: source.entries[pending.key], enumerable: true });
      S.applyLocal({ ...source, entries }, 'merge');
      recordAction('localStorage', pending.key, 'import');
      toast('localStorage-Schlüssel lokal importiert.');
    } else if (pending.type === 'indexedDB') {
      const source = detail.data, match = (source?.databases || []).filter(db => db.name === pending.key);
      if (match.length !== 1) throw Error('Datenbank ist auf der Gegenstelle nicht mehr vorhanden.');
      const mode = await importMode('IndexedDB · ' + pending.key); if (!mode) return;
      await S.applyIDB({ ...source, databases: match }, mode);
      recordAction('indexedDB', pending.key, 'import');
      toast('IndexedDB „' + pending.key + '“ lokal importiert (' + mode + ').');
    }
    await refreshAll(); P.sendHello();
  }
  function setupBridge() {
    el('new-room').addEventListener('click', () => run(async () => {
      selectRoom(P.newRoom(), 'create');
      el('join-input').value = '';
      el('join-error').classList.add('hidden');
      toast('Neue Sitzung erstellt. Teile ID, QR-Code oder Einladungslink.');
    }));
    el('join-form').addEventListener('submit', joinSession);
    el('join-input').addEventListener('input', () => {
      el('join-error').classList.add('hidden'); el('join-input').removeAttribute('aria-invalid');
    });
    el('copy-session-id').addEventListener('click', () => run(() => copyValue(el('session-id').value, el('session-id'), 'Session-ID kopiert.')));
    el('copy-link').addEventListener('click', () => run(() => copyValue(el('share-link').value, el('share-link'), 'Einladungslink kopiert.')));
    el('disconnect-room').addEventListener('click', () => {
      P.stop(); sessionMode = null; setRoomUrl(null); updateSessionUI(); updateConnection('idle');
      el('join-input').value = ''; toast('Sitzung beendet.');
    });
    const invited = new URL(location.href).searchParams.get('room');
    if (invited) {
      if (ROOM_PATTERN.test(invited)) {
        el('join-input').value = invited;
        selectRoom(invited, 'join');
      } else {
        setRoomUrl(null);
        toast('Der Einladungslink enthält eine ungültige Session-ID.', true);
      }
    }
    updateSessionUI();
    window.addEventListener('lb:connection', e => updateConnection(e.detail.status));
    window.addEventListener('lb:peer-info', e => { state.remoteInfo = e.detail; updateRemote(); });
    window.addEventListener('lb:peer-error', e => fail(e.detail));
    window.addEventListener('lb:request-error', e => {
      const pending = state.pending.get(e.detail.requestId);
      state.pending.delete(e.detail.requestId);
      if (pending?.mode === 'content-preview' && contentIsCurrent(pending.view)) contentMessage(e.detail.reason, true);
    });
    window.addEventListener('lb:received', e => run(() => onReceived(e.detail)));
    updateConnection(sessionMode ? 'waiting' : 'idle');
  }
  function setupPWA() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext || !['http:', 'https:'].includes(location.protocol)) return;
    const register = () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(error => {
      console.warn('LocalSync: Service Worker konnte nicht registriert werden:', error);
    });
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', register, { once: true });
  }
  function init() {
    setupWakeLock(); setupPairDialog(); setupContentDialog(); setupClipboardDialog(); setupPermissions(); setupStorage(); setupFiles(); setupBridge(); setupPWA();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
