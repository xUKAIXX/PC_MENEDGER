import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ItemCategory, ItemKind, PlatformAdapter } from './types';

export interface IconPresetDef {
  id: string;
  label: string;
  accent: string;
  svgInner: string;
}

export const ICON_PRESETS: IconPresetDef[] = [
  {
    id: 'preset:gamepad',
    label: 'Игра',
    accent: '#C8FF2E',
    svgInner: `<path d="M17 24h8M21 20v8M39 22h.02M44 26h.02" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><rect x="10" y="15" width="44" height="28" rx="12" stroke="currentColor" stroke-width="3" fill="none"/><path d="M14 41l-3 8c-.6 1.5.7 3 2.2 2.5L22 48h20l8.8 3.5c1.5.5 2.8-1 2.2-2.5l-3-8" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linejoin="round"/>`,
  },
  {
    id: 'preset:rocket',
    label: 'Старт',
    accent: '#00F0FF',
    svgInner: `<path d="M32 10c9 4 13 13 13 23 0 4-1 8-3 11H22c-2-3-3-7-3-11 0-10 4-19 13-23z" stroke="currentColor" stroke-width="3" fill="none"/><circle cx="32" cy="27" r="4.5" stroke="currentColor" stroke-width="2.8" fill="none"/><path d="M19 35l-6 6 6 3M45 35l6 6-6 3M27 44v8M37 44v8M32 44v10" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: 'preset:folder',
    label: 'Папка',
    accent: '#FFB800',
    svgInner: `<path d="M10 20a4 4 0 014-4h12l5 5h19a4 4 0 014 4v21a4 4 0 01-4 4H14a4 4 0 01-4-4V20z" stroke="currentColor" stroke-width="3" fill="none"/><path d="M10 27h44" stroke="currentColor" stroke-width="2.6" opacity="0.65"/>`,
  },
  {
    id: 'preset:film',
    label: 'Кино / Видео',
    accent: '#FF3B5C',
    svgInner: `<rect x="10" y="14" width="44" height="36" rx="7" stroke="currentColor" stroke-width="3" fill="none"/><polygon points="28,24 28,40 41,32" fill="currentColor"/>`,
  },
  {
    id: 'preset:music',
    label: 'Музыка',
    accent: '#1ED760',
    svgInner: `<path d="M25 44V17l22-4v27" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="44" r="5.5" stroke="currentColor" stroke-width="3" fill="none"/><circle cx="42" cy="40" r="5.5" stroke="currentColor" stroke-width="3" fill="none"/>`,
  },
  {
    id: 'preset:globe',
    label: 'Сайт / Браузер',
    accent: '#38BDF8',
    svgInner: `<circle cx="32" cy="32" r="20" stroke="currentColor" stroke-width="3" fill="none"/><ellipse cx="32" cy="32" rx="9" ry="20" stroke="currentColor" stroke-width="2.6" fill="none"/><path d="M12 32h40M15 23h34M15 41h34" stroke="currentColor" stroke-width="2.4" opacity="0.8"/>`,
  },
  {
    id: 'preset:terminal',
    label: 'Скрипт / CMD',
    accent: '#A855F7',
    svgInner: `<rect x="10" y="13" width="44" height="38" rx="6" stroke="currentColor" stroke-width="3" fill="none"/><path d="M19 25l8 7-8 7M31 39h12" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: 'preset:code',
    label: 'Код / IDE',
    accent: '#22D3EE',
    svgInner: `<path d="M23 21L12 32l11 11M41 21l11 11-11 11M35 16l-6 32" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    id: 'preset:chat',
    label: 'Чат / Связь',
    accent: '#6366F1',
    svgInner: `<path d="M12 20a6 6 0 016-6h28a6 6 0 016 6v18a6 6 0 01-6 6H26l-10 8v-8h-0a6 6 0 01-4-6V20z" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round"/><circle cx="24" cy="29" r="2.5" fill="currentColor"/><circle cx="32" cy="29" r="2.5" fill="currentColor"/><circle cx="40" cy="29" r="2.5" fill="currentColor"/>`,
  },
  {
    id: 'preset:doc',
    label: 'Документ',
    accent: '#F59E0B',
    svgInner: `<path d="M18 11h19l11 11v29a3 3 0 01-3 3H18a3 3 0 01-3-3V14a3 3 0 013-3z" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M37 11v11h11M22 31h20M22 39h20M22 47h13" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" fill="none"/>`,
  },
  {
    id: 'preset:cpu',
    label: 'Система',
    accent: '#10B981',
    svgInner: `<rect x="18" y="18" width="28" height="28" rx="5" stroke="currentColor" stroke-width="3" fill="none"/><rect x="25" y="25" width="14" height="14" rx="2" fill="currentColor" opacity="0.85"/><path d="M25 11v7M39 11v7M25 46v7M39 46v7M11 25h7M11 39h7M46 25h7M46 39h7" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>`,
  },
  {
    id: 'preset:headphones',
    label: 'Звук / Войс',
    accent: '#EC4899',
    svgInner: `<path d="M13 35v-3a19 19 0 0138 0v3" stroke="currentColor" stroke-width="3.2" fill="none"/><rect x="11" y="33" width="9" height="16" rx="4.5" stroke="currentColor" stroke-width="3" fill="none"/><rect x="44" y="33" width="9" height="16" rx="4.5" stroke="currentColor" stroke-width="3" fill="none"/>`,
  },
];

interface BrandSignature {
  match: RegExp;
  accent: string;
  category: ItemCategory;
  bgStart: string;
  bgEnd: string;
  glyph: string;
}

const BRAND_SIGNATURES: BrandSignature[] = [
  {
    match: /\b(steam|cs2|counter-strike|dota|hl2)\b/i,
    accent: '#00D2FF',
    category: 'games',
    bgStart: '#0B1D36',
    bgEnd: '#144B7A',
    glyph: `<circle cx="39" cy="24" r="8" stroke="#66E3FF" stroke-width="3.5" fill="none"/><circle cx="39" cy="24" r="3.2" fill="#66E3FF"/><circle cx="23" cy="41" r="6" stroke="#66E3FF" stroke-width="3.2" fill="none"/><path d="M10 35l13 6M27 37l8-7" stroke="#66E3FF" stroke-width="4.5" stroke-linecap="round"/>`,
  },
  {
    match: /\b(discord)\b/i,
    accent: '#5865F2',
    category: 'apps',
    bgStart: '#23286B',
    bgEnd: '#5865F2',
    glyph: `<path d="M21 21c4-2 8-2.5 11-2.5S39 19 43 21c3 6 4 13 3 20-3.5 2.6-7 4-10.5 4.5l-2-3.5c3-.8 4.5-2 4.5-2-3 1.5-6 2-12 0 0 0 1.5 1.2 4.5 2l-2 3.5C25 45 21.5 43.6 18 41c-1-7 0-14 3-20z" fill="#EEF0FF"/><circle cx="26.5" cy="31.5" r="3" fill="#23286B"/><circle cx="37.5" cy="31.5" r="3" fill="#23286B"/>`,
  },
  {
    match: /\b(telegram|tdesktop)\b/i,
    accent: '#2AABEE',
    category: 'apps',
    bgStart: '#0E3958',
    bgEnd: '#229ED9',
    glyph: `<path d="M48 18L14 31.5c-1.8.7-1.7 2.4-.2 2.9l8.6 2.7 19.8-12.5c.9-.6 1.8-.3 1.1.4L27.2 39.6l-.6 8.8c.9 0 1.3-.4 1.8-.9l4.2-4.1 8.8 6.5c1.6.9 2.8.4 3.2-1.5L50 20.1c.5-2-0.8-2.8-2-2.1z" fill="#FFFFFF"/>`,
  },
  {
    match: /\b(spotify)\b/i,
    accent: '#1ED760',
    category: 'media',
    bgStart: '#0A2E18',
    bgEnd: '#15883E',
    glyph: `<path d="M18 25c9-2.8 20-2.2 28 2.2M20 33c7.5-2.2 16.5-1.7 23.5 1.9M22 40.5c6-1.6 13-1.2 18.5 1.5" stroke="#1ED760" stroke-width="4" stroke-linecap="round" fill="none"/>`,
  },
  {
    match: /\b(chrome|google\s*chrome)\b/i,
    accent: '#FACC15',
    category: 'apps',
    bgStart: '#1E293B',
    bgEnd: '#0F172A',
    glyph: `<circle cx="32" cy="32" r="18" stroke="#38BDF8" stroke-width="4" fill="none"/><path d="M17 22a18 18 0 0129 2" stroke="#EF4444" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M47 24a18 18 0 01-13 26" stroke="#FACC15" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M31 50A18 18 0 0116 23" stroke="#22C55E" stroke-width="5" stroke-linecap="round" fill="none"/><circle cx="32" cy="32" r="7.5" fill="#3B82F6"/>`,
  },
  {
    match: /\b(firefox|mozilla)\b/i,
    accent: '#FF7139',
    category: 'apps',
    bgStart: '#2D1238',
    bgEnd: '#9A2B25',
    glyph: `<circle cx="32" cy="33" r="16" fill="#FF7139"/><circle cx="34" cy="34" r="9" fill="#3B1D5E"/><path d="M22 20c5-5 15-4 20 2 3 4 4 11 0 17-4 6-14 8-20 3" stroke="#FACC15" stroke-width="4" stroke-linecap="round" fill="none"/>`,
  },
  {
    match: /\b(brave)\b/i,
    accent: '#FB542B',
    category: 'apps',
    bgStart: '#2B120C',
    bgEnd: '#7C2312',
    glyph: `<polygon points="32,13 47,20 43,41 32,51 21,41 17,20" stroke="#FB542B" stroke-width="3.4" fill="none"/><path d="M24 26h16l-3 9-5 5-5-5-3-9z" fill="#FDBA74"/>`,
  },
  {
    match: /\b(opera)\b/i,
    accent: '#FF1B2D',
    category: 'apps',
    bgStart: '#2A0810',
    bgEnd: '#730F1D',
    glyph: `<circle cx="32" cy="32" r="17" stroke="#FF1B2D" stroke-width="5.5" fill="none"/><ellipse cx="34" cy="32" rx="8" ry="14" stroke="#FF6B78" stroke-width="2.5" fill="none"/>`,
  },
  {
    match: /\b(msedge|edge)\b/i,
    accent: '#0EA5E9',
    category: 'apps',
    bgStart: '#082F49',
    bgEnd: '#0369A1',
    glyph: `<path d="M45 37c-3 7-11 11-19 9-9-2-14-11-12-20s11-14 20-12c7 1.5 12 7.5 12 14 0 4-3 6-7 6-4 0-7-3-7-7 0-3 2-5 5-5" stroke="#38BDF8" stroke-width="4.5" stroke-linecap="round" fill="none"/>`,
  },
  {
    match: /\b(code|vscode|visual studio code|cursor)\b/i,
    accent: '#0098FF',
    category: 'work',
    bgStart: '#082038',
    bgEnd: '#005BA1',
    glyph: `<path d="M42 14L20 35l-7-5.5L10 32l10 9 22 9 8-4V18l-8-4z" stroke="#38BDF8" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M42 15v34L22 32 42 15z" fill="#38BDF8" opacity="0.35"/>`,
  },
  {
    match: /\b(obs|obs64|streamlabs)\b/i,
    accent: '#E2E8F0',
    category: 'media',
    bgStart: '#0F172A',
    bgEnd: '#334155',
    glyph: `<circle cx="32" cy="32" r="18" stroke="#E2E8F0" stroke-width="3.2" fill="none"/><path d="M32 14a10 10 0 018 16M47 40a10 10 0 01-17 1M17 38a10 10 0 019-16" stroke="#38BDF8" stroke-width="3.8" stroke-linecap="round" fill="none"/>`,
  },
  {
    match: /\b(youtube\.com|youtu\.be|youtube)\b/i,
    accent: '#FF2E4C',
    category: 'media',
    bgStart: '#300810',
    bgEnd: '#881124',
    glyph: `<rect x="12" y="18" width="40" height="28" rx="9" fill="#FF2E4C"/><polygon points="28,25 28,39 40,32" fill="#FFFFFF"/>`,
  },
  {
    match: /\b(twitch\.tv|twitch)\b/i,
    accent: '#A970FF',
    category: 'media',
    bgStart: '#231042',
    bgEnd: '#5B21B6',
    glyph: `<path d="M16 14h32v22l-9 9h-8l-5 5v-5h-10V14z" stroke="#C4B5FD" stroke-width="3.2" fill="none" stroke-linejoin="round"/><path d="M30 23v10M39 23v10" stroke="#C4B5FD" stroke-width="3.4" stroke-linecap="round"/>`,
  },
  {
    match: /\b(vlc|mpc-hc|potplayer|mpv)\b/i,
    accent: '#FF8800',
    category: 'media',
    bgStart: '#2E1605',
    bgEnd: '#7C3AED00',
    glyph: `<polygon points="32,13 45,47 19,47" stroke="#FF8800" stroke-width="3.2" fill="#FF880033" stroke-linejoin="round"/><path d="M24 33h16M21 41h22M15 48h34" stroke="#FDBA74" stroke-width="3.2" stroke-linecap="round"/>`,
  },
  {
    match: /\b(blender)\b/i,
    accent: '#F97316',
    category: 'work',
    bgStart: '#2B1508',
    bgEnd: '#7C2D12',
    glyph: `<circle cx="34" cy="35" r="12" stroke="#FB923C" stroke-width="3.5" fill="none"/><circle cx="34" cy="35" r="5" fill="#38BDF8"/><path d="M13 33l17-4M19 21l15 4" stroke="#FB923C" stroke-width="3.5" stroke-linecap="round"/>`,
  },
  {
    match: /\b(epic\s*games|epicgameslauncher)\b/i,
    accent: '#E2E8F0',
    category: 'games',
    bgStart: '#111827',
    bgEnd: '#1F2937',
    glyph: `<path d="M19 14h26v26l-13 10-13-10V14z" stroke="#F8FAFC" stroke-width="3" fill="none"/><path d="M26 22h12M26 29h10M26 36h12M26 22v14" stroke="#C8FF2E" stroke-width="3" stroke-linecap="round"/>`,
  },
  {
    match: /\b(explorer|проводник)\b/i,
    accent: '#FBBF24',
    category: 'files',
    bgStart: '#2B2108',
    bgEnd: '#78350F',
    glyph: `<path d="M11 20a4 4 0 014-4h12l5 5h17a4 4 0 014 4v20a4 4 0 01-4 4H15a4 4 0 01-4-4V20z" fill="#FBBF2433" stroke="#FBBF24" stroke-width="3"/><rect x="23" y="34" width="18" height="7" rx="2" fill="#38BDF8"/>`,
  },
  {
    match: /\b(powershell|pwsh|cmd|wt|terminal|терминал)\b/i,
    accent: '#38BDF8',
    category: 'work',
    bgStart: '#09192C',
    bgEnd: '#1E3A8A',
    glyph: `<rect x="11" y="14" width="42" height="36" rx="6" stroke="#60A5FA" stroke-width="3" fill="none"/><path d="M20 25l8 7-8 7M32 39h11" stroke="#C8FF2E" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  {
    match: /\b(github\.com|github)\b/i,
    accent: '#E2E8F0',
    category: 'work',
    bgStart: '#0D1117',
    bgEnd: '#21262D',
    glyph: `<circle cx="32" cy="30" r="14" stroke="#F0F6FC" stroke-width="3" fill="none"/><path d="M24 21l-2-6 6 3M40 21l2-6-6 3M27 44v6M37 44v6" stroke="#F0F6FC" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
];

export function computeIconHash(dataUrl: string): string {
  return crypto.createHash('sha1').update(dataUrl).digest('hex').slice(0, 12);
}

export function renderStyledSvgDataUrl(
  svgInner: string,
  accent: string,
  bgStart = '#0F1420',
  bgEnd = '#182235'
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgStart}"/>
      <stop offset="100%" stop-color="${bgEnd}"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#bg)" stroke="${accent}" stroke-opacity="0.42" stroke-width="2"/>
  <g style="color:${accent}">${svgInner}</g>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export function renderPresetIconDataUrl(presetId: string): { iconDataUrl: string; accent: string } | null {
  const found = ICON_PRESETS.find((p) => p.id === presetId);
  if (!found) return null;
  return {
    accent: found.accent,
    iconDataUrl: renderStyledSvgDataUrl(found.svgInner, found.accent),
  };
}

/**
 * Extracts the largest embedded PNG frame from a Windows .ico file directly in pure Node!
 * Windows high-DPI .ico files store a crisp 256x256 PNG frame inside the ICO directory.
 */
export function extractLargestPngFromIco(icoPath: string): string | null {
  try {
    if (!fs.existsSync(icoPath)) return null;
    const buf = fs.readFileSync(icoPath);
    if (buf.length < 22) return null;
    const reserved = buf.readUInt16LE(0);
    const type = buf.readUInt16LE(2);
    const count = buf.readUInt16LE(4);
    if (reserved !== 0 || type !== 1 || count < 1 || count > 64) return null;

    let bestPngOffset = -1;
    let bestPngSize = 0;
    let bestDim = -1;

    for (let i = 0; i < count; i++) {
      const entryOffset = 6 + i * 16;
      if (entryOffset + 16 > buf.length) break;
      const rawW = buf.readUInt8(entryOffset);
      const rawH = buf.readUInt8(entryOffset + 1);
      const w = rawW === 0 ? 256 : rawW;
      const h = rawH === 0 ? 256 : rawH;
      const bytesInRes = buf.readUInt32LE(entryOffset + 8);
      const imageOffset = buf.readUInt32LE(entryOffset + 12);

      if (imageOffset + bytesInRes <= buf.length && bytesInRes > 8) {
        // Check PNG magic signature: 89 50 4E 47 0D 0A 1A 0A
        if (
          buf[imageOffset] === 0x89 &&
          buf[imageOffset + 1] === 0x50 &&
          buf[imageOffset + 2] === 0x4e &&
          buf[imageOffset + 3] === 0x47
        ) {
          const score = w * h;
          if (score > bestDim) {
            bestDim = score;
            bestPngOffset = imageOffset;
            bestPngSize = bytesInRes;
          }
        }
      }
    }

    if (bestPngOffset >= 0 && bestPngSize > 0) {
      const pngSlice = buf.subarray(bestPngOffset, bestPngOffset + bestPngSize);
      return `data:image/png;base64,${pngSlice.toString('base64')}`;
    }
  } catch {
    // Ignore parse errors and let fallback handle it
  }
  return null;
}

export function parseWindowsUrlShortcut(urlFilePath: string): { url?: string; iconFile?: string } {
  try {
    const content = fs.readFileSync(urlFilePath, 'utf8');
    const urlMatch = content.match(/^URL=(.+)$/im);
    const iconMatch = content.match(/^IconFile=(.+)$/im);
    return {
      url: urlMatch ? urlMatch[1].trim() : undefined,
      iconFile: iconMatch ? iconMatch[1].trim() : undefined,
    };
  } catch {
    return {};
  }
}

export function inferKindFromTarget(target: string): ItemKind {
  const trimmed = target.trim();
  if (/^(https?:\/\/|steam:\/\/|com\.epicgames\.launcher:\/\/|discord:\/\/|spotify:)/i.test(trimmed)) {
    return 'url';
  }
  try {
    if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
      return 'folder';
    }
  } catch {
    // ignore
  }
  const ext = path.extname(trimmed).toLowerCase();
  if (['.exe', '.lnk', '.appref-ms', '.msi'].includes(ext)) return 'app';
  if (['.url'].includes(ext)) return 'url';
  if (['.bat', '.cmd', '.ps1', '.sh', '.py'].includes(ext)) return 'script';
  if (!ext && (trimmed.endsWith('\\') || trimmed.endsWith('/'))) return 'folder';
  return 'file';
}

export function inferCategoryFromTarget(name: string, target: string, kind: ItemKind): ItemCategory {
  const combined = `${name} ${target}`.toLowerCase();
  for (const sig of BRAND_SIGNATURES) {
    if (sig.match.test(combined)) return sig.category;
  }
  if (/steamapps|games|игры|steam:\/\/rungameid/i.test(combined)) return 'games';
  const ext = path.extname(target).toLowerCase();
  if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.mp3', '.flac', '.wav', '.m4a'].includes(ext)) {
    return 'media';
  }
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.sln', '.code-workspace'].includes(ext)) {
    return 'work';
  }
  if (kind === 'folder' || kind === 'file') return 'files';
  if (kind === 'script') return 'work';
  return 'apps';
}

export function inferDisplayName(target: string): string {
  const trimmed = target.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const host = u.hostname.replace(/^www\./i, '');
      const main = host.split('.')[0];
      return main.charAt(0).toUpperCase() + main.slice(1);
    } catch {
      return trimmed;
    }
  }
  const cleaned = trimmed.replace(/[\\/]+$/, '');
  const base = path.basename(cleaned);
  const ext = path.extname(base);
  if (['.exe', '.lnk', '.url', '.bat', '.cmd', '.ps1'].includes(ext.toLowerCase())) {
    return base.slice(0, base.length - ext.length) || base;
  }
  return base || trimmed;
}

export function generateFallbackIcon(name: string, target: string, kind: ItemKind): {
  iconDataUrl: string;
  accent: string;
} {
  const combined = `${name} ${target}`;
  for (const sig of BRAND_SIGNATURES) {
    if (sig.match.test(combined)) {
      return {
        accent: sig.accent,
        iconDataUrl: renderStyledSvgDataUrl(sig.glyph, sig.accent, sig.bgStart, sig.bgEnd),
      };
    }
  }

  const ext = path.extname(target).toLowerCase();
  if (kind === 'folder') {
    const p = renderPresetIconDataUrl('preset:folder')!;
    return p;
  }
  if (['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(ext)) {
    return renderPresetIconDataUrl('preset:film')!;
  }
  if (['.mp3', '.flac', '.wav', '.ogg', '.m4a'].includes(ext)) {
    return renderPresetIconDataUrl('preset:music')!;
  }
  if (['.pdf', '.doc', '.docx', '.txt', '.rtf', '.xlsx', '.pptx'].includes(ext)) {
    return renderPresetIconDataUrl('preset:doc')!;
  }
  if (kind === 'script') {
    return renderPresetIconDataUrl('preset:terminal')!;
  }
  if (kind === 'url') {
    return renderPresetIconDataUrl('preset:globe')!;
  }

  // Stylized cyber monogram badge with deterministic vibrant neon accent
  const palette = ['#C8FF2E', '#00F0FF', '#FF3B5C', '#FFB800', '#A855F7', '#10B981', '#38BDF8'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const accent = palette[hash % palette.length];
  const cleanChars = name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, '').toUpperCase();
  const monogram = (cleanChars.slice(0, 2) || 'NX').replace(/[<>&"']/g, '');

  const badgeLabel = ext ? ext.replace('.', '').slice(0, 4).toUpperCase() : kind.toUpperCase();
  const inner = `
    <text x="32" y="34" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="800" font-size="21" fill="${accent}" letter-spacing="1">${monogram}</text>
    <text x="32" y="51" text-anchor="middle" font-family="monospace" font-weight="700" font-size="8.5" fill="#94A3B8" letter-spacing="1.2">${badgeLabel}</text>
  `;
  return {
    accent,
    iconDataUrl: renderStyledSvgDataUrl(inner, accent),
  };
}

/**
 * Resolves the highest-quality icon + metadata for any target (.exe, .lnk, .url, file, folder, website)
 */
export async function resolveItemIconAndMeta(
  adapter: PlatformAdapter,
  input: {
    name?: string;
    target: string;
    args?: string;
    kind?: ItemKind;
    category?: ItemCategory;
    accent?: string;
    iconDataUrl?: string;
    iconPreset?: string;
  }
): Promise<{
  name: string;
  target: string;
  args?: string;
  kind: ItemKind;
  category: ItemCategory;
  accent: string;
  iconDataUrl: string;
  iconHash: string;
}> {
  let effectiveTarget = input.target.trim();
  let effectiveArgs = input.args;
  let shortcutIconCandidate: string | undefined;
  let originalDisplayName = input.name?.trim() || inferDisplayName(effectiveTarget);

  const rawExt = path.extname(effectiveTarget).toLowerCase();

  // 1. Resolve Windows .lnk shortcut to clean target + optional custom icon
  if (rawExt === '.lnk') {
    const lnk = adapter.readShortcut(effectiveTarget);
    if (lnk && lnk.target) {
      shortcutIconCandidate = lnk.icon || undefined;
      if (!effectiveArgs && lnk.args) {
        effectiveArgs = lnk.args;
      }
      effectiveTarget = lnk.target;
    }
  }

  // 2. Resolve Windows .url shortcut (e.g. Steam Desktop/StartMenu shortcuts!)
  if (rawExt === '.url') {
    const parsedUrl = parseWindowsUrlShortcut(effectiveTarget);
    if (parsedUrl.iconFile) {
      shortcutIconCandidate = parsedUrl.iconFile;
    }
    if (parsedUrl.url) {
      effectiveTarget = parsedUrl.url;
    }
  }

  const kind = input.kind || inferKindFromTarget(effectiveTarget);
  const category = input.category || inferCategoryFromTarget(originalDisplayName, effectiveTarget, kind);
  const fallback = generateFallbackIcon(originalDisplayName, effectiveTarget, kind);

  // Explicit custom uploaded icon takes priority
  if (input.iconDataUrl && input.iconDataUrl.startsWith('data:image/')) {
    const accent = input.accent || fallback.accent;
    return {
      name: originalDisplayName,
      target: effectiveTarget,
      args: effectiveArgs,
      kind,
      category,
      accent,
      iconDataUrl: input.iconDataUrl,
      iconHash: computeIconHash(input.iconDataUrl),
    };
  }

  // Explicit preset icon selection
  if (input.iconPreset) {
    const preset = renderPresetIconDataUrl(input.iconPreset);
    if (preset) {
      const accent = input.accent || preset.accent;
      return {
        name: originalDisplayName,
        target: effectiveTarget,
        args: effectiveArgs,
        kind,
        category,
        accent,
        iconDataUrl: preset.iconDataUrl,
        iconHash: computeIconHash(preset.iconDataUrl),
      };
    }
  }

  let extractedIcon: string | null = null;

  // 3. Try shortcut custom icon (.ico / .png / .exe)
  if (shortcutIconCandidate && fs.existsSync(shortcutIconCandidate)) {
    const iconExt = path.extname(shortcutIconCandidate).toLowerCase();
    if (iconExt === '.ico') {
      extractedIcon =
        extractLargestPngFromIco(shortcutIconCandidate) ||
        adapter.imageFileToDataUrl(shortcutIconCandidate);
    } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(iconExt)) {
      extractedIcon = adapter.imageFileToDataUrl(shortcutIconCandidate);
    }
    if (!extractedIcon) {
      extractedIcon = await adapter.getFileIconDataUrl(shortcutIconCandidate);
    }
  }

  // 4. If target itself is an .ico or image file
  if (!extractedIcon && fs.existsSync(effectiveTarget)) {
    const tExt = path.extname(effectiveTarget).toLowerCase();
    if (tExt === '.ico') {
      extractedIcon =
        extractLargestPngFromIco(effectiveTarget) || adapter.imageFileToDataUrl(effectiveTarget);
    } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(tExt)) {
      extractedIcon = adapter.imageFileToDataUrl(effectiveTarget);
    }
  }

  // 5. Native Windows Shell File Icon (.exe, .mp4, .pdf, .docx, etc.)
  if (!extractedIcon && kind !== 'folder' && kind !== 'url' && fs.existsSync(effectiveTarget)) {
    extractedIcon = await adapter.getFileIconDataUrl(effectiveTarget);
  }

  const finalIcon = extractedIcon || fallback.iconDataUrl;
  const finalAccent = input.accent || fallback.accent;

  return {
    name: originalDisplayName,
    target: effectiveTarget,
    args: effectiveArgs,
    kind,
    category,
    accent: finalAccent,
    iconDataUrl: finalIcon,
    iconHash: computeIconHash(finalIcon),
  };
}
