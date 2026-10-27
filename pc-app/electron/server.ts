import * as http from 'http';
import * as dgram from 'dgram';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { DeckStore } from './store';
import { ICON_PRESETS } from './icons';
import { getFsRoots, listDirectoryEntries, scanInstalledApps } from './scanner';
import {
  ControlAction,
  executeControlAction,
  getNetworkInfo,
  getPcStats,
  getRunningItemIds,
  getShutdownTimerEndsAt,
  killDeckItem,
  launchDeckItem,
  openArbitraryPath,
  runWindowsSystemSetup,
} from './system';
import { PlatformAdapter } from './types';

function ipToUint(ip: string): number {
  const p = ip.split('.').map((n) => parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return 0;
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);
}

export interface NexusServerHandle {
  port: number;
  broadcastSync: () => void;
  getConnectedClientsCount: () => number;
  close: () => Promise<void>;
}

export async function startNexusServer(
  adapter: PlatformAdapter,
  store: DeckStore,
  onActivity?: (msg: string) => void
): Promise<NexusServerHandle> {
  await store.ensureSeeded();
  const port = store.getState().port || 7788;

  const clients = new Set<WebSocket>();

  const getPcInfo = () => {
    const st = store.getState();
    return getNetworkInfo({
      serverId: st.serverId,
      pcName: st.pcName,
      port,
      pinRequired: Boolean(st.pin),
    });
  };

  const broadcastJson = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  };

  const broadcastSync = () => {
    broadcastJson({
      type: 'items:sync',
      items: store.getItems(),
      pcInfo: getPcInfo(),
    });
  };

  const setCors = (res: http.ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Nexus-Pin');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  };

  const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
    setCors(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const readJsonBody = (req: http.IncomingMessage): Promise<any> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const MAX_BYTES = 10 * 1024 * 1024;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          reject(new Error('Payload too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });

  const checkPinAuthorized = (req: http.IncomingMessage): boolean => {
    const requiredPin = store.getState().pin;
    if (!requiredPin) return true;
    const remote = req.socket.remoteAddress || '';
    if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
      return true;
    }
    const headerPin = String(req.headers['x-nexus-pin'] || '').trim();
    return headerPin === requiredPin;
  };

  const server = http.createServer(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const pathname = parsedUrl.pathname;
    const method = req.method || 'GET';

    try {
      // 1. Public discovery ping
      if (method === 'GET' && pathname === '/api/ping') {
        const info = getPcInfo();
        sendJson(res, 200, {
          ok: true,
          magic: 'NEXUS_PC_V1',
          ...info,
        });
        return;
      }

      // 2. Pair phone endpoint
      if (method === 'POST' && pathname === '/api/pair') {
        const body = await readJsonBody(req);
        const requiredPin = store.getState().pin;
        if (requiredPin && String(body.pin || '').trim() !== requiredPin) {
          sendJson(res, 401, { ok: false, error: 'Неверный PIN-код ПК' });
          return;
        }
        const dev = store.registerPairedDevice(String(body.deviceName || 'Android'));
        onActivity?.(`Подключен телефон: ${dev.name}`);
        sendJson(res, 200, {
          ok: true,
          device: dev,
          pcInfo: getPcInfo(),
          items: store.getItems(),
        });
        return;
      }

      // Check optional PIN for remaining endpoints
      if (!checkPinAuthorized(req)) {
        sendJson(res, 401, { ok: false, error: 'Требуется PIN-код' });
        return;
      }

      // 3. Full state snapshot
      if (method === 'GET' && pathname === '/api/state') {
        const items = store.getItems();
        const runningIds = await getRunningItemIds(items);
        sendJson(res, 200, {
          ok: true,
          pcInfo: getPcInfo(),
          stats: getPcStats(),
          items,
          runningIds,
          shutdownTimerEndsAt: getShutdownTimerEndsAt(),
          autostart: adapter.getAutostart(),
          presets: ICON_PRESETS.map((p) => ({ id: p.id, label: p.label, accent: p.accent })),
          connectedClients: clients.size,
          pin: store.getState().pin,
        });
        return;
      }

      // 4. Items CRUD
      if (method === 'GET' && pathname === '/api/items') {
        sendJson(res, 200, { ok: true, items: store.getItems() });
        return;
      }

      if (method === 'POST' && pathname === '/api/items') {
        const body = await readJsonBody(req);
        if (Array.isArray(body.items)) {
          const added = [];
          for (const rawItem of body.items) {
            if (rawItem?.target) {
              added.push(await store.addItem(rawItem));
            }
          }
          broadcastSync();
          sendJson(res, 201, { ok: true, added, items: store.getItems() });
          return;
        }

        if (!body.target || !String(body.target).trim()) {
          sendJson(res, 400, { ok: false, error: 'Укажите путь к файлу, приложению или URL' });
          return;
        }
        const item = await store.addItem({
          name: body.name,
          target: String(body.target),
          args: body.args,
          kind: body.kind,
          category: body.category,
          accent: body.accent,
          iconDataUrl: body.iconDataUrl,
          iconPreset: body.iconPreset,
        });
        broadcastSync();
        onActivity?.(`Добавлено: ${item.name}`);
        sendJson(res, 201, { ok: true, item, items: store.getItems() });
        return;
      }

      if (method === 'POST' && pathname === '/api/items/reorder') {
        const body = await readJsonBody(req);
        if (Array.isArray(body.orderedIds)) {
          const items = store.reorderItems(body.orderedIds);
          broadcastSync();
          sendJson(res, 200, { ok: true, items });
          return;
        }
        sendJson(res, 400, { ok: false, error: 'orderedIds required' });
        return;
      }

      if (pathname.startsWith('/api/items/')) {
        const id = decodeURIComponent(pathname.slice('/api/items/'.length));
        if (method === 'PATCH' || method === 'PUT') {
          const body = await readJsonBody(req);
          const updated = await store.updateItem(id, body);
          if (!updated) {
            sendJson(res, 404, { ok: false, error: 'Элемент не найден' });
            return;
          }
          broadcastSync();
          sendJson(res, 200, { ok: true, item: updated, items: store.getItems() });
          return;
        }
        if (method === 'DELETE') {
          const removed = store.deleteItem(id);
          if (!removed) {
            sendJson(res, 404, { ok: false, error: 'Элемент не найден' });
            return;
          }
          broadcastSync();
          sendJson(res, 200, { ok: true, items: store.getItems() });
          return;
        }
      }

      // 5. Launch or Kill item
      if (method === 'POST' && pathname.startsWith('/api/launch/')) {
        const id = decodeURIComponent(pathname.slice('/api/launch/'.length));
        const item = store.getItems().find((i) => i.id === id);
        if (!item) {
          sendJson(res, 404, { ok: false, error: 'Элемент не найден' });
          return;
        }
        const resLaunch = await launchDeckItem(adapter, item);
        if (!resLaunch.ok) {
          sendJson(res, 500, { ok: false, error: resLaunch.error || 'Ошибка запуска' });
          return;
        }
        store.markLaunched(id);
        onActivity?.(`Запуск: ${item.name}`);
        broadcastJson({ type: 'launch:event', id: item.id, name: item.name, at: Date.now() });
        sendJson(res, 200, { ok: true, item });
        return;
      }

      if (method === 'POST' && pathname.startsWith('/api/kill/')) {
        const id = decodeURIComponent(pathname.slice('/api/kill/'.length));
        const item = store.getItems().find((i) => i.id === id);
        if (!item) {
          sendJson(res, 404, { ok: false, error: 'Элемент не найден' });
          return;
        }
        const killRes = await killDeckItem(item);
        onActivity?.(`Закрыто: ${item.name}`);
        sendJson(res, 200, killRes);
        return;
      }

      // 6. Direct open arbitrary path from Remote File Explorer
      if (method === 'POST' && pathname === '/api/open-path') {
        const body = await readJsonBody(req);
        if (!body.target) {
          sendJson(res, 400, { ok: false, error: 'target required' });
          return;
        }
        const openRes = await openArbitraryPath(adapter, String(body.target));
        onActivity?.(`Открыт файл: ${body.target}`);
        sendJson(res, openRes.ok ? 200 : 500, openRes);
        return;
      }

      // 7. Installed PC Apps Catalog (with real extracted icons!)
      if (method === 'GET' && pathname === '/api/catalog/apps') {
        const refresh = parsedUrl.searchParams.get('refresh') === '1';
        const apps = await scanInstalledApps(adapter, refresh);
        sendJson(res, 200, { ok: true, apps });
        return;
      }

      // 8. Preset Icons List (with rendered SVG data URLs!)
      if (method === 'GET' && pathname === '/api/icons/presets') {
        const { renderPresetIconDataUrl } = await import('./icons');
        const presets = ICON_PRESETS.map((p) => {
          const rendered = renderPresetIconDataUrl(p.id)!;
          return {
            id: p.id,
            label: p.label,
            accent: p.accent,
            iconDataUrl: rendered.iconDataUrl,
          };
        });
        sendJson(res, 200, { ok: true, presets });
        return;
      }

      // 9. Remote PC File System Browser
      if (method === 'GET' && pathname === '/api/fs/roots') {
        sendJson(res, 200, { ok: true, roots: getFsRoots() });
        return;
      }

      if (method === 'GET' && pathname === '/api/fs/list') {
        const dirPath = parsedUrl.searchParams.get('path') || undefined;
        const listing = await listDirectoryEntries(adapter, dirPath);
        sendJson(res, 200, { ok: true, ...listing });
        return;
      }

      // 10. System Power & Media Control
      if (method === 'POST' && pathname === '/api/control') {
        const body = await readJsonBody(req);
        const action = body.action as ControlAction;
        const result = await executeControlAction(action, body.seconds);
        onActivity?.(`Команда: ${action}`);
        broadcastJson({
          type: 'control:event',
          action,
          shutdownTimerEndsAt: result.shutdownTimerEndsAt,
        });
        sendJson(res, 200, result);
        return;
      }

      // 11. Settings & Autostart & 1-Click Windows WoL/Firewall Setup
      if (method === 'POST' && pathname === '/api/settings') {
        const body = await readJsonBody(req);
        if (typeof body.autostart === 'boolean') {
          adapter.setAutostart(body.autostart);
        }
        store.setSettings({
          pcName: body.pcName,
          pin: body.pin,
        });
        broadcastSync();
        sendJson(res, 200, {
          ok: true,
          pcInfo: getPcInfo(),
          autostart: adapter.getAutostart(),
          pin: store.getState().pin,
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/windows-setup') {
        const setupRes = await runWindowsSystemSetup(port, process.execPath);
        if (setupRes.ok) {
          store.markFirewallConfigured();
        }
        sendJson(res, 200, setupRes);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err?.message || 'Internal error' });
    }
  });

  // WebSocket Server for <50ms icon/item sync + live telemetry
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', async (ws) => {
    clients.add(ws);
    const items = store.getItems();
    const runningIds = await getRunningItemIds(items);
    ws.send(
      JSON.stringify({
        type: 'init',
        pcInfo: getPcInfo(),
        stats: getPcStats(),
        items,
        runningIds,
        shutdownTimerEndsAt: getShutdownTimerEndsAt(),
        connectedClients: clients.size,
      })
    );
    ws.on('close', () => {
      clients.delete(ws);
    });
    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  // Telemetry loop
  const telemetryTimer = setInterval(async () => {
    if (clients.size === 0) return;
    const items = store.getItems();
    const runningIds = await getRunningItemIds(items);
    broadcastJson({
      type: 'telemetry',
      stats: getPcStats(),
      runningIds,
      shutdownTimerEndsAt: getShutdownTimerEndsAt(),
      connectedClients: clients.size,
    });
  }, 2500);

  // UDP Discovery Responder on port + 1 (7789)
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8').trim();
    if (!text.startsWith('NEXUS_DISCOVER')) return;

    const info = getPcInfo();
    const senderUint = ipToUint(rinfo.address);
    let matchedAdapter = info.adapters[0];

    for (const ad of info.adapters) {
      const adUint = ipToUint(ad.ip);
      const maskUint = ipToUint(ad.netmask);
      if (maskUint && (adUint & maskUint) === (senderUint & maskUint)) {
        matchedAdapter = ad;
        break;
      }
    }

    const reply = JSON.stringify({
      magic: 'NEXUS_PC_V1',
      serverId: info.serverId,
      name: info.name,
      hostname: info.hostname,
      ip: matchedAdapter?.ip || info.primaryIp,
      port: info.port,
      mac: matchedAdapter?.mac || info.primaryMac,
      macs: info.macs,
      broadcastIp: matchedAdapter?.broadcastIp || info.broadcastIp,
      pinRequired: info.pinRequired,
    });

    udp.send(Buffer.from(reply, 'utf8'), rinfo.port, rinfo.address, () => {});
  });
  udp.on('error', () => {
    // Non-fatal if UDP discovery port is already occupied
  });
  try {
    udp.bind(port + 1, '0.0.0.0', () => {
      try {
        udp.setBroadcast(true);
        const announceBoot = () => {
          const info = getPcInfo();
          const payload = Buffer.from(
            JSON.stringify({
              magic: 'NEXUS_PC_V1',
              serverId: info.serverId,
              name: info.name,
              hostname: info.hostname,
              ip: info.primaryIp,
              port: info.port,
              mac: info.primaryMac,
              macs: info.macs,
              broadcastIp: info.broadcastIp,
              pinRequired: info.pinRequired,
            }),
            'utf8'
          );
          const targets = new Set<string>(['255.255.255.255']);
          for (const ad of info.adapters) {
            if (ad.broadcastIp) targets.add(ad.broadcastIp);
          }
          for (const bcast of targets) {
            udp.send(payload, port + 1, bcast, () => {});
          }
        };
        announceBoot();
        setTimeout(announceBoot, 3000).unref();
        setTimeout(announceBoot, 8000).unref();
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }

  const bindHost = process.env.NEXUS_BIND_HOST || '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bindHost, () => resolve());
  });

  return {
    port,
    broadcastSync,
    getConnectedClientsCount: () => clients.size,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(telemetryTimer);
        try {
          udp.close();
        } catch {
          // ignore
        }
        for (const ws of clients) {
          try {
            ws.terminate();
          } catch {
            // ignore
          }
        }
        wss.close(() => {
          server.close(() => resolve());
        });
      }),
  };
}
