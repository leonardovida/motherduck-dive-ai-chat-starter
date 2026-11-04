// Runs fn with env overrides, restoring the previous values afterwards.
export async function withEnv(overrides, fn) {
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

// Accounts mode without a database. getAuth() and appPool() keep their instances on globalThis,
// so a test can put fakes there: a Better Auth whose session is the user named by the request's
// cookie, and an app pool that records every query and answers it with rows(sql, values).
// Accounts mode itself still needs MOTHERDUCK_APP_TOKEN in the environment.
export function fakeAccounts({ users = {}, rows = () => [], handler = async () => Response.json({ status: true }) } = {}) {
  const queries = [];
  globalThis.__diveChatAuth = {
    handler,
    api: {
      getSession: async ({ headers }) => {
        const user = users[headers.get('cookie') ?? ''];
        return user ? { user, session: { id: `session-${user.id}` } } : null;
      },
    },
  };
  globalThis.__diveChatAppPool = {
    on() {},
    query: async (text, values = []) => { queries.push({ text, values }); return { rows: (await rows(text, values)) ?? [] }; },
  };
  return { queries, restore() { delete globalThis.__diveChatAuth; delete globalThis.__diveChatAppPool; } };
}
