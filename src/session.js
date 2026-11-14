// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
// Kapselt eine SSH-Verbindung: SFTP-Operationen, interaktive Shells und exec.
const { Client } = require('ssh2');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const path = require('path').posix;
const fs = require('fs');

function fingerprint(keyBuf) {
  return 'SHA256:' + crypto.createHash('sha256').update(keyBuf).digest('base64').replace(/=+$/, '');
}

function permString(mode) {
  const type = (mode & 0o170000) === 0o040000 ? 'd' : (mode & 0o170000) === 0o120000 ? 'l' : '-';
  const chars = 'rwxrwxrwx';
  let s = '';
  for (let i = 0; i < 9; i++) s += (mode & (1 << (8 - i))) ? chars[i] : '-';
  return type + s;
}

class SshSession extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.sftp = null;
    this.shells = new Map();
    this.connected = false;
    this.info = null;
  }

  /**
   * @param {object} opts host, port, username, password, privateKeyPath, passphrase
   * @param {(fp:string, keyType:string) => Promise<boolean>} verifyHost
   */
  connect(opts, verifyHost) {
    return new Promise((resolve, reject) => {
      const client = new Client();
      this.client = client;
      let settled = false;
      const fail = (err) => { if (!settled) { settled = true; reject(err); } };

      const cfg = {
        host: opts.host,
        port: Number(opts.port) || 22,
        username: opts.username,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        tryKeyboard: true,
        hostVerifier: (key, cb) => {
          const fp = fingerprint(key);
          verifyHost(fp).then((ok) => cb(!!ok), () => cb(false));
        },
      };
      if (opts.password) cfg.password = opts.password;
      if (opts.privateKeyPath) {
        try {
          cfg.privateKey = fs.readFileSync(opts.privateKeyPath);
          if (opts.passphrase) cfg.passphrase = opts.passphrase;
        } catch (e) {
          return fail(new Error('Schlüsseldatei nicht lesbar: ' + e.message));
        }
      }
      if (!opts.password && !opts.privateKeyPath && process.env.SSH_AUTH_SOCK) {
        cfg.agent = process.env.SSH_AUTH_SOCK;
      } else if (!opts.password && !opts.privateKeyPath && process.platform === 'win32') {
        cfg.agent = 'pageant';
      }

      // Viele Server erlauben nur keyboard-interactive statt "password".
      client.on('keyboard-interactive', (name, instr, lang, prompts, finish) => {
        finish(prompts.map(() => opts.password || ''));
      });

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) { client.end(); return fail(err); }
          this.sftp = sftp;
          this.connected = true;
          this.info = { host: opts.host, port: cfg.port, username: opts.username };
          settled = true;
          resolve();
        });
      });
      client.on('error', (err) => {
        if (!settled) fail(err);
        else this.emit('error', err);
      });
      client.on('close', () => {
        const was = this.connected;
        this.connected = false;
        this.sftp = null;
        if (was) this.emit('closed');
        if (!settled) fail(new Error('Verbindung geschlossen'));
      });
      client.connect(cfg);
    });
  }

  disconnect() {
    for (const s of this.shells.values()) { try { s.end(); } catch (_) { /* ignore */ } }
    this.shells.clear();
    if (this.client) this.client.end();
    this.connected = false;
  }

  _need() {
    if (!this.sftp) throw new Error('Nicht verbunden');
    return this.sftp;
  }

  _p(fn) {
    return new Promise((resolve, reject) => {
      fn((err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  realpath(p) { const s = this._need(); return this._p((cb) => s.realpath(p, cb)); }
  stat(p) { const s = this._need(); return this._p((cb) => s.stat(p, cb)); }

  async list(dir) {
    const s = this._need();
    const entries = await this._p((cb) => s.readdir(dir, cb));
    const out = await Promise.all(entries.map(async (e) => {
      const a = e.attrs;
      const isLink = (a.mode & 0o170000) === 0o120000;
      let isDir = (a.mode & 0o170000) === 0o040000;
      if (isLink) {
        try { const t = await this.stat(path.join(dir, e.filename)); isDir = t.isDirectory(); } catch (_) { /* toter Link */ }
      }
      return {
        name: e.filename,
        size: a.size,
        mtime: a.mtime * 1000,
        mode: a.mode & 0o7777,
        perms: permString(a.mode),
        uid: a.uid,
        gid: a.gid,
        owner: (e.longname || '').split(/\s+/)[2] || String(a.uid),
        isDir,
        isLink,
      };
    }));
    return out;
  }

  mkdir(p) { const s = this._need(); return this._p((cb) => s.mkdir(p, cb)); }
  rename(a, b) { const s = this._need(); return this._p((cb) => s.rename(a, b, cb)); }
  chmod(p, mode) { const s = this._need(); return this._p((cb) => s.chmod(p, mode, cb)); }
  unlink(p) { const s = this._need(); return this._p((cb) => s.unlink(p, cb)); }

  async remove(p) {
    const s = this._need();
    const st = await this._p((cb) => s.lstat(p, cb));
    if (st.isDirectory()) {
      const kids = await this._p((cb) => s.readdir(p, cb));
      for (const k of kids) await this.remove(path.join(p, k.filename));
      await this._p((cb) => s.rmdir(p, cb));
    } else {
      await this.unlink(p);
    }
  }

  fastGet(remote, local, onStep) {
    const s = this._need();
    return this._p((cb) => s.fastGet(remote, local, { step: (t, _c, total) => onStep && onStep(t, total) }, cb));
  }

  fastPut(local, remote, onStep) {
    const s = this._need();
    return this._p((cb) => s.fastPut(local, remote, { step: (t, _c, total) => onStep && onStep(t, total) }, cb));
  }

  async readFile(p, maxBytes = 5 * 1024 * 1024) {
    const st = await this.stat(p);
    if (st.size > maxBytes) throw new Error('Datei zu groß für die Vorschau');
    const s = this._need();
    return this._p((cb) => s.readFile(p, cb));
  }

  writeFile(p, data) { const s = this._need(); return this._p((cb) => s.writeFile(p, data, cb)); }

  exec(cmd, { timeout = 120000, input = null } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) return reject(new Error('Nicht verbunden'));
      this.client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        const t = setTimeout(() => { stream.close(); reject(new Error('Zeitüberschreitung bei Befehl')); }, timeout);
        stream.on('data', (d) => { stdout += d.toString('utf8'); });
        stream.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
        stream.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
        if (input !== null) stream.end(input);
      });
    });
  }

  openShell(id, cols, rows) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) return reject(new Error('Nicht verbunden'));
      this.client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return reject(err);
        this.shells.set(id, stream);
        stream.on('data', (d) => this.emit('shell-data', id, d.toString('utf8')));
        stream.stderr.on('data', (d) => this.emit('shell-data', id, d.toString('utf8')));
        stream.on('close', () => { this.shells.delete(id); this.emit('shell-exit', id); });
        resolve();
      });
    });
  }

  writeShell(id, data) { const s = this.shells.get(id); if (s) s.write(data); }
  resizeShell(id, cols, rows) { const s = this.shells.get(id); if (s) s.setWindow(rows, cols, 0, 0); }
  closeShell(id) { const s = this.shells.get(id); if (s) s.end(); }
}

module.exports = { SshSession, fingerprint, permString };
