import { send } from '../lib/security.mjs';
import { canSeeDive, getViewer } from '../lib/viewer.mjs';
import { listDives, publicDive } from '../lib/dives.mjs';
import { DEFAULT_APP_TITLE } from '../src/lib/app-meta.mjs';

export default async function handler(request, response) {
  const viewer = await getViewer(request.headers);
  if (!viewer) return send(response, 401, { error: 'authentication_required' });
  if (request.method !== 'GET') return send(response, 405, { error: 'method_not_allowed' });
  // Viewers see only the Dives their account may open; chat is hidden when they lack chat access.
  const dives = listDives().filter(dive => canSeeDive(viewer, dive.key)).map(dive => publicDive(dive)).map(dive => (viewer.chat ? dive : { ...dive, chatEnabled: false, chatDenied: true }));
  return send(response, 200, { appTitle: String(process.env.APP_TITLE || DEFAULT_APP_TITLE).slice(0, 80), dives });
}
