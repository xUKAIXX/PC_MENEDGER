import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile, spawn } from 'child_process';
import {
  DeckItem,
  NetworkAdapterInfo,
  PcNetworkInfo,
  PcStats,
  PlatformAdapter,
} from './types';

const VIRTUAL_IFACE_RE =
  /\b(vethernet|wsl|hyper-v|vmware|virtualbox|vboxnet|docker|loopback|npcap|bluetooth|teredo|isatap)\b/i;

function ipToInt(ip: string): number {
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return 0;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function intToIp(intVal: number): string {
  return [
    (intVal >>> 24) & 255,
    (intVal >>> 16) & 255,
    (intVal >>> 8) & 255,
    intVal & 255,
  ].join('.');
}

export function computeBroadcastIp(ip: string, netmask: string): string {
  const ipNum = ipToInt(ip);
  const maskNum = ipToInt(netmask);
  if (!ipNum || !maskNum) return '255.255.255.255';
  const broadcast = (ipNum | (~maskNum >>> 0)) >>> 0;
  return intToIp(broadcast);
}

function scoreAdapter(name: string, ip: string): number {
  let score = 50;
  if (VIRTUAL_IFACE_RE.test(name)) score -= 40;
  if (/^(ethernet|wi-fi|wifi|wlan|eth|en|беспроводная)/i.test(name)) score += 30;
  if (ip.startsWith('192.168.')) score += 25;
  else if (ip.startsWith('10.')) score += 15;
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 5;
  if (ip.startsWith('169.254.')) score -= 100;
  return score;
}

export function getNetworkInfo(opts: {
  serverId: string;
  pcName: string;
  port: number;
  pinRequired: boolean;
}): PcNetworkInfo {
  const nets = os.networkInterfaces();
  const scored: Array<{ score: number; adapter: NetworkAdapterInfo }> = [];

  for (const [ifaceName, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      const isV4 = addr.family === 'IPv4' || (addr.family as unknown) === 4;
      if (!isV4 || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue;

      const rawMac = (addr.mac || '').toUpperCase().replace(/-/g, ':');
      const validMac =
        rawMac && rawMac !== '00:00:00:00:00:00' ? rawMac : '';

      const adapter: NetworkAdapterInfo = {
        name: ifaceName,
        ip: addr.address,
        netmask: addr.netmask || '255.255.255.0',
        broadcastIp: computeBroadcastIp(addr.address, addr.netmask || '255.255.255.0'),
        mac: validMac,
      };
      scored.push({
        score: scoreAdapter(ifaceName, addr.address),
        adapter,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const adapters = scored.map((s) => s.adapter);
  const primary = adapters[0];
  const macSet = new Set<string>();
  for (const a of adapters) {
    if (a.mac) macSet.add(a.mac);
  }
  const macs = Array.from(macSet);

  return {
    serverId: opts.serverId,
    name: opts.pcName,
    hostname: os.hostname(),
    port: opts.port,
    primaryIp: primary?.ip || '127.0.0.1',
    broadcastIp: primary?.broadcastIp || '255.255.255.255',
    primaryMac: macs[0] || '',
    macs,
    adapters,
    pinRequired: opts.pinRequired,
    platform: process.platform,
    version: '1.0.0',
  };
}

let prevCpuIdle = 0;
let prevCpuTotal = 0;

function sampleCpuTicks(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.irq +
      cpu.times.idle;
  }
  return { idle, total };
}

// Initialize baseline CPU ticks
const initTicks = sampleCpuTicks();
prevCpuIdle = initTicks.idle;
prevCpuTotal = initTicks.total;
let lastCpuPercent = 8;

export function getPcStats(): PcStats {
  const cur = sampleCpuTicks();
  const idleDiff = cur.idle - prevCpuIdle;
  const totalDiff = cur.total - prevCpuTotal;
  if (totalDiff > 0) {
    lastCpuPercent = Math.max(1, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
    prevCpuIdle = cur.idle;
    prevCpuTotal = cur.total;
  }

  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const ramTotalGb = Math.round((totalBytes / 1024 ** 3) * 10) / 10;
  const ramUsedGb = Math.round((usedBytes / 1024 ** 3) * 10) / 10;
  const ramPercent = Math.round((usedBytes / totalBytes) * 100);

  return {
    cpuPercent: lastCpuPercent,
    ramPercent,
    ramUsedGb,
    ramTotalGb,
    uptimeSec: Math.floor(os.uptime()),
  };
}

let cachedRunningExes = new Set<string>();
let lastProcCheckAt = 0;
let procCheckInFlight = false;

function refreshRunningProcesses(): Promise<Set<string>> {
  if (Date.now() - lastProcCheckAt < 2500 || procCheckInFlight) {
    return Promise.resolve(cachedRunningExes);
  }
  procCheckInFlight = true;

  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile(
        'tasklist.exe',
        ['/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 2200, maxBuffer: 2 * 1024 * 1024 },
        (err, stdout) => {
          procCheckInFlight = false;
          lastProcCheckAt = Date.now();
          if (!err && stdout) {
            const set = new Set<string>();
            const lines = stdout.split(/\r?\n/);
            for (const line of lines) {
              const m = line.match(/^"([^"]+)"/);
              if (m) set.add(m[1].toLowerCase());
            }
            cachedRunningExes = set;
          }
          resolve(cachedRunningExes);
        }
      );
    } else {
      execFile(
        'ps',
        ['-eo', 'comm'],
        { timeout: 1500 },
        (err, stdout) => {
          procCheckInFlight = false;
          lastProcCheckAt = Date.now();
          if (!err && stdout) {
            const set = new Set<string>();
            for (const line of stdout.split(/\r?\n/)) {
              const t = line.trim().toLowerCase();
              if (t) set.add(t);
            }
            cachedRunningExes = set;
          }
          resolve(cachedRunningExes);
        }
      );
    }
  });
}

export async function getRunningItemIds(items: DeckItem[]): Promise<string[]> {
  const runningSet = await refreshRunningProcesses();
  const activeIds: string[] = [];
  for (const item of items) {
    if (item.kind !== 'app') continue;
    const base = path.basename(item.target).toLowerCase();
    if (!base) continue;
    if (runningSet.has(base)) {
      activeIds.push(item.id);
      continue;
    }
    // Special case: Discord's Update.exe launches Discord.exe
    if (base === 'update.exe' && /discord/i.test(item.target) && runningSet.has('discord.exe')) {
      activeIds.push(item.id);
    }
  }
  return activeIds;
}

export async function launchDeckItem(
  adapter: PlatformAdapter,
  item: DeckItem
): Promise<{ ok: boolean; error?: string }> {
  try {
    const target = item.target.trim();
    if (/^(https?:\/\/|steam:\/\/|com\.epicgames\.launcher:\/\/|discord:\/\/|spotify:)/i.test(target)) {
      await adapter.openExternal(target);
      return { ok: true };
    }

    // Discord Update.exe requires --processStart Discord.exe if no args provided
    let effectiveArgs = item.args?.trim() || '';
    if (
      process.platform === 'win32' &&
      path.basename(target).toLowerCase() === 'update.exe' &&
      /discord/i.test(target) &&
      !effectiveArgs
    ) {
      effectiveArgs = '--processStart Discord.exe';
    }

    if (effectiveArgs) {
      const argList = effectiveArgs.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/^"|"$/g, '')) || [];
      const cwd = fs.existsSync(target) ? path.dirname(target) : undefined;
      const child = spawn(target, argList, {
        cwd,
        detached: true,
        stdio: 'ignore',
        shell: item.kind === 'script',
      });
      child.unref();
      return { ok: true };
    }

    const errMsg = await adapter.openPath(target);
    if (errMsg) {
      return { ok: false, error: errMsg };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Launch failed' };
  }
}

export async function openArbitraryPath(
  adapter: PlatformAdapter,
  targetPath: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (/^https?:\/\//i.test(targetPath)) {
      await adapter.openExternal(targetPath);
      return { ok: true };
    }
    const errMsg = await adapter.openPath(targetPath);
    if (errMsg) return { ok: false, error: errMsg };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Open failed' };
  }
}

export function killDeckItem(item: DeckItem): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let exeName = path.basename(item.target);
    if (exeName.toLowerCase() === 'update.exe' && /discord/i.test(item.target)) {
      exeName = 'Discord.exe';
    }
    if (!exeName) {
      resolve({ ok: false, error: 'Не удалось определить процесс' });
      return;
    }
    if (process.platform === 'win32') {
      execFile(
        'taskkill.exe',
        ['/IM', exeName, '/F'],
        { windowsHide: true, timeout: 4000 },
        (err) => {
          lastProcCheckAt = 0;
          resolve(err ? { ok: false, error: err.message } : { ok: true });
        }
      );
    } else {
      execFile('pkill', ['-f', exeName], { timeout: 3000 }, () => {
        lastProcCheckAt = 0;
        resolve({ ok: true });
      });
    }
  });
}

let shutdownTimerEndsAt: number | null = null;

export function getShutdownTimerEndsAt(): number | null {
  if (shutdownTimerEndsAt && shutdownTimerEndsAt <= Date.now()) {
    shutdownTimerEndsAt = null;
  }
  return shutdownTimerEndsAt;
}

function sendWindowsVirtualKey(vkCharCode: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve();
      return;
    }
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]${vkCharCode})`,
      ],
      { windowsHide: true, timeout: 3000 },
      () => resolve()
    );
  });
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

export async function executeControlAction(
  action: ControlAction,
  seconds?: number
): Promise<{ ok: boolean; shutdownTimerEndsAt: number | null }> {
  if (process.platform === 'win32') {
    switch (action) {
      case 'vol_mute':
        await sendWindowsVirtualKey(173);
        break;
      case 'vol_down':
        await sendWindowsVirtualKey(174);
        break;
      case 'vol_up':
        await sendWindowsVirtualKey(175);
        break;
      case 'media_next':
        await sendWindowsVirtualKey(176);
        break;
      case 'media_prev':
        await sendWindowsVirtualKey(177);
        break;
      case 'media_play_pause':
        await sendWindowsVirtualKey(179);
        break;
      case 'lock':
        execFile('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true });
        break;
      case 'sleep':
        execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { windowsHide: true });
        break;
      case 'restart':
        execFile('shutdown.exe', ['/r', '/t', '5'], { windowsHide: true });
        break;
      case 'shutdown':
        shutdownTimerEndsAt = Date.now() + 5000;
        execFile('shutdown.exe', ['/s', '/t', '5'], { windowsHide: true });
        break;
      case 'shutdown_timer': {
        const sec = Math.max(60, Math.min(86400, Number(seconds) || 1800));
        shutdownTimerEndsAt = Date.now() + sec * 1000;
        execFile('shutdown.exe', ['/a'], { windowsHide: true }, () => {
          execFile('shutdown.exe', ['/s', '/t', String(sec)], { windowsHide: true });
        });
        break;
      }
      case 'cancel_shutdown':
        shutdownTimerEndsAt = null;
        execFile('shutdown.exe', ['/a'], { windowsHide: true });
        break;
    }
  } else {
    // Dev/Linux simulation for timer state verification
    if (action === 'shutdown_timer') {
      const sec = Math.max(60, Math.min(86400, Number(seconds) || 1800));
      shutdownTimerEndsAt = Date.now() + sec * 1000;
    } else if (action === 'cancel_shutdown') {
      shutdownTimerEndsAt = null;
    }
  }

  return { ok: true, shutdownTimerEndsAt: getShutdownTimerEndsAt() };
}

/**
 * 1-Click Windows Setup: Removes any Defender Block rules, opens Firewall for Program + Ports
 * across all profiles (Public/Private/Domain), registers zero-delay Logon Scheduled Task,
 * configures Wake-on-LAN on network adapters, and disables Fast Startup (Hiberboot).
 */
export function runWindowsSystemSetup(
  port: number,
  exePath = process.execPath
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: true });
      return;
    }

    const cleanExe = exePath.replace(/'/g, "''");
    const psScript = [
      `Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'NEXUS|nexus-pc' } | Remove-NetFirewallRule -ErrorAction SilentlyContinue`,
      `New-NetFirewallRule -DisplayName 'NEXUS PC App (Inbound)' -Direction Inbound -Action Allow -Program '${cleanExe}' -Profile Any -ErrorAction SilentlyContinue | Out-Null`,
      `New-NetFirewallRule -DisplayName 'NEXUS PC App (Outbound)' -Direction Outbound -Action Allow -Program '${cleanExe}' -Profile Any -ErrorAction SilentlyContinue | Out-Null`,
      `New-NetFirewallRule -DisplayName 'NEXUS PC Port TCP' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Any -ErrorAction SilentlyContinue | Out-Null`,
      `New-NetFirewallRule -DisplayName 'NEXUS PC Port UDP' -Direction Inbound -Action Allow -Protocol UDP -LocalPort ${port + 1},9,7 -Profile Any -ErrorAction SilentlyContinue | Out-Null`,
      `$act = New-ScheduledTaskAction -Execute '${cleanExe}' -Argument '--hidden'`,
      `$trg = New-ScheduledTaskTrigger -AtLogOn`,
      `$stg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)`,
      `Register-ScheduledTask -TaskName 'NEXUS_PC_Deck' -Action $act -Trigger $trg -Settings $stg -Force -ErrorAction SilentlyContinue | Out-Null`,
      `Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { Enable-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket -ErrorAction SilentlyContinue }`,
      `Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -Value 0 -Type DWord -ErrorAction SilentlyContinue`,
    ].join('; ');

    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile -EncodedCommand ${encoded}'`,
      ],
      { windowsHide: true, timeout: 45000 },
      (err) => {
        if (err) {
          resolve({ ok: false, error: 'Требуется подтверждение администратора (UAC)' });
        } else {
          resolve({ ok: true });
        }
      }
    );
  });
}
