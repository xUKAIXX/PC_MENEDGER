import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { DeckItem, PairedDevice, PlatformAdapter } from './types';
import { resolveItemIconAndMeta } from './icons';

export interface PersistedState {
  serverId: string;
  pcName: string;
  port: number;
  pin: string;
  items: DeckItem[];
  pairedDevices: PairedDevice[];
  initialized: boolean;
  firewallConfigured: boolean;
}

export class DeckStore {
  private filePath: string;
  private state: PersistedState;
  private adapter: PlatformAdapter;

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
    fs.mkdirSync(adapter.userDataDir, { recursive: true });
    this.filePath = path.join(adapter.userDataDir, 'nexus-deck-state.json');
    this.state = this.load();
  }

  private load(): PersistedState {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        return {
          serverId: raw.serverId || crypto.randomUUID(),
          pcName: raw.pcName || os.hostname() || 'MY-PC',
          port: typeof raw.port === 'number' ? raw.port : 7788,
          pin: typeof raw.pin === 'string' ? raw.pin : '',
          items: Array.isArray(raw.items) ? raw.items : [],
          pairedDevices: Array.isArray(raw.pairedDevices) ? raw.pairedDevices : [],
          initialized: Boolean(raw.initialized),
          firewallConfigured: Boolean(raw.firewallConfigured),
        };
      }
    } catch {
      // Fallback to fresh state
    }
    return {
      serverId: crypto.randomUUID(),
      pcName: os.hostname() || 'MY-PC',
      port: 7788,
      pin: '',
      items: [],
      pairedDevices: [],
      initialized: false,
      firewallConfigured: false,
    };
  }

  public save(): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  public async ensureSeeded(): Promise<void> {
    if (this.state.initialized) return;

    const home = os.homedir();
    const isWin = process.platform === 'win32';

    const candidates: Array<{
      name: string;
      target: string;
      category?: DeckItem['category'];
      onlyIfExists?: boolean;
    }> = [];

    if (isWin) {
      const steamCandidates = [
        'C:\\Program Files (x86)\\Steam\\steam.exe',
        'C:\\Program Files\\Steam\\steam.exe',
      ];
      const steamExe = steamCandidates.find((p) => fs.existsSync(p));
      if (steamExe) {
        candidates.push({ name: 'Steam', target: steamExe, category: 'games' });
      }

      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      const discordUpdate = path.join(localAppData, 'Discord', 'Update.exe');
      if (fs.existsSync(discordUpdate)) {
        candidates.push({ name: 'Discord', target: discordUpdate, category: 'apps' });
      }

      const telegramExe = path.join(process.env.APPDATA || '', 'Telegram Desktop', 'Telegram.exe');
      if (fs.existsSync(telegramExe)) {
        candidates.push({ name: 'Telegram', target: telegramExe, category: 'apps' });
      }

      candidates.push({
        name: 'Проводник',
        target: 'C:\\Windows\\explorer.exe',
        category: 'files',
      });
    }

    const downloadsDir = path.join(home, 'Downloads');
    const desktopDir = path.join(home, 'Desktop');

    if (fs.existsSync(downloadsDir)) {
      candidates.push({ name: 'Загрузки', target: downloadsDir, category: 'files' });
    }
    if (fs.existsSync(desktopDir)) {
      candidates.push({ name: 'Рабочий стол', target: desktopDir, category: 'files' });
    }

    candidates.push(
      { name: 'YouTube', target: 'https://www.youtube.com', category: 'media' },
      { name: 'Twitch', target: 'https://www.twitch.tv', category: 'media' }
    );

    if (!isWin) {
      // Helpful starter items when testing in non-Windows environments
      candidates.unshift(
        { name: 'Steam', target: 'steam://open/main', category: 'games' },
        { name: 'Discord', target: 'https://discord.com/app', category: 'apps' },
        { name: 'Домашняя папка', target: home, category: 'files' }
      );
    }

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const resolved = await resolveItemIconAndMeta(this.adapter, {
        name: c.name,
        target: c.target,
        category: c.category,
      });
      this.state.items.push({
        id: crypto.randomUUID(),
        ...resolved,
        order: i,
        createdAt: Date.now(),
      });
    }

    this.state.initialized = true;
    this.save();
  }

  public getState(): PersistedState {
    return this.state;
  }

  public getItems(): DeckItem[] {
    return [...this.state.items].sort((a, b) => a.order - b.order);
  }

  public setSettings(patch: { pcName?: string; pin?: string }): PersistedState {
    if (typeof patch.pcName === 'string' && patch.pcName.trim()) {
      this.state.pcName = patch.pcName.trim();
    }
    if (typeof patch.pin === 'string') {
      this.state.pin = patch.pin.trim();
    }
    this.save();
    return this.state;
  }

  public async addItem(input: {
    name?: string;
    target: string;
    args?: string;
    kind?: DeckItem['kind'];
    category?: DeckItem['category'];
    accent?: string;
    iconDataUrl?: string;
    iconPreset?: string;
  }): Promise<DeckItem> {
    const resolved = await resolveItemIconAndMeta(this.adapter, input);
    const maxOrder = this.state.items.reduce((max, it) => Math.max(max, it.order), -1);
    const item: DeckItem = {
      id: crypto.randomUUID(),
      ...resolved,
      order: maxOrder + 1,
      createdAt: Date.now(),
    };
    this.state.items.push(item);
    this.save();
    return item;
  }

  public async updateItem(
    id: string,
    patch: {
      name?: string;
      target?: string;
      args?: string;
      kind?: DeckItem['kind'];
      category?: DeckItem['category'];
      accent?: string;
      iconDataUrl?: string;
      iconPreset?: string;
      refreshIcon?: boolean;
    }
  ): Promise<DeckItem | null> {
    const idx = this.state.items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const existing = this.state.items[idx];

    const targetChanged = patch.target !== undefined && patch.target.trim() !== existing.target;
    const needsIconResolve =
      targetChanged ||
      Boolean(patch.refreshIcon) ||
      Boolean(patch.iconDataUrl) ||
      Boolean(patch.iconPreset);

    if (needsIconResolve) {
      const resolved = await resolveItemIconAndMeta(this.adapter, {
        name: patch.name ?? existing.name,
        target: patch.target ?? existing.target,
        args: patch.args !== undefined ? patch.args : existing.args,
        kind: patch.kind ?? (targetChanged ? undefined : existing.kind),
        category: patch.category ?? existing.category,
        accent: patch.accent ?? (patch.iconPreset ? undefined : existing.accent),
        iconDataUrl: patch.iconDataUrl,
        iconPreset: patch.iconPreset,
      });
      this.state.items[idx] = {
        ...existing,
        ...resolved,
      };
    } else {
      this.state.items[idx] = {
        ...existing,
        name: patch.name?.trim() || existing.name,
        args: patch.args !== undefined ? patch.args : existing.args,
        kind: patch.kind ?? existing.kind,
        category: patch.category ?? existing.category,
        accent: patch.accent ?? existing.accent,
      };
    }

    this.save();
    return this.state.items[idx];
  }

  public deleteItem(id: string): boolean {
    const before = this.state.items.length;
    this.state.items = this.state.items.filter((i) => i.id !== id);
    if (this.state.items.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  public reorderItems(orderedIds: string[]): DeckItem[] {
    const orderMap = new Map<string, number>();
    orderedIds.forEach((id, i) => orderMap.set(id, i));
    this.state.items.forEach((item, idx) => {
      item.order = orderMap.has(item.id) ? orderMap.get(item.id)! : orderedIds.length + idx;
    });
    this.save();
    return this.getItems();
  }

  public markLaunched(id: string): DeckItem | null {
    const item = this.state.items.find((i) => i.id === id);
    if (!item) return null;
    item.lastLaunchedAt = Date.now();
    this.save();
    return item;
  }

  public registerPairedDevice(deviceName: string): PairedDevice {
    const cleanName = deviceName.trim() || 'Android Phone';
    const existing = this.state.pairedDevices.find((d) => d.name === cleanName);
    if (existing) {
      existing.lastSeenAt = Date.now();
      this.save();
      return existing;
    }
    const dev: PairedDevice = {
      id: crypto.randomUUID(),
      name: cleanName,
      token: crypto.randomBytes(16).toString('hex'),
      pairedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    this.state.pairedDevices.push(dev);
    this.save();
    return dev;
  }

  public markFirewallConfigured(): void {
    if (!this.state.firewallConfigured) {
      this.state.firewallConfigured = true;
      this.save();
    }
  }
}
