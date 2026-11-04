// Where embedded Dives run. Messages from any other origin, or another window, are ignored.
export const EMBED_ORIGIN = 'https://embed-motherduck.com';
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
const MIME = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  parquet: 'application/vnd.apache.parquet',
};
// Plain file names only: no paths, no leading dot, extension must match the format.
const FILENAME = /^[A-Za-z0-9][\w .-]{0,150}\.(csv|xlsx|json|parquet)$/;

export function fromDiveFrame(event, frameWindow) {
  return Boolean(frameWindow) && event.source === frameWindow && event.origin === EMBED_ORIGIN;
}

// Reads an export message from a Dive frame (check fromDiveFrame first). Returns null for
// anything that is not an export message.
export function receiveDiveExport(message, pending) {
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

