import { z } from 'zod';
import { accountsEnabled } from '../../../lib/auth.mjs';
import { createSetupStore } from '../../../lib/account-setup.mjs';
import { sameOrigin } from '../../../lib/security.mjs';
import { DEMO_READ_ONLY, publicDemo } from '../../../lib/public-demo.mjs';
import { audit } from '../../../lib/audit.mjs';
import { NO_STORE, failure } from '../../../lib/admin-api.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const unavailable = () => (!accountsEnabled() ? failure('accounts_not_configured', 404) : publicDemo() ? failure(DEMO_READ_ONLY, 403) : null);

// Who a setup link is for, so the page can greet them. Says nothing about unknown links.
export async function POST(request) {
  const refused = unavailable();
  if (refused) return refused;
  if (!sameOrigin(request)) return failure('origin_not_allowed', 403);
  let body;
  try { body = z.object({ token: z.string().max(64), password: z.string().max(256).optional() }).parse(await request.json()); } catch { return failure('invalid_setup', 400); }
  const store = createSetupStore();
  try {
    if (body.password === undefined) {
      const person = await store.peek(body.token);
      return person ? Response.json({ username: person.username, name: person.name }, { headers: NO_STORE }) : failure('setup_link_invalid', 404);
    }
    if (body.password.length < 12) return failure('password_too_short', 400);
    const person = await store.redeem(body.token, body.password);
    if (person) await audit({ id: person.userId, username: person.username }, 'person.password_chosen');
    return person ? Response.json({ username: person.username }, { headers: NO_STORE }) : failure('setup_link_invalid', 404);
  } catch (error) {
    console.error('account_setup_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
