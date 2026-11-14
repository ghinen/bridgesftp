// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
// Gespeicherte Verbindungen (Seiten-Manager) und bekannte Host-Schlüssel.
// Passwörter werden – falls vom Betriebssystem unterstützt – mit Electron
// safeStorage verschlüsselt (Windows DPAPI, macOS Keychain, Linux libsecret).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safe = safeStorage;
    fs.mkdirSync(dir, { recursive: true });
    this.sitesFile = path.join(dir, 'sites.json');
    this.hostsFile = path.join(dir, 'known_hosts.json');
    this.settingsFile = path.join(dir, 'settings.json');
  }

  _read(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return def; }
  }

  _write(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  canEncrypt() {
    try { return !!(this.safe && this.safe.isEncryptionAvailable()); } catch (_) { return false; }
  }

  listSites() {
    // Passwörter verlassen den Hauptprozess nicht; nur ein Flag.
    return this._read(this.sitesFile, []).map(({ encPassword, encPassphrase, ...s }) => ({
      ...s, hasPassword: !!encPassword, hasPassphrase: !!encPassphrase,
    }));
  }

  getSiteWithSecrets(id) {
    const s = this._read(this.sitesFile, []).find((x) => x.id === id);
    if (!s) return null;
    const dec = (v) => {
      if (!v || !this.canEncrypt()) return undefined;
      try { return this.safe.decryptString(Buffer.from(v, 'base64')); } catch (_) { return undefined; }
    };
    const { encPassword, encPassphrase, ...rest } = s;
    return { ...rest, password: dec(encPassword), passphrase: dec(encPassphrase) };
  }

  saveSite(site) {
    const sites = this._read(this.sitesFile, []);
    const id = site.id || crypto.randomUUID();
    const old = sites.find((x) => x.id === id) || {};
    const enc = (v) => (this.canEncrypt() ? this.safe.encryptString(v).toString('base64') : undefined);
    const entry = {
      id,
      name: site.name || `${site.username}@${site.host}`,
      folder: site.folder || '',
      host: site.host,
      port: Number(site.port) || 22,
      username: site.username,
      privateKeyPath: site.privateKeyPath || '',
      remoteDir: site.remoteDir || '',
      localDir: site.localDir || '',
      encPassword: old.encPassword,
      encPassphrase: old.encPassphrase,
    };
    if (site.clearPassword) entry.encPassword = undefined;
    else if (site.password) entry.encPassword = enc(site.password);
    if (site.passphrase) entry.encPassphrase = enc(site.passphrase);
    const idx = sites.findIndex((x) => x.id === id);
    if (idx >= 0) sites[idx] = entry; else sites.push(entry);
    this._write(this.sitesFile, sites);
    return id;
  }

  deleteSite(id) {
    this._write(this.sitesFile, this._read(this.sitesFile, []).filter((x) => x.id !== id));
  }

  hostKey(host, port) {
    return this._read(this.hostsFile, {})[`${host}:${port}`] || null;
  }

  trustHostKey(host, port, fp) {
    const h = this._read(this.hostsFile, {});
    h[`${host}:${port}`] = fp;
    this._write(this.hostsFile, h);
  }

  getSettings() { return this._read(this.settingsFile, {}); }
  setSettings(patch) { this._write(this.settingsFile, { ...this.getSettings(), ...patch }); }
}

module.exports = { Store };
