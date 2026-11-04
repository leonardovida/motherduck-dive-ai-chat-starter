import { z } from 'zod';
import { budgets } from '../../../../lib/budgets.mjs';
import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { createPeopleService, MAX_IMPORT } from '../../../../lib/people.mjs';
import { listDives, publicDive } from '../../../../lib/dives.mjs';
import { adminConfigured } from '../../../../lib/motherduck-admin.mjs';
import { diveIdentity } from '../../../../lib/groups.mjs';
import { scheduleSync } from '../../../../lib/access-sync.mjs';
import { audit } from '../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Adding up to 200 people creates each account in turn.
export const maxDuration = 300;

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
  const { response, scope, viewer } = await requireAdmin(request, { managers: true });
  if (response) return response;
  try {
    const result = await createPeopleService().list(scope);
    // Administrators grant any configured Dive, not only the ones they can open themselves.
    const configured = listDives();
    const dives = configured.map(dive => { const { key, title, connected } = publicDive(dive); return { key, title, connected }; });
    // Whether chat really works for a group's members: a group with a service account needs
    // the admin token to mint its chat tokens, and the Dive's chat database among its own.
    const chatReady = group => group.chat && (!group.serviceAccount || (adminConfigured() && configured.some(dive => (group.dives === '*' || group.dives.includes(dive.key)) && diveIdentity(dive, { dataGroup: group }).chat)));
    // Tokens each group used this month, for groups with a monthly allowance.
    let usage = new Map();
    if (result.groups.some(group => group.monthlyTokenCap)) {
      try { usage = await budgets().usage({ fresh: true }); } catch (error) { console.error('budget_usage_failed', error?.code ?? error?.name); }
    }
    result.groups = result.groups.map(group => ({ ...group, chatReady: chatReady(group), ...(group.monthlyTokenCap ? { tokensThisMonth: usage.get(group.id) ?? 0 } : {}) }));
    return Response.json({ ...result, dives, scope: scope.all ? 'admin' : 'manager', me: viewer.id, maxImport: MAX_IMPORT, mdAutomatic: adminConfigured() }, { headers: NO_STORE });
  } catch (error) {
    console.error('people_list_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

// Adds one person or a pasted list. Rows without a password get a one-time setup link.
export async function POST(request) {
  const { response, scope, viewer } = await requireAdmin(request, { write: true, managers: true });
  if (response) return response;
  let body;
  try { body = createSchema.parse(await request.json()); } catch { return failure('invalid_people', 400); }
  if (body.access && body.access.dives !== '*') {
    const known = new Set(listDives().map(dive => dive.key));
    body.access = { ...body.access, dives: body.access.dives.filter(key => known.has(key)) };
  }
  try {
    const results = await createPeopleService().create(body, { scope, viewer, origin: new URL(request.url).origin });
    for (const result of results.filter(item => item.id)) await audit(viewer, 'person.created', { id: result.id, label: result.username }, { group: body.groupId ?? null, role: scope.all ? body.role ?? 'user' : 'user', setupLink: Boolean(result.setupUrl) });
    if (results.some(result => result.id)) await scheduleSync();
    return Response.json({ results }, { headers: NO_STORE });
  } catch (error) {
    if (error.status) return failure(error.message, error.status);
    console.error('people_create_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
