'use client';

import { useEffect } from 'react';
import { flushOfflineOutboxClient } from '@/lib/offline/outbox';

export default function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => undefined);

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PULSEGUARD_OUTBOX_SYNCED') {
          window.dispatchEvent(
            new CustomEvent('pulseguard-outbox-updated', { detail: event.data })
          );
        }
      });
    }

    const handleOnline = () => {
      flushOfflineOutboxClient()
        .then((flushed) => {
          if (flushed > 0) {
            window.dispatchEvent(
              new CustomEvent('pulseguard-outbox-updated', { detail: { flushedCount: flushed } })
            );
          }
        })
        .catch(() => undefined);
    };

    window.addEventListener('online', handleOnline);
    if (navigator.onLine) {
      handleOnline();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return null;
}
