import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Supervisor } from './supervisor';
import { readSettings, saveSettings, type Settings } from './settings';
import { settingsPath, dataDirDefault, logDir, crashLogPath } from './paths';

let supervisor: Supervisor | null = null;
let mainWindow: BrowserWindow | null = null;
let wizardWindow: BrowserWindow | null = null;
let wizardResolver: ((_settings: Settings) => void) | null = null;
let wizardRejecter: ((_err: Error) => void) | null = null;

function entryPath(): string {
  // In production the .app unpacks resources at process.resourcesPath/app
  // In dev (npm run desktop:dev) __dirname is desktop/dist/desktop/, so climb
  // two levels to reach desktop/server-entry.cjs (the source, not emitted).
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'desktop', 'server-entry.cjs');
  }
  return path.resolve(__dirname, '..', '..', 'server-entry.cjs');
}

async function bootSupervisor(settings: Settings): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LARIAT_DATA_DIR: settings.dataDir,
    PORT: String(settings.port),
    HOST: '0.0.0.0',
    NODE_ENV: 'production',
    // process.execPath is the Electron binary inside a packaged .app; without
    // this flag, fork() would spawn a second windowless Electron instead of
    // running server-entry.cjs as Node.
    ELECTRON_RUN_AS_NODE: '1',
  };
  if (settings.datapackDir) env.LARIAT_DATA_ROOT = settings.datapackDir;
  if (settings.pythonPath) env.LARIAT_PYTHON = settings.pythonPath;
  if (settings.ollamaUrl) env.LARIAT_OLLAMA_URL = settings.ollamaUrl;
  // Cloud-bridge wiring (T8b). Both must be present for the in-process
  // drainer launched from instrumentation.ts to register as configured;
  // either-absent leaves LARIAT_CLOUD_BRIDGE_* unset and the drainer
  // logs a one-line skip per lib/cloudBridgeDrainerLifecycle.ts.
  if (settings.cloudBridgeUrl) env.LARIAT_CLOUD_BRIDGE_URL = settings.cloudBridgeUrl;
  if (settings.cloudBridgeSecret) env.LARIAT_CLOUD_BRIDGE_SECRET = settings.cloudBridgeSecret;

  supervisor = new Supervisor({
    entryPath: entryPath(),
    electronExecPath: process.execPath,
    env,
    onCrash: (info) => {
      const detail = `Server exited (code=${info.exitCode}, signal=${info.signal}). See ${crashLogPath()} for details.`;
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
      } else {
        // No main window yet (boot phase) — at least surface to a system dialog
        dialog.showErrorBox('Lariat server crashed', detail);
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

  // mDNS responder runs inside the Next child via instrumentation.ts; do not duplicate here

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
    wizardResolver = resolve;
    wizardRejecter = reject;
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
      : path.resolve(__dirname, '..', 'wizard', 'index.html');
    wizardWindow.loadFile(wizardHtml);
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
ipcMain.handle('settings:set', async (_evt, settings: Settings) => {
  saveSettings(settingsPath(), settings);
});
ipcMain.handle('dialog:pickDirectory', async (_evt, defaultPath?: string) => {
  const r = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath,
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('paths:dataDirDefault', () => dataDirDefault());

// Wizard IPC handlers — registered at module load so openWizard() can be
// called multiple times in a process lifetime (e.g., future "settings reopen").
// handleOnce would throw "Attempted to register a second handler" on reuse.
ipcMain.handle('wizard:proceed', async (_evt, settings: Settings) => {
  // saveSettings throws on disk-full / permission errors. We deliberately
  // do NOT catch — the throw propagates to the renderer's invoke() so
  // wizard.tsx can show the error, and the close() below stays unreachable
  // so the wizard window remains open for the user to retry.
  saveSettings(settingsPath(), settings);
  wizardWindow?.close();
  wizardWindow = null;
  if (wizardResolver) {
    wizardResolver(settings);
    wizardResolver = null;
    wizardRejecter = null;
  }
});
ipcMain.handle('wizard:cancel', async () => {
  wizardWindow?.close();
  wizardWindow = null;
  if (wizardRejecter) {
    wizardRejecter(new Error('wizard cancelled'));
    wizardResolver = null;
    wizardRejecter = null;
  }
});

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
  await supervisor.shutdown();
  supervisor = null;
  app.exit(0);
});
