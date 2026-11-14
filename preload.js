// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Ruft einen IPC-Handler auf und wirft bei Fehlern eine Exception.
async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const on = (channel) => (cb) => {
  const fn = (_e, ...a) => cb(...a);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  call,
  pathForFile: (file) => webUtils.getPathForFile(file),
  answerHostKey: (id, accept, remember) => ipcRenderer.send('hostkey:answer', id, accept, remember),
  shellWrite: (id, data) => ipcRenderer.send('shell:write', id, data),
  shellResize: (id, cols, rows) => ipcRenderer.send('shell:resize', id, cols, rows),
  onLog: on('log'),
  onHostKey: on('hostkey:ask'),
  onTransfer: on('transfer:update'),
  onTransferCleared: on('transfer:cleared'),
  onTransferIdle: on('transfer:idle'),
  onShellData: on('shell:data'),
  onShellExit: on('shell:exit'),
  onSessionClosed: on('session:closed'),
  onUpdates: on('updates:status'),
  onMenu: on('menu'),
  onAppUpdate: on('appupdate:available'),
});
