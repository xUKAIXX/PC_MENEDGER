import {
  DeckItem,
  DiscoveredApp,
  FsEntry,
  FsRoot,
  PcNetworkInfo,
  PcStats,
  PresetIconOption,
} from './types';

const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
const API_BASE = isFileProtocol
  ? `http://127.0.0.1:${window.nexusDesktop?.apiPort || 7788}`
  : '';

export function getWsUrl(): string {
  if (isFileProtocol) {
    return `ws://127.0.0.1:${window.nexusDesktop?.apiPort || 7788}/ws`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export interface FullStateResponse {
  ok: true;
  pcInfo: PcNetworkInfo;
  stats: PcStats;
  items: DeckItem[];
  runningIds: string[];
  shutdownTimerEndsAt: number | null;
  autostart: boolean;
  connectedClients: number;
  pin: string;
}

export const pcApi = {
  getState: () => request<FullStateResponse>('/api/state'),

  addItem: (payload: {
    name?: string;
    target: string;
    args?: string;
    kind?: DeckItem['kind'];
    category?: DeckItem['category'];
    accent?: string;
    iconDataUrl?: string;
    iconPreset?: string;
  }) => request<{ ok: true; item: DeckItem; items: DeckItem[] }>('/api/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  addMultipleTargets: (targets: string[]) =>
    request<{ ok: true; items: DeckItem[] }>('/api/items', {
      method: 'POST',
      body: JSON.stringify({ items: targets.map((t) => ({ target: t })) }),
    }),

  updateItem: (
    id: string,
    patch: Partial<DeckItem> & { iconPreset?: string; refreshIcon?: boolean }
  ) =>
    request<{ ok: true; item: DeckItem; items: DeckItem[] }>(
      `/api/items/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }
    ),

  deleteItem: (id: string) =>
    request<{ ok: true; items: DeckItem[] }>(`/api/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  launchItem: (id: string) =>
    request<{ ok: true; item: DeckItem }>(`/api/launch/${encodeURIComponent(id)}`, {
      method: 'POST',
    }),

  killItem: (id: string) =>
    request<{ ok: boolean }>(`/api/kill/${encodeURIComponent(id)}`, {
      method: 'POST',
    }),

  getCatalogApps: (refresh = false) =>
    request<{ ok: true; apps: DiscoveredApp[] }>(
      `/api/catalog/apps${refresh ? '?refresh=1' : ''}`
    ),

  getPresetIcons: () =>
    request<{ ok: true; presets: PresetIconOption[] }>('/api/icons/presets'),

  getFsRoots: () => request<{ ok: true; roots: FsRoot[] }>('/api/fs/roots'),

  listDir: (dirPath?: string) =>
    request<{
      ok: true;
      currentPath: string;
      parentPath: string | null;
      entries: FsEntry[];
    }>(`/api/fs/list${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`),

  saveSettings: (payload: { pcName?: string; pin?: string; autostart?: boolean }) =>
    request<{ ok: true; pcInfo: PcNetworkInfo; autostart: boolean; pin: string }>(
      '/api/settings',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  runWindowsSetup: () =>
    request<{ ok: boolean; error?: string }>('/api/windows-setup', {
      method: 'POST',
    }),
};

export function resizeImageFileToDataUrl(file: File, maxDim = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.onload = () => {
      const result = String(reader.result || '');
      if (file.type === 'image/svg+xml') {
        resolve(result);
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(result);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(result);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}
