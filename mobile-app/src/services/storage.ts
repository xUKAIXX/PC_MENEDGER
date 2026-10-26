import { DeckItem, SavedPcProfile } from '../types';

const PROFILES_KEY = 'nexus_saved_pcs_v1';
const ACTIVE_PC_KEY = 'nexus_active_pc_v1';
const GRID_COLS_KEY = 'nexus_grid_cols_v1';

const DB_NAME = 'nexus_mobile_cache_v1';
const STORE_NAME = 'pc_items';

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function loadSavedPcs(): SavedPcProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSavedPcs(pcs: SavedPcProfile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(pcs));
  } catch {
    // ignore
  }
}

export function upsertSavedPc(pc: SavedPcProfile): SavedPcProfile[] {
  const list = loadSavedPcs();
  const idx = list.findIndex((p) => p.id === pc.id || (p.ip === pc.ip && p.port === pc.port));
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      ...pc,
      mac: pc.mac || prev.mac,
      macs: pc.macs?.length ? pc.macs : prev.macs,
      broadcastIp: pc.broadcastIp || prev.broadcastIp,
      pin: pc.pin !== undefined ? pc.pin : prev.pin,
    };
  } else {
    list.unshift(pc);
  }
  saveSavedPcs(list);
  return list;
}

export function removeSavedPc(id: string): SavedPcProfile[] {
  const next = loadSavedPcs().filter((p) => p.id !== id);
  saveSavedPcs(next);
  return next;
}

export function getActivePcId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PC_KEY);
  } catch {
    return null;
  }
}

export function setActivePcId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PC_KEY, id);
  } catch {
    // ignore
  }
}

export function getGridCols(): 2 | 3 {
  try {
    return localStorage.getItem(GRID_COLS_KEY) === '3' ? 3 : 2;
  } catch {
    return 2;
  }
}

export function setGridCols(cols: 2 | 3): void {
  try {
    localStorage.setItem(GRID_COLS_KEY, String(cols));
  } catch {
    // ignore
  }
}

export async function loadCachedItemsForPc(pcId: string): Promise<DeckItem[]> {
  try {
    const db = await openCacheDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(pcId);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function saveCachedItemsForPc(pcId: string, items: DeckItem[]): Promise<void> {
  try {
    const db = await openCacheDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(items, pcId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}
