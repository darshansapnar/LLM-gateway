// Thin wrapper around fetch(): always sends the admin key and base URL,
// and turns a non-2xx response into a thrown Error with a readable message
// so components can just catch(err) and show err.message.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

async function request(path, { method = "GET", adminKey, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return response.json();
}

export function getOverview(adminKey, range) {
  return request(`/v1/admin/overview?range=${range}`, { adminKey });
}

export function getTimeseries(adminKey, range) {
  return request(`/v1/admin/timeseries?range=${range}`, { adminKey });
}

export function getProviders(adminKey, range) {
  return request(`/v1/admin/providers?range=${range}`, { adminKey });
}

export function getLogs(adminKey, { page = 1, limit = 20, ...filters } = {}) {
  const params = new URLSearchParams({ page, limit });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return request(`/v1/admin/logs?${params}`, { adminKey });
}

export function getCacheStats(adminKey) {
  return request("/v1/admin/cache-stats", { adminKey });
}

export function getKeys(adminKey) {
  return request("/v1/admin/keys", { adminKey });
}

export function patchKey(adminKey, id, updates) {
  return request(`/v1/admin/keys/${id}`, { method: "PATCH", adminKey, body: updates });
}

// Returns { id, name, key, keyPrefix, requestsPerMinute, tokensPerDay,
// isActive, semanticCacheEnabled, createdAt } - `key` is the raw key and is
// ONLY ever present in this one response; nothing after this can retrieve
// it again (the backend only stores its hash).
export function createKey(adminKey, data) {
  return request("/v1/admin/keys", { method: "POST", adminKey, body: data });
}

export function deleteKey(adminKey, id) {
  return request(`/v1/admin/keys/${id}`, { method: "DELETE", adminKey });
}

// Used only by the login screen, to confirm the admin key actually works
// before "logging in" - any admin endpoint would do; overview is cheap.
export function verifyAdminKey(adminKey) {
  return getOverview(adminKey, "1h");
}

// GET /health needs no admin key - it's the same public endpoint uptime
// monitors use. The sidebar polls it to drive the connection status dot.
export async function getHealth() {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) throw new Error(`Health check failed (${response.status})`);
  return response.json();
}
