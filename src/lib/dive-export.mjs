export const DIVE_ORIGIN = 'https://embed-motherduck.com';
export const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
const MIME = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  parquet: 'application/vnd.apache.parquet',
};
// Plain file names only: no paths, no leading dot, extension must match the format.
const FILENAME = /^[A-Za-z0-9][\w .-]{0,150}\.(csv|xlsx|json|parquet)$/;

export function receiveDiveExport(event, frameWindow, pending) {
  if (!frameWindow || event.source !== frameWindow || event.origin !== DIVE_ORIGIN) return null;
  const message = event.data;
  if (!message || typeof message !== 'object' || !['export-started', 'export-file', 'export-error'].includes(message.type)) return null;
  const { requestId, format, filename } = message;
  if (typeof requestId !== 'string' || requestId.length > 128 || !MIME[format]) return null;
  if (message.type === 'export-started') {
    if (typeof filename !== 'string' || filename.length > 160 || !FILENAME.test(filename) || !filename.endsWith(`.${format}`)) return null;
    if (pending.size >= 8) return null;
    pending.set(requestId, { format, filename });
    return { type: 'started' };
  }
  const started = pending.get(requestId);
  if (!started) return null;
  pending.delete(requestId);
  if (message.type === 'export-error') return { type: 'error' };
  if (started.format !== format || started.filename !== filename ||
      Object.prototype.toString.call(message.data) !== '[object ArrayBuffer]' ||
      message.byteLength !== message.data.byteLength || message.byteLength <= 0 ||
      message.byteLength > MAX_EXPORT_BYTES ||
      typeof message.mimeType !== 'string' || message.mimeType.toLowerCase().split(';')[0] !== MIME[format]) return { type: 'error' };
  // Binary formats must carry their magic bytes: ZIP (PK) for xlsx, PAR1 for parquet.
  const signature = new Uint8Array(message.data, 0, Math.min(4, message.byteLength));
  if (format === 'xlsx' && (signature[0] !== 0x50 || signature[1] !== 0x4b)) return { type: 'error' };
  if (format === 'parquet' && String.fromCharCode(...signature) !== 'PAR1') return { type: 'error' };
  return { type: 'file', filename, mimeType: message.mimeType, data: message.data };
}

// The Dive runtime generates the file. The host delivers those bytes to the browser.
export function downloadDiveExport(file) {
  const url = URL.createObjectURL(new Blob([file.data], { type: file.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
