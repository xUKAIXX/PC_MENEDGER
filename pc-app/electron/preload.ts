import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('nexusDesktop', {
  isElectron: true,
  apiPort: 7788,
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('nexus:pick-files'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('nexus:pick-folder'),
  pickIconImage: (): Promise<string | null> => ipcRenderer.invoke('nexus:pick-icon-image'),
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return (file as any)?.path || '';
    }
  },
  minimizeWindow: () => ipcRenderer.send('nexus:win-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('nexus:win-maximize'),
  hideToTray: () => ipcRenderer.send('nexus:win-hide-tray'),
  quitApp: () => ipcRenderer.send('nexus:app-quit'),
});
