import {
  ControlAction,
  DeckItem,
  DiscoveredApp,
  FsEntry,
  FsRoot,
  PcStats,
  PresetIconOption,
  SavedPcProfile,
} from '../types';

export function getHttpBase(pc: SavedPcProfile): string {
  if (pc.ip === 'preview') return '';
  return `http://${pc.ip}:${pc.port || 7788}`;
}

export function getWsEndpoint(pc: SavedPcProfile): string {
  if (pc.ip === 'preview') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return `ws://${pc.ip}:${pc.port || 7788}/ws`;
}

async function fetchJson<T>(
  pc: SavedPcProfile,
  path: string,
  init?: RequestInit,
  timeoutMs = 5000
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) || {}),
    };
    if (pc.pin) {
      headers['X-Nexus-Pin'] = pc.pin;
    }
    const res = await fetch(`${getHttpBase(pc)}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export const mobilePcApi = {
  ping: async (ip: string, port = 7788) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2200);
    const t0 = performance.now();
    try {
      const base = ip === 'preview' ? '' : `http://${ip}:${port}`;
      const res = await fetch(`${base}/api/ping`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok || data.magic !== 'NEXUS_PC_V1') {
        throw new Error('Не найден сервер NEXUS на этом адресе');
      }
      return {
        latencyMs: Math.max(1, Math.round(performance.now() - t0)),
        info: data as {
          serverId: string;
          name: string;
          hostname: string;
          primaryIp: string;
          broadcastIp: string;
          primaryMac: string;
          macs: string[];
          port: number;
          pinRequired: boolean;
        },
      };
    } finally {
      window.clearTimeout(timer);
    }
  },

  pair: (ip: string, port: number, pin?: string, deviceName = 'Android NEXUS') => {
    const tempPc: SavedPcProfile = {
      id: 'temp',
      name: 'PC',
      ip,
      port,
      mac: '',
      macs: [],
      broadcastIp: '255.255.255.255',
      pin,
    };
    return fetchJson<{
      ok: true;
      pcInfo: {
        serverId: string;
        name: string;
        primaryIp: string;
        broadcastIp: string;
        primaryMac: string;
        macs: string[];
        port: number;
      };
      items: DeckItem[];
    }>(
      tempPc,
      '/api/pair',
      {
        method: 'POST',
        body: JSON.stringify({ deviceName, pin }),
      },
      4500
    );
  },

  getState: (pc: SavedPcProfile) =>
    fetchJson<{
      ok: true;
      pcInfo: {
        serverId: string;
        name: string;
        primaryIp: string;
        broadcastIp: string;
        primaryMac: string;
        macs: string[];
        port: number;
      };
      stats: PcStats;
      items: DeckItem[];
      runningIds: string[];
      shutdownTimerEndsAt: number | null;
    }>(pc, '/api/state', undefined, 3500),

  launch: (pc: SavedPcProfile, itemId: string) =>
    fetchJson<{ ok: true; item: DeckItem }>(
      pc,
      `/api/launch/${encodeURIComponent(itemId)}`,
      { method: 'POST' },
      4500
    ),

  kill: (pc: SavedPcProfile, itemId: string) =>
    fetchJson<{ ok: boolean }>(
      pc,
      `/api/kill/${encodeURIComponent(itemId)}`,
      { method: 'POST' },
      4500
    ),

  openPath: (pc: SavedPcProfile, target: string) =>
    fetchJson<{ ok: boolean; error?: string }>(
      pc,
      '/api/open-path',
      {
        method: 'POST',
        body: JSON.stringify({ target }),
      },
      4500
    ),

  addItem: (
    pc: SavedPcProfile,
    payload: {
      name?: string;
      target: string;
      args?: string;
      kind?: DeckItem['kind'];
      category?: DeckItem['category'];
      accent?: string;
      iconDataUrl?: string;
      iconPreset?: string;
    }
  ) =>
    fetchJson<{ ok: true; item: DeckItem; items: DeckItem[] }>(
      pc,
      '/api/items',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      8000
    ),

  updateItem: (
    pc: SavedPcProfile,
    id: string,
    patch: Partial<DeckItem> & { iconPreset?: string; refreshIcon?: boolean }
  ) =>
    fetchJson<{ ok: true; item: DeckItem; items: DeckItem[] }>(
      pc,
      `/api/items/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
      8000
    ),

  deleteItem: (pc: SavedPcProfile, id: string) =>
    fetchJson<{ ok: true; items: DeckItem[] }>(
      pc,
      `/api/items/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      5000
    ),

  getCatalogApps: (pc: SavedPcProfile, refresh = false) =>
    fetchJson<{ ok: true; apps: DiscoveredApp[] }>(
      pc,
      `/api/catalog/apps${refresh ? '?refresh=1' : ''}`,
      undefined,
      12000
    ),

  getPresetIcons: (pc: SavedPcProfile) =>
    fetchJson<{ ok: true; presets: PresetIconOption[] }>(pc, '/api/icons/presets', undefined, 5000),

  getFsRoots: (pc: SavedPcProfile) =>
    fetchJson<{ ok: true; roots: FsRoot[] }>(pc, '/api/fs/roots', undefined, 5000),

  listDir: (pc: SavedPcProfile, dirPath?: string) =>
    fetchJson<{
      ok: true;
      currentPath: string;
      parentPath: string | null;
      entries: FsEntry[];
    }>(
      pc,
      `/api/fs/list${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`,
      undefined,
      8000
    ),

  sendControl: (pc: SavedPcProfile, action: ControlAction, seconds?: number) =>
    fetchJson<{ ok: boolean; shutdownTimerEndsAt: number | null }>(
      pc,
      '/api/control',
      {
        method: 'POST',
        body: JSON.stringify({ action, seconds }),
      },
      4500
    ),
};

export function resizeGalleryImageToDataUrl(file: File, maxDim = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Ошибка чтения картинки'));
    reader.onload = () => {
      const src = String(reader.result || '');
      if (file.type === 'image/svg+xml') {
        resolve(src);
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(src);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
