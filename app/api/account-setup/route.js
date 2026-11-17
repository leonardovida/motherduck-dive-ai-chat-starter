import { z } from 'zod';
import { accountsAvailable, sharedAdminAccounts } from '../../../lib/auth.mjs';
import { createSetupStore } from '../../../lib/account-setup.mjs';
import { sameOrigin, sessionCookieHeader } from '../../../lib/security.mjs';
import { DEMO_READ_ONLY, publicDemo } from '../../../lib/public-demo.mjs';
import { audit } from '../../../lib/audit.mjs';
import { NO_STORE, failure, badBody } from '../../../lib/admin-api.mjs';
import { readJsonBody } from '../../../lib/request-body.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const unavailable = () => (!accountsAvailable() ? failure('accounts_not_configured', 404) : publicDemo() ? failure(DEMO_READ_ONLY, 403) : null);

// Who a setup link is for, so the page can greet them. Says nothing about unknown links.
export async function POST(request) {
  const refused = unavailable();
  if (refused) return refused;
  if (!sameOrigin(request)) return failure('origin_not_allowed', 403);
  let body;
  try { body = z.object({ token: z.string().max(64), password: z.string().max(256).optional() }).parse(await readJsonBody(request, 4096)); } catch (error) { return badBody(error, 'invalid_setup'); }
  const store = createSetupStore();
  try {
    if (body.password === undefined) {
      const person = await store.peek(body.token);
      return person ? Response.json({ username: person.username, name: person.name }, { headers: NO_STORE }) : failure('setup_link_invalid', 404);
    }
    if (body.password.length < 12) return failure('password_too_short', 400);
    const person = await store.redeem(body.token, body.password);
    if (!person) return failure('setup_link_invalid', 404);
    await audit({ id: person.userId, username: person.username }, 'person.password_chosen');
    // SHARED_PASSWORD_ADMIN: the browser that chose this password is about to sign in as the person
    // (src/App.jsx), so an administrator's shared-password sign-in in it ends here.
    return Response.json({ username: person.username }, { headers: { ...NO_STORE, ...(sharedAdminAccounts() ? { 'Set-Cookie': sessionCookieHeader('', 0) } : {}) } });
  } catch (error) {
    console.error('account_setup_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
