import { NO_STORE, failure } from '../../../lib/admin-api.mjs';
import { canSeeDive, getViewer } from '../../../lib/viewer.mjs';
import { listDives, publicDive } from '../../../lib/dives.mjs';
import { DEFAULT_APP_TITLE } from '../../../src/lib/app-meta.mjs';
import { demoDives, publicDemo } from '../../../lib/public-demo.mjs';
import { diveIdentity } from '../../../lib/groups.mjs';
import { adminConfigured } from '../../../lib/motherduck-admin.mjs';
import { refreshModelSettings } from '../../../lib/model-settings.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  const viewer = await getViewer(request.headers);
  if (!viewer) return failure('authentication_required', 401);
  // Whether chat is on can depend on providers chosen in the admin Models tab.
  await refreshModelSettings();
  // Viewers see only the Dives their account may open; chat is hidden when they lack chat access.
  const configured = publicDemo() ? demoDives(listDives()) : listDives();
  // A data group's members can chat only where the group's service account can read the chat
  // database and the app can mint its short-lived token.
  const groupChat = dive => !viewer.dataGroup || (Boolean(diveIdentity(dive, viewer).chat) && adminConfigured());
  const dives = configured.filter(dive => canSeeDive(viewer, dive.key))
    .map(dive => ({ ...publicDive(dive), ...(groupChat(dive) ? {} : { chatEnabled: false }) }))
    .map(dive => (viewer.chat ? dive : { ...dive, chatEnabled: false, chatDenied: true }));
  return Response.json({ appTitle: String(process.env.APP_TITLE || DEFAULT_APP_TITLE).slice(0, 80), dives }, { headers: NO_STORE });
}
