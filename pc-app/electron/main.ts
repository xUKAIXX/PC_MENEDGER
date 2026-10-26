import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { extractLargestPngFromIco } from './icons';
import { startNexusServer, NexusServerHandle } from './server';
import { DeckStore } from './store';
import { PlatformAdapter, ShortcutDetails } from './types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverHandle: NexusServerHandle | null = null;
let isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getStartupExePath(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function createElectronAdapter(): PlatformAdapter {
  return {
    userDataDir: app.getPath('userData'),
    getFileIconDataUrl: async (filePath: string): Promise<string | null> => {
      try {
        const img = await app.getFileIcon(filePath, { size: 'large' });
        if (img && !img.isEmpty()) {
          return img.toDataURL();
        }
      } catch {
        // fallback handled by caller
      }
      return null;
    },
    readShortcut: (lnkPath: string): ShortcutDetails | null => {
      try {
        if (process.platform === 'win32') {
          const details = shell.readShortcutLink(lnkPath);
          return {
            target: details.target,
            args: details.args,
            cwd: details.cwd,
            icon: details.icon,
          };
        }
      } catch {
        // ignore invalid shortcut
      }
      return null;
    },
    imageFileToDataUrl: (imgPath: string): string | null => {
      try {
        const ext = path.extname(imgPath).toLowerCase();
        if (ext === '.svg') {
          const raw = fs.readFileSync(imgPath);
          return `data:image/svg+xml;base64,${raw.toString('base64')}`;
        }
        if (ext === '.ico') {
          const icoPng = extractLargestPngFromIco(imgPath);
          if (icoPng) return icoPng;
        }
        const img = nativeImage.createFromPath(imgPath);
        if (!img.isEmpty()) {
          const size = img.getSize();
          const resized =
            size.width > 160 || size.height > 160
              ? img.resize({ width: 128, height: 128, quality: 'best' })
              : img;
          return resized.toDataURL();
        }
      } catch {
        // ignore
      }
      return null;
    },
    openPath: async (targetPath: string): Promise<string> => {
      return shell.openPath(targetPath);
    },
    openExternal: async (url: string): Promise<void> => {
      await shell.openExternal(url);
    },
    getAutostart: (): boolean => {
      if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
      try {
        return app.getLoginItemSettings({
          path: getStartupExePath(),
          args: ['--hidden'],
        }).openAtLogin;
      } catch {
        return false;
      }
    },
    setAutostart: (enabled: boolean): boolean => {
      if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          path: getStartupExePath(),
          args: ['--hidden'],
        });
        return enabled;
      } catch {
        return false;
      }
    },
  };
}

function resolveAppIconPath(): string {
  const candidates = [
    path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'build', 'icon.ico'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function createTray(adapter: PlatformAdapter) {
  try {
    const iconPath = resolveAppIconPath();
    let trayIcon = nativeImage.createFromPath(iconPath);
    if (process.platform !== 'win32' && !trayIcon.isEmpty()) {
      trayIcon = trayIcon.resize({ width: 22, height: 22 });
    }
    tray = new Tray(trayIcon);
    tray.setToolTip('NEXUS // PC DECK — Сервер активен');

    const updateMenu = () => {
      const autostart = adapter.getAutostart();
      const menu = Menu.buildFromTemplate([
        {
          label: 'Открыть NEXUS PC',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Автозапуск с Windows',
          type: 'checkbox',
          checked: autostart,
          click: (item) => {
            adapter.setAutostart(item.checked);
            updateMenu();
          },
        },
        { type: 'separator' },
        {
          label: 'Выйти полностью',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]);
      tray?.setContextMenu(menu);
    };

    updateMenu();
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch {
    // Non-fatal if OS has no system tray
  }
}

function createWindow(startHidden: boolean) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    backgroundColor: '#07080C',
    show: !startHidden,
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function registerIpc(adapter: PlatformAdapter) {
  ipcMain.handle('nexus:pick-files', async () => {
    if (!mainWindow) return [];
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите приложения (.exe, .lnk) или любые файлы',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('nexus:pick-folder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите папку для быстрого доступа',
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });

  ipcMain.handle('nexus:pick-icon-image', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите иконку (PNG, ICO, SVG, JPG, WEBP)',
      filters: [
        { name: 'Иконки и изображения', extensions: ['png', 'ico', 'svg', 'jpg', 'jpeg', 'webp'] },
      ],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return adapter.imageFileToDataUrl(res.filePaths[0]);
  });

  ipcMain.on('nexus:win-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('nexus:win-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.on('nexus:win-hide-tray', () => {
    if (tray) mainWindow?.hide();
    else mainWindow?.close();
  });

  ipcMain.on('nexus:app-quit', () => {
    isQuitting = true;
    app.quit();
  });
}

app.whenReady().then(async () => {
  const adapter = createElectronAdapter();
  const store = new DeckStore(adapter);

  // Enable autostart by default on first run on Windows so Wake-on-LAN works seamlessly!
  if (process.platform === 'win32' && !store.getState().initialized) {
    adapter.setAutostart(true);
  }

  serverHandle = await startNexusServer(adapter, store);
  registerIpc(adapter);
  createTray(adapter);

  const startHidden = process.argv.includes('--hidden');
  createWindow(startHidden);
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (serverHandle) {
    await serverHandle.close();
    serverHandle = null;
  }
});

app.on('window-all-closed', () => {
  if (!tray && process.platform !== 'darwin') {
    app.quit();
  }
});
