import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { DiscoveredApp, FsEntry, FsRoot, PlatformAdapter } from './types';
import {
  generateFallbackIcon,
  inferKindFromTarget,
  resolveItemIconAndMeta,
} from './icons';

const NOISE_NAME_RE =
  /\b(uninstall|unins000|удалить|удаление|деинстал|readme|help|справка|manual|website|license|лиценз|setup|installer|crash\s*handler|updater|diagnostic)\b/i;

let cachedApps: DiscoveredApp[] | null = null;
let lastScanAt = 0;

function collectShortcutsRecursive(dir: string, depth = 0, maxDepth = 3, out: string[] = []): string[] {
  if (depth > maxDepth || out.length >= 260) return out;
  try {
    if (!fs.existsSync(dir)) return out;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= 260) break;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/administrative tools|system tools|accessibility|startup|автозагрузка/i.test(entry.name)) {
          continue;
        }
        collectShortcutsRecursive(full, depth + 1, maxDepth, out);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.lnk' || ext === '.url') {
          out.push(full);
        }
      }
    }
  } catch {
    // Ignore permission errors on protected folders
  }
  return out;
}

export async function scanInstalledApps(
  adapter: PlatformAdapter,
  forceRefresh = false
): Promise<DiscoveredApp[]> {
  if (!forceRefresh && cachedApps && Date.now() - lastScanAt < 60_000) {
    return cachedApps;
  }

  const results: DiscoveredApp[] = [];
  const seenNames = new Set<string>();
  const seenTargets = new Set<string>();

  if (process.platform === 'win32') {
    const home = os.homedir();
    const roots = [
      path.join(home, 'Desktop'),
      process.env.PUBLIC ? path.join(process.env.PUBLIC, 'Desktop') : '',
      process.env.APPDATA
        ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        : '',
      process.env.PROGRAMDATA
        ? path.join(process.env.PROGRAMDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        : 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
    ].filter(Boolean);

    const files: string[] = [];
    for (const r of roots) {
      collectShortcutsRecursive(r, 0, 3, files);
    }

    for (const shortcutPath of files) {
      if (results.length >= 100) break;
      const rawBase = path.basename(shortcutPath, path.extname(shortcutPath)).trim();
      if (!rawBase || NOISE_NAME_RE.test(rawBase)) continue;
      const nameKey = rawBase.toLowerCase();
      if (seenNames.has(nameKey)) continue;

      try {
        const resolved = await resolveItemIconAndMeta(adapter, {
          name: rawBase,
          target: shortcutPath,
        });
        if (!resolved.target || NOISE_NAME_RE.test(resolved.target)) continue;
        const targetExt = path.extname(resolved.target).toLowerCase();
        if (
          resolved.kind === 'file' &&
          !['.exe', '.bat', '.cmd', '.msc', '.appref-ms'].includes(targetExt)
        ) {
          continue;
        }
        const targetKey = resolved.target.toLowerCase();
        if (seenTargets.has(targetKey)) continue;

        seenNames.add(nameKey);
        seenTargets.add(targetKey);

        results.push({
          id: crypto.createHash('md5').update(shortcutPath).digest('hex').slice(0, 12),
          name: resolved.name,
          target: resolved.target,
          args: resolved.args,
          sourcePath: shortcutPath,
          kind: resolved.kind,
          category: resolved.category,
          accent: resolved.accent,
          iconDataUrl: resolved.iconDataUrl,
        });
      } catch {
        // Skip unreadable shortcut
      }
    }
  } else {
    // Non-Windows fallback catalog for development & Linux testing
    const devSamples = [
      { name: 'Steam', target: 'steam://open/main' },
      { name: 'Discord', target: 'https://discord.com/app' },
      { name: 'Telegram', target: 'https://web.telegram.org' },
      { name: 'Spotify', target: 'https://open.spotify.com' },
      { name: 'VS Code', target: '/usr/bin/code' },
      { name: 'OBS Studio', target: '/usr/bin/obs' },
      { name: 'Google Chrome', target: '/usr/bin/google-chrome' },
      { name: 'VLC Media Player', target: '/usr/bin/vlc' },
      { name: 'Blender', target: '/usr/bin/blender' },
      { name: 'Терминал', target: '/bin/bash' },
    ];
    for (const s of devSamples) {
      const resolved = await resolveItemIconAndMeta(adapter, {
        name: s.name,
        target: s.target,
      });
      results.push({
        id: crypto.createHash('md5').update(s.name).digest('hex').slice(0, 12),
        name: resolved.name,
        target: resolved.target,
        sourcePath: s.target,
        kind: resolved.kind,
        category: resolved.category,
        accent: resolved.accent,
        iconDataUrl: resolved.iconDataUrl,
      });
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  cachedApps = results;
  lastScanAt = Date.now();
  return results;
}

export function getFsRoots(): FsRoot[] {
  const home = os.homedir();
  const quickCandidates: Array<{ name: string; rel: string }> = [
    { name: 'Рабочий стол', rel: 'Desktop' },
    { name: 'Загрузки', rel: 'Downloads' },
    { name: 'Документы', rel: 'Documents' },
    { name: 'Видео', rel: 'Videos' },
    { name: 'Музыка', rel: 'Music' },
    { name: 'Изображения', rel: 'Pictures' },
  ];

  const roots: FsRoot[] = [];
  for (const q of quickCandidates) {
    const p = path.join(home, q.rel);
    if (fs.existsSync(p)) {
      roots.push({ name: q.name, path: p, kind: 'quick' });
    }
  }
  roots.push({ name: 'Домашняя папка', path: home, kind: 'quick' });

  if (process.platform === 'win32') {
    for (let code = 67; code <= 90; code++) {
      // C:\ through Z:\
      const letter = String.fromCharCode(code);
      const drive = `${letter}:\\`;
      try {
        if (fs.existsSync(drive)) {
          roots.push({ name: `Диск ${letter}:`, path: drive, kind: 'drive' });
        }
      } catch {
        // Ignore unavailable drive
      }
    }
  } else {
    roots.push({ name: 'Корень /', path: '/', kind: 'drive' });
  }

  return roots;
}

export async function listDirectoryEntries(
  adapter: PlatformAdapter,
  requestedPath?: string
): Promise<{
  currentPath: string;
  parentPath: string | null;
  entries: FsEntry[];
}> {
  const targetDir = requestedPath && fs.existsSync(requestedPath) ? path.resolve(requestedPath) : os.homedir();
  const parsed = path.parse(targetDir);
  const parentPath = parsed.root === targetDir ? null : path.dirname(targetDir);

  const entries: FsEntry[] = [];
  let dirents: fs.Dirent[] = [];
  try {
    dirents = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return { currentPath: targetDir, parentPath, entries: [] };
  }

  // Sort directories first, then files alphabetically
  const visible = dirents
    .filter((d) => !d.name.startsWith('.') && !d.name.startsWith('$'))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'ru');
    })
    .slice(0, 200);

  let exeIconsExtracted = 0;

  for (const d of visible) {
    const fullPath = path.join(targetDir, d.name);
    const isDir = d.isDirectory();
    let size = 0;
    if (!isDir) {
      try {
        size = fs.statSync(fullPath).size;
      } catch {
        size = 0;
      }
    }
    const ext = isDir ? '' : path.extname(d.name).toLowerCase();
    const kind = isDir ? 'folder' : inferKindFromTarget(fullPath);

    let iconDataUrl: string;
    let accent: string;

    if (!isDir && (ext === '.exe' || ext === '.lnk') && exeIconsExtracted < 24) {
      exeIconsExtracted++;
      const res = await resolveItemIconAndMeta(adapter, { name: d.name, target: fullPath });
      iconDataUrl = res.iconDataUrl;
      accent = res.accent;
    } else {
      const fb = generateFallbackIcon(d.name, fullPath, kind);
      iconDataUrl = fb.iconDataUrl;
      accent = fb.accent;
    }

    entries.push({
      name: d.name,
      path: fullPath,
      isDirectory: isDir,
      size,
      ext,
      kind,
      accent,
      iconDataUrl,
    });
  }

  return {
    currentPath: targetDir,
    parentPath,
    entries,
  };
}
