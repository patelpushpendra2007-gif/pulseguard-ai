'use client';

import { useEffect, useState } from 'react';
import { Bluetooth, MessageSquare, Radio, RefreshCw, Send, UploadCloud } from 'lucide-react';
import {
  clearOfflineOutbox,
  flushOfflineOutboxClient,
  listOfflineOutbox,
  type OfflineSosOutboxItem,
} from '@/lib/offline/outbox';
import { buildSmsFailoverUri } from '@/lib/crypto/e2ee';

interface BleRelayConsoleProps {
  emergencyPhone: string | null;
  latest52BFrame: string | null;
  latestPayloadSha256: string | null;
}

const NORDIC_UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export default function BleRelayConsole({
  emergencyPhone,
  latest52BFrame,
  latestPayloadSha256,
}: BleRelayConsoleProps) {
  const [outboxItems, setOutboxItems] = useState<OfflineSosOutboxItem[]>([]);
  const [bleRelayLog, setBleRelayLog] = useState<string[]>([]);
  const [relayBusy, setRelayBusy] = useState(false);

  const loadOutbox = async () => {
    const items = await listOfflineOutbox();
    setOutboxItems(items);
  };

  useEffect(() => {
    loadOutbox();
    const handler = () => {
      loadOutbox();
    };
    window.addEventListener('pulseguard-outbox-updated', handler);

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('pulseguard-ble-zk-relay');
      bc.onmessage = (evt) => {
        if (evt.data?.frame52b) {
          setBleRelayLog((prev) =>
            [
              `[${new Date().toLocaleTimeString()}] Zero-Knowledge Peer Frame Received: ${String(
                evt.data.frame52b
              )}`,
              ...prev,
            ].slice(0, 8)
          );
        }
      };
    }

    return () => {
      window.removeEventListener('pulseguard-outbox-updated', handler);
      bc?.close();
    };
  }, []);

  const handleBroadcastBlePacket = async () => {
    if (!latest52BFrame) return;
    setRelayBusy(true);
    try {
      // Broadcast to local Service Worker / PWA tab peer channel
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('pulseguard-ble-zk-relay');
        bc.postMessage({
          frame52b: latest52BFrame,
          sha256: latestPayloadSha256,
          sentAt: new Date().toISOString(),
        });
        bc.close();
      }

      const nav = navigator as unknown as {
        bluetooth?: {
          requestDevice: (opts: unknown) => Promise<{
            name?: string;
            gatt?: {
              connect: () => Promise<{
                getPrimaryService: (uuid: string) => Promise<{
                  getCharacteristic: (uuid: string) => Promise<{
                    writeValue?: (val: BufferSource) => Promise<void>;
                    startNotifications?: () => Promise<void>;
                    addEventListener?: (
                      t: string,
                      cb: (e: { target: { value: DataView } }) => void
                    ) => void;
                  }>;
                }>;
              }>;
            };
          }>;
        };
      };

      if (!nav.bluetooth) {
        setBleRelayLog((prev) => [
          `[${new Date().toLocaleTimeString()}] Local PWA channel relayed 52B packet (${latest52BFrame.length} chars). Web Bluetooth GATT requires Chrome/Edge HTTPS.`,
          ...prev,
        ]);
        return;
      }

      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: [NORDIC_UART_SERVICE] }],
        optionalServices: [NORDIC_UART_SERVICE],
      });
      const server = await device.gatt?.connect();
      if (!server) throw new Error('Failed to open GATT connection');
      const service = await server.getPrimaryService(NORDIC_UART_SERVICE);
      const rxChar = await service.getCharacteristic(NORDIC_UART_RX_CHAR);
      const payloadBytes = new TextEncoder().encode(`PG52:${latest52BFrame}\n`);
      await rxChar.writeValue?.(payloadBytes);

      setBleRelayLog((prev) => [
        `[${new Date().toLocaleTimeString()}] Transmitted 52B zero-knowledge frame over BLE GATT to ${device.name || 'Relay Node'}`,
        ...prev,
      ]);

      // Listen for ACK or peer packet on TX
      try {
        const txChar = await service.getCharacteristic(NORDIC_UART_TX_CHAR);
        await txChar.startNotifications?.();
        txChar.addEventListener?.('characteristicvaluechanged', (evt) => {
          const decoded = new TextDecoder().decode(evt.target.value.buffer).trim();
          if (decoded) {
            setBleRelayLog((prev) => [
              `[${new Date().toLocaleTimeString()}] BLE Peer RX: ${decoded}`,
              ...prev,
            ]);
          }
        });
      } catch {
        // TX optional on write-only relay
      }
    } catch (err) {
      setBleRelayLog((prev) => [
        `[${new Date().toLocaleTimeString()}] BLE Relay Notice: ${
          err instanceof Error ? err.message : 'Device selection canceled'
        }`,
        ...prev,
      ]);
    } finally {
      setRelayBusy(false);
    }
  };

  const handleManualSync = async () => {
    const flushed = await flushOfflineOutboxClient();
    await loadOutbox();
    if (flushed > 0) {
      setBleRelayLog((prev) => [
        `[${new Date().toLocaleTimeString()}] Flushed ${flushed} queued offline SOS packet(s) to Supabase.`,
        ...prev,
      ]);
    }
  };

  const handleClearSynced = async () => {
    await clearOfflineOutbox();
    await loadOutbox();
  };

  const pendingCount = outboxItems.filter((i) => !i.synced).length;

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-amber-400">
            <Radio className="h-4 w-4" />
            TIER 3 · E2EE 52-BYTE BINARY SMS FAILOVER, INDEXEDDB &amp; BLE RELAY
          </div>
          <h2 className="mt-1 text-base font-bold text-white">
            Zero-Knowledge Offline Survival Stack
          </h2>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleManualSync}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Sync Outbox ({pendingCount} pending)
          </button>
          {outboxItems.length > 0 && (
            <button
              type="button"
              onClick={handleClearSynced}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              Clear Outbox
            </button>
          )}
        </div>
      </div>

      {latest52BFrame ? (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs font-semibold text-emerald-300">
              ACTIVE 52-BYTE AES-256-GCM FRAME ({latest52BFrame.length} / 160 GSM-7 chars)
            </span>
            <span className="font-mono text-[11px] text-slate-400">
              Headroom: {160 - latest52BFrame.length} chars free
            </span>
          </div>
          <div className="break-all rounded-lg border border-slate-800 bg-[#05080F] p-2.5 font-mono text-xs text-cyan-300">
            PG52:{latest52BFrame}
          </div>
          {latestPayloadSha256 && (
            <div className="break-all font-mono text-[11px] text-slate-400">
              SHA-256 Digest: <span className="text-slate-200">{latestPayloadSha256}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={buildSmsFailoverUri(emergencyPhone, latest52BFrame)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-500"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              One-Tap Native 52B SMS Failover ({emergencyPhone || '112'})
            </a>

            <button
              type="button"
              onClick={handleBroadcastBlePacket}
              disabled={relayBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
            >
              <Bluetooth className="h-3.5 w-3.5" />
              <Send className="h-3 w-3" />
              {relayBusy ? 'Relaying...' : 'Broadcast BLE 52B Relay Packet'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
          No active E2EE 52-byte binary frame generated yet. Triggering SOS seals an exact 24B
          telemetry struct + 12B random IV + 16B AES-256-GCM tag into 72 Base64 characters.
        </div>
      )}

      {/* IndexedDB Outbox */}
      {outboxItems.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
          <div className="flex items-center gap-2 font-mono text-xs font-semibold text-slate-200">
            <UploadCloud className="h-4 w-4 text-cyan-400" />
            IndexedDB Background Sync Queue ({outboxItems.length})
          </div>
          <div className="mt-2 space-y-2">
            {outboxItems.map((item) => (
              <div
                key={item.localId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#05080F] px-3 py-2 font-mono text-[11px]"
              >
                <span className="text-slate-300">
                  {item.createdAt} · PG52:{item.smsFrame52BBase64.slice(0, 18)}...
                </span>
                <span className={item.synced ? 'text-emerald-400' : 'text-amber-400'}>
                  {item.synced ? `SYNCED (${item.syncedAt})` : 'QUEUED FOR RECONNECT'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {bleRelayLog.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-[#05080F] p-3 font-mono text-[11px] text-slate-300">
          {bleRelayLog.map((line, i) => (
            <div key={i} className="py-0.5">
              {line}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
