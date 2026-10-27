// Send narrative context only. Tool results remain in the UI, never in the next request.
const encoder = new TextEncoder();
const encodedSize = value => encoder.encode(JSON.stringify(value)).byteLength;

export function prepareChatHistory(messages) {
  const kept = [];
  let remaining = 48000;
  for (const message of [...messages].reverse()) {
    if (kept.length === 16 || remaining === 0) break;
    if (!['user', 'assistant'].includes(message.role)) continue;
    let text = (message.parts || []).filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text).join('').slice(0, 12000);
    // Quotes/control characters expand in JSON. Budget the serialized form as well.
    if (encodedSize(text) > remaining) {
      let low = 0, high = text.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (encodedSize(text.slice(0, middle)) <= remaining) low = middle;
        else high = middle - 1;
      }
      text = text.slice(0, low);
    }
    if (!text) continue;
    kept.push({ id: String(message.id || `history-${kept.length}`).slice(0, 200), role: message.role, parts: [{ type: 'text', text }] });
    remaining -= encodedSize(text);
  }
  return kept.reverse();
}
