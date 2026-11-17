// An in-memory app store for running the real Better Auth in tests. It answers the SQL Better
// Auth's Kysely adapter sends (select/insert/update/delete on one table with "and"-ed conditions)
// and, through query(), the few app statements the shared-password admin tests reach; any other
// app statement is recorded and answered with no rows. It is not a SQL engine: an unexpected Better
// Auth statement throws, so a test fails loudly instead of passing on a wrong answer.
//
// install() puts it where getAuth() and appQuery() look (globalThis), marks the store as ready,
// and clears any Better Auth instance, so the next getAuth() builds a real one over it.

const quoted = text => text.replace(/^"|"$/g, '');
const plain = value => (value instanceof Date ? value.getTime() : value);

function condition(text, params) {
  const clause = text.trim().replace(/^\((.*)\)$/s, '$1');
  const parts = clause.split(/ and /i);
  const tests = parts.map(part => {
    let match = /^"\w+"\."(\w+)" (=|<>|!=|>|<|>=|<=) \$(\d+)$/.exec(part.trim());
    if (match) {
      const [, column, op, index] = match;
      const value = plain(params[index - 1]);
      return row => {
        const cell = plain(row[column]);
        return { '=': cell === value, '<>': cell !== value, '!=': cell !== value, '>': cell > value, '<': cell < value, '>=': cell >= value, '<=': cell <= value }[op];
      };
    }
    match = /^"\w+"\."(\w+)" in \(([^)]*)\)$/.exec(part.trim());
    if (match) {
      const values = match[2].split(',').map(item => plain(params[Number(item.trim().slice(1)) - 1]));
      return row => values.includes(plain(row[match[1]]));
    }
    throw new Error(`memory store cannot read the condition: ${part}`);
  });
  return row => tests.every(test => test(row));
}

export function createMemoryStore() {
  const tables = { user: [], session: [], account: [], verification: [], account_setup: [], audit_event: [], access_group: [], access_group_member: [] };
  const app = [];
  const kysely = (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (/^(begin|commit|rollback)$/i.test(text)) return [];
    let match = /^select "primary"\.\* from \(select \* from "(\w+)"(?: where (.*?))?(?: order by "\w+"\."(\w+)" (asc|desc))?(?: limit \$(\d+))?(?: offset \$(\d+))?\) as "primary"$/i.exec(text);
    if (match) {
      const [, table, where, order, direction, limit, offset] = match;
      let rows = tables[table].filter(where ? condition(where, params) : () => true);
      if (order) rows = [...rows].sort((a, b) => (plain(a[order]) > plain(b[order]) ? 1 : -1) * (direction === 'desc' ? -1 : 1));
      if (offset) rows = rows.slice(params[offset - 1]);
      if (limit) rows = rows.slice(0, params[limit - 1]);
      return rows.map(row => ({ ...row }));
    }
    match = /^select count\(\*\) as "count" from "(\w+)"(?: where (.*))?$/i.exec(text);
    if (match) return [{ count: tables[match[1]].filter(match[2] ? condition(match[2], params) : () => true).length }];
    match = /^insert into "(\w+)" \(([^)]*)\) values \(([^)]*)\)(?: returning \*)?$/i.exec(text);
    if (match) {
      const columns = match[2].split(',').map(item => quoted(item.trim()));
      const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      tables[match[1]].push(row);
      return [{ ...row }];
    }
    match = /^update "(\w+)" set (.*?) where (.*?)(?: returning \*)?$/i.exec(text);
    if (match) {
      const sets = match[2].split(', ').map(item => /^"(\w+)" = \$(\d+)$/.exec(item.trim())).map(([, column, index]) => [column, params[index - 1]]);
      const rows = tables[match[1]].filter(condition(match[3], params));
      for (const row of rows) for (const [column, value] of sets) row[column] = value;
      return rows.map(row => ({ ...row }));
    }
    match = /^delete from "(\w+)" where (.*)$/i.exec(text);
    if (match) {
      const test = condition(match[2], params);
      const removed = tables[match[1]].filter(test);
      tables[match[1]] = tables[match[1]].filter(row => !test(row));
      return removed;
    }
    throw new Error(`memory store cannot run: ${text}`);
  };
  // The app's own statements that these tests reach, by shape.
  const appSql = (text, values = []) => {
    app.push({ text, values });
    const users = tables.user;
    if (text.startsWith('DELETE FROM account_setup WHERE user_id = $1')) { tables.account_setup = tables.account_setup.filter(row => row.user_id !== values[0] || (text.includes('used_at IS NULL') && row.used_at)); return []; }
    if (text.startsWith('INSERT INTO account_setup')) { tables.account_setup.push({ token_hash: values[0], user_id: values[1], created_by: values[2], expires_at: values[3], used_at: null }); return []; }
    if (text.startsWith('SELECT u.id, u.name, u."displayUsername", u.username, s.created_by FROM account_setup s')) {
      const setup = tables.account_setup.find(row => row.token_hash === values[0] && !row.used_at && row.expires_at > values[1]);
      const user = setup && users.find(row => row.id === setup.user_id && !row.banned);
      return user ? [{ id: user.id, name: user.name, displayUsername: user.displayUsername, username: user.username, created_by: setup.created_by }] : [];
    }
    if (text.startsWith('UPDATE account_setup SET used_at')) {
      const setup = tables.account_setup.find(row => row.token_hash === values[1] && !row.used_at);
      if (!setup) return [];
      setup.used_at = values[0];
      return [{ user_id: setup.user_id }];
    }
    if (text.startsWith('SELECT lower(username) AS username, lower(email) AS email FROM "user"')) return users.filter(user => values.includes(String(user.username).toLowerCase()) || values.includes(String(user.email).toLowerCase())).map(user => ({ username: user.username, email: user.email }));
    if (text.startsWith('UPDATE "user" SET "diveAccess" = $1, "chatAccess" = $2, "motherduckUser" = $3, "emailVerified" = $4 WHERE id = $5')) {
      const user = users.find(row => row.id === values[4]);
      if (user) Object.assign(user, { diveAccess: values[0], chatAccess: values[1], motherduckUser: values[2], emailVerified: values[3] });
      return [];
    }
    // PATCH /api/admin/users/:id/access, with or without the MotherDuck username.
    if (/^UPDATE "user" SET "diveAccess" = \$1, "chatAccess" = \$2, (?:"motherduckUser" = \$3, )?"updatedAt" = \$\d WHERE id = \$\d RETURNING id$/.test(text)) {
      const user = users.find(row => row.id === values.at(-1));
      if (!user) return [];
      Object.assign(user, { diveAccess: values[0], chatAccess: values[1] }, values.length === 5 ? { motherduckUser: values[2] } : {});
      return [{ id: user.id }];
    }
    if (text.startsWith('SELECT role, banned FROM "user" WHERE id = $1')) return users.filter(user => user.id === values[0]).map(({ role, banned }) => ({ role, banned }));
    if (text.startsWith('SELECT username, "displayUsername", name FROM "user" WHERE id = $1')) return users.filter(user => user.id === values[0]);
    if (text.startsWith('SELECT * FROM access_group WHERE id = $1')) return tables.access_group.filter(group => group.id === values[0]);
    if (text.startsWith('SELECT 1 AS found FROM "user" WHERE id = $1')) return users.filter(user => user.id === values[0]).map(() => ({ found: 1 }));
    if (text.startsWith('INSERT INTO audit_event')) { tables.audit_event.push({ actor_id: values[2], actor_label: values[3], action: values[4], target_id: values[5] }); return []; }
    return [];
  };
  const client = { query: async (sql, params) => { const rows = kysely(sql, params); return { rows, rowCount: rows.length, command: sql.trim().split(/\s+/)[0].toUpperCase() }; }, release() {} };
  const pool = { on() {}, connect: async () => client, query: async (text, values) => ({ rows: appSql(text, values) }), end: async () => {} };
  return {
    tables, app, pool,
    install() {
      delete globalThis.__diveChatAuth;
      globalThis.__diveChatAppPool = pool;
      globalThis.__diveChatAppReady = Promise.resolve();
      delete globalThis.__diveChatAppFailed;
    },
    restore() {
      delete globalThis.__diveChatAuth; delete globalThis.__diveChatAppPool; delete globalThis.__diveChatAppReady; delete globalThis.__diveChatAppFailed;
    },
  };
}

// Cookies a response set, as one Cookie header for the next request: expired ones are dropped.
export function cookieJar(initial = '') {
  const jar = new Map(initial.split(';').map(part => part.trim()).filter(Boolean).map(part => [part.split('=')[0], part.slice(part.indexOf('=') + 1)]));
  return {
    take(response) {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const name = pair.split('=')[0], value = pair.slice(name.length + 1);
        if (!value || /Max-Age=0/i.test(cookie)) jar.delete(name); else jar.set(name, value);
      }
      return response;
    },
    set(name, value) { jar.set(name, value); },
    has: name => jar.has(name),
    names: () => [...jar.keys()],
    header: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
  };
}
