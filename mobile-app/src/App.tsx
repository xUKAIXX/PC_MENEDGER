import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Edit3,
  FolderSearch,
  LayoutGrid,
  MoreHorizontal,
  Play,
  Plus,
  Power,
  Search,
  Sliders,
  Square,
  Trash2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { ControlSheet } from './components/ControlSheet';
import { PairSheet } from './components/PairSheet';
import { RemoteAddSheet } from './components/RemoteAddSheet';
import {
  discoverPcsOnWifi,
  sendWakeOnLan,
  triggerHaptic,
} from './plugins/wolLan';
import { getWsEndpoint, mobilePcApi } from './services/pcClient';
import {
  getActivePcId,
  getGridCols,
  loadCachedItemsForPc,
  loadSavedPcs,
  removeSavedPc,
  saveCachedItemsForPc,
  setActivePcId,
  setGridCols,
  upsertSavedPc,
} from './services/storage';
import {
  ControlAction,
  DeckItem,
  ItemCategory,
  PcStats,
  SavedPcProfile,
} from './types';

const KIND_BADGE: Record<DeckItem['kind'], string> = {
  app: 'APP',
  file: 'FILE',
  folder: 'DIR',
  url: 'WEB',
  script: 'CMD',
};

const CATS: Array<{ id: 'all' | ItemCategory; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'games', label: 'Игры' },
  { id: 'apps', label: 'Программы' },
  { id: 'media', label: 'Медиа' },
  { id: 'files', label: 'Файлы' },
  { id: 'work', label: 'Работа' },
];

function hexToRgba(hex: string, alpha = 0.2): string {
  const c = hex.replace('#', '');
  if (c.length !== 6) return `rgba(0, 240, 255, ${alpha})`;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const App: React.FC = () => {
  const [savedPcs, setSavedPcs] = useState<SavedPcProfile[]>(() => loadSavedPcs());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const stored = getActivePcId();
    const pcs = loadSavedPcs();
    return stored && pcs.some((p) => p.id === stored) ? stored : pcs[0]?.id || null;
  });

  const activePc = useMemo(
    () => savedPcs.find((p) => p.id === activeId) || null,
    [savedPcs, activeId]
  );

  const [items, setItems] = useState<DeckItem[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [stats, setStats] = useState<PcStats>({
    cpuPercent: 0,
    ramPercent: 0,
    ramUsedGb: 0,
    ramTotalGb: 0,
    uptimeSec: 0,
  });
  const [shutdownTimerEndsAt, setShutdownTimerEndsAt] = useState<number | null>(null);

  // Wake-on-LAN Boot Radar state
  const [wakingStartedAt, setWakingStartedAt] = useState<number | null>(null);
  const [wakingElapsedSec, setWakingElapsedSec] = useState<number>(0);
  const [pendingWakeLaunchItem, setPendingWakeLaunchItem] = useState<DeckItem | null>(null);

  // UI state
  const [cols, setCols] = useState<2 | 3>(() => getGridCols());
  const [filterCat, setFilterCat] = useState<'all' | ItemCategory>('all');
  const [search, setSearch] = useState('');
  const [flashedId, setFlashedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Sheets
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DeckItem | null>(null);
  const [actionItem, setActionItem] = useState<DeckItem | null>(null);
  const [controlOpen, setControlOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);

  const toastTimer = useRef<number | null>(null);
  const pendingLaunchRef = useRef<DeckItem | null>(null);
  pendingLaunchRef.current = pendingWakeLaunchItem;

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  // First launch auto-discovery if no PC paired yet
  useEffect(() => {
    if (savedPcs.length > 0) return;
    discoverPcsOnWifi(7788).then(async (hosts) => {
      if (hosts.length === 1 && !hosts[0].pinRequired) {
        try {
          const h = hosts[0];
          const res = await mobilePcApi.pair(h.ip, h.port);
          const profile: SavedPcProfile = {
            id: res.pcInfo.serverId || `${h.ip}:${h.port}`,
            name: res.pcInfo.name || h.name,
            ip: h.ip,
            port: res.pcInfo.port || h.port,
            mac: res.pcInfo.primaryMac || h.mac,
            macs: res.pcInfo.macs?.length ? res.pcInfo.macs : h.macs,
            broadcastIp: res.pcInfo.broadcastIp || h.broadcastIp,
            lastSeenAt: Date.now(),
          };
          handlePaired(profile, res.items);
        } catch {
          setPairOpen(true);
        }
      } else {
        setPairOpen(true);
      }
    });
  }, []);

  // Load offline cached icons/items immediately on PC switch
  useEffect(() => {
    if (!activePc) {
      setItems([]);
      setIsOnline(false);
      return;
    }
    loadCachedItemsForPc(activePc.id).then((cached) => {
      if (cached.length > 0) {
        setItems(cached);
      }
    });
  }, [activePc?.id]);

  // Live WebSocket + Ping Polling to Active PC
  useEffect(() => {
    if (!activePc) return;

    let ws: WebSocket | null = null;
    let wsRetryTimer: number | null = null;
    let pingInterval: number | null = null;
    let disposed = false;

    const markOnlineAndUpdateProfile = (pcInfo?: {
      name?: string;
      primaryMac?: string;
      macs?: string[];
      broadcastIp?: string;
    }) => {
      setIsOnline(true);
      setWakingStartedAt(null);

      // Update saved MAC/Broadcast automatically for Wake-on-LAN
      if (pcInfo && (pcInfo.primaryMac || pcInfo.macs?.length)) {
        const nextList = upsertSavedPc({
          ...activePc,
          name: pcInfo.name || activePc.name,
          mac: pcInfo.primaryMac || activePc.mac,
          macs: pcInfo.macs?.length ? pcInfo.macs : activePc.macs,
          broadcastIp: pcInfo.broadcastIp || activePc.broadcastIp,
          lastSeenAt: Date.now(),
        });
        setSavedPcs(nextList);
      }

      // Smart Wake & Launch execution!
      if (pendingLaunchRef.current) {
        const queued = pendingLaunchRef.current;
        setPendingWakeLaunchItem(null);
        triggerHaptic(35);
        mobilePcApi
          .launch(activePc, queued.id)
          .then(() => showToast(`ПК включился! Запущено: ${queued.name}`))
          .catch(() => {});
      }
    };

    let failedPings = 0;
    let searchingLan = false;
    let checkInFlight = false;

    const checkHttpStatus = async () => {
      if (disposed || checkInFlight) return;
      checkInFlight = true;
      const t0 = performance.now();
      try {
        const st = await mobilePcApi.getState(activePc);
        if (disposed) return;
        failedPings = 0;
        setLatencyMs(Math.max(1, Math.round(performance.now() - t0)));
        markOnlineAndUpdateProfile(st.pcInfo);
        setStats(st.stats);
        setItems(st.items);
        saveCachedItemsForPc(activePc.id, st.items);
        setRunningIds(new Set(st.runningIds || []));
        setShutdownTimerEndsAt(st.shutdownTimerEndsAt || null);
      } catch {
        if (disposed) return;
        setIsOnline(false);
        failedPings += 1;

        // Immediately scan Wi-Fi on 1st failure & every 2nd failure to auto-heal DHCP IP changes!
        if (!searchingLan && (failedPings === 1 || failedPings % 2 === 1)) {
          searchingLan = true;
          discoverPcsOnWifi(activePc.port)
            .then((hosts) => {
              if (disposed) return;
              const matched =
                hosts.find(
                  (h) =>
                    h.serverId === activePc.id ||
                    (activePc.mac &&
                      (h.mac === activePc.mac || h.macs?.includes(activePc.mac))) ||
                    h.name.toLowerCase() === activePc.name.toLowerCase()
                ) || (hosts.length === 1 ? hosts[0] : undefined);

              if (matched && matched.ip && matched.ip !== activePc.ip) {
                const updatedList = upsertSavedPc({
                  ...activePc,
                  id: matched.serverId || activePc.id,
                  ip: matched.ip,
                  mac: matched.mac || activePc.mac,
                  macs: matched.macs?.length ? matched.macs : activePc.macs,
                  broadcastIp: matched.broadcastIp || activePc.broadcastIp,
                  lastSeenAt: Date.now(),
                });
                setSavedPcs(updatedList);
              }
            })
            .catch(() => {})
            .finally(() => {
              searchingLan = false;
            });
        }
      } finally {
        checkInFlight = false;
      }
    };

    const connectWs = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(getWsEndpoint(activePc));
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'init') {
              markOnlineAndUpdateProfile(msg.pcInfo);
              setStats(msg.stats);
              setItems(msg.items);
              saveCachedItemsForPc(activePc.id, msg.items);
              setRunningIds(new Set(msg.runningIds || []));
              setShutdownTimerEndsAt(msg.shutdownTimerEndsAt || null);
            } else if (msg.type === 'items:sync') {
              setItems(msg.items);
              saveCachedItemsForPc(activePc.id, msg.items);
              if (msg.pcInfo) markOnlineAndUpdateProfile(msg.pcInfo);
            } else if (msg.type === 'telemetry') {
              setIsOnline(true);
              setStats(msg.stats);
              setRunningIds(new Set(msg.runningIds || []));
              setShutdownTimerEndsAt(msg.shutdownTimerEndsAt || null);
            } else if (msg.type === 'launch:event') {
              setFlashedId(msg.id);
              window.setTimeout(() => setFlashedId(null), 600);
            } else if (msg.type === 'control:event') {
              setShutdownTimerEndsAt(msg.shutdownTimerEndsAt || null);
            }
          } catch {
            // ignore
          }
        };
        ws.onclose = () => {
          if (!disposed) {
            wsRetryTimer = window.setTimeout(connectWs, 3000);
          }
        };
        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        wsRetryTimer = window.setTimeout(connectWs, 3000);
      }
    };

    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        checkHttpStatus();
      }
    };

    checkHttpStatus();
    connectWs();
    pingInterval = window.setInterval(checkHttpStatus, wakingStartedAt ? 1400 : 2500);
    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', checkHttpStatus);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', checkHttpStatus);
      if (wsRetryTimer) window.clearTimeout(wsRetryTimer);
      if (pingInterval) window.clearInterval(pingInterval);
      ws?.close();
    };
  }, [activePc?.id, activePc?.ip, activePc?.port, activePc?.pin, Boolean(wakingStartedAt)]);

  // Boot radar timer counter (up to 120s for slow BIOS / DDR5 cold boots + retry WoL at 7s)
  useEffect(() => {
    if (!wakingStartedAt) {
      setWakingElapsedSec(0);
      return;
    }
    let resentOnce = false;
    const iv = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - wakingStartedAt) / 1000);
      if (elapsed >= 7 && !resentOnce && activePc) {
        resentOnce = true;
        const macList = activePc.macs?.length
          ? activePc.macs
          : activePc.mac
          ? [activePc.mac]
          : [];
        if (macList.length > 0) {
          sendWakeOnLan(macList, activePc.broadcastIp).catch(() => {});
        }
      }
      if (elapsed > 120) {
        setWakingStartedAt(null);
        setPendingWakeLaunchItem(null);
      } else {
        setWakingElapsedSec(elapsed);
      }
    }, 500);
    return () => window.clearInterval(iv);
  }, [wakingStartedAt, activePc]);

  const handlePaired = (profile: SavedPcProfile, syncedItems: DeckItem[]) => {
    const nextList = upsertSavedPc(profile);
    setSavedPcs(nextList);
    setActiveId(profile.id);
    setActivePcId(profile.id);
    setItems(syncedItems);
    saveCachedItemsForPc(profile.id, syncedItems);
    setIsOnline(true);
    showToast(`Подключено к ${profile.name}`);
  };

  const handleWakePc = async (queuedItem?: DeckItem) => {
    if (!activePc) {
      setPairOpen(true);
      return;
    }
    triggerHaptic(35);
    const macList = activePc.macs?.length
      ? activePc.macs
      : activePc.mac
      ? [activePc.mac]
      : [];

    const res = await sendWakeOnLan(macList, activePc.broadcastIp);
    if (!res.ok) {
      showToast(res.error || 'Укажите MAC адрес ПК');
      return;
    }

    setWakingStartedAt(Date.now());
    if (queuedItem) {
      setPendingWakeLaunchItem(queuedItem);
      showToast(`Включаем ПК → запустим ${queuedItem.name}`);
    } else {
      showToast('Magic Packet отправлен! Включаем ПК...');
    }
  };

  const handleTapItem = async (item: DeckItem) => {
    if (!activePc) {
      setPairOpen(true);
      return;
    }
    triggerHaptic(20);
    setFlashedId(item.id);
    window.setTimeout(() => setFlashedId(null), 550);

    if (!isOnline) {
      // Smart Wake & Launch!
      await handleWakePc(item);
      return;
    }

    try {
      await mobilePcApi.launch(activePc, item.id);
      showToast(`Запуск: ${item.name}`);
    } catch (err: any) {
      showToast(err?.message || 'Ошибка запуска на ПК');
    }
  };

  const handleControl = async (action: ControlAction, seconds?: number) => {
    if (!activePc) return;
    try {
      const res = await mobilePcApi.sendControl(activePc, action, seconds);
      setShutdownTimerEndsAt(res.shutdownTimerEndsAt);
      if (action === 'shutdown' || action === 'sleep' || action === 'restart') {
        showToast('Команда питания отправлена на ПК');
        setControlOpen(false);
      } else if (action === 'shutdown_timer') {
        showToast('Таймер выключения установлен');
      } else if (action === 'cancel_shutdown') {
        showToast('Таймер выключения отменён');
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка команды');
    }
  };

  const toggleColumns = () => {
    const next = cols === 2 ? 3 : 2;
    setCols(next);
    setGridCols(next);
    triggerHaptic(12);
  };

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (filterCat !== 'all' && it.category !== filterCat) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          it.name.toLowerCase().includes(q) || it.target.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, filterCat, search]);

  const existingTargets = useMemo(
    () => new Set(items.map((i) => i.target.toLowerCase())),
    [items]
  );

  const reactorState = isOnline ? 'online' : wakingStartedAt ? 'waking' : 'offline';

  return (
    <div className="mobile-shell">
      {/* Top Bar */}
      <header className="m-topbar">
        <div className="m-brand">
          <img src="./logo.png" alt="NEXUS" />
          <div className="m-brand-text">
            NEXUS <span>//</span> DECK
          </div>
        </div>

        <button className="pc-selector-btn" onClick={() => setPairOpen(true)}>
          <Wifi size={13} color={isOnline ? 'var(--volt)' : 'var(--cyan)'} />
          <span>{activePc ? activePc.name : 'Найти ПК'}</span>
          <ChevronDown size={13} color="var(--text-muted)" />
        </button>
      </header>

      {/* Hero Power Reactor & Telemetry Card */}
      <section className={`reactor-card ${reactorState}`}>
        <div className="reactor-info">
          <div className={`state-pill ${reactorState}`}>
            {reactorState === 'online' && `● ONLINE • ${latencyMs || 4}ms`}
            {reactorState === 'waking' && `◉ ЗАПУСК WINDOWS • ${wakingElapsedSec}с`}
            {reactorState === 'offline' && '○ ВЫКЛЮЧЕН • WAKE-ON-LAN'}
          </div>

          <div className="reactor-title">
            {activePc ? activePc.name : 'ПК не выбран'}
          </div>

          {isOnline ? (
            <div className="telemetry-bars">
              <div className="tele-mini">
                <div className="tele-mini-label">
                  <span>CPU</span>
                  <span>{stats.cpuPercent}%</span>
                </div>
                <div className="tele-track">
                  <div
                    className="tele-fill"
                    style={{ width: `${stats.cpuPercent}%`, background: 'var(--cyan)' }}
                  />
                </div>
              </div>
              <div className="tele-mini">
                <div className="tele-mini-label">
                  <span>RAM</span>
                  <span>{stats.ramPercent}%</span>
                </div>
                <div className="tele-track">
                  <div
                    className="tele-fill"
                    style={{ width: `${stats.ramPercent}%`, background: 'var(--volt)' }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="reactor-sub">
              {wakingStartedAt
                ? pendingWakeLaunchItem
                  ? `Ждём отклик ПК для запуска ${pendingWakeLaunchItem.name}...`
                  : 'Отправлен Magic Packet. Ожидание загрузки ПК...'
                : activePc?.mac
                ? `Нажмите кнопку справа, чтобы включить ПК (${activePc.mac})`
                : 'Подключитесь к ПК по Wi-Fi 1 раз для автосохранения WoL'}
            </div>
          )}
        </div>

        <button
          className={`reactor-btn ${reactorState}`}
          onClick={() => (isOnline ? setControlOpen(true) : handleWakePc())}
        >
          {isOnline ? <Power size={24} /> : <Zap size={25} />}
          <span>{isOnline ? 'ПУЛЬТ' : wakingStartedAt ? 'СТАРТ...' : 'ВКЛ ПК'}</span>
        </button>
      </section>

      {/* Search & Category Strip */}
      <div className="m-controls-bar">
        <div className="m-search-row">
          <div className="m-search">
            <Search size={15} />
            <input
              placeholder="Поиск игр, программ, файлов..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="cols-toggle-btn"
            onClick={toggleColumns}
            title="Размер сетки"
          >
            {cols}x
          </button>
        </div>

        <div className="m-cats">
          {CATS.map((c) => (
            <button
              key={c.id}
              className={`m-cat-pill ${filterCat === c.id ? 'active' : ''}`}
              onClick={() => setFilterCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Illuminated Tactile Keycap Deck */}
      <main className="m-deck-scroll">
        {filteredItems.length === 0 ? (
          <div
            style={{
              padding: '44px 20px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <LayoutGrid size={36} color="var(--cyan)" />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>
              {activePc ? 'Панель пока пуста' : 'Подключите ваш ПК'}
            </div>
            <div style={{ fontSize: 12.5, maxWidth: 260 }}>
              {activePc
                ? 'Нажмите зелёную кнопку «+» внизу, чтобы за пару секунд добавить игры, программы и файлы прямо с телефона!'
                : 'Нажмите «Найти ПК в Wi-Fi», чтобы синхронизировать приложения и иконки.'}
            </div>
          </div>
        ) : (
          <div className={`m-deck-grid cols-${cols}`}>
            {filteredItems.map((item) => {
              const isRunning = isOnline && runningIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`m-keycap ${flashedId === item.id ? 'flash' : ''}`}
                  style={
                    {
                      '--k-accent': item.accent,
                      '--k-glow': hexToRgba(item.accent, 0.22),
                    } as React.CSSProperties
                  }
                  onClick={() => handleTapItem(item)}
                >
                  <div className="m-keycap-head">
                    {isRunning ? (
                      <span className="m-live">LIVE</span>
                    ) : (
                      <span className="m-kind">{KIND_BADGE[item.kind]}</span>
                    )}

                    <button
                      className="m-more-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerHaptic(12);
                        setActionItem(item);
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>

                  <div className="m-icon-lens">
                    <img src={item.iconDataUrl} alt={item.name} />
                  </div>

                  <div className="m-keycap-name">{item.name}</div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating Bottom Cyber Navigation Dock */}
      <nav className="bottom-dock">
        <button
          className={`dock-nav-btn ${!addSheetOpen && !controlOpen && !pairOpen ? 'active' : ''}`}
          onClick={() => {
            setAddSheetOpen(false);
            setControlOpen(false);
            setPairOpen(false);
          }}
        >
          <LayoutGrid size={19} />
          <span>Пульт</span>
        </button>

        <button
          className="dock-nav-btn"
          onClick={() => {
            triggerHaptic(15);
            setEditingItem(null);
            setAddSheetOpen(true);
          }}
        >
          <FolderSearch size={19} />
          <span>Файлы ПК</span>
        </button>

        <button
          className="dock-fab"
          onClick={() => {
            triggerHaptic(22);
            setEditingItem(null);
            setAddSheetOpen(true);
          }}
          title="Добавить приложение или файл"
        >
          <Plus size={26} strokeWidth={2.8} />
        </button>

        <button
          className={`dock-nav-btn ${controlOpen ? 'active' : ''}`}
          onClick={() => {
            triggerHaptic(15);
            setControlOpen(true);
          }}
        >
          <Sliders size={19} />
          <span>Медиа/Сон</span>
        </button>

        <button
          className={`dock-nav-btn ${pairOpen ? 'active' : ''}`}
          onClick={() => {
            triggerHaptic(15);
            setPairOpen(true);
          }}
        >
          <Wifi size={19} />
          <span>Связь ПК</span>
        </button>
      </nav>

      {/* Item Quick Actions Sheet */}
      {actionItem && (
        <div className="sheet-backdrop" onClick={() => setActionItem(null)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={actionItem.iconDataUrl}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: 8 }}
                />
                <h3>{actionItem.name}</h3>
              </div>
              <button className="sheet-close" onClick={() => setActionItem(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="sheet-body">
              <button
                className="m-btn-primary"
                onClick={() => {
                  const targetItem = actionItem;
                  setActionItem(null);
                  handleTapItem(targetItem);
                }}
              >
                <Play size={16} /> {isOnline ? 'ЗАПУСТИТЬ НА ПК' : 'ВКЛЮЧИТЬ ПК И ЗАПУСТИТЬ'}
              </button>

              {isOnline && runningIds.has(actionItem.id) && (
                <button
                  className="m-btn-secondary"
                  style={{ borderColor: 'rgba(255,59,92,0.4)', color: 'var(--coral)' }}
                  onClick={async () => {
                    if (!activePc) return;
                    await mobilePcApi.kill(activePc, actionItem.id);
                    setActionItem(null);
                    showToast(`Закрыт процесс: ${actionItem.name}`);
                  }}
                >
                  <Square size={15} /> Закрыть запущенное приложение
                </button>
              )}

              <button
                className="m-btn-secondary"
                onClick={() => {
                  const it = actionItem;
                  setActionItem(null);
                  setEditingItem(it);
                  setAddSheetOpen(true);
                }}
              >
                <Edit3 size={15} color="var(--cyan)" /> Изменить название или иконку
              </button>

              <button
                className="m-btn-secondary"
                style={{ color: 'var(--coral)' }}
                onClick={async () => {
                  if (!activePc || !isOnline) {
                    showToast('Включите ПК для удаления');
                    return;
                  }
                  const res = await mobilePcApi.deleteItem(activePc, actionItem.id);
                  setItems(res.items);
                  saveCachedItemsForPc(activePc.id, res.items);
                  showToast(`Удалено: ${actionItem.name}`);
                  setActionItem(null);
                }}
              >
                <Trash2 size={15} /> Удалить с пульта
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remote Add & Edit Sheet */}
      <RemoteAddSheet
        open={addSheetOpen}
        pc={activePc}
        isOnline={isOnline}
        editingItem={editingItem}
        existingTargets={existingTargets}
        onClose={() => {
          setAddSheetOpen(false);
          setEditingItem(null);
        }}
        onItemsUpdated={(nextItems, msg) => {
          setItems(nextItems);
          if (activePc) saveCachedItemsForPc(activePc.id, nextItems);
          if (msg) showToast(msg);
        }}
        onNotify={showToast}
      />

      {/* Media & Power Control Sheet */}
      <ControlSheet
        open={controlOpen}
        isOnline={isOnline}
        shutdownTimerEndsAt={shutdownTimerEndsAt}
        onClose={() => setControlOpen(false)}
        onWakePc={() => handleWakePc()}
        onControl={handleControl}
      />

      {/* PC Discovery & Pair Sheet */}
      <PairSheet
        open={pairOpen}
        savedPcs={savedPcs}
        activePcId={activeId}
        onClose={() => setPairOpen(false)}
        onPaired={handlePaired}
        onSelectSaved={(id) => {
          setActiveId(id);
          setActivePcId(id);
        }}
        onDeleteSaved={(id) => {
          const next = removeSavedPc(id);
          setSavedPcs(next);
          if (activeId === id) {
            const fallback = next[0]?.id || null;
            setActiveId(fallback);
            if (fallback) setActivePcId(fallback);
          }
        }}
        onNotify={showToast}
      />

      {toast && <div className="m-toast">{toast}</div>}
    </div>
  );
};
