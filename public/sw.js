// PulseGuard AI Production Service Worker
// Handles offline PWA shell resilience & Background Sync of encrypted 52-byte SOS frames in IndexedDB.

const CACHE_NAME = 'pulseguard-shell-v1';
const DB_NAME = 'pulseguard-offline-db';
const DB_VERSION = 1;
const STORE_NAME = 'sos_outbox';

const APP_SHELL_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/worklets/ring-buffer-processor.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/worklets/'))) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      });
    })
  );
});

function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'localId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPendingOutboxItems(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).filter((item) => !item.synced));
    req.onerror = () => reject(req.error);
  });
}

async function markOutboxItemSynced(db, localId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) {
        resolve();
        return;
      }
      record.synced = true;
      record.syncedAt = new Date().toISOString();
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function flushOfflineSosOutbox() {
  let db;
  try {
    db = await openOutboxDb();
    const pending = await getPendingOutboxItems(db);
    let flushedCount = 0;

    for (const item of pending) {
      if (!item.supabaseUrl || !item.supabaseAnonKey || !item.accessToken || !item.incidentRow) {
        continue;
      }
      try {
        const res = await fetch(`${item.supabaseUrl}/rest/v1/incidents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: item.supabaseAnonKey,
            Authorization: `Bearer ${item.accessToken}`,
            Prefer: 'return=representation',
          },
          body: JSON.stringify(item.incidentRow),
        });

        if (res.ok) {
          if (item.notifyPayload) {
            await fetch('/api/dispatch/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.notifyPayload),
            }).catch(() => undefined);
          }
          await markOutboxItemSynced(db, item.localId);
          flushedCount++;
        }
      } catch {
        // Still offline or transient error; retry on next sync event
      }
    }

    if (flushedCount > 0) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'PULSEGUARD_OUTBOX_SYNCED', flushedCount });
      }
    }
  } finally {
    if (db) db.close();
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'pulseguard-sos-sync') {
    event.waitUntil(flushOfflineSosOutbox());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FLUSH_SOS_OUTBOX') {
    event.waitUntil(flushOfflineSosOutbox());
  }
});
