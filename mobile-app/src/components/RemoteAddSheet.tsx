import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ImagePlus,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { triggerHaptic } from '../plugins/wolLan';
import { mobilePcApi, resizeGalleryImageToDataUrl } from '../services/pcClient';
import {
  DeckItem,
  DiscoveredApp,
  FsEntry,
  FsRoot,
  ItemCategory,
  PresetIconOption,
  SavedPcProfile,
} from '../types';

interface Props {
  open: boolean;
  pc: SavedPcProfile | null;
  isOnline: boolean;
  editingItem: DeckItem | null;
  existingTargets: Set<string>;
  onClose: () => void;
  onItemsUpdated: (items: DeckItem[], msg?: string) => void;
  onNotify: (msg: string) => void;
}

const CATEGORIES: Array<{ id: ItemCategory; label: string }> = [
  { id: 'games', label: 'Игры' },
  { id: 'apps', label: 'Приложения' },
  { id: 'media', label: 'Медиа' },
  { id: 'files', label: 'Файлы' },
  { id: 'work', label: 'Работа' },
];

export const RemoteAddSheet: React.FC<Props> = ({
  open,
  pc,
  isOnline,
  editingItem,
  existingTargets,
  onClose,
  onItemsUpdated,
  onNotify,
}) => {
  const [tab, setTab] = useState<'apps' | 'files' | 'custom'>('apps');
  const [apps, setApps] = useState<DiscoveredApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [appQuery, setAppQuery] = useState('');

  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loadingFs, setLoadingFs] = useState(false);

  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [args, setArgs] = useState('');
  const [category, setCategory] = useState<ItemCategory>('apps');
  const [accent, setAccent] = useState('#C8FF2E');
  const [iconDataUrl, setIconDataUrl] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presets, setPresets] = useState<PresetIconOption[]>([]);
  const [saving, setSaving] = useState(false);

  const galleryRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !pc) return;
    if (isOnline) {
      mobilePcApi.getPresetIcons(pc).then((r) => setPresets(r.presets)).catch(() => {});
    }

    if (editingItem) {
      setTab('custom');
      setName(editingItem.name);
      setTarget(editingItem.target);
      setArgs(editingItem.args || '');
      setCategory(editingItem.category);
      setAccent(editingItem.accent);
      setIconDataUrl(editingItem.iconDataUrl);
      setSelectedPreset('');
    } else {
      setTab(isOnline ? 'apps' : 'custom');
      setName('');
      setTarget('');
      setArgs('');
      setCategory('apps');
      setAccent('#C8FF2E');
      setIconDataUrl('');
      setSelectedPreset('');
      if (isOnline) {
        loadCatalog(false);
        initRemoteExplorer();
      }
    }
  }, [open, pc, isOnline, editingItem]);

  const loadCatalog = async (refresh: boolean) => {
    if (!pc || !isOnline) return;
    setLoadingApps(true);
    try {
      const res = await mobilePcApi.getCatalogApps(pc, refresh);
      setApps(res.apps);
    } catch {
      // ignore
    } finally {
      setLoadingApps(false);
    }
  };

  const initRemoteExplorer = async () => {
    if (!pc || !isOnline) return;
    try {
      const r = await mobilePcApi.getFsRoots(pc);
      setRoots(r.roots);
      await openRemoteDir(r.roots[0]?.path);
    } catch {
      // ignore
    }
  };

  const openRemoteDir = async (dir?: string) => {
    if (!pc || !isOnline) return;
    setLoadingFs(true);
    try {
      const res = await mobilePcApi.listDir(pc, dir);
      setCurrentDir(res.currentPath);
      setParentDir(res.parentPath);
      setEntries(res.entries);
    } catch {
      // ignore
    } finally {
      setLoadingFs(false);
    }
  };

  if (!open) return null;

  const handleAddApp = async (app: DiscoveredApp) => {
    if (!pc) return;
    triggerHaptic(18);
    try {
      const res = await mobilePcApi.addItem(pc, {
        name: app.name,
        target: app.target,
        args: app.args,
        kind: app.kind,
        category: app.category,
        accent: app.accent,
        iconDataUrl: app.iconDataUrl,
      });
      onItemsUpdated(res.items, `Добавлено: ${app.name}`);
    } catch (err: any) {
      onNotify(err?.message || 'Ошибка добавления');
    }
  };

  const handlePinFsEntry = async (entry: FsEntry) => {
    if (!pc) return;
    triggerHaptic(18);
    try {
      const res = await mobilePcApi.addItem(pc, {
        name: entry.name.replace(/\.(exe|lnk|url)$/i, ''),
        target: entry.path,
        kind: entry.kind,
      });
      onItemsUpdated(res.items, `Добавлено: ${res.item.name}`);
    } catch (err: any) {
      onNotify(err?.message || 'Ошибка добавления');
    }
  };

  const handleOpenFsNow = async (entry: FsEntry) => {
    if (!pc) return;
    triggerHaptic(22);
    try {
      await mobilePcApi.openPath(pc, entry.path);
      onNotify(`Открыто на ПК: ${entry.name}`);
    } catch (err: any) {
      onNotify(err?.message || 'Не удалось открыть файл');
    }
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await resizeGalleryImageToDataUrl(f, 128);
    setIconDataUrl(dataUrl);
    setSelectedPreset('');
  };

  const handleSaveCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pc || !isOnline) {
      onNotify('Включите ПК для синхронизации новых элементов');
      return;
    }
    if (!target.trim()) return;
    setSaving(true);
    triggerHaptic(20);
    try {
      if (editingItem) {
        const iconChanged = iconDataUrl && iconDataUrl !== editingItem.iconDataUrl;
        const res = await mobilePcApi.updateItem(pc, editingItem.id, {
          name: name.trim() || undefined,
          target: target.trim(),
          args: args.trim(),
          category,
          accent,
          iconDataUrl: iconChanged ? iconDataUrl : undefined,
          iconPreset: selectedPreset || undefined,
        });
        onItemsUpdated(res.items, `Сохранено: ${res.item.name}`);
      } else {
        const res = await mobilePcApi.addItem(pc, {
          name: name.trim() || undefined,
          target: target.trim(),
          args: args.trim() || undefined,
          category,
          accent,
          iconDataUrl: selectedPreset ? undefined : iconDataUrl || undefined,
          iconPreset: selectedPreset || undefined,
        });
        onItemsUpdated(res.items, `Добавлено: ${res.item.name}`);
      }
      onClose();
    } catch (err: any) {
      onNotify(err?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const filteredApps = apps.filter(
    (a) =>
      !appQuery.trim() ||
      a.name.toLowerCase().includes(appQuery.toLowerCase()) ||
      a.target.toLowerCase().includes(appQuery.toLowerCase())
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{editingItem ? `ИЗМЕНИТЬ // ${editingItem.name}` : 'ДОБАВИТЬ С ТЕЛЕФОНА'}</h3>
          <button className="sheet-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {!editingItem && (
          <div className="sheet-tabs">
            <button
              className={`sheet-tab ${tab === 'apps' ? 'active' : ''}`}
              onClick={() => setTab('apps')}
            >
              Программы ПК
            </button>
            <button
              className={`sheet-tab ${tab === 'files' ? 'active' : ''}`}
              onClick={() => setTab('files')}
            >
              Файлы ПК
            </button>
            <button
              className={`sheet-tab ${tab === 'custom' ? 'active' : ''}`}
              onClick={() => setTab('custom')}
            >
              Сайт / Своё
            </button>
          </div>
        )}

        <div className="sheet-body">
          {!isOnline && !editingItem && (
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                background: 'rgba(0,240,255,0.08)',
                border: '1px solid rgba(0,240,255,0.28)',
                fontSize: 12.5,
                color: 'var(--cyan)',
              }}
            >
              ПК сейчас выключен или не в сети. Включите ПК кнопкой питания сверху, чтобы просматривать установленные программы и диски ПК прямо с телефона!
            </div>
          )}

          {tab === 'apps' && !editingItem && isOnline && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="m-search" style={{ flex: 1 }}>
                  <Search size={15} />
                  <input
                    placeholder="Найти игру или программу на ПК..."
                    value={appQuery}
                    onChange={(e) => setAppQuery(e.target.value)}
                  />
                </div>
                <button
                  className="m-btn-secondary"
                  onClick={() => loadCatalog(true)}
                  disabled={loadingApps}
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              {loadingApps ? (
                <div style={{ padding: 26, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Получаем программы и иконки с ПК...
                </div>
              ) : (
                filteredApps.map((app) => {
                  const exists = existingTargets.has(app.target.toLowerCase());
                  return (
                    <div
                      key={app.id}
                      className="m-list-item"
                      onClick={() => handleAddApp(app)}
                      style={{ cursor: 'pointer' }}
                    >
                      <img src={app.iconDataUrl} alt={app.name} />
                      <div className="m-list-meta">
                        <div className="m-list-title">{app.name}</div>
                        <div className="m-list-sub">{app.target}</div>
                      </div>
                      {exists ? (
                        <Check size={18} color="var(--volt)" />
                      ) : (
                        <Plus size={18} color="var(--cyan)" />
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}

          {tab === 'files' && !editingItem && isOnline && (
            <>
              <div className="m-cats">
                {roots.map((r) => (
                  <button
                    key={r.path}
                    className={`m-cat-pill ${currentDir === r.path ? 'active' : ''}`}
                    onClick={() => openRemoteDir(r.path)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 11,
                  background: 'rgba(6,9,15,0.75)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentDir}
                </span>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {currentDir && (
                    <button
                      className="m-btn-secondary"
                      style={{ padding: '5px 9px', fontSize: 11 }}
                      onClick={async () => {
                        if (!pc) return;
                        const res = await mobilePcApi.addItem(pc, {
                          target: currentDir,
                          kind: 'folder',
                          category: 'files',
                        });
                        onItemsUpdated(res.items, `Папка добавлена: ${res.item.name}`);
                      }}
                    >
                      + Папку
                    </button>
                  )}
                  {parentDir && (
                    <button
                      className="m-btn-secondary"
                      style={{ padding: '5px 9px', fontSize: 11 }}
                      onClick={() => openRemoteDir(parentDir)}
                    >
                      <ArrowUp size={13} />
                    </button>
                  )}
                </div>
              </div>

              {loadingFs ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Открываем папку ПК...
                </div>
              ) : (
                entries.map((entry) => (
                  <div key={entry.path} className="m-list-item">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flex: 1,
                        minWidth: 0,
                        cursor: 'pointer',
                      }}
                      onClick={() =>
                        entry.isDirectory ? openRemoteDir(entry.path) : handleOpenFsNow(entry)
                      }
                    >
                      <img src={entry.iconDataUrl} alt="" />
                      <div className="m-list-meta">
                        <div className="m-list-title">{entry.name}</div>
                        <div className="m-list-sub">
                          {entry.isDirectory ? 'Папка ПК' : entry.ext || 'Файл ПК'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      {!entry.isDirectory && (
                        <button
                          className="m-btn-secondary"
                          style={{ padding: '7px 9px' }}
                          title="Запустить сейчас на ПК"
                          onClick={() => handleOpenFsNow(entry)}
                        >
                          <Play size={13} color="var(--volt)" />
                        </button>
                      )}
                      <button
                        className="m-btn-secondary"
                        style={{ padding: '7px 10px', fontSize: 11 }}
                        onClick={() => handlePinFsEntry(entry)}
                      >
                        <Plus size={14} color="var(--cyan)" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'custom' && (
            <form onSubmit={handleSaveCustom} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <input
                className="m-input"
                placeholder="Название (например: Кинопоиск, Фильмы, CS2)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="m-input"
                required
                placeholder="URL (https://...) или путь на ПК (D:\Games\...)"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
                <select
                  className="m-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ItemCategory)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="color"
                  className="m-input"
                  style={{ height: 43, padding: 4 }}
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="m-icon-lens" style={{ flexShrink: 0 }}>
                  {iconDataUrl ? (
                    <img src={iconDataUrl} alt="icon" />
                  ) : (
                    <Sparkles size={20} color="var(--cyan)" />
                  )}
                </div>
                <button
                  type="button"
                  className="m-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => galleryRef.current?.click()}
                >
                  <ImagePlus size={15} /> Иконка из галереи телефона
                </button>
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleGalleryUpload}
                />
              </div>

              {presets.length > 0 && (
                <div className="m-preset-grid">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`m-preset-item ${selectedPreset === p.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedPreset(p.id);
                        setIconDataUrl(p.iconDataUrl);
                        setAccent(p.accent);
                      }}
                    >
                      <img src={p.iconDataUrl} alt={p.label} />
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              )}

              <button type="submit" className="m-btn-primary" disabled={saving || !isOnline}>
                {saving
                  ? 'Синхронизация с ПК...'
                  : editingItem
                  ? 'СОХРАНИТЬ И СИНХРОНИЗИРОВАТЬ'
                  : 'ДОБАВИТЬ НА ПК И ТЕЛЕФОН'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
