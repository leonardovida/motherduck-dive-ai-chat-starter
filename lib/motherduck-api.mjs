// MotherDuck's REST API. MOTHERDUCK_API_URL points the app at another endpoint, such as the
// stand-in the end-to-end tests run against.
export const motherDuckApi = (env = process.env) => `${String(env.MOTHERDUCK_API_URL || 'https://api.motherduck.com').trim().replace(/\/+$/, '')}/v1`;
