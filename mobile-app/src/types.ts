export type ItemKind = 'app' | 'file' | 'folder' | 'url' | 'script';
export type ItemCategory = 'games' | 'apps' | 'files' | 'media' | 'work';

export interface DeckItem {
  id: string;
  name: string;
  target: string;
  args?: string;
  kind: ItemKind;
  category: ItemCategory;
  accent: string;
  iconDataUrl: string;
  iconHash: string;
  order: number;
  createdAt: number;
  lastLaunchedAt?: number;
}

export interface SavedPcProfile {
  id: string;
  name: string;
  ip: string;
  port: number;
  mac: string;
  macs: string[];
  broadcastIp: string;
  pin?: string;
  lastSeenAt?: number;
}

export interface DiscoveredPc {
  serverId: string;
  name: string;
  hostname: string;
  ip: string;
  port: number;
  mac: string;
  macs: string[];
  broadcastIp: string;
  pinRequired: boolean;
}

export interface PcStats {
  cpuPercent: number;
  ramPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  uptimeSec: number;
}

export interface DiscoveredApp {
  id: string;
  name: string;
  target: string;
  args?: string;
  sourcePath: string;
  kind: ItemKind;
  category: ItemCategory;
  accent: string;
  iconDataUrl: string;
}

export interface FsRoot {
  name: string;
  path: string;
  kind: 'quick' | 'drive';
}

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  ext: string;
  kind: ItemKind;
  accent: string;
  iconDataUrl: string;
}

export interface PresetIconOption {
  id: string;
  label: string;
  accent: string;
  iconDataUrl: string;
}

export type ControlAction =
  | 'vol_up'
  | 'vol_down'
  | 'vol_mute'
  | 'media_play_pause'
  | 'media_next'
  | 'media_prev'
  | 'lock'
  | 'sleep'
  | 'restart'
  | 'shutdown'
  | 'shutdown_timer'
  | 'cancel_shutdown';
