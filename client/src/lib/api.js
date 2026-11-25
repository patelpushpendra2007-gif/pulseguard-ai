const TOKEN_KEY = 'pulseguard_tab_jwt_v4';

export function getStoredToken() {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || null;
}

export function setStoredToken(token) {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiRequest(path, { method = 'GET', body, token } = {}) {
  const authToken = token ?? getStoredToken();
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export function openEventStream(token, onEvent) {
  if (!token) return () => {};
  const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  const events = [
    'connected',
    'incident_created',
    'incident_updated',
    'pulsebox_updated',
    'zone_controls_updated',
    'responder_updated'
  ];

  for (const name of events) {
    es.addEventListener(name, (ev) => {
      try {
        onEvent(name, JSON.parse(ev.data));
      } catch {
        // ignore malformed heartbeat
      }
    });
  }
  return () => es.close();
}
