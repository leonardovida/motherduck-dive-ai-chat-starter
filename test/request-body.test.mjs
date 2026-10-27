import test from 'node:test';
import assert from 'node:assert/strict';
import { PayloadTooLarge, readRequestText } from '../lib/request-body.mjs';

test('chunked request size is bounded before JSON parsing and cancels the source', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(10)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readRequestText({ headers: new Headers(), body }, 16), PayloadTooLarge);
  assert.equal(cancelled, true);
});

test('a valid small request survives split UTF-8 chunks', async () => {
  const bytes = new TextEncoder().encode('{"text":"café"}');
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 13)); controller.enqueue(bytes.slice(13)); controller.close();
  } });
  assert.equal(await readRequestText({ headers: new Headers(), body }, 32), '{"text":"café"}');
});
