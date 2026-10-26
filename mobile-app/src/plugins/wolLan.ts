import { Capacitor, registerPlugin } from '@capacitor/core';
import { DiscoveredPc } from '../types';

export interface WolLanPluginInterface {
  wake(options: { macs: string[]; broadcastIp?: string }): Promise<{
    sentCount: number;
  }>;
  discover(options: { port?: number }): Promise<{
    hosts: DiscoveredPc[];
  }>;
  haptic(options: { durationMs?: number }): Promise<void>;
}

const NativeWolLan = registerPlugin<WolLanPluginInterface>('WolLan');

export async function triggerHaptic(durationMs = 18): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await NativeWolLan.haptic({ durationMs });
    } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(durationMs);
    }
  } catch {
    // ignore
  }
}

export async function sendWakeOnLan(
  macs: string[],
  broadcastIp = '255.255.255.255'
): Promise<{ ok: boolean; sentCount: number; error?: string }> {
  const cleanMacs = Array.from(
    new Set(
      macs
        .map((m) => m.trim().toUpperCase().replace(/-/g, ':'))
        .filter((m) => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(m))
    )
  );

  if (cleanMacs.length === 0) {
    return {
      ok: false,
      sentCount: 0,
      error: 'Сначала подключитесь к включённому ПК 1 раз (MAC сохранится автоматически) или укажите MAC вручную.',
    };
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await NativeWolLan.wake({ macs: cleanMacs, broadcastIp });
      return { ok: true, sentCount: res.sentCount };
    } catch (err: any) {
      return { ok: false, sentCount: 0, error: err?.message || 'Ошибка отправки WoL пакета' };
    }
  }

  // Web preview simulation response
  return { ok: true, sentCount: cleanMacs.length * 3 };
}

export async function discoverPcsOnWifi(port = 7788): Promise<DiscoveredPc[]> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await NativeWolLan.discover({ port });
      return res.hosts || [];
    } catch {
      return [];
    }
  }

  // Browser preview fallback: check proxied /api/ping
  try {
    const res = await fetch('/api/ping');
    if (res.ok) {
      const data = await res.json();
      if (data?.magic === 'NEXUS_PC_V1') {
        return [
          {
            serverId: data.serverId,
            name: data.name,
            hostname: data.hostname,
            ip: 'preview',
            port: data.port || 7788,
            mac: data.primaryMac || '',
            macs: data.macs || [],
            broadcastIp: data.broadcastIp || '255.255.255.255',
            pinRequired: Boolean(data.pinRequired),
          },
        ];
      }
    }
  } catch {
    // ignore
  }
  return [];
}
