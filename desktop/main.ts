import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Supervisor } from './supervisor';
import { readSettings, saveSettings, type Settings } from './settings';
import { settingsPath, dataDirDefault, logDir, crashLogPath } from './paths';
import { advertise, type AdvertiseHandle } from '../lib/mdnsDiscovery';

let supervisor: Supervisor | null = null;
let mainWindow: BrowserWindow | null = null;
let wizardWindow: BrowserWindow | null = null;
let mdnsHandle: AdvertiseHandle | null = null;

function entryPath(): string {
  // In production the .app unpacks resources at process.resourcesPath/app
  // In dev (npm run desktop:dev) __dirname is desktop/dist/
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'desktop', 'server-entry.cjs');
  }
  return path.resolve(__dirname, '..', 'server-entry.cjs');
}

async function bootSupervisor(settings: Settings): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LARIAT_DATA_DIR: settings.dataDir,
    PORT: String(settings.port),
    HOST: '0.0.0.0',
    NODE_ENV: 'production',
  };
  if (settings.datapackDir) env.LARIAT_DATA_ROOT = settings.datapackDir;
  if (settings.pythonPath) env.LARIAT_PYTHON = settings.pythonPath;
  if (settings.ollamaUrl) env.LARIAT_OLLAMA_URL = settings.ollamaUrl;

  supervisor = new Supervisor({
    entryPath: entryPath(),
    electronExecPath: process.execPath,
    env,
    onCrash: (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'Lariat server crashed',
          message: `Server exited (code=${info.exitCode}, signal=${info.signal}).`,
          detail: `See ${crashLogPath()} for details. Supervisor will retry automatically.`,
          buttons: ['View Log', 'Continue'],
        }).then(({ response }) => {
          if (response === 0) shell.openPath(crashLogPath());
        });
      }
    },
  });
  supervisor.start();

  // Poll until /api/discover is reachable (max 30s), then open the window
  const ok = await waitForServer(`http://127.0.0.1:${settings.port}/api/discover`, 30_000);
  if (!ok) {
    dialog.showErrorBox('Lariat failed to start', `Server did not respond within 30s. See ${logDir()}.`);
    app.quit();
    return;
  }

  // Start mDNS responder so iPads can find the hub
  try {
    mdnsHandle = await advertise({ port: settings.port, locationId: 'default' });
  } catch (e) {
    console.warn('[main] mDNS advertise failed (non-fatal):', e);
  }

  openMainWindow(settings.port);
}

function openMainWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Lariat',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function openWizard(): Promise<Settings> {
  return new Promise((resolve, reject) => {
    wizardWindow = new BrowserWindow({
      width: 600,
      height: 500,
      title: 'Lariat — Setup',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const wizardHtml = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'desktop', 'dist', 'wizard', 'index.html')
      : path.resolve(__dirname, 'wizard', 'index.html');
    wizardWindow.loadFile(wizardHtml);

    ipcMain.handleOnce('wizard:proceed', (_evt, settings: Settings) => {
      saveSettings(settingsPath(), settings);
      wizardWindow?.close();
      wizardWindow = null;
      resolve(settings);
    });
    ipcMain.handleOnce('wizard:cancel', () => {
      wizardWindow?.close();
      wizardWindow = null;
      reject(new Error('wizard cancelled'));
    });
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

ipcMain.handle('settings:get', () => readSettings(settingsPath()));
ipcMain.handle('dialog:pickDirectory', async (_evt, defaultPath?: string) => {
  const r = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath,
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('paths:dataDirDefault', () => dataDirDefault());

/**
 * Spec §6.6: detect a pre-existing dev-tree DB so the wizard can offer
 * "use in place" without a full path picker. Probes the canonical dev
 * location only — any other location, the user picks via "Choose…".
 * Returns the absolute parent dir (suitable for LARIAT_DATA_DIR) or null.
 */
ipcMain.handle('paths:detectExistingDb', () => {
  const candidate = path.join(os.homedir(), 'Dev', 'Lariat', 'data', 'lariat.db');
  if (fs.existsSync(candidate)) return path.dirname(candidate);
  return null;
});

app.whenReady().then(async () => {
  let settings = readSettings(settingsPath());
  if (!settings) {
    try {
      settings = await openWizard();
    } catch {
      app.quit();
      return;
    }
  }
  // Ensure data dir exists; first server boot will run initSchema
  fs.mkdirSync(settings.dataDir, { recursive: true });
  await bootSupervisor(settings);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (!supervisor) return;       // re-entry guard: app.exit(0) below re-fires before-quit
  event.preventDefault();
  try { await mdnsHandle?.stop(); } catch {}
  await supervisor.shutdown();
  supervisor = null;
  app.exit(0);
});
