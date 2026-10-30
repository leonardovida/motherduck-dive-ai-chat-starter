import { z } from 'zod';
import { NO_STORE, failure, requireAdmin } from '../../../../../../lib/admin-api.mjs';
import { appQuery } from '../../../../../../lib/app-db.mjs';
import { listDives } from '../../../../../../lib/dives.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const accessSchema = z.object({ dives: z.union([z.literal('*'), z.array(z.string().max(40)).max(100)]), chat: z.boolean() });

// Which Dives a person may open and whether they may use chat. Sign-in and roles stay with
// Better Auth's admin endpoints; this stores the two access fields on the same user row.
export async function PATCH(request, { params }) {
  const { response } = await requireAdmin(request, { write: true });
  if (response) return response;
  let body;
  try { body = accessSchema.parse(await request.json()); } catch { return failure('invalid_access', 400); }
  const known = new Set(listDives().map(dive => dive.key));
  const dives = body.dives === '*' ? '*' : [...new Set(body.dives.filter(key => known.has(key)))].join(',');
  try {
    const rows = await appQuery('UPDATE "user" SET "diveAccess" = $1, "chatAccess" = $2, "updatedAt" = $3 WHERE id = $4 RETURNING id', [dives, body.chat, new Date(), (await params).id.slice(0, 64)]);
    if (!rows.length) return failure('not_found', 404);
    // Signed session cookies refresh within a minute, so the change applies on the next lookups.
    return Response.json({ access: { dives: dives === '*' ? '*' : dives.split(',').filter(Boolean), chat: body.chat } }, { headers: NO_STORE });
  } catch (error) {
    console.error('access_update_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
