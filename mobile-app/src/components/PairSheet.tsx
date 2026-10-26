import React, { useEffect, useState } from 'react';
import { Check, Monitor, Radar, Trash2, Wifi, X } from 'lucide-react';
import { discoverPcsOnWifi, triggerHaptic } from '../plugins/wolLan';
import { mobilePcApi } from '../services/pcClient';
import { DeckItem, DiscoveredPc, SavedPcProfile } from '../types';

interface Props {
  open: boolean;
  savedPcs: SavedPcProfile[];
  activePcId: string | null;
  onClose: () => void;
  onPaired: (profile: SavedPcProfile, items: DeckItem[]) => void;
  onSelectSaved: (id: string) => void;
  onDeleteSaved: (id: string) => void;
  onNotify: (msg: string) => void;
}

export const PairSheet: React.FC<Props> = ({
  open,
  savedPcs,
  activePcId,
  onClose,
  onPaired,
  onSelectSaved,
  onDeleteSaved,
  onNotify,
}) => {
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredPc[]>([]);
  const [ipInput, setIpInput] = useState('');
  const [portInput, setPortInput] = useState('7788');
  const [macInput, setMacInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (open) {
      handleScan();
    }
  }, [open]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const hosts = await discoverPcsOnWifi(Number(portInput) || 7788);
      setDiscovered(hosts);
    } catch {
      // ignore
    } finally {
      setScanning(false);
    }
  };

  if (!open) return null;

  const connectToHost = async (ip: string, port: number, fallbackMac = '') => {
    setConnecting(true);
    triggerHaptic(22);
    try {
      const res = await mobilePcApi.pair(ip.trim(), port, pinInput.trim() || undefined);
      const profile: SavedPcProfile = {
        id: res.pcInfo.serverId || `${ip}:${port}`,
        name: res.pcInfo.name || ip,
        ip: ip.trim(),
        port: res.pcInfo.port || port,
        mac: res.pcInfo.primaryMac || fallbackMac.trim(),
        macs: res.pcInfo.macs?.length
          ? res.pcInfo.macs
          : fallbackMac.trim()
          ? [fallbackMac.trim()]
          : [],
        broadcastIp: res.pcInfo.broadcastIp || '255.255.255.255',
        pin: pinInput.trim() || undefined,
        lastSeenAt: Date.now(),
      };
      onPaired(profile, res.items);
      onClose();
    } catch (err: any) {
      onNotify(err?.message || 'Не удалось подключиться к ПК');
    } finally {
      setConnecting(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipInput.trim()) return;
    // Allow pasting QR JSON payload directly too!
    if (ipInput.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(ipInput.trim());
        if (parsed.ip) {
          await connectToHost(parsed.ip, Number(parsed.port) || 7788, parsed.mac || '');
          return;
        }
      } catch {
        // fallback to normal IP
      }
    }
    await connectToHost(ipInput.trim(), Number(portInput) || 7788, macInput.trim());
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>ПОДКЛЮЧЕНИЕ К ПК</h3>
          <button className="sheet-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="sheet-body">
          <button className="m-btn-primary" onClick={handleScan} disabled={scanning}>
            <Radar size={17} />
            {scanning ? 'ПОИСК ПК В WI-FI...' : 'НАЙТИ ПК В WI-FI АВТОМАТИЧЕСКИ'}
          </button>

          {discovered.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--volt)' }}>
                НАЙДЕНЫ В СЕТИ ({discovered.length})
              </div>
              {discovered.map((host) => (
                <div
                  key={`${host.ip}:${host.port}`}
                  className="m-list-item"
                  style={{ borderColor: 'rgba(200,255,46,0.38)', cursor: 'pointer' }}
                  onClick={() => connectToHost(host.ip, host.port, host.mac)}
                >
                  <Wifi size={22} color="var(--volt)" />
                  <div className="m-list-meta">
                    <div className="m-list-title">{host.name}</div>
                    <div className="m-list-sub">
                      {host.ip === 'preview' ? 'Локальный сервер' : `${host.ip}:${host.port}`}
                      {host.mac ? ` • MAC: ${host.mac}` : ''}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: 'var(--volt)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    ПОДКЛ →
                  </span>
                </div>
              ))}
            </div>
          )}

          {savedPcs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                СОХРАНЁННЫЕ ПК
              </div>
              {savedPcs.map((pc) => (
                <div key={pc.id} className="m-list-item">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flex: 1,
                      minWidth: 0,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      onSelectSaved(pc.id);
                      onClose();
                    }}
                  >
                    <Monitor
                      size={20}
                      color={pc.id === activePcId ? 'var(--volt)' : 'var(--cyan)'}
                    />
                    <div className="m-list-meta">
                      <div className="m-list-title">{pc.name}</div>
                      <div className="m-list-sub">
                        {pc.ip}:{pc.port} {pc.mac ? `• ${pc.mac}` : ''}
                      </div>
                    </div>
                  </div>
                  {pc.id === activePcId && <Check size={16} color="var(--volt)" />}
                  <button
                    className="sheet-close"
                    style={{ width: 28, height: 28 }}
                    onClick={() => onDeleteSaved(pc.id)}
                  >
                    <Trash2 size={13} color="var(--coral)" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleManualSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              paddingTop: 6,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
              ИЛИ ПОДКЛЮЧИТЬ ПО IP АДРЕСУ ПК
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px', gap: 8 }}>
              <input
                className="m-input"
                placeholder="IP адрес ПК (напр. 192.168.1.42)"
                value={ipInput}
                onChange={(e) => setIpInput(e.target.value)}
              />
              <input
                className="m-input"
                placeholder="7788"
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
              <input
                className="m-input"
                placeholder="MAC (подтянется сам с ПК)"
                value={macInput}
                onChange={(e) => setMacInput(e.target.value)}
              />
              <input
                className="m-input"
                placeholder="PIN (если есть)"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
              />
            </div>
            <button type="submit" className="m-btn-secondary" disabled={connecting}>
              {connecting ? 'Подключение...' : 'Подключить по IP'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
