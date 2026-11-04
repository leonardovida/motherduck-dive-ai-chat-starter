import { sameOrigin, sanitizeState } from '../../../lib/security.mjs';
import { PayloadTooLarge, readJsonBody } from '../../../lib/request-body.mjs';
import { NO_STORE, failure } from '../../../lib/admin-api.mjs';
import { canSeeDive, getViewer } from '../../../lib/viewer.mjs';
import { getDive } from '../../../lib/dives.mjs';
import { diveIdentity } from '../../../lib/groups.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Creates a short-lived MotherDuck embed session for one configured Dive. The browser
// names a Dive key only; service-account credentials and share URLs stay on the server.
// GET takes the Dive and theme from the query; POST also carries the Dive state to start from,
// so it must come from this site.
async function embedSession(request, { post }) {
  const viewer = await getViewer(request.headers, process.env, undefined, { fresh: true });
  if (!viewer) return failure('authentication_required', 401);
  let body = {};
  if (post) {
    if (!sameOrigin(request)) return failure('origin_not_allowed', 403);
    try { body = await readJsonBody(request, 16384); }
    catch (error) { return error instanceof PayloadTooLarge ? failure('request_too_large', 413) : failure('invalid_body', 400); }
  }
  const query = new URL(request.url).searchParams;
  const dive = getDive(String(body?.dive || query.get('dive') || ''));
  if (!dive || !canSeeDive(viewer, dive.key)) return failure('invalid_dive', 400);
  const theme = body?.theme || query.get('theme') || 'light';
  if (!['dark', 'light'].includes(theme)) return failure('invalid_theme', 400);
  if (!dive.connected) return Response.json({ error: 'embedding_not_configured', missing: dive.missing }, { status: 503, headers: NO_STORE });
  // A data group's members see the Dive as the group's service account, against its databases.
  const identity = diveIdentity(dive, viewer);
  try {
    const upstream = await fetch(`https://api.motherduck.com/v1/dives/${dive.id}/embed-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MOTHERDUCK_EMBED_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: identity.username,
        ...(dive.version ? { version: dive.version } : {}),
        session_name: `embedded-dive-chat-${dive.key}`,
        required_resources: identity.resources,
        initial_state: { ...sanitizeState(body?.state), app_theme: theme, app_embedded: true },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) {
      console.error('embed_session_failed', { dive: dive.key, status: upstream.status, group: Boolean(identity.serviceAccount) });
      return failure('embed_unavailable', 502);
    }
    const result = await upstream.json();
    if (typeof result.session !== 'string' || !result.session) return failure('embed_unavailable', 502);
    // The current REST contract exposes only `session`; use its documented 24h
    // lifetime unless a future response supplies an explicit bounded expiry.
    const expiresIn = Number(result.expires_in);
    return Response.json({ session: result.session, expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 86400) : 86400 }, { headers: NO_STORE });
  } catch (error) {
    console.error('embed_session_failed', { dive: dive.key, reason: error?.name === 'TimeoutError' ? 'timeout' : 'connection' });
    return failure('embed_unavailable', 502);
  }
}

export const GET = request => embedSession(request, { post: false });
export const POST = request => embedSession(request, { post: true });
