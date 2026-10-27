import { authenticated, readBody, sameOrigin, sanitizeState, send } from '../lib/security.mjs';
import { getDive } from '../lib/dives.mjs';

// Creates a short-lived MotherDuck embed session for one configured Dive. The browser
// names a Dive key only; the Dive id, service account and shares stay on the server.
export default async function handler(request, response) {
  if (!authenticated(request)) return send(response, 401, { error: 'authentication_required' });
  if (!['GET', 'POST'].includes(request.method)) return send(response, 405, { error: 'method_not_allowed' });
  let body = {};
  if (request.method === 'POST') {
    if (!sameOrigin(request)) return send(response, 403, { error: 'origin_not_allowed' });
    try { body = await readBody(request); } catch { return send(response, 400, { error: 'invalid_body' }); }
  }
  const query = new URL(request.url, 'https://placeholder.invalid').searchParams;
  const dive = getDive(String(body?.dive || query.get('dive') || ''));
  if (!dive) return send(response, 400, { error: 'invalid_dive' });
  const theme = body?.theme || query.get('theme') || 'light';
  if (!['dark', 'light'].includes(theme)) return send(response, 400, { error: 'invalid_theme' });
  if (!dive.connected) return send(response, 503, { error: 'embedding_not_configured', missing: dive.missing });
  try {
    const upstream = await fetch(`https://api.motherduck.com/v1/dives/${dive.id}/embed-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MOTHERDUCK_EMBED_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: dive.username,
        ...(dive.version ? { version: dive.version } : {}),
        session_hint: `embedded-dive-chat-${dive.key}`,
        required_resources: dive.resources,
        initial_state: { ...sanitizeState(body?.state), app_theme: theme, app_embedded: true },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) {
      console.error('embed_session_failed', { dive: dive.key, status: upstream.status });
      return send(response, 502, { error: 'embed_unavailable' });
    }
    const result = await upstream.json();
    if (typeof result.session !== 'string' || !result.session) return send(response, 502, { error: 'embed_unavailable' });
    return send(response, 200, { session: result.session, expires_in: 86400 });
  } catch (error) {
    console.error('embed_session_failed', { dive: dive.key, reason: error?.name === 'TimeoutError' ? 'timeout' : 'connection' });
    return send(response, 502, { error: 'embed_unavailable' });
  }
}
