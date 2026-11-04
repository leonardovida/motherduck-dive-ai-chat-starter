// JSON requests to the app's own API. A non-2xx answer throws an Error whose message is the
// server's error code (or "HTTP <status>"), with the parsed body on error.data.
export async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), { data });
  return data;
}
