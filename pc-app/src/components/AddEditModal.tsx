import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  FolderOpen,
  FilePlus2,
  ImagePlus,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
  X,
  ArrowUp,
  Plus,
} from 'lucide-react';
import { pcApi, resizeImageFileToDataUrl } from '../api';
import {
  DeckItem,
  DiscoveredApp,
  FsEntry,
  FsRoot,
  ItemCategory,
  PresetIconOption,
} from '../types';

interface Props {
  open: boolean;
  editingItem: DeckItem | null;
  existingTargets: Set<string>;
  onClose: () => void;
  onChanged: (items: DeckItem[], toastMsg?: string) => void;
}

const CATEGORIES: Array<{ id: ItemCategory; label: string }> = [
  { id: 'games', label: 'Игры' },
  { id: 'apps', label: 'Приложения' },
  { id: 'media', label: 'Медиа' },
  { id: 'files', label: 'Файлы / Папки' },
  { id: 'work', label: 'Работа' },
];

export const AddEditModal: React.FC<Props> = ({
  open,
  editingItem,
  existingTargets,
  onClose,
  onChanged,
}) => {
  const [tab, setTab] = useState<'catalog' | 'files' | 'custom'>('catalog');
  const [apps, setApps] = useState<DiscoveredApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');

  // File browser state
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [currentDir, setCurrentDir] = useState<string>('');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loadingFs, setLoadingFs] = useState(false);

  // Custom / Edit form state
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [args, setArgs] = useState('');
  const [category, setCategory] = useState<ItemCategory>('apps');
  const [accent, setAccent] = useState('#00F0FF');
  const [customIconDataUrl, setCustomIconDataUrl] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [presets, setPresets] = useState<PresetIconOption[]>([]);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    pcApi.getPresetIcons().then((r) => setPresets(r.presets)).catch(() => {});

    if (editingItem) {
      setTab('custom');
      setName(editingItem.name);
      setTarget(editingItem.target);
      setArgs(editingItem.args || '');
      setCategory(editingItem.category);
      setAccent(editingItem.accent);
      setCustomIconDataUrl(editingItem.iconDataUrl);
      setSelectedPreset('');
    } else {
      setTab('catalog');
      setName('');
      setTarget('');
      setArgs('');
      setCategory('apps');
      setAccent('#00F0FF');
      setCustomIconDataUrl('');
      setSelectedPreset('');
      loadCatalog(false);
      loadFsRootsAndHome();
    }
  }, [open, editingItem]);

  const loadCatalog = async (refresh: boolean) => {
    setLoadingApps(true);
    try {
      const res = await pcApi.getCatalogApps(refresh);
      setApps(res.apps);
    } catch {
      // ignore
    } finally {
      setLoadingApps(false);
    }
  };

  const loadFsRootsAndHome = async () => {
    try {
      const r = await pcApi.getFsRoots();
      setRoots(r.roots);
      await browseDir(r.roots[0]?.path);
    } catch {
      // ignore
    }
  };

  const browseDir = async (dirPath?: string) => {
    setLoadingFs(true);
    try {
      const res = await pcApi.listDir(dirPath);
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

  const handleAddDiscovered = async (app: DiscoveredApp) => {
    try {
      const res = await pcApi.addItem({
        name: app.name,
        target: app.target,
        args: app.args,
        kind: app.kind,
        category: app.category,
        accent: app.accent,
        iconDataUrl: app.iconDataUrl,
      });
      onChanged(res.items, `Добавлено: ${app.name}`);
    } catch (err: any) {
      alert(err?.message || 'Ошибка добавления');
    }
  };

  const handleNativePickFiles = async () => {
    if (!window.nexusDesktop) return;
    const paths = await window.nexusDesktop.pickFiles();
    if (paths.length > 0) {
      const res = await pcApi.addMultipleTargets(paths);
      onChanged(res.items, `Добавлено элементов: ${paths.length}`);
      onClose();
    }
  };

  const handleNativePickFolder = async () => {
    if (!window.nexusDesktop) return;
    const folder = await window.nexusDesktop.pickFolder();
    if (folder) {
      const res = await pcApi.addItem({ target: folder, kind: 'folder', category: 'files' });
      onChanged(res.items, `Папка добавлена: ${res.item.name}`);
      onClose();
    }
  };

  const handleAddFsEntry = async (entry: FsEntry) => {
    const res = await pcApi.addItem({
      name: entry.name.replace(/\.(exe|lnk|url)$/i, ''),
      target: entry.path,
      kind: entry.kind,
    });
    onChanged(res.items, `Добавлено: ${res.item.name}`);
  };

  const handleUploadIcon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await resizeImageFileToDataUrl(f, 128);
    setCustomIconDataUrl(dataUrl);
    setSelectedPreset('');
  };

  const handleNativePickIcon = async () => {
    if (window.nexusDesktop) {
      const dataUrl = await window.nexusDesktop.pickIconImage();
      if (dataUrl) {
        setCustomIconDataUrl(dataUrl);
        setSelectedPreset('');
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleSaveCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim()) return;
    setSaving(true);
    try {
      if (editingItem) {
        const iconChanged = customIconDataUrl && customIconDataUrl !== editingItem.iconDataUrl;
        const res = await pcApi.updateItem(editingItem.id, {
          name: name.trim() || undefined,
          target: target.trim(),
          args: args.trim(),
          category,
          accent,
          iconDataUrl: iconChanged ? customIconDataUrl : undefined,
          iconPreset: selectedPreset || undefined,
        });
        onChanged(res.items, `Сохранено: ${res.item.name}`);
      } else {
        const res = await pcApi.addItem({
          name: name.trim() || undefined,
          target: target.trim(),
          args: args.trim() || undefined,
          category,
          accent,
          iconDataUrl: selectedPreset ? undefined : customIconDataUrl || undefined,
          iconPreset: selectedPreset || undefined,
        });
        onChanged(res.items, `Добавлено: ${res.item.name}`);
      }
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const filteredApps = apps.filter(
    (a) =>
      !catalogQuery.trim() ||
      a.name.toLowerCase().includes(catalogQuery.toLowerCase()) ||
      a.target.toLowerCase().includes(catalogQuery.toLowerCase())
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {editingItem
              ? `НАСТРОЙКА // ${editingItem.name.toUpperCase()}`
              : 'ДОБАВИТЬ НА ПАНЕЛЬ ЗАПУСКА'}
          </h3>
          <button className="win-btn close" onClick={onClose} title="Закрыть">
            <X size={16} />
          </button>
        </div>

        {!editingItem && (
          <div className="modal-tabs">
            <button
              className={`modal-tab ${tab === 'catalog' ? 'active' : ''}`}
              onClick={() => setTab('catalog')}
            >
              Приложения ПК ({apps.length})
            </button>
            <button
              className={`modal-tab ${tab === 'files' ? 'active' : ''}`}
              onClick={() => setTab('files')}
            >
              Файлы и Папки
            </button>
            <button
              className={`modal-tab ${tab === 'custom' ? 'active' : ''}`}
              onClick={() => setTab('custom')}
            >
              Своя ссылка / Иконка
            </button>
          </div>
        )}

        <div className="modal-body">
          {tab === 'catalog' && !editingItem && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div className="search-box" style={{ flex: 1 }}>
                  <Search size={15} />
                  <input
                    style={{ width: '100%' }}
                    placeholder="Поиск установленных программ и игр..."
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                  />
                </div>
                <button
                  className="btn-ghost"
                  onClick={() => loadCatalog(true)}
                  disabled={loadingApps}
                >
                  <RefreshCw size={14} />
                  Обновить
                </button>
              </div>

              {loadingApps ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Сканирование ярлыков и извлечение иконок...
                </div>
              ) : (
                <div className="catalog-grid">
                  {filteredApps.map((app) => {
                    const alreadyAdded = existingTargets.has(app.target.toLowerCase());
                    return (
                      <div
                        key={app.id}
                        className="catalog-row"
                        onClick={() => handleAddDiscovered(app)}
                      >
                        <img src={app.iconDataUrl} alt={app.name} />
                        <div className="catalog-row-info">
                          <div className="catalog-row-title">{app.name}</div>
                          <div className="catalog-row-path">{app.target}</div>
                        </div>
                        {alreadyAdded ? (
                          <Check size={16} color="var(--volt)" />
                        ) : (
                          <Plus size={16} color="var(--cyan)" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'files' && !editingItem && (
            <>
              {window.nexusDesktop && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-volt" onClick={handleNativePickFiles}>
                    <FilePlus2 size={15} />
                    Выбрать файлы / .exe в Windows
                  </button>
                  <button className="btn-ghost" onClick={handleNativePickFolder}>
                    <FolderOpen size={15} />
                    Выбрать папку
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {roots.map((r) => (
                  <button
                    key={r.path}
                    className={`cat-pill ${currentDir === r.path ? 'active' : ''}`}
                    onClick={() => browseDir(r.path)}
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
                  padding: '7px 10px',
                  borderRadius: 9,
                  background: 'rgba(6,8,13,0.7)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentDir}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {currentDir && (
                    <button
                      className="btn-ghost"
                      style={{ padding: '4px 9px', fontSize: 11 }}
                      onClick={async () => {
                        const res = await pcApi.addItem({
                          target: currentDir,
                          kind: 'folder',
                          category: 'files',
                        });
                        onChanged(res.items, `Папка добавлена: ${res.item.name}`);
                      }}
                    >
                      + Эту папку
                    </button>
                  )}
                  {parentDir && (
                    <button
                      className="btn-ghost"
                      style={{ padding: '4px 9px', fontSize: 11 }}
                      onClick={() => browseDir(parentDir)}
                    >
                      <ArrowUp size={13} /> Вверх
                    </button>
                  )}
                </div>
              </div>

              <div className="fs-browser-list">
                {loadingFs ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Загрузка содержимого...
                  </div>
                ) : (
                  entries.map((entry) => (
                    <div key={entry.path} className="fs-item-row">
                      <div
                        className="fs-item-left"
                        onClick={() => (entry.isDirectory ? browseDir(entry.path) : handleAddFsEntry(entry))}
                      >
                        <img src={entry.iconDataUrl} alt="" />
                        <div style={{ minWidth: 0 }}>
                          <div className="catalog-row-title">{entry.name}</div>
                          <div className="catalog-row-path">
                            {entry.isDirectory ? 'Папка' : entry.ext || 'Файл'}
                          </div>
                        </div>
                      </div>
                      <button
                        className="btn-ghost"
                        style={{ padding: '5px 10px', fontSize: 11.5 }}
                        onClick={() => handleAddFsEntry(entry)}
                      >
                        <Plus size={13} /> На пульт
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {tab === 'custom' && (
            <form onSubmit={handleSaveCustom} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field-group">
                  <label>Название на плитке</label>
                  <input
                    className="cyber-input"
                    placeholder="Например: Cyberpunk 2077 или Кино"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label>Категория</label>
                  <select
                    className="cyber-input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ItemCategory)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field-group">
                <label>Путь на ПК (.exe, файл, папка) или URL (https://, steam://)</label>
                <input
                  className="cyber-input"
                  required
                  placeholder="C:\Games\Game.exe или https://youtube.com"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 12 }}>
                <div className="field-group">
                  <label>Аргументы запуска (необязательно)</label>
                  <input
                    className="cyber-input"
                    placeholder="-fullscreen --novid"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label>Неоновый цвет</label>
                  <input
                    type="color"
                    className="cyber-input"
                    style={{ height: 37, padding: 4, cursor: 'pointer' }}
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                  />
                </div>
              </div>

              <div className="field-group">
                <label>Иконка (синхронизируется между ПК и телефоном автоматически)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                  <div className="keycap-icon-lens" style={{ margin: 0, flexShrink: 0 }}>
                    {customIconDataUrl ? (
                      <img src={customIconDataUrl} alt="preview" />
                    ) : (
                      <Sparkles size={22} color="var(--cyan)" />
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn-ghost" onClick={handleNativePickIcon}>
                      <ImagePlus size={14} /> Своя картинка / .ico
                    </button>
                    {editingItem && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={async () => {
                          const res = await pcApi.updateItem(editingItem.id, { refreshIcon: true });
                          setCustomIconDataUrl(res.item.iconDataUrl);
                          onChanged(res.items, 'Иконка обновлена из файла');
                        }}
                      >
                        <Upload size={14} /> Извлечь из файла
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.ico"
                      style={{ display: 'none' }}
                      onChange={handleUploadIcon}
                    />
                  </div>
                </div>
              </div>

              {presets.length > 0 && (
                <div className="field-group">
                  <label>Или выберите неоновую иконку NEXUS:</label>
                  <div className="preset-strip">
                    {presets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`preset-btn ${selectedPreset === p.id ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedPreset(p.id);
                          setCustomIconDataUrl(p.iconDataUrl);
                          setAccent(p.accent);
                        }}
                      >
                        <img src={p.iconDataUrl} alt={p.label} />
                        <span>{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button type="button" className="btn-ghost" onClick={onClose}>
                  Отмена
                </button>
                <button type="submit" className="btn-volt" disabled={saving}>
                  {saving ? 'Сохранение...' : editingItem ? 'Сохранить изменения' : 'Добавить на пульт'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
