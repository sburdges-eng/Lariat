import { contextBridge, ipcRenderer } from 'electron';
import type { Settings } from './settings';

contextBridge.exposeInMainWorld('lariat', {
  getSettings: (): Promise<Settings | null> => ipcRenderer.invoke('settings:get'),
  pickDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickDirectory', defaultPath),
  getDataDirDefault: (): Promise<string> => ipcRenderer.invoke('paths:dataDirDefault'),
  detectExistingDb: (): Promise<string | null> => ipcRenderer.invoke('paths:detectExistingDb'),
  proceed: (settings: Settings): Promise<void> => ipcRenderer.invoke('wizard:proceed', settings),
  cancel: (): Promise<void> => ipcRenderer.invoke('wizard:cancel'),
});
