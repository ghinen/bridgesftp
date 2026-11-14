// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

async function list(dir) {
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const out = await Promise.all(ents.map(async (e) => {
    const full = path.join(dir, e.name);
    try {
      const st = await fsp.stat(full);
      return { name: e.name, size: st.size, mtime: st.mtimeMs, isDir: st.isDirectory(), isLink: e.isSymbolicLink() };
    } catch (_) {
      return { name: e.name, size: 0, mtime: 0, isDir: false, isLink: e.isSymbolicLink(), broken: true };
    }
  }));
  return out;
}

async function drives() {
  if (process.platform !== 'win32') return ['/'];
  const out = [];
  for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    try { await fsp.access(l + ':\\'); out.push(l + ':\\'); } catch (_) { /* nicht vorhanden */ }
  }
  return out;
}

module.exports = {
  list,
  drives,
  home: () => os.homedir(),
  parent: (p) => path.dirname(p),
  join: (...a) => path.join(...a),
  resolve: (p) => path.resolve(p),
  sep: path.sep,
  mkdir: (p) => fsp.mkdir(p, { recursive: false }),
  rename: (a, b) => fsp.rename(a, b),
  remove: (p) => fsp.rm(p, { recursive: true, force: false }),
  stat: (p) => fsp.stat(p),
};
