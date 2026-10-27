// Minimal stand-ins for the Node-style request/response the api/ handlers use.
export function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.data = JSON.parse(value); } };
}

export function request(method, { body, headers = {}, url = '/api/test' } = {}) {
  return { method, url, body, headers: { host: 'demo.test', origin: 'https://demo.test', 'content-type': 'application/json', ...headers } };
}

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
