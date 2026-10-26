import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { extractLargestPngFromIco } from './icons';
import { startNexusServer } from './server';
import { DeckStore } from './store';
import { PlatformAdapter } from './types';

let mockAutostart = true;

function createNodeAdapter(): PlatformAdapter {
  const userDataDir = path.join(os.homedir(), '.nexus-pc-manager');
  return {
    userDataDir,
    getFileIconDataUrl: async () => null,
    readShortcut: () => null,
    imageFileToDataUrl: (imgPath: string) => {
      try {
        if (!fs.existsSync(imgPath)) return null;
        const ext = path.extname(imgPath).toLowerCase();
        if (ext === '.ico') return extractLargestPngFromIco(imgPath);
        const mime =
          ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
            ? 'image/webp'
            : 'image/png';
        return `data:${mime};base64,${fs.readFileSync(imgPath).toString('base64')}`;
      } catch {
        return null;
      }
    },
    openPath: async (targetPath: string) => {
      return new Promise((resolve) => {
        if (process.platform === 'win32') {
          execFile('explorer.exe', [targetPath], () => resolve(''));
        } else {
          resolve('');
        }
      });
    },
    openExternal: async () => {},
    getAutostart: () => mockAutostart,
    setAutostart: (enabled: boolean) => {
      mockAutostart = enabled;
      return enabled;
    },
  };
}

async function main() {
  const adapter = createNodeAdapter();
  const store = new DeckStore(adapter);
  const handle = await startNexusServer(adapter, store, (msg) => {
    console.log(`[NEXUS] ${msg}`);
  });
  console.log(`NEXUS PC Server listening on http://0.0.0.0:${handle.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
