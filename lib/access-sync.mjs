import { randomUUID } from 'node:crypto';
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
//
// Without MOTHERDUCK_ADMIN_TOKEN the same plan becomes SQL for a share owner to run. Grants the
// app asked for wait as "pending", and removals as "removing", until the owner marks them done.
export const SYNCED = 'synced', PENDING = 'pending', FAILED = 'failed', REMOVING = 'removing';

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
  // A data group's service account gets exactly the group's Dives, even before anyone joins.
  // Every member shares the account, so nothing one member has on their own is added to it.
  for (const group of groups) {
    if (group.serviceAccount && SERVICE_ACCOUNT.test(group.serviceAccount)) {
      add(group.serviceAccount, 'service_account', resourcesFor(group.dives, { dataGroup: group }));
    }
  }
  for (const user of users) {
    const own = viewerFromUser(user);
    if (!own) continue; // disabled people keep nothing
    const viewer = applyGroups(own, memberships.filter(item => item.userId === user.id).map(item => ({ ...groupById.get(item.groupId), manager: item.manager })).filter(group => group.id));
    if (!viewer.dataGroup && viewer.motherduckUser && MOTHERDUCK_USER.test(viewer.motherduckUser)) add(viewer.motherduckUser, 'user', resourcesFor(viewer.dives, viewer));
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
  const removals = plan.revoke.filter(row => row.granted_by_app || row.attached_by_app);
  for (const row of removals) {
    lines.push('', `-- ${row.grantee} no longer needs ${row.share_url}`);
    if (row.attached_by_app && row.alias) lines.push(`-- Signed in as ${row.grantee}: DETACH DATABASE IF EXISTS ${quoteIdent(row.alias)};`);
    if (row.granted_by_app) lines.push(`REVOKE READ ON SHARE ${row.share_name ? quoteIdent(row.share_name) : `<name of ${row.share_url}>`} FROM USER ${quoteIdent(row.grantee)};`);
  }
  return plan.grant.length || removals.length ? lines.join('\n') : '';
}

export function createGrantStore(query = appQuery) {
  return {
    list: () => query('SELECT grantee, grantee_kind, share_url, alias, share_name, state, granted_by_app, attached_by_app, detail, updated_at FROM md_access_grant ORDER BY grantee, share_url'),
    // One statement, so a concurrent reader never sees the row missing.
    save: row => query(`INSERT INTO md_access_grant (grantee, grantee_kind, share_url, alias, share_name, state, granted_by_app, attached_by_app, detail, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (grantee, share_url) DO UPDATE SET grantee_kind = EXCLUDED.grantee_kind, alias = EXCLUDED.alias, share_name = EXCLUDED.share_name, state = EXCLUDED.state, granted_by_app = EXCLUDED.granted_by_app, attached_by_app = EXCLUDED.attached_by_app, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at`,
    [row.grantee, row.grantee_kind, row.share_url, row.alias ?? null, row.share_name ?? null, row.state, Boolean(row.granted_by_app), Boolean(row.attached_by_app), row.detail ?? null, new Date()]),
    remove: (grantee, url) => query('DELETE FROM md_access_grant WHERE grantee = $1 AND share_url = $2', [grantee, url]),
  };
}

// One sync at a time across every server instance, through a lease row in the app database.
// A request that finds the lease taken sets "again", and the holder runs once more before it
// lets go, so no change is lost between instances.
// The lease is shorter than the five-minute function limit, so a run the platform stops cannot
// hold it for long, and each pass of a run renews it.
const LOCK = 'access_sync', LEASE_MS = 4 * 60 * 1000;
const missingLockTable = error => /app_lock/i.test(String(error?.message)) && /(does not exist|not found)/i.test(String(error?.message));
export function createSyncLock(query = appQuery, now = () => new Date()) {
  return {
    async acquire(holder) {
      await query('DELETE FROM app_lock WHERE name = $1 AND expires_at < $2', [LOCK, now()]);
      return (await query('INSERT INTO app_lock (name, holder, again, expires_at) VALUES ($1, $2, false, $3) ON CONFLICT DO NOTHING RETURNING holder', [LOCK, holder, new Date(now().getTime() + LEASE_MS)])).length > 0;
    },
    markAgain: async () => (await query('UPDATE app_lock SET again = true WHERE name = $1 AND expires_at >= $2 RETURNING holder', [LOCK, now()])).length > 0,
    renew: async holder => (await query('UPDATE app_lock SET expires_at = $3 WHERE name = $1 AND holder = $2 RETURNING holder', [LOCK, holder, new Date(now().getTime() + LEASE_MS)])).length > 0,
    takeAgain: async holder => (await query('UPDATE app_lock SET again = false, expires_at = $3 WHERE name = $1 AND holder = $2 AND again RETURNING holder', [LOCK, holder, new Date(now().getTime() + LEASE_MS)])).length > 0,
    // Lets go only when nobody asked for another run; false means run again first.
    release: async holder => (await query('DELETE FROM app_lock WHERE name = $1 AND holder = $2 AND NOT again RETURNING holder', [LOCK, holder])).length > 0,
    abandon: holder => query('DELETE FROM app_lock WHERE name = $1 AND holder = $2', [LOCK, holder]),
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

// Applies the plan. Each change is recorded as it completes, so a failure halfway leaves an
// accurate record and the next sync picks up where this one stopped. Removals run first, so an
// alias that moves to another share is detached before the new share is attached under it.
export async function applyPlan(plan, { md, grants, previous = new Map(), saved = new Set() }) {
  const results = { synced: 0, failed: 0, revoked: 0 };
  const key = (grantee, url) => `${grantee}\n${url}`;
  const record = async row => { await grants.save(row); saved.add(key(row.grantee, row.share_url)); };
  const forget = async (grantee, url) => { await grants.remove(grantee, url); saved.add(key(grantee, url)); };
  const shares = new Map(), granted = new Map();
  const shareFor = async (owner, url) => {
    if (!shares.has(url)) {
      const [row] = await owner(`SELECT name, access FROM MD_INFORMATION_SCHEMA.OWNED_SHARES WHERE url = ${quoteLiteral(url)}`);
      shares.set(url, row ?? null);
    }
    const share = shares.get(url);
    if (!share) throw new MotherDuckError('share_not_owned');
    return share;
  };
  // Who already holds a share, read once per share and kept current as this run changes it.
  const holders = async (owner, name) => {
    if (!granted.has(name)) {
      const rows = await owner(`SHOW GRANTS ON SHARE ${quoteIdent(name)}`);
      granted.set(name, new Set(rows.filter(row => String(row.grantee_type ?? 'user').toLowerCase() === 'user').map(row => String(row.grantee_name).toLowerCase())));
    }
    return granted.get(name);
  };
  await md.asOwner(async owner => {
    for (const row of plan.revoke) {
      try {
        // Detaching is best effort: the REVOKE below is what takes the access away.
        if (row.attached_by_app && row.alias) await md.asServiceAccount(row.grantee, run => run(`DETACH DATABASE IF EXISTS ${quoteIdent(row.alias)}`)).catch(() => {});
        if (row.granted_by_app) {
          const share = row.share_name ? { name: row.share_name } : await shareFor(owner, row.share_url);
          const current = await holders(owner, share.name);
          if (current.has(row.grantee.toLowerCase())) {
            await owner(`REVOKE READ ON SHARE ${quoteIdent(share.name)} FROM USER ${quoteIdent(row.grantee)}`);
            current.delete(row.grantee.toLowerCase());
          }
        }
        await forget(row.grantee, row.share_url);
        results.revoked += 1;
      } catch (error) {
        await record({ ...row, state: FAILED, detail: `Could not remove access. ${describeFailure(error)}` });
        results.failed += 1;
      }
    }
    // Every alias that is about to point at another share is detached before anything is
    // attached, so two aliases can swap shares without one attach landing on the other.
    const moving = new Map();
    for (const item of plan.grant.filter(grant => grant.kind === 'service_account')) {
      const aliases = moving.get(item.grantee) ?? new Set();
      const before = previous.get(key(item.grantee, item.url));
      if (before?.attached_by_app && before.alias && before.alias !== item.alias) aliases.add(before.alias);
      for (const row of previous.values()) if (row.grantee === item.grantee && row.share_url !== item.url && row.attached_by_app && row.alias === item.alias) aliases.add(item.alias);
      if (aliases.size) moving.set(item.grantee, aliases);
    }
    const detached = new Set();
    for (const [grantee, aliases] of moving) {
      await md.asServiceAccount(grantee, async run => { for (const alias of aliases) { await run(`DETACH DATABASE IF EXISTS ${quoteIdent(alias)}`); detached.add(`${grantee}\n${alias}`); } }).catch(() => {});
    }
    for (const item of plan.grant) {
      const before = previous.get(`${item.grantee}\n${item.url}`);
      const row = { grantee: item.grantee, grantee_kind: item.kind, share_url: item.url, alias: item.alias, granted_by_app: Boolean(before?.granted_by_app), attached_by_app: Boolean(before?.attached_by_app) };
      try {
        const share = await shareFor(owner, item.url);
        row.share_name = share.name;
        if (String(share.access).toUpperCase() === 'RESTRICTED') {
          const current = await holders(owner, share.name);
          // A grant someone else made stays theirs; one the app made or asked for stays the app's.
          if (!current.has(item.grantee.toLowerCase())) {
            await owner(`GRANT READ ON SHARE ${quoteIdent(share.name)} TO USER ${quoteIdent(item.grantee)}`);
            current.add(item.grantee.toLowerCase());
            row.granted_by_app = true;
          }
        }
        if (item.kind === 'service_account') {
          row.attached_by_app = await md.asServiceAccount(item.grantee, async run => {
            const kept = before?.attached_by_app && before.alias === item.alias && !detached.has(`${item.grantee}\n${item.alias}`);
            // An alias the account already had is left as it is and never detached later.
            if ((await run(`SELECT database_name FROM duckdb_databases() WHERE database_name = ${quoteLiteral(item.alias)}`)).length) return Boolean(kept);
            await run(`ATTACH IF NOT EXISTS ${quoteLiteral(item.url)} AS ${quoteIdent(item.alias)}`);
            return true;
          });
        }
        await record({ ...row, state: SYNCED, detail: null });
        results.synced += 1;
      } catch (error) {
        await record({ ...row, state: FAILED, detail: describeFailure(error) });
        results.failed += 1;
      }
    }
  });
  return results;
}

export async function syncAccess({ query = appQuery, env = process.env, md = motherDuckAdmin(env), dives = listDives(env) } = {}) {
  const grants = createGrantStore(query);
  const state = await loadState(query);
  const recorded = await grants.list();
  const plan = planSync(desiredGrants({ ...state, dives }), recorded);
  const previous = new Map(recorded.map(row => [`${row.grantee}\n${row.share_url}`, row]));
  if (!md.configured()) {
    // Without the admin token, record what is outstanding so the portal can show it and the SQL.
    // Grants listed in that SQL count as the app's, so taking access away lists their REVOKE.
    for (const item of plan.grant) {
      const before = previous.get(`${item.grantee}\n${item.url}`);
      await grants.save({ grantee: item.grantee, grantee_kind: item.kind, share_url: item.url, alias: item.alias, share_name: before?.share_name, state: PENDING, granted_by_app: true, attached_by_app: item.kind === 'service_account', detail: FAILURES.admin_not_configured });
    }
    for (const row of plan.revoke) {
      if (row.granted_by_app || row.attached_by_app) await grants.save({ ...row, state: REMOVING, detail: FAILURES.admin_not_configured });
      else await grants.remove(row.grantee, row.share_url);
    }
    return { mode: 'manual', pending: plan.grant.length, removing: plan.revoke.filter(row => row.granted_by_app || row.attached_by_app).length, unchanged: plan.unchanged, sql: manualSql(plan) };
  }
  if (!plan.grant.length && !plan.revoke.length) return { mode: 'automatic', synced: 0, failed: 0, revoked: 0, unchanged: plan.unchanged };
  const saved = new Set();
  try {
    return { mode: 'automatic', unchanged: plan.unchanged, ...await applyPlan(plan, { md, grants, previous, saved }) };
  } catch (error) {
    // The owner connection itself failed (for example a revoked admin token): say so on every
    // outstanding grant instead of leaving the portal showing stale states. Rows this run
    // already recorded keep what it recorded.
    const detail = describeFailure(error);
    for (const item of plan.grant.filter(grant => !saved.has(`${grant.grantee}\n${grant.url}`))) {
      const before = previous.get(`${item.grantee}\n${item.url}`);
      await grants.save({ grantee: item.grantee, grantee_kind: item.kind, share_url: item.url, alias: item.alias, share_name: before?.share_name, state: FAILED, granted_by_app: Boolean(before?.granted_by_app), attached_by_app: Boolean(before?.attached_by_app), detail });
    }
    return { mode: 'automatic', synced: 0, failed: plan.grant.length + plan.revoke.length, revoked: 0, unchanged: plan.unchanged, error: detail };
  }
}

// One run per instance at a time, and one across instances through the lease row. A request
// that arrives during a run is folded into one more run after it.
let running = null, again = false;
export function requestSync(options = {}) {
  if (running) { again = true; return running; }
  const lock = options.lock ?? createSyncLock(options.query ?? appQuery);
  const holder = randomUUID();
  running = (async () => {
    let locked = false;
    try {
      try {
        locked = await lock.acquire(holder);
        // Another instance is syncing: ask it to run once more, which picks up this change.
        if (!locked && (await lock.markAgain() || !(locked = await lock.acquire(holder)))) return { mode: 'queued' };
      } catch (error) {
        // Before `npm run db:migrate` adds the lease table, fall back to this instance's guard.
        if (!missingLockTable(error)) throw error;
      }
      let result;
      for (;;) {
        if (locked && !await lock.renew(holder)) { console.error('access_sync_lease_lost'); locked = false; break; }
        again = false;
        result = await syncAccess(options);
        if (again) continue;
        if (!locked || await lock.release(holder)) break;
        if (await lock.takeAgain(holder)) continue;
        // Neither released nor asked to run again: another instance holds the lease now.
        console.error('access_sync_lease_lost'); locked = false; break;
      }
      locked = false;
      return result ?? { mode: 'queued' };
    } catch (error) {
      console.error('access_sync_failed', error?.code ?? error?.name ?? 'error', redact(error?.message));
      return { mode: 'error' };
    } finally {
      if (locked) await lock.abandon(holder).catch(() => {});
      running = null;
    }
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

// Manual mode: the share owner ran the SQL the admin saw. Only the changes in that SQL that are
// still outstanding are settled; anything that changed since stays listed for the next run.
export async function confirmManualSql(seen, { query = appQuery, env = process.env, dives = listDives(env) } = {}) {
  const grants = createGrantStore(query);
  const [state, recorded] = await Promise.all([loadState(query), grants.list()]);
  const plan = planSync(desiredGrants({ ...state, dives }), recorded);
  const shown = new Set(seen.map(item => `${item.grantee}\n${item.url}`));
  const was = new Map(recorded.map(row => [`${row.grantee}\n${row.share_url}`, row]));
  let granted = 0, removed = 0;
  for (const item of plan.grant.filter(grant => shown.has(`${grant.grantee}\n${grant.url}`))) {
    await grants.save({ grantee: item.grantee, grantee_kind: item.kind, share_url: item.url, alias: item.alias, share_name: was.get(`${item.grantee}\n${item.url}`)?.share_name, state: SYNCED, granted_by_app: true, attached_by_app: item.kind === 'service_account', detail: null });
    granted += 1;
  }
  for (const row of plan.revoke.filter(item => shown.has(`${item.grantee}\n${item.share_url}`))) { await grants.remove(row.grantee, row.share_url); removed += 1; }
  return { granted, removed };
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
    // The changes behind that SQL, sent back by "Mark as done".
    planned: md.configured() ? [] : [...plan.grant.map(item => ({ grantee: item.grantee, url: item.url })), ...plan.revoke.filter(row => row.granted_by_app || row.attached_by_app).map(row => ({ grantee: row.grantee, url: row.share_url }))],
  };
}
