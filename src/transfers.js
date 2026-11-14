// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
// Übertragungswarteschlange: Verzeichnisse werden rekursiv aufgelöst,
// es laufen bis zu `concurrency` Dateien gleichzeitig.
const { EventEmitter } = require('events');
const fs = require('fs');
const fsp = fs.promises;
const lpath = require('path');
const rpath = require('path').posix;

let nextId = 1;

class TransferQueue extends EventEmitter {
  constructor(session, { concurrency = 3 } = {}) {
    super();
    this.session = session;
    this.concurrency = concurrency;
    this.jobs = [];
    this.running = 0;
    this.policy = 'overwrite'; // overwrite | skip | newer
    this.expanding = 0; // laufende rekursive Ordner-Auflösungen
  }

  _busy() { return this.expanding > 0 || this.jobs.some((j) => j.status === 'wartend' || j.status === 'läuft'); }
  _checkIdle() { if (!this._busy()) this.emit('idle'); }

  setPolicy(p) { if (['overwrite', 'skip', 'newer'].includes(p)) this.policy = p; }

  _add(job) {
    Object.assign(job, { id: nextId++, transferred: 0, status: 'wartend', error: null, speed: 0 });
    this.jobs.push(job);
    this.emit('update', this._public(job));
    this._pump();
  }

  _public(j) {
    const { id, direction, local, remote, size, transferred, status, error, speed } = j;
    return { id, direction, local, remote, size, transferred, status, error, speed };
  }

  async upload(localPaths, remoteDir) {
    this.expanding++;
    try { await this._upload(localPaths, remoteDir); } finally { this.expanding--; this._checkIdle(); }
  }

  async _upload(localPaths, remoteDir) {
    for (const lp of localPaths) {
      try {
        const st = await fsp.stat(lp);
        const target = rpath.join(remoteDir, lpath.basename(lp));
        if (st.isDirectory()) await this._uploadDir(lp, target);
        else this._add({ direction: 'up', local: lp, remote: target, size: st.size, mtime: st.mtimeMs });
      } catch (e) { this.emit('log', 'error', `Hochladen von ${lp} fehlgeschlagen: ${e.message}`); }
    }
  }

  async _uploadDir(lp, rp) {
    try { await this.session.mkdir(rp); } catch (_) { /* existiert evtl. schon */ }
    for (const e of await fsp.readdir(lp, { withFileTypes: true })) {
      const l = lpath.join(lp, e.name);
      const r = rpath.join(rp, e.name);
      if (e.isDirectory()) await this._uploadDir(l, r);
      else if (e.isFile()) {
        const st = await fsp.stat(l);
        this._add({ direction: 'up', local: l, remote: r, size: st.size, mtime: st.mtimeMs });
      }
    }
  }

  async download(remotePaths, localDir) {
    this.expanding++;
    try { await this._download(remotePaths, localDir); } finally { this.expanding--; this._checkIdle(); }
  }

  async _download(remotePaths, localDir) {
    for (const rp of remotePaths) {
      try {
        const st = await this.session.stat(rp);
        const target = lpath.join(localDir, rpath.basename(rp));
        if (st.isDirectory()) await this._downloadDir(rp, target);
        else this._add({ direction: 'down', local: target, remote: rp, size: st.size, mtime: st.mtime * 1000 });
      } catch (e) { this.emit('log', 'error', `Herunterladen von ${rp} fehlgeschlagen: ${e.message}`); }
    }
  }

  async _downloadDir(rp, lp) {
    await fsp.mkdir(lp, { recursive: true });
    for (const e of await this.session.list(rp)) {
      const r = rpath.join(rp, e.name);
      const l = lpath.join(lp, e.name);
      if (e.isDir) await this._downloadDir(r, l);
      else this._add({ direction: 'down', local: l, remote: r, size: e.size, mtime: e.mtime });
    }
  }

  async _shouldSkip(job) {
    if (this.policy === 'overwrite') return false;
    let targetMtime = null;
    try {
      if (job.direction === 'up') targetMtime = (await this.session.stat(job.remote)).mtime * 1000;
      else targetMtime = (await fsp.stat(job.local)).mtimeMs;
    } catch (_) { return false; } // Ziel existiert nicht
    if (this.policy === 'skip') return true;
    return job.mtime <= targetMtime; // "newer": nur übertragen, wenn Quelle neuer
  }

  _pump() {
    while (this.running < this.concurrency) {
      const job = this.jobs.find((j) => j.status === 'wartend');
      if (!job) return;
      this._run(job);
    }
  }

  async _run(job) {
    this.running++;
    job.status = 'läuft';
    this.emit('update', this._public(job));
    const started = Date.now();
    let lastEmit = 0;
    const onStep = (t) => {
      job.transferred = t;
      const now = Date.now();
      if (now - lastEmit > 150) {
        lastEmit = now;
        job.speed = t / Math.max(0.001, (now - started) / 1000);
        this.emit('update', this._public(job));
      }
    };
    try {
      if (await this._shouldSkip(job)) {
        job.status = 'übersprungen';
      } else if (job.direction === 'up') {
        await this.session.fastPut(job.local, job.remote, onStep);
        job.status = 'fertig';
      } else {
        await fsp.mkdir(lpath.dirname(job.local), { recursive: true });
        await this.session.fastGet(job.remote, job.local, onStep);
        job.status = 'fertig';
      }
      if (job.status === 'fertig') job.transferred = job.size;
      this.emit('log', 'info', `${job.direction === 'up' ? 'Hochgeladen' : 'Heruntergeladen'}: ${job.direction === 'up' ? job.remote : job.local} (${job.status})`);
    } catch (e) {
      if (job.status === 'abgebrochen') { /* bereits markiert */ } else {
        job.status = 'fehler';
        job.error = e.message;
        this.emit('log', 'error', `Übertragung fehlgeschlagen (${job.remote}): ${e.message}`);
      }
    }
    this.running--;
    this.emit('update', this._public(job));
    this._pump();
    this._checkIdle();
  }

  cancelPending() {
    for (const j of this.jobs) {
      if (j.status === 'wartend') { j.status = 'abgebrochen'; this.emit('update', this._public(j)); }
    }
  }

  retryFailed() {
    for (const j of this.jobs) {
      if (j.status === 'fehler') { j.status = 'wartend'; j.error = null; j.transferred = 0; this.emit('update', this._public(j)); }
    }
    this._pump();
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.status === 'wartend' || j.status === 'läuft');
    this.emit('cleared', this.jobs.map((j) => this._public(j)));
  }
}

module.exports = { TransferQueue };
