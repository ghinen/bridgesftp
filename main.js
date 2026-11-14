// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SshSession } = require('./src/session');
const { TransferQueue } = require('./src/transfers');
const { checkUpdates } = require('./src/updates');
const { Store } = require('./src/store');
const localfs = require('./src/localfs');
const { checkForAppUpdate, REPO } = require('./src/appupdate');

const APP_INFO = {
  name: 'BridgeSFTP',
  brand: 'ARWEH',
  author: 'Arne Wolter',
  copyright: 'Copyright © 2026 Arne Wolter · ARWEH',
  license: 'GPL-3.0-or-later',
  repoUrl: `https://github.com/${REPO}`,
  issuesUrl: `https://github.com/${REPO}/issues`,
  docsUrl: `https://github.com/${REPO}#readme`,
  releasesUrl: `https://github.com/${REPO}/releases`,
};

let store;
const contexts = new Map(); // webContents.id -> Fensterkontext
const pendingHostKeys = new Map();
let hostReqId = 1;
let startupUpdateCheckDone = false;

// Nur diese Adressen dürfen aus der App heraus im Browser geöffnet werden.
function isAllowedExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === 'github.com') return u.pathname === `/${REPO}` || u.pathname.startsWith(`/${REPO}/`) || u.pathname.startsWith(`/${REPO}#`);
    if (u.hostname === 'www.gnu.org') return u.pathname.startsWith('/licenses/');
    return false;
  } catch (_) { return false; }
}

function openExternal(url) {
  if (!isAllowedExternal(url)) throw new Error('Diese Adresse darf nicht geöffnet werden: ' + url);
  return shell.openExternal(url);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'BridgeSFTP',
    icon: path.join(__dirname, 'renderer', 'logo.png'),
    backgroundColor: '#1e2227',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const ctx = { win, session: null, queue: null, edits: new Map(), updateTimer: null };
  contexts.set(win.webContents.id, ctx);
  win.on('closed', () => { cleanup(ctx); contexts.delete(ctx.id); });
  ctx.id = win.webContents.id;
  // Links nie im App-Fenster öffnen; erlaubte Adressen gehen an den Browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.once('did-finish-load', () => {
    if (!startupUpdateCheckDone) {
      startupUpdateCheckDone = true;
      setTimeout(() => startupAppUpdateCheck(ctx), 4000);
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

async function startupAppUpdateCheck(ctx) {
  const s = store.getSettings();
  if (s.appUpdateCheck === false) return;
  try {
    const r = await checkForAppUpdate(app.getVersion(), net.fetch);
    if (r.available && r.latest !== s.skippedVersion) send(ctx, 'appupdate:available', r);
  } catch (e) {
    log(ctx, 'info', 'Suche nach neuer BridgeSFTP-Version nicht möglich: ' + e.message);
  }
}

function menuAction(action) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('menu', action);
}

function send(ctx, channel, ...args) {
  if (!ctx.win.isDestroyed()) ctx.win.webContents.send(channel, ...args);
}

function log(ctx, level, msg) { send(ctx, 'log', { level, msg, time: Date.now() }); }

function cleanup(ctx) {
  clearInterval(ctx.updateTimer);
  for (const e of ctx.edits.values()) { try { e.watcher.close(); } catch (_) { /* ignore */ } }
  ctx.edits.clear();
  if (ctx.session) ctx.session.disconnect();
  ctx.session = null;
  ctx.queue = null;
}

function ctxOf(evt) {
  const c = contexts.get(evt.sender.id);
  if (!c) throw new Error('Unbekanntes Fenster');
  return c;
}
function sessOf(evt) {
  const c = ctxOf(evt);
  if (!c.session || !c.session.connected) throw new Error('Nicht verbunden');
  return c;
}

// Hilfsfunktion: Fehler als lesbare Meldung an den Renderer zurückgeben
function handle(channel, fn) {
  ipcMain.handle(channel, async (evt, ...args) => {
    try { return { ok: true, data: await fn(evt, ...args) }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

async function runUpdateCheck(ctx) {
  if (!ctx.session || !ctx.session.connected) return;
  send(ctx, 'updates:status', { state: 'checking' });
  try {
    const r = await checkUpdates(ctx.session);
    send(ctx, 'updates:status', { state: 'done', result: r });
    log(ctx, 'info', r.supported
      ? `Update-Prüfung: ${r.count} Paket(e) aktualisierbar${r.securityCount ? `, davon ${r.securityCount} Sicherheitsupdate(s)` : ''}.`
      : 'Update-Prüfung: kein unterstützter Paketmanager gefunden.');
  } catch (e) {
    send(ctx, 'updates:status', { state: 'error', error: e.message });
    log(ctx, 'error', 'Update-Prüfung fehlgeschlagen: ' + e.message);
  }
}

function registerIpc() {
  // ---------- Seiten-Manager ----------
  handle('sites:list', () => store.listSites());
  handle('sites:save', (_e, site) => store.saveSite(site));
  handle('sites:delete', (_e, id) => store.deleteSite(id));
  handle('sites:canEncrypt', () => store.canEncrypt());
  handle('dialog:pickKey', async (evt) => {
    const r = await dialog.showOpenDialog(ctxOf(evt).win, {
      title: 'Privaten Schlüssel wählen',
      defaultPath: path.join(os.homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog:pickDir', async (evt) => {
    const r = await dialog.showOpenDialog(ctxOf(evt).win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // ---------- Verbindung ----------
  handle('ssh:connect', async (evt, params) => {
    const ctx = ctxOf(evt);
    cleanup(ctx);
    let opts = params;
    if (params.siteId) {
      const s = store.getSiteWithSecrets(params.siteId);
      if (!s) throw new Error('Gespeicherte Verbindung nicht gefunden');
      opts = { ...s, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) };
    }
    if (!opts.host || !opts.username) throw new Error('Host und Benutzer sind erforderlich');
    const port = Number(opts.port) || 22;
    log(ctx, 'info', `Verbinde mit ${opts.username}@${opts.host}:${port} …`);

    const session = new SshSession();
    const verifyHost = (fp) => {
      const known = store.hostKey(opts.host, port);
      if (known === fp) return Promise.resolve(true);
      return new Promise((resolve) => {
        const id = hostReqId++;
        pendingHostKeys.set(id, (accept, remember) => {
          if (accept && remember) store.trustHostKey(opts.host, port, fp);
          resolve(accept);
        });
        send(ctx, 'hostkey:ask', { id, host: opts.host, port, fingerprint: fp, previous: known });
      });
    };
    await session.connect(opts, verifyHost);
    ctx.session = session;
    ctx.queue = new TransferQueue(session);
    ctx.queue.setPolicy(store.getSettings().policy);
    ctx.queue.on('update', (j) => send(ctx, 'transfer:update', j));
    ctx.queue.on('cleared', (jobs) => send(ctx, 'transfer:cleared', jobs));
    ctx.queue.on('log', (lvl, m) => log(ctx, lvl, m));
    ctx.queue.on('idle', () => send(ctx, 'transfer:idle'));
    session.on('shell-data', (id, d) => send(ctx, 'shell:data', id, d));
    session.on('shell-exit', (id) => send(ctx, 'shell:exit', id));
    session.on('closed', () => {
      log(ctx, 'error', 'Verbindung zum Server wurde getrennt.');
      send(ctx, 'session:closed');
      clearInterval(ctx.updateTimer);
    });
    session.on('error', (e) => log(ctx, 'error', 'SSH-Fehler: ' + e.message));

    const home = await session.realpath('.');
    let startDir = home;
    if (opts.remoteDir) {
      try { await session.stat(opts.remoteDir); startDir = opts.remoteDir; } catch (_) { /* fallback home */ }
    }
    log(ctx, 'ok', `Verbunden mit ${opts.host}. Home-Verzeichnis: ${home}`);

    // Update-Prüfung im Hintergrund + alle 30 Minuten
    setTimeout(() => runUpdateCheck(ctx), 500);
    ctx.updateTimer = setInterval(() => runUpdateCheck(ctx), 30 * 60 * 1000);

    return {
      home,
      startDir,
      localDir: opts.localDir || null,
      info: session.info,
      label: opts.name || `${opts.username}@${opts.host}`,
    };
  });

  ipcMain.on('hostkey:answer', (_e, id, accept, remember) => {
    const cb = pendingHostKeys.get(id);
    if (cb) { pendingHostKeys.delete(id); cb(accept, remember); }
  });

  handle('ssh:disconnect', (evt) => {
    const ctx = ctxOf(evt);
    cleanup(ctx);
    log(ctx, 'info', 'Verbindung getrennt.');
  });

  // ---------- Entferntes Dateisystem ----------
  handle('remote:list', (evt, dir) => sessOf(evt).session.list(dir));
  handle('remote:realpath', (evt, p) => sessOf(evt).session.realpath(p));
  handle('remote:mkdir', (evt, p) => sessOf(evt).session.mkdir(p));
  handle('remote:rename', (evt, a, b) => sessOf(evt).session.rename(a, b));
  handle('remote:chmod', async (evt, paths, mode) => {
    const s = sessOf(evt).session;
    for (const p of paths) await s.chmod(p, mode);
  });
  handle('remote:remove', async (evt, paths) => {
    const ctx = sessOf(evt);
    for (const p of paths) { await ctx.session.remove(p); log(ctx, 'info', `Gelöscht: ${p}`); }
  });
  handle('remote:newFile', (evt, p) => sessOf(evt).session.writeFile(p, Buffer.alloc(0)));

  // „Bearbeiten“: Datei in temporäres Verzeichnis laden, mit Standardprogramm
  // öffnen und bei jeder Änderung automatisch zurück auf den Server laden.
  handle('remote:edit', async (evt, remotePath) => {
    const ctx = sessOf(evt);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgesftp-'));
    const local = path.join(dir, path.posix.basename(remotePath));
    await ctx.session.fastGet(remotePath, local);
    let timer = null;
    let lastMtime = fs.statSync(local).mtimeMs;
    const watcher = fs.watch(dir, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const m = fs.statSync(local).mtimeMs;
          if (m === lastMtime) return;
          lastMtime = m;
          await ctx.session.fastPut(local, remotePath);
          log(ctx, 'ok', `Änderungen hochgeladen: ${remotePath}`);
        } catch (e) { log(ctx, 'error', `Hochladen von ${remotePath} fehlgeschlagen: ${e.message}`); }
      }, 400);
    });
    ctx.edits.set(remotePath, { watcher, local });
    const err = await shell.openPath(local);
    if (err) throw new Error(err);
    log(ctx, 'info', `Bearbeite ${remotePath} – gespeicherte Änderungen werden automatisch hochgeladen.`);
  });

  // ---------- Lokales Dateisystem ----------
  handle('local:list', (_e, dir) => localfs.list(dir));
  handle('local:home', () => localfs.home());
  handle('local:drives', () => localfs.drives());
  handle('local:parent', (_e, p) => localfs.parent(p));
  handle('local:join', (_e, ...a) => localfs.join(...a));
  handle('local:resolve', (_e, p) => localfs.resolve(p));
  handle('local:mkdir', (_e, p) => localfs.mkdir(p));
  handle('local:rename', (_e, a, b) => localfs.rename(a, b));
  handle('local:remove', async (_e, paths) => { for (const p of paths) await localfs.remove(p); });
  handle('local:open', async (_e, p) => { const err = await shell.openPath(p); if (err) throw new Error(err); });
  handle('local:isDir', async (_e, p) => (await localfs.stat(p)).isDirectory());
  handle('platform', () => ({ platform: process.platform, sep: localfs.sep }));

  // ---------- Übertragungen ----------
  handle('transfer:upload', (evt, localPaths, remoteDir) => sessOf(evt).queue.upload(localPaths, remoteDir));
  handle('transfer:download', (evt, remotePaths, localDir) => sessOf(evt).queue.download(remotePaths, localDir));
  handle('transfer:cancel', (evt) => sessOf(evt).queue.cancelPending());
  handle('transfer:retry', (evt) => sessOf(evt).queue.retryFailed());
  handle('transfer:clear', (evt) => sessOf(evt).queue.clearFinished());
  handle('transfer:policy', (evt, p) => { const c = ctxOf(evt); if (c.queue) c.queue.setPolicy(p); store.setSettings({ policy: p }); });
  handle('settings:get', () => store.getSettings());
  handle('settings:set', (_e, patch) => store.setSettings(patch));

  // ---------- Terminal ----------
  handle('shell:open', (evt, id, cols, rows) => sessOf(evt).session.openShell(id, cols, rows));
  ipcMain.on('shell:write', (evt, id, data) => { const c = contexts.get(evt.sender.id); if (c && c.session) c.session.writeShell(id, data); });
  ipcMain.on('shell:resize', (evt, id, cols, rows) => { const c = contexts.get(evt.sender.id); if (c && c.session) c.session.resizeShell(id, cols, rows); });
  handle('shell:close', (evt, id) => { const c = ctxOf(evt); if (c.session) c.session.closeShell(id); });

  // ---------- Updates ----------
  handle('updates:check', (evt) => runUpdateCheck(sessOf(evt)));

  // ---------- Über / Hilfe / Programm-Updates ----------
  handle('app:info', () => ({
    ...APP_INFO,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${os.type()} ${os.release()} (${process.arch})`,
  }));
  handle('app:license', () => fs.readFileSync(path.join(__dirname, 'LICENSE'), 'utf8'));
  handle('app:openExternal', (_e, url) => openExternal(url));
  handle('appupdate:check', () => checkForAppUpdate(app.getVersion(), net.fetch));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const about = { label: 'Über BridgeSFTP', click: () => menuAction('about') };
  const checkApp = { label: 'Nach neuer Version suchen …', click: () => menuAction('appupdate') };
  const tpl = [
    ...(isMac ? [{
      label: 'BridgeSFTP',
      submenu: [about, checkApp, { type: 'separator' }, { role: 'hide', label: 'BridgeSFTP ausblenden' }, { role: 'hideOthers', label: 'Andere ausblenden' }, { type: 'separator' }, { role: 'quit', label: 'BridgeSFTP beenden' }],
    }] : []),
    {
      label: 'Datei',
      submenu: [
        { label: 'Neues Fenster', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fenster schließen' } : { role: 'quit', label: 'Beenden' },
      ],
    },
    { label: 'Bearbeiten', submenu: [{ role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einfügen' }, { role: 'selectAll', label: 'Alles auswählen' }] },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'zoomIn', label: 'Vergrößern' }, { role: 'zoomOut', label: 'Verkleinern' }, { role: 'resetZoom', label: 'Originalgröße' },
        { type: 'separator' }, { role: 'togglefullscreen', label: 'Vollbild' }, { role: 'toggleDevTools', label: 'Entwicklertools' },
      ],
    },
    {
      label: 'Hilfe',
      role: 'help',
      submenu: [
        { label: 'Hilfe & Tastenkürzel', accelerator: 'F1', click: () => menuAction('help') },
        { label: 'Online-Dokumentation', click: () => openExternal(APP_INFO.docsUrl) },
        { label: 'Problem melden / Vorschlag machen', click: () => openExternal(APP_INFO.issuesUrl) },
        { type: 'separator' },
        checkApp,
        { label: 'Lizenz (GPL-3.0)', click: () => menuAction('license') },
        ...(isMac ? [] : [{ type: 'separator' }, about]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), safeStorage);
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
