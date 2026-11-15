/* Session-only attachments. File bytes are never sent unless explicitly requested by the peer. */
(function () {
  'use strict';
  const attachments = new Map();
  let clipboardSnapshot = '';
  function id() { return Array.from(crypto.getRandomValues(new Uint8Array(12))).map(n => n.toString(16).padStart(2, '0')).join(''); }
  function humanSize(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }
  function add(files) {
    let count = 0;
    for (const file of Array.from(files || [])) {
      if (!(file instanceof Blob)) continue;
      const actual = file instanceof File ? file : new File([file], 'Anhang-' + (count + 1), { type: file.type });
      attachments.set(id(), actual); count++;
    }
    if (count) window.dispatchEvent(new Event('lb:files-changed'));
    return count;
  }
  function remove(fileId) { if (attachments.delete(fileId)) window.dispatchEvent(new Event('lb:files-changed')); }
  function list() { return Array.from(attachments.entries()).map(([fileId, file]) => ({ id: fileId, name: file.name, size: file.size, type: file.type || 'application/octet-stream', modified: file.lastModified || null })); }
  function get(fileId) { return attachments.get(fileId) || null; }
  function setClipboard(text) { clipboardSnapshot = String(text || ''); window.dispatchEvent(new Event('lb:clipboard-changed')); }
  function getClipboard() { return clipboardSnapshot; }
  function download(data, name, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  window.LocalBridgeFiles = { add, remove, list, get, humanSize, setClipboard, getClipboard, download };
}());
