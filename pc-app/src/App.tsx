import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Copy,
  Cpu,
  Edit3,
  FilePlus2,
  FolderPlus,
  HardDrive,
  Maximize2,
  Minus,
  Play,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Smartphone,
  Square,
  Trash2,
  UploadCloud,
  Wifi,
  X,
} from 'lucide-react';
import { getWsUrl, pcApi } from './api';
import { AddEditModal } from './components/AddEditModal';
import { DeckItem, ItemCategory, PcNetworkInfo, PcStats } from './types';

const KIND_LABELS: Record<DeckItem['kind'], string> = {
  app: 'APP',
  file: 'FILE',
  folder: 'DIR',
  url: 'WEB',
  script: 'CMD',
};

const FILTER_TABS: Array<{ id: 'all' | ItemCategory; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'games', label: 'Игры' },
  { id: 'apps', label: 'Приложения' },
  { id: 'media', label: 'Медиа' },
  { id: 'files', label: 'Файлы' },
  { id: 'work', label: 'Работа' },
];

function hexToGlow(hex: string, alpha = 0.22): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(0, 240, 255, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const App: React.FC = () => {
  const [pcInfo, setPcInfo] = useState<PcNetworkInfo | null>(null);
  const [stats, setStats] = useState<PcStats>({
    cpuPercent: 0,
    ramPercent: 0,
    ramUsedGb: 0,
    ramTotalGb: 0,
    uptimeSec: 0,
  });
  const [items, setItems] = useState<DeckItem[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [connectedClients, setConnectedClients] = useState<number>(0);
  const [autostart, setAutostart] = useState<boolean>(true);
  const [pin, setPin] = useState<string>('');
  const [pcNameInput, setPcNameInput] = useState<string>('');

  const [selectedAdapterIdx, setSelectedAdapterIdx] = useState<number>(0);
  const [qrSvg, setQrSvg] = useState<string>('');

  const [filterCat, setFilterCat] = useState<'all' | ItemCategory>('all');
  const [search, setSearch] = useState<string>('');
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<DeckItem | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [flashedId, setFlashedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const dragCounter = useRef(0);
  const toastTimer = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const loadInitial = async () => {
      try {
        const st = await pcApi.getState();
        setPcInfo(st.pcInfo);
        setPcNameInput(st.pcInfo.name);
        setStats(st.stats);
        setItems(st.items);
        setRunningIds(new Set(st.runningIds));
        setAutostart(st.autostart);
        setConnectedClients(st.connectedClients);
        setPin(st.pin || '');
      } catch {
        // retry via ws
      }
    };

    const connectWs = () => {
      if (disposed) return;
      ws = new WebSocket(getWsUrl());
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'init') {
            setPcInfo(msg.pcInfo);
            setPcNameInput(msg.pcInfo.name);
            setStats(msg.stats);
            setItems(msg.items);
            setRunningIds(new Set(msg.runningIds || []));
            setConnectedClients(msg.connectedClients || 0);
          } else if (msg.type === 'items:sync') {
            setItems(msg.items);
            if (msg.pcInfo) setPcInfo(msg.pcInfo);
          } else if (msg.type === 'telemetry') {
            setStats(msg.stats);
            setRunningIds(new Set(msg.runningIds || []));
            setConnectedClients(msg.connectedClients || 0);
          } else if (msg.type === 'launch:event') {
            setFlashedId(msg.id);
            window.setTimeout(() => setFlashedId(null), 650);
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = window.setTimeout(connectWs, 2000);
        }
      };
    };

    loadInitial();
    connectWs();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const activeAdapter = useMemo(() => {
    if (!pcInfo || pcInfo.adapters.length === 0) return null;
    return pcInfo.adapters[selectedAdapterIdx] || pcInfo.adapters[0];
  }, [pcInfo, selectedAdapterIdx]);

  const activeIp = activeAdapter?.ip || pcInfo?.primaryIp || '127.0.0.1';
  const activeMac = activeAdapter?.mac || pcInfo?.primaryMac || '';
  const activeBroadcast = activeAdapter?.broadcastIp || pcInfo?.broadcastIp || '255.255.255.255';

  useEffect(() => {
    if (!pcInfo) return;
    const pairPayload = JSON.stringify({
      v: 1,
      name: pcInfo.name,
      ip: activeIp,
      port: pcInfo.port,
      mac: activeMac,
      broadcast: activeBroadcast,
    });
    QRCode.toString(pairPayload, {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#C8FF2E',
        light: '#0A0E17',
      },
    })
      .then(setQrSvg)
      .catch(() => {});
  }, [pcInfo, activeIp, activeMac, activeBroadcast]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filterCat !== 'all' && item.category !== filterCat) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.target.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, filterCat, search]);

  const existingTargets = useMemo(
    () => new Set(items.map((i) => i.target.toLowerCase())),
    [items]
  );

  // Drag & Drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const paths: string[] = [];
    for (const f of files) {
      const p = window.nexusDesktop?.getPathForFile(f) || (f as any).path;
      if (p) paths.push(p);
    }

    if (paths.length > 0) {
      try {
        const res = await pcApi.addMultipleTargets(paths);
        setItems(res.items);
        showToast(`Добавлено файлов с иконками: ${paths.length}`);
      } catch (err: any) {
        showToast(err?.message || 'Ошибка добавления');
      }
    }
  };

  const handleQuickPickFiles = async () => {
    if (window.nexusDesktop) {
      const paths = await window.nexusDesktop.pickFiles();
      if (paths.length > 0) {
        const res = await pcApi.addMultipleTargets(paths);
        setItems(res.items);
        showToast(`Добавлено: ${paths.length}`);
      }
    } else {
      setEditingItem(null);
      setModalOpen(true);
    }
  };

  const handleQuickPickFolder = async () => {
    if (window.nexusDesktop) {
      const folder = await window.nexusDesktop.pickFolder();
      if (folder) {
        const res = await pcApi.addItem({ target: folder, kind: 'folder', category: 'files' });
        setItems(res.items);
        showToast(`Папка добавлена: ${res.item.name}`);
      }
    } else {
      setEditingItem(null);
      setModalOpen(true);
    }
  };

  const handleLaunch = async (item: DeckItem) => {
    try {
      setFlashedId(item.id);
      window.setTimeout(() => setFlashedId(null), 650);
      await pcApi.launchItem(item.id);
      showToast(`Запущено: ${item.name}`);
    } catch (err: any) {
      showToast(err?.message || 'Ошибка запуска');
    }
  };

  const handleDelete = async (e: React.MouseEvent, item: DeckItem) => {
    e.stopPropagation();
    const res = await pcApi.deleteItem(item.id);
    setItems(res.items);
    showToast(`Удалено: ${item.name}`);
  };

  const handleToggleAutostart = async () => {
    const next = !autostart;
    setAutostart(next);
    const res = await pcApi.saveSettings({ autostart: next });
    setAutostart(res.autostart);
    showToast(next ? 'Автозапуск с Windows включён' : 'Автозапуск выключен');
  };

  const handleSaveHostSettings = async () => {
    const res = await pcApi.saveSettings({ pcName: pcNameInput, pin });
    setPcInfo(res.pcInfo);
    setPin(res.pin);
    showToast('Настройки ПК сохранены');
  };

  const handleWindowsSetup = async () => {
    const res = await pcApi.runWindowsSetup();
    if (res.ok) {
      showToast('Firewall и Wake-on-LAN успешно настроены!');
    } else {
      showToast(res.error || 'Подтвердите запрос администратора');
    }
  };

  const copyText = (value: string, label: string) => {
    navigator.clipboard?.writeText(value);
    showToast(`${label} скопирован: ${value}`);
  };

  return (
    <div
      className="pc-shell"
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Frameless Cyber Titlebar */}
      <header className="titlebar">
        <div className="titlebar-brand">
          <img src="./logo.png" alt="NEXUS" className="titlebar-logo" />
          <div className="titlebar-name">
            NEXUS <span className="slash">//</span> PC DECK
          </div>
        </div>

        <div className="titlebar-telemetry">
          <div className="status-chip">
            <span className="pulse-dot" />
            <span>
              ONLINE : {pcInfo?.port || 7788}
              {connectedClients > 0 ? ` • ТЕЛЕФОНОВ: ${connectedClients}` : ''}
            </span>
          </div>
          <div className="metric-pill">
            <Cpu size={13} color="var(--cyan)" />
            <span>CPU</span>
            <strong>{stats.cpuPercent}%</strong>
          </div>
          <div className="metric-pill">
            <HardDrive size={13} color="var(--volt)" />
            <span>RAM</span>
            <strong>
              {stats.ramUsedGb}/{stats.ramTotalGb} ГБ
            </strong>
          </div>
        </div>

        {window.nexusDesktop ? (
          <div className="win-controls">
            <button
              className="win-btn"
              title="Свернуть"
              onClick={() => window.nexusDesktop?.minimizeWindow()}
            >
              <Minus size={14} />
            </button>
            <button
              className="win-btn"
              title="Развернуть"
              onClick={() => window.nexusDesktop?.toggleMaximizeWindow()}
            >
              <Maximize2 size={13} />
            </button>
            <button
              className="win-btn close"
              title="Свернуть в трей (сервер продолжит работу)"
              onClick={() => window.nexusDesktop?.hideToTray()}
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <div style={{ width: 60 }} />
        )}
      </header>

      {/* Main Split Workspace */}
      <div className="workspace">
        <main className="deck-column">
          <div className="deck-toolbar">
            <div className="toolbar-left">
              <button
                className="btn-volt"
                onClick={() => {
                  setEditingItem(null);
                  setModalOpen(true);
                }}
              >
                <Plus size={16} strokeWidth={2.8} />
                ДОБАВИТЬ
              </button>
              <button className="btn-ghost" onClick={handleQuickPickFiles}>
                <FilePlus2 size={15} color="var(--cyan)" />+ Приложение / Файл
              </button>
              <button className="btn-ghost" onClick={handleQuickPickFolder}>
                <FolderPlus size={15} color="var(--amber)" />+ Папка
              </button>
            </div>

            <div className="search-box">
              <Search size={15} />
              <input
                placeholder="Быстрый фильтр..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="category-strip">
            <div className="cat-pills">
              {FILTER_TABS.map((t) => (
                <button
                  key={t.id}
                  className={`cat-pill ${filterCat === t.id ? 'active' : ''}`}
                  onClick={() => setFilterCat(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="drop-hint">Перетащите сюда любой .exe, ярлык или файл</span>
          </div>

          {/* Tactile Hardware Keycap Grid */}
          <div className="deck-grid">
            {filteredItems.map((item) => {
              const isRunning = runningIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`keycap-card ${flashedId === item.id ? 'launched-flash' : ''}`}
                  style={
                    {
                      '--card-accent': item.accent,
                      '--card-glow': hexToGlow(item.accent, 0.2),
                    } as React.CSSProperties
                  }
                  onClick={() => handleLaunch(item)}
                >
                  <div className="keycap-top">
                    {isRunning ? (
                      <span className="live-badge">LIVE</span>
                    ) : (
                      <span className="kind-tag">{KIND_LABELS[item.kind]}</span>
                    )}

                    <div className="keycap-actions" onClick={(e) => e.stopPropagation()}>
                      {isRunning ? (
                        <button
                          className="mini-icon-btn danger"
                          title="Закрыть процесс"
                          onClick={async () => {
                            await pcApi.killItem(item.id);
                            showToast(`Закрыто: ${item.name}`);
                          }}
                        >
                          <Square size={11} />
                        </button>
                      ) : (
                        <button
                          className="mini-icon-btn"
                          title="Запустить"
                          onClick={() => handleLaunch(item)}
                        >
                          <Play size={11} />
                        </button>
                      )}
                      <button
                        className="mini-icon-btn"
                        title="Изменить иконку или путь"
                        onClick={() => {
                          setEditingItem(item);
                          setModalOpen(true);
                        }}
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        className="mini-icon-btn danger"
                        title="Удалить"
                        onClick={(e) => handleDelete(e, item)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  <div className="keycap-icon-lens">
                    <img src={item.iconDataUrl} alt={item.name} />
                  </div>

                  <div>
                    <div className="keycap-title" title={item.name}>
                      {item.name}
                    </div>
                    <div className="keycap-sub" title={item.target}>
                      {item.target}
                    </div>
                  </div>
                </div>
              );
            })}

            <div
              className="add-slot-card"
              onClick={() => {
                setEditingItem(null);
                setModalOpen(true);
              }}
            >
              <Plus size={26} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Добавить элемент</span>
            </div>
          </div>
        </main>

        {/* Right Dock: Phone Connection + Wake-on-LAN + Quick Setup */}
        <aside className="side-dock">
          <div className="dock-card">
            <div className="dock-header">
              <span>СВЯЗЬ С ТЕЛЕФОНОМ</span>
              <Smartphone size={15} color="var(--volt)" />
            </div>

            {qrSvg ? (
              <div
                className="qr-frame"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
                title="Данные подключения для Android"
              />
            ) : (
              <div className="qr-frame">
                <QrCode size={42} color="var(--volt)" />
              </div>
            )}

            {pcInfo && pcInfo.adapters.length > 1 && (
              <select
                className="adapter-select"
                value={selectedAdapterIdx}
                onChange={(e) => setSelectedAdapterIdx(Number(e.target.value))}
              >
                {pcInfo.adapters.map((ad, idx) => (
                  <option key={`${ad.name}-${ad.ip}`} value={idx}>
                    {ad.name} — {ad.ip}
                  </option>
                ))}
              </select>
            )}

            <div className="net-kv-list">
              <div
                className="net-kv"
                style={{ cursor: 'pointer' }}
                onClick={() => copyText(activeIp, 'IP адрес')}
                title="Нажмите, чтобы скопировать IP"
              >
                <span className="label">IP адрес ПК</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code>{activeIp}</code>
                  <Copy size={12} color="var(--text-dim)" />
                </div>
              </div>

              <div
                className="net-kv"
                style={{ cursor: 'pointer' }}
                onClick={() => activeMac && copyText(activeMac, 'MAC адрес')}
                title="MAC сохраняется на телефоне автоматически для Wake-on-LAN"
              >
                <span className="label">MAC (WoL)</span>
                <code>{activeMac || 'Авто'}</code>
              </div>

              <div className="net-kv">
                <span className="label">Порт / Автопоиск</span>
                <code style={{ color: 'var(--volt)' }}>{pcInfo?.port || 7788} • Wi-Fi</code>
              </div>
            </div>
          </div>

          <div className="dock-card">
            <div className="dock-header">
              <span>WAKE-ON-LAN И СИСТЕМА</span>
              <Wifi size={15} color="var(--cyan)" />
            </div>

            <button className="btn-cyan-outline" onClick={handleWindowsSetup}>
              <ShieldCheck size={16} />
              Настроить WoL + Firewall (1 клик)
            </button>

            <div className="switch-row">
              <span>Автозапуск с Windows</span>
              <button
                type="button"
                className={`cyber-switch ${autostart ? 'on' : ''}`}
                onClick={handleToggleAutostart}
              />
            </div>

            <div className="field-group">
              <label>Имя ПК на телефоне</label>
              <input
                className="cyber-input"
                value={pcNameInput}
                onChange={(e) => setPcNameInput(e.target.value)}
                onBlur={handleSaveHostSettings}
              />
            </div>

            <div className="field-group">
              <label>PIN-код защиты (пусто = без PIN)</label>
              <input
                className="cyber-input"
                placeholder="Необязательно"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onBlur={handleSaveHostSettings}
              />
            </div>
          </div>
        </aside>
      </div>

      {isDraggingOver && (
        <div className="drop-overlay">
          <UploadCloud size={54} color="var(--cyan)" />
          <h2>ОТПУСТИТЕ ФАЙЛЫ ИЛИ ЯРЛЫКИ</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Иконки автоматически извлекутся и появятся на ПК и телефоне
          </p>
        </div>
      )}

      <AddEditModal
        open={modalOpen}
        editingItem={editingItem}
        existingTargets={existingTargets}
        onClose={() => setModalOpen(false)}
        onChanged={(nextItems, msg) => {
          setItems(nextItems);
          if (msg) showToast(msg);
        }}
      />

      {toast && <div className="cyber-toast">{toast}</div>}
    </div>
  );
};
