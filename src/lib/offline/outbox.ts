// Real IndexedDB Offline SOS Outbox & Background Sync / BLE Mesh Broadcast Utility

const DB_NAME = 'pulseguard-offline-db';
const DB_VERSION = 1;
const STORE_NAME = 'sos_outbox';

export interface OfflineSosOutboxItem {
  localId: string;
  createdAt: string;
  synced: boolean;
  syncedAt?: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  incidentRow: Record<string, unknown>;
  notifyPayload: Record<string, unknown> | null;
  smsFrame52BBase64: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
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

export async function enqueueOfflineSos(item: OfflineSosOutboxItem): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (reg && 'sync' in reg) {
        const syncReg = reg as ServiceWorkerRegistration & {
          sync?: { register: (tag: string) => Promise<void> };
        };
        await syncReg.sync?.register('pulseguard-sos-sync').catch(() => undefined);
      }
    }
  } finally {
    db.close();
  }
}

export async function listOfflineOutbox(): Promise<OfflineSosOutboxItem[]> {
  try {
    const db = await openDb();
    try {
      return await new Promise<OfflineSosOutboxItem[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as OfflineSosOutboxItem[]) || []);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function markOutboxItemSyncedClient(localId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(localId);
      getReq.onsuccess = () => {
        const row = getReq.result as OfflineSosOutboxItem | undefined;
        if (!row) {
          resolve();
          return;
        }
        row.synced = true;
        row.syncedAt = new Date().toISOString();
        const putReq = store.put(row);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } finally {
    db.close();
  }
}

export async function clearOfflineOutbox(): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore if unavailable
  }
}

export async function flushOfflineOutboxClient(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  const items = await listOfflineOutbox();
  let flushed = 0;

  for (const item of items) {
    if (item.synced) continue;
    if (!item.supabaseUrl || !item.supabaseAnonKey || !item.accessToken) continue;

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
        const insertedRows = (await res.json()) as Array<{ id: string }>;
        const incidentId = insertedRows[0]?.id;
        if (item.notifyPayload) {
          await fetch('/api/dispatch/notify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${item.accessToken}`,
            },
            body: JSON.stringify({ incidentId }),
          }).catch(() => undefined);
        }
        await markOutboxItemSyncedClient(item.localId);
        flushed++;
      }
    } catch {
      // keep queued for next retry
    }
  }

  return flushed;
}
