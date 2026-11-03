import { appQuery } from './app-db.mjs';
import { listDives } from './dives.mjs';
import { applyGroups, createGroupStore, diveIdentity, MOTHERDUCK_USER, SERVICE_ACCOUNT } from './groups.mjs';
import { viewerFromUser } from './viewer.mjs';
import { MotherDuckError, SHARE_URL, motherDuckAdmin, quoteIdent, quoteLiteral, redact } from './motherduck-admin.mjs';

// Mirrors Dive access in the app onto MotherDuck share grants.
//
//   person with a MotherDuck username  -> GRANT READ ON SHARE ... TO USER <their username>
//   group with a service account       -> the same grant to the service account, then ATTACH the
//                                         share as that account so chat can query it by alias
//
// The sync only removes what it added: a grant that already existed, or a share that was open to
// the whole organization, is recorded and left alone when access is later taken away.
export const SYNCED = 'synced', PENDING = 'pending', FAILED = 'failed';

const FAILURES = {
  admin_not_configured: 'Set MOTHERDUCK_ADMIN_TOKEN to sync automatically, or run the SQL shown in the admin portal.',
  share_not_owned: 'The account behind MOTHERDUCK_ADMIN_TOKEN does not own this share. Use the share owner\'s token.',
  motherduck_unreachable: 'MotherDuck could not be reached. The next sync retries.',
  sql_failed: 'MotherDuck refused the change.',
  http_401: 'MOTHERDUCK_ADMIN_TOKEN was refused. Check that it is an Admin\'s current token.',
  http_403: 'MOTHERDUCK_ADMIN_TOKEN is not allowed to do this. It needs the Admin role.',
  http_404: 'The service account does not exist in this organization. Create it from the group.',
};
export const describeFailure = error => {
  const code = error instanceof MotherDuckError ? error.code : 'sql_failed';
  const reason = FAILURES[code] ?? FAILURES.sql_failed;
  return error?.detail ? `${reason} (${error.detail})` : reason;
};

// Everyone's wanted grants, from the app's own records. Pure, so it can be tested and previewed.
export function desiredGrants({ users, groups, memberships, dives }) {
  const want = new Map();
  const groupById = new Map(groups.map(group => [group.id, group]));
  const add = (grantee, kind, resources) => {
    for (const { url, alias } of resources) {
      if (!SHARE_URL.test(url ?? '')) continue; // owned databases (md:<name>) cannot be granted
      const key = `${grantee}\n${url}`;
      if (!want.has(key)) want.set(key, { grantee, kind, url, alias });
    }
  };
  const resourcesFor = (diveKeys, viewer) => dives.filter(dive => diveKeys === '*' || diveKeys.includes(dive.key)).flatMap(dive => diveIdentity(dive, viewer).resources);
  // A data group's service account gets its Dives even before anyone joins, so the first
  // member does not wait for a sync.
  for (const group of groups) {
    if (group.serviceAccount && SERVICE_ACCOUNT.test(group.serviceAccount)) {
      add(group.serviceAccount, 'service_account', resourcesFor(group.dives, { dataGroup: group }));
    }
  }
  for (const user of users) {
    const own = viewerFromUser(user);
    if (!own) continue; // disabled people keep nothing
    const viewer = applyGroups(own, memberships.filter(item => item.userId === user.id).map(item => ({ ...groupById.get(item.groupId), manager: item.manager })).filter(group => group.id));
    if (viewer.dataGroup) add(viewer.dataGroup.serviceAccount, 'service_account', resourcesFor(viewer.dives, viewer));
    else if (viewer.motherduckUser && MOTHERDUCK_USER.test(viewer.motherduckUser)) add(viewer.motherduckUser, 'user', resourcesFor(viewer.dives, viewer));
  }
  return [...want.values()];
}

// What to change, given the wanted grants and the rows recorded by earlier syncs.
export function planSync(desired, recorded) {
  const key = item => `${item.grantee}\n${item.url ?? item.share_url}`;
  const have = new Map(recorded.map(row => [key(row), row]));
  const wanted = new Set(desired.map(key));
  return {
    grant: desired.filter(item => have.get(key(item))?.state !== SYNCED || have.get(key(item))?.alias !== item.alias),
    revoke: recorded.filter(row => !wanted.has(key(row))),
    unchanged: desired.filter(item => have.get(key(item))?.state === SYNCED && have.get(key(item))?.alias === item.alias).length,
  };
}

// The same plan as SQL, for organizations that keep the admin token out of the app.
export function manualSql(plan) {
  const lines = ['-- Run as the owner of these shares, for example in the MotherDuck UI.', '-- Find a share\'s name with: SELECT name, url FROM MD_INFORMATION_SCHEMA.OWNED_SHARES;'];
  for (const item of plan.grant) {
    lines.push('', `-- ${item.grantee} (${item.kind === 'service_account' ? 'service account' : 'MotherDuck user'}) needs ${item.url}`);
    lines.push(`GRANT READ ON SHARE <name of ${item.url}> TO USER ${quoteIdent(item.grantee)};`);
    if (item.kind === 'service_account') lines.push(`-- Then, signed in as ${item.grantee}: ATTACH IF NOT EXISTS ${quoteLiteral(item.url)} AS ${quoteIdent(item.alias)};`);
  }
  for (const row of plan.revoke.filter(row => row.granted_by_app)) {
    lines.push('', `-- ${row.grantee} no longer needs ${row.share_url}`, `REVOKE READ ON SHARE ${row.share_name ? quoteIdent(row.share_name) : `<name of ${row.share_url}>`} FROM USER ${quoteIdent(row.grantee)};`);
  }
  return plan.grant.length || plan.revoke.some(row => row.granted_by_app) ? lines.join('\n') : '';
}

export function createGrantStore(query = appQuery) {
  return {
    list: () => query('SELECT grantee, grantee_kind, share_url, alias, share_name, state, granted_by_app, attached_by_app, detail, updated_at FROM md_access_grant ORDER BY grantee, share_url'),
    async save(row) {
      await query('DELETE FROM md_access_grant WHERE grantee = $1 AND share_url = $2', [row.grantee, row.share_url]);
      await query('INSERT INTO md_access_grant (grantee, grantee_kind, share_url, alias, share_name, state, granted_by_app, attached_by_app, detail, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [row.grantee, row.grantee_kind, row.share_url, row.alias ?? null, row.share_name ?? null, row.state, Boolean(row.granted_by_app), Boolean(row.attached_by_app), row.detail ?? null, new Date()]);
    },
    remove: (grantee, url) => query('DELETE FROM md_access_grant WHERE grantee = $1 AND share_url = $2', [grantee, url]),
  };
}

async function loadState(query) {
  const groupStore = createGroupStore(query);
  const [users, groups, memberships] = await Promise.all([
    query('SELECT id, name, username, "displayUsername", role, banned, "diveAccess", "chatAccess", "motherduckUser" FROM "user"'),
    groupStore.list(), groupStore.memberships(),
  ]);
  return { users, groups, memberships };
}

// Applies the plan. Each grant is recorded as it completes, so a failure halfway leaves an
// accurate record and the next sync picks up where this one stopped.
export async function applyPlan(plan, { md, grants, previous = new Map() }) {
  const results = { synced: 0, failed: 0, revoked: 0 };
  const shares = new Map();
  const shareFor = async (owner, url) => {
    if (!shares.has(url)) {
      const [row] = await owner(`SELECT name, access FROM MD_INFORMATION_SCHEMA.OWNED_SHARES WHERE url = ${quoteLiteral(url)}`);
      shares.set(url, row ?? null);
    }
    const share = shares.get(url);
    if (!share) throw new MotherDuckError('share_not_owned');
    return share;
  };
  await md.asOwner(async owner => {
    for (const item of plan.grant) {
      const before = previous.get(`${item.grantee}\n${item.url}`);
      const row = { grantee: item.grantee, grantee_kind: item.kind, share_url: item.url, alias: item.alias, granted_by_app: Boolean(before?.granted_by_app), attached_by_app: Boolean(before?.attached_by_app) };
      try {
        const share = await shareFor(owner, item.url);
        row.share_name = share.name;
        if (String(share.access).toUpperCase() === 'RESTRICTED' && !row.granted_by_app) {
          const existing = await owner(`SHOW GRANTS ON SHARE ${quoteIdent(share.name)}`);
          const already = existing.some(grant => String(grant.grantee_name) === item.grantee && String(grant.grantee_type ?? 'user').toLowerCase() === 'user');
          if (!already) { await owner(`GRANT READ ON SHARE ${quoteIdent(share.name)} TO USER ${quoteIdent(item.grantee)}`); row.granted_by_app = true; }
        }
        if (item.kind === 'service_account') {
          if (before?.attached_by_app && before.alias && before.alias !== item.alias) await md.asServiceAccount(item.grantee, run => run(`DETACH DATABASE IF EXISTS ${quoteIdent(before.alias)}`));
          await md.asServiceAccount(item.grantee, run => run(`ATTACH IF NOT EXISTS ${quoteLiteral(item.url)} AS ${quoteIdent(item.alias)}`));
          row.attached_by_app = true;
        }
        await grants.save({ ...row, state: SYNCED, detail: null });
        results.synced += 1;
      } catch (error) {
        await grants.save({ ...row, state: FAILED, detail: describeFailure(error) });
        results.failed += 1;
      }
    }
    for (const row of plan.revoke) {
      try {
        if (row.attached_by_app && row.alias) await md.asServiceAccount(row.grantee, run => run(`DETACH DATABASE IF EXISTS ${quoteIdent(row.alias)}`));
        if (row.granted_by_app) {
          const share = row.share_name ? { name: row.share_name } : await shareFor(owner, row.share_url);
          await owner(`REVOKE READ ON SHARE ${quoteIdent(share.name)} FROM USER ${quoteIdent(row.grantee)}`);
        }
        await grants.remove(row.grantee, row.share_url);
        results.revoked += 1;
      } catch (error) {
        await grants.save({ ...row, state: FAILED, detail: `Could not remove access. ${describeFailure(error)}` });
        results.failed += 1;
      }
    }
  });
  return results;
}

// One sync at a time per server instance; a request during a run waits for a fresh run after it.
let running = null, again = false;
export async function syncAccess({ query = appQuery, env = process.env, md = motherDuckAdmin(env), dives = listDives(env) } = {}) {
  const grants = createGrantStore(query);
  const state = await loadState(query);
  const recorded = await grants.list();
  const plan = planSync(desiredGrants({ ...state, dives }), recorded);
  if (!md.configured()) {
    // Without the admin token, record what is outstanding so the portal can show it and the SQL.
    for (const item of plan.grant) await grants.save({ grantee: item.grantee, grantee_kind: item.kind, share_url: item.url, alias: item.alias, state: PENDING, granted_by_app: false, attached_by_app: false, detail: FAILURES.admin_not_configured });
    for (const row of plan.revoke.filter(row => !row.granted_by_app && !row.attached_by_app)) await grants.remove(row.grantee, row.share_url);
    return { mode: 'manual', pending: plan.grant.length, unchanged: plan.unchanged, sql: manualSql(plan) };
  }
  if (!plan.grant.length && !plan.revoke.length) return { mode: 'automatic', synced: 0, failed: 0, revoked: 0, unchanged: plan.unchanged };
  const previous = new Map(recorded.map(row => [`${row.grantee}\n${row.share_url}`, row]));
  try {
    return { mode: 'automatic', unchanged: plan.unchanged, ...await applyPlan(plan, { md, grants, previous }) };
  } catch (error) {
    // The owner connection itself failed (for example a revoked admin token): say so on every
    // outstanding grant instead of leaving the portal showing stale states.
    const detail = describeFailure(error);
    for (const item of plan.grant) {
      const before = previous.get(`${item.grantee}\n${item.url}`);
      await grants.save({ grantee: item.grantee, grantee_kind: item.kind, share_url: item.url, alias: item.alias, share_name: before?.share_name, state: FAILED, granted_by_app: Boolean(before?.granted_by_app), attached_by_app: Boolean(before?.attached_by_app), detail });
    }
    return { mode: 'automatic', synced: 0, failed: plan.grant.length + plan.revoke.length, revoked: 0, unchanged: plan.unchanged, error: detail };
  }
}

export function requestSync(options) {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      let result;
      do { again = false; result = await syncAccess(options); } while (again);
      return result;
    } catch (error) {
      console.error('access_sync_failed', error?.code ?? error?.name ?? 'error', redact(error?.message));
      return { mode: 'error' };
    } finally { running = null; }
  })();
  return running;
}

// Runs the sync after the response is sent where the platform supports it (Next.js after()).
export async function scheduleSync() {
  try {
    const { after } = await import('next/server');
    after(() => requestSync());
  } catch { void requestSync(); }
}

// What the admin portal shows: totals, every recorded grant, and the SQL for manual mode.
export async function syncStatus({ query = appQuery, env = process.env, dives = listDives(env), md = motherDuckAdmin(env) } = {}) {
  const grants = createGrantStore(query);
  const [state, recorded] = await Promise.all([loadState(query), grants.list()]);
  const plan = planSync(desiredGrants({ ...state, dives }), recorded);
  const count = value => recorded.filter(row => row.state === value).length;
  return {
    mode: md.configured() ? 'automatic' : 'manual',
    totals: { synced: count(SYNCED), pending: count(PENDING) + plan.grant.filter(item => !recorded.some(row => row.grantee === item.grantee && row.share_url === item.url)).length, failed: count(FAILED), toRemove: plan.revoke.length },
    grants: recorded.map(row => ({ grantee: row.grantee, kind: row.grantee_kind, url: row.share_url, alias: row.alias, share: row.share_name, state: row.state, grantedByApp: Boolean(row.granted_by_app), attachedByApp: Boolean(row.attached_by_app), detail: row.detail, updatedAt: row.updated_at })),
    sql: md.configured() ? '' : manualSql(plan),
  };
}
