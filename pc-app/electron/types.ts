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

export interface NetworkAdapterInfo {
  name: string;
  ip: string;
  netmask: string;
  broadcastIp: string;
  mac: string;
}

export interface PcNetworkInfo {
  serverId: string;
  name: string;
  hostname: string;
  port: number;
  primaryIp: string;
  broadcastIp: string;
  primaryMac: string;
  macs: string[];
  adapters: NetworkAdapterInfo[];
  pinRequired: boolean;
  platform: string;
  version: string;
}

export interface PcStats {
  cpuPercent: number;
  ramPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  uptimeSec: number;
}

export interface PairedDevice {
  id: string;
  name: string;
  token: string;
  pairedAt: number;
  lastSeenAt: number;
}

export interface ShortcutDetails {
  target: string;
  args?: string;
  cwd?: string;
  icon?: string;
}

export interface PlatformAdapter {
  userDataDir: string;
  getFileIconDataUrl: (filePath: string) => Promise<string | null>;
  readShortcut: (lnkPath: string) => ShortcutDetails | null;
  imageFileToDataUrl: (imgPath: string) => string | null;
  openPath: (targetPath: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  getAutostart: () => boolean;
  setAutostart: (enabled: boolean) => boolean;
}
