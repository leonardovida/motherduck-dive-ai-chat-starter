import { z } from 'zod';
import { NO_STORE, failure, requirePeopleManager } from '../../../../lib/admin-api.mjs';
import { createPeopleService, MAX_IMPORT } from '../../../../lib/people.mjs';
import { listDives, publicDive } from '../../../../lib/dives.mjs';
import { scheduleSync } from '../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const person = z.object({ username: z.string().max(40), name: z.string().max(120).optional(), email: z.string().max(254).optional(), password: z.string().max(256).optional(), motherduckUser: z.string().max(128).optional() });
const createSchema = z.object({
  people: z.array(person).min(1).max(MAX_IMPORT),
  role: z.enum(['user', 'admin']).optional(),
  access: z.object({ dives: z.union([z.literal('*'), z.array(z.string().max(40)).max(100)]), chat: z.boolean() }).optional(),
  groupId: z.string().max(64).optional(),
  manager: z.boolean().optional(),
});

// Everyone the caller may manage, with group memberships. Managers see their groups only.
export async function GET(request) {
  const { response, scope, viewer } = await requirePeopleManager(request);
  if (response) return response;
  try {
    const result = await createPeopleService().list(scope);
    // Administrators grant any configured Dive, not only the ones they can open themselves.
    const dives = listDives().map(dive => { const { key, title, connected } = publicDive(dive); return { key, title, connected }; });
    return Response.json({ ...result, dives, scope: scope.all ? 'admin' : 'manager', me: viewer.id }, { headers: NO_STORE });
  } catch (error) {
    console.error('people_list_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

// Adds one person or a pasted list. Rows without a password get a one-time setup link.
export async function POST(request) {
  const { response, scope, viewer } = await requirePeopleManager(request, { write: true });
  if (response) return response;
  let body;
  try { body = createSchema.parse(await request.json()); } catch { return failure('invalid_people', 400); }
  if (body.access && body.access.dives !== '*') {
    const known = new Set(listDives().map(dive => dive.key));
    body.access = { ...body.access, dives: body.access.dives.filter(key => known.has(key)) };
  }
  try {
    const results = await createPeopleService().create(body, { scope, viewer, origin: new URL(request.url).origin });
    if (results.some(result => result.id)) await scheduleSync();
    return Response.json({ results }, { headers: NO_STORE });
  } catch (error) {
    if (error.status) return failure(error.message, error.status);
    console.error('people_create_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
