import { authenticated, send } from '../lib/security.mjs';
import { listDives, publicDive } from '../lib/dives.mjs';
import { DEFAULT_APP_TITLE } from '../src/lib/app-meta.mjs';

export default function handler(request, response) {
  if (!authenticated(request)) return send(response, 401, { error: 'authentication_required' });
  if (request.method !== 'GET') return send(response, 405, { error: 'method_not_allowed' });
  return send(response, 200, { appTitle: String(process.env.APP_TITLE || DEFAULT_APP_TITLE).slice(0, 80), dives: listDives().map(dive => publicDive(dive)) });
}
