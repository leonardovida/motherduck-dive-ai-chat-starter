import { PayloadTooLarge, readRequestText } from '../../lib/request-body.mjs';

export async function runLegacyHandler(handler, request) {
  const headers = Object.fromEntries(request.headers.entries());
  const legacyRequest = {
    method: request.method,
    url: request.url,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      legacyRequest.body = await readRequestText(request, 16384);
    } catch (error) {
      if (error instanceof PayloadTooLarge) return Response.json({ error: 'request_too_large' }, { status: 413, headers: { 'Cache-Control': 'private, no-store' } });
      // A malformed body is passed through so the legacy parser returns 400.
      legacyRequest.body = "{";
    }
  }

  const state = { headers: {}, body: "" };
  const legacyResponse = {
    statusCode: 200,
    setHeader(name, value) {
      state.headers[name] = value;
    },
    end(body = "") {
      state.body = body;
    },
  };

  await handler(legacyRequest, legacyResponse);
  return new Response(state.body, {
    status: legacyResponse.statusCode,
    headers: state.headers,
  });
}
