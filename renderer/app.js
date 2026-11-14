// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
/* global Terminal, FitAddon */
/* global api */ // über preload.js (contextBridge) bereitgestellt

// ====================== Hilfsfunktionen ======================
const $ = (s, r = document) => r.querySelector(s);

/** Element bauen – Text immer über textContent (Dateinamen vom Server sind nicht vertrauenswürdig). */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function fmtSize(n) {
  if (n === null || n === undefined) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}
const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });
const fmtDate = (ms) => (ms ? dateFmt.format(new Date(ms)) : '');
function fmtAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400 * 2) return `vor ${Math.round(s / 3600)} Std.`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}

const rjoin = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name);
const rparent = (p) => { if (p === '/') return '/'; const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
const basename = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
let SEP = '/';
const ljoin = (dir, name) => (dir.endsWith(SEP) ? dir + name : dir + SEP + name);
const shQuote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

function toast(msg, kind = 'info', ms = 4500) {
  const t = h('div', { class: 'toast ' + kind, text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

const state = { connected: false, label: '', lastParams: null, updates: null, updState: 'idle' };

// ====================== Modale Dialoge ======================
function modal({ title, body, buttons, width, onOpen }) {
  return new Promise((resolve) => {
    const close = (v) => { bd.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const foot = h('div', { class: 'mfoot' }, buttons.map((b) => h('button', {
      class: b.kind || '', onclick: () => { const v = b.value instanceof Function ? b.value() : b.value; if (v !== undefined && v !== false) close(v); else if (b.value === undefined) close(undefined); },
    }, b.label)));
    const m = h('div', { class: 'modal', style: width ? `width:${width}px` : '' }, h('h2', { text: title }), h('div', { class: 'mbody' }, body), foot);
    const bd = h('div', { class: 'backdrop' }, m);
    const key = (e) => {
      if (bd !== $('#modalRoot').lastElementChild) return; // nur der oberste Dialog reagiert
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const def = buttons.find((b) => b.default);
        if (def) { e.preventDefault(); e.stopPropagation(); const v = def.value instanceof Function ? def.value() : def.value; if (v !== false) close(v); }
      }
    };
    document.addEventListener('keydown', key, true);
    $('#modalRoot').append(bd);
    if (onOpen) onOpen(m, close);
    const inp = m.querySelector('input');
    if (inp) { inp.focus(); inp.select && inp.select(); }
  });
}

function promptDlg(title, label, value = '', selectBase = false) {
  const inp = h('input', { value, style: 'width:100%' });
  return modal({
    title,
    body: h('div', {}, h('div', { style: 'margin-bottom:6px', text: label }), inp),
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'OK', kind: 'primary', default: true, value: () => inp.value.trim() || null }],
    onOpen: () => setTimeout(() => {
      inp.focus();
      const dot = value.lastIndexOf('.');
      if (selectBase && dot > 0) inp.setSelectionRange(0, dot); else inp.select();
    }),
  });
}

function confirmDlg(title, msg, okLabel = 'OK', danger = false) {
  return modal({
    title,
    body: h('div', { style: 'white-space:pre-wrap;max-width:520px', text: msg }),
    buttons: [{ label: 'Abbrechen', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', default: true, value: true }],
  }).then((v) => v === true);
}

// ====================== Kontextmenü ======================
const ctxEl = $('#ctxMenu');
function showMenu(x, y, items) {
  ctxEl.replaceChildren(...items.map((it) => (it === '-' ? h('div', { class: 'sep' }) : h('div', {
    class: 'item' + (it.disabled ? ' disabled' : ''),
    onclick: () => { hideMenu(); it.action(); },
  }, h('span', { text: it.label }), h('span', { class: 'key', text: it.key || '' })))));
  ctxEl.classList.remove('hidden');
  const r = ctxEl.getBoundingClientRect();
  ctxEl.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
  ctxEl.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
}
function hideMenu() { ctxEl.classList.add('hidden'); }
document.addEventListener('mousedown', (e) => { if (!ctxEl.contains(e.target)) hideMenu(); });
window.addEventListener('blur', hideMenu);

// ====================== Dateifenster ======================
let dragState = null;
let activePane = null;

class Pane {
  constructor(kind, root) {
    this.kind = kind;
    this.root = root;
    this.cwd = null;
    this.parentDir = null;
    this.entries = [];
    this.rows = [];
    this.sel = new Set();
    this.anchor = null;
    this.sort = { key: 'name', dir: 1 };
    this.filter = '';
    this.history = [];
    this.build();
  }

  get remote() { return this.kind === 'remote'; }
  get other() { return this === panes.local ? panes.remote : panes.local; }
  join(name) { return this.remote ? rjoin(this.cwd, name) : ljoin(this.cwd, name); }

  build() {
    this.titleEl = h('span', { class: 'title', text: this.remote ? '🌐 Server' : '💻 Lokal' });
    const btn = (label, title, fn) => h('button', { class: 'icon', title, onclick: fn }, label);
    this.transferBtn = h('button', {
      class: 'small', title: this.remote ? 'Auswahl herunterladen (F6)' : 'Auswahl hochladen (F6)', onclick: () => this.transferSelection(),
    }, this.remote ? '◀ Herunterladen' : 'Hochladen ▶');
    this.drives = null;
    const head = h('div', { class: 'pane-head' },
      this.titleEl,
      h('span', { class: 'spacer' }),
      btn('←', 'Zurück', () => this.back()),
      btn('↑', 'Übergeordnetes Verzeichnis (Backspace)', () => this.up()),
      btn('⌂', 'Home-Verzeichnis', () => this.goHome()),
      btn('⟳', 'Aktualisieren (F5)', () => this.refresh()),
      btn('＋📁', 'Neuer Ordner (F7)', () => this.newFolder()),
      this.transferBtn);
    this.pathInput = h('input', { class: 'path', spellcheck: 'false', title: 'Pfad eingeben und Enter drücken' });
    this.pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.navigate(this.pathInput.value.trim()); this.body.focus(); }
      if (e.key === 'Escape') { this.pathInput.value = this.cwd || ''; this.body.focus(); }
    });
    this.filterInput = h('input', { class: 'filter', placeholder: '🔍 Filter', spellcheck: 'false' });
    this.filterInput.addEventListener('input', () => { this.filter = this.filterInput.value.toLowerCase(); this.render(); });
    this.filterInput.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') this.body.focus(); });
    const pathRow = h('div', { class: 'pane-path' }, this.pathInput, this.filterInput);

    const cols = this.remote
      ? [['name', 'Name', ''], ['size', 'Größe', 'width:80px'], ['mtime', 'Geändert', 'width:125px'], ['perms', 'Rechte', 'width:95px'], ['owner', 'Besitzer', 'width:80px']]
      : [['name', 'Name', ''], ['size', 'Größe', 'width:80px'], ['mtime', 'Geändert', 'width:125px']];
    this.ths = cols.map(([k, label, style]) => h('th', { style, onclick: () => this.setSort(k), 'data-k': k }, label));
    this.tbody = h('tbody');
    this.table = h('table', { class: 'list files' }, h('thead', {}, h('tr', {}, this.ths)), this.tbody);
    this.placeholder = h('div', { class: 'placeholder hidden' });
    this.body = h('div', { class: 'pane-body', tabindex: '0' }, this.table, this.placeholder);
    this.foot = h('div', { class: 'pane-foot' });
    this.root.append(head, pathRow, this.body, this.foot);

    this.body.addEventListener('focus', () => this.activate());
    this.root.addEventListener('mousedown', () => this.activate());
    this.body.addEventListener('keydown', (e) => this.onKey(e));
    this.tbody.addEventListener('click', (e) => this.onClick(e));
    this.tbody.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.body.addEventListener('contextmenu', (e) => this.onContext(e));
    this.tbody.addEventListener('dragstart', (e) => this.onDragStart(e));
    this.body.addEventListener('dragover', (e) => this.onDragOver(e));
    this.body.addEventListener('dragleave', (e) => { if (!this.body.contains(e.relatedTarget)) this.clearDrop(); });
    this.body.addEventListener('drop', (e) => this.onDrop(e));
    this.updateSortHeader();
  }

  activate() {
    if (activePane === this) return;
    if (activePane) activePane.root.classList.remove('focus');
    activePane = this;
    this.root.classList.add('focus');
  }

  showPlaceholder(icon, text, action) {
    this.table.classList.add('hidden');
    this.placeholder.classList.remove('hidden');
    this.placeholder.replaceChildren(h('div', { class: 'big', text: icon }), h('div', { text }), action || '');
  }

  hidePlaceholder() { this.table.classList.remove('hidden'); this.placeholder.classList.add('hidden'); }

  async list(dir) { return api.call(this.remote ? 'remote:list' : 'local:list', dir); }

  async navigate(dir, { push = true, keepSel = false } = {}) {
    if (!dir) return;
    if (this.remote && !state.connected) return;
    try {
      if (!this.remote) dir = await api.call('local:resolve', dir);
      const entries = await this.list(dir);
      if (push && this.cwd && this.cwd !== dir) this.history.push(this.cwd);
      const prev = this.cwd;
      const prevParent = this.parentDir;
      this.cwd = dir;
      this.parentDir = this.remote ? rparent(dir) : await api.call('local:parent', dir);
      this.entries = entries;
      if (!keepSel || prev !== dir) { this.sel.clear(); this.anchor = null; }
      if (prev !== dir && this.filter) { this.filter = ''; this.filterInput.value = ''; }
      this.pathInput.value = dir;
      this.hidePlaceholder();
      this.render();
      if (prev && prev !== dir && this.remote === false) api.call('settings:set', { lastLocalDir: dir }).catch(() => {});
      // Ausgewählte Elemente nach „hoch“ wieder markieren
      if (prev && prev !== dir && prevParent === dir) {
        const name = basename(prev);
        const idx = this.rows.findIndex((r) => r.name === name);
        if (idx >= 0) { this.sel = new Set([name]); this.anchor = idx; this.paintSel(); this.scrollTo(idx); }
      }
    } catch (e) {
      toast(`Verzeichnis konnte nicht geöffnet werden: ${e.message}`, 'error');
      this.pathInput.value = this.cwd || '';
    }
  }

  refresh() { if (this.cwd) return this.navigate(this.cwd, { push: false, keepSel: true }); }
  up() { if (this.cwd && this.parentDir && this.parentDir !== this.cwd) this.navigate(this.parentDir); }
  back() { const d = this.history.pop(); if (d) this.navigate(d, { push: false }); }
  async goHome() {
    if (this.remote) { if (state.home) this.navigate(state.home); } else this.navigate(await api.call('local:home'));
  }

  setSort(k) {
    if (this.sort.key === k) this.sort.dir *= -1; else this.sort = { key: k, dir: 1 };
    this.updateSortHeader();
    this.render();
  }

  updateSortHeader() {
    for (const th of this.ths) {
      const k = th.dataset.k;
      th.querySelector('.arrow')?.remove();
      if (k === this.sort.key) th.append(h('span', { class: 'arrow', text: this.sort.dir > 0 ? ' ▲' : ' ▼' }));
    }
  }

  visibleEntries() {
    const { key, dir } = this.sort;
    let list = this.entries.filter((e) => !this.filter || e.name.toLowerCase().includes(this.filter));
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let r;
      if (key === 'size' || key === 'mtime') r = (a[key] || 0) - (b[key] || 0);
      else r = String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'de', { numeric: true, sensitivity: 'base' });
      return r * dir || a.name.localeCompare(b.name, 'de', { numeric: true });
    });
    if (this.parentDir && this.parentDir !== this.cwd) list = [{ name: '..', isDir: true, up: true }, ...list];
    return list;
  }

  render() {
    this.rows = this.visibleEntries();
    const frag = document.createDocumentFragment();
    this.rows.forEach((e, i) => {
      const icon = e.up ? '↰' : e.isDir ? (e.isLink ? '📂' : '📁') : e.isLink ? '🔗' : fileIcon(e.name);
      const tds = [
        h('td', {}, h('div', { class: 'fname' }, h('span', { class: 'ic', text: icon }), h('span', { text: e.name, title: e.name }))),
        h('td', { class: 'num', text: e.isDir ? '' : fmtSize(e.size) }),
        h('td', { class: 'dim', text: e.up ? '' : fmtDate(e.mtime) }),
      ];
      if (this.remote) {
        tds.push(h('td', { class: 'mono dim', text: e.perms || '' }), h('td', { class: 'dim', text: e.owner || '' }));
      }
      frag.append(h('tr', { 'data-i': i, draggable: e.up ? null : 'true' }, tds));
    });
    this.tbody.replaceChildren(frag);
    this.paintSel();
  }

  paintSel() {
    [...this.tbody.children].forEach((tr, i) => tr.classList.toggle('sel', this.sel.has(this.rows[i].name)));
    const files = this.entries.filter((e) => !e.isDir);
    const dirs = this.entries.length - files.length;
    const total = files.reduce((s, e) => s + (e.size || 0), 0);
    let txt = `${files.length} Datei(en), ${dirs} Ordner · ${fmtSize(total)}`;
    if (this.sel.size) {
      const selE = this.selectedEntries();
      txt = `${this.sel.size} ausgewählt (${fmtSize(selE.filter((e) => !e.isDir).reduce((s, e) => s + e.size, 0))}) · ` + txt;
    }
    this.foot.textContent = txt;
  }

  scrollTo(i) { this.tbody.children[i]?.scrollIntoView({ block: 'nearest' }); }
  rowIndex(e) { const tr = e.target.closest('tr'); return tr ? Number(tr.dataset.i) : -1; }
  selectedEntries() { return this.rows.filter((r) => this.sel.has(r.name) && !r.up); }
  selectedPaths() { return this.selectedEntries().map((e) => this.join(e.name)); }

  selectIndex(i, { ctrl = false, shift = false } = {}) {
    if (i < 0 || i >= this.rows.length) return;
    const name = this.rows[i].name;
    if (shift && this.anchor !== null) {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      if (!ctrl) this.sel.clear();
      for (let k = a; k <= b; k++) this.sel.add(this.rows[k].name);
    } else if (ctrl) {
      if (this.sel.has(name)) this.sel.delete(name); else this.sel.add(name);
      this.anchor = i;
    } else {
      this.sel = new Set([name]);
      this.anchor = i;
    }
    this.cursor = i;
    this.paintSel();
    this.scrollTo(i);
  }

  onClick(e) {
    const i = this.rowIndex(e);
    if (i < 0) return;
    this.selectIndex(i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  }

  onDblClick(e) {
    const i = this.rowIndex(e);
    if (i >= 0) this.openEntry(this.rows[i]);
  }

  openEntry(entry) {
    if (!entry) return;
    if (entry.up) return this.up();
    if (entry.isDir) return this.navigate(this.join(entry.name));
    // Doppelklick auf Datei = übertragen (wie FileZilla)
    this.transfer([this.join(entry.name)]);
  }

  async transfer(paths, targetDir) {
    if (!paths.length) return;
    if (!state.connected) return toast('Bitte zuerst mit einem Server verbinden.', 'error');
    const target = targetDir || this.other.cwd;
    if (!target) return;
    try {
      if (this.remote) await api.call('transfer:download', paths, target);
      else await api.call('transfer:upload', paths, target);
      switchBottom('queue');
    } catch (e) { toast(e.message, 'error'); }
  }

  transferSelection() {
    let paths = this.selectedPaths();
    if (!paths.length && this.cursor !== undefined && this.rows[this.cursor] && !this.rows[this.cursor].up) paths = [this.join(this.rows[this.cursor].name)];
    if (!paths.length) return toast('Nichts ausgewählt.');
    this.transfer(paths);
  }

  async newFolder() {
    if (!this.cwd) return;
    const name = await promptDlg('Neuer Ordner', `Name des neuen Ordners in ${this.cwd}:`, 'Neuer Ordner');
    if (!name) return;
    try {
      await api.call(this.remote ? 'remote:mkdir' : 'local:mkdir', this.join(name));
      await this.refresh();
      const idx = this.rows.findIndex((r) => r.name === name);
      if (idx >= 0) this.selectIndex(idx);
    } catch (e) { toast('Ordner anlegen fehlgeschlagen: ' + e.message, 'error'); }
  }

  async newFile() {
    const name = await promptDlg('Neue Datei', `Name der neuen Datei in ${this.cwd}:`, 'neu.txt', true);
    if (!name) return;
    try { await api.call('remote:newFile', this.join(name)); await this.refresh(); } catch (e) { toast(e.message, 'error'); }
  }

  async rename() {
    const [e] = this.selectedEntries();
    if (!e) return;
    const name = await promptDlg('Umbenennen', `Neuer Name für „${e.name}“:`, e.name, true);
    if (!name || name === e.name) return;
    try {
      await api.call(this.remote ? 'remote:rename' : 'local:rename', this.join(e.name), this.join(name));
      this.sel = new Set([name]);
      await this.refresh();
    } catch (err) { toast('Umbenennen fehlgeschlagen: ' + err.message, 'error'); }
  }

  async remove() {
    const sel = this.selectedEntries();
    if (!sel.length) return;
    const what = sel.length === 1 ? `„${sel[0].name}“${sel[0].isDir ? ' (Ordner inkl. Inhalt)' : ''}` : `${sel.length} Elemente`;
    const where = this.remote ? 'auf dem Server' : 'auf diesem Computer';
    if (!await confirmDlg('Löschen', `${what} ${where} endgültig löschen?`, 'Löschen', true)) return;
    try {
      await api.call(this.remote ? 'remote:remove' : 'local:remove', sel.map((x) => this.join(x.name)));
    } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, 'error'); }
    this.refresh();
  }

  async edit() {
    const [e] = this.selectedEntries();
    if (!e || e.isDir) return;
    if (!this.remote) return api.call('local:open', this.join(e.name)).catch((err) => toast(err.message, 'error'));
    try {
      await api.call('remote:edit', this.join(e.name));
      toast(`„${e.name}“ geöffnet. Beim Speichern wird die Datei automatisch hochgeladen.`, 'ok', 6000);
    } catch (err) { toast('Öffnen fehlgeschlagen: ' + err.message, 'error'); }
  }

  async chmod() {
    const sel = this.selectedEntries();
    if (!sel.length) return;
    const mode = await permDialog(sel);
    if (mode === null || mode === undefined) return;
    try { await api.call('remote:chmod', sel.map((e) => this.join(e.name)), mode); this.refresh(); } catch (e) { toast('Rechte ändern fehlgeschlagen: ' + e.message, 'error'); }
  }

  copyPath() {
    const p = this.selectedPaths();
    navigator.clipboard.writeText((p.length ? p : [this.cwd]).join('\n'));
    toast('Pfad kopiert.');
  }

  onKey(e) {
    const n = this.rows.length;
    const cur = this.cursor ?? -1;
    const mod = e.ctrlKey || e.metaKey;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'ArrowDown': handled(); this.selectIndex(Math.min(n - 1, cur + 1), { shift: e.shiftKey }); break;
      case 'ArrowUp': handled(); this.selectIndex(Math.max(0, cur - 1), { shift: e.shiftKey }); break;
      case 'Home': handled(); this.selectIndex(0, { shift: e.shiftKey }); break;
      case 'End': handled(); this.selectIndex(n - 1, { shift: e.shiftKey }); break;
      case 'PageDown': handled(); this.selectIndex(Math.min(n - 1, cur + 15), { shift: e.shiftKey }); break;
      case 'PageUp': handled(); this.selectIndex(Math.max(0, cur - 15), { shift: e.shiftKey }); break;
      case 'Enter': handled(); this.openEntry(this.rows[cur]); break;
      case 'Backspace': handled(); this.up(); break;
      case 'Delete': handled(); this.remove(); break;
      case 'F2': handled(); this.rename(); break;
      case 'F4': handled(); this.edit(); break;
      case 'F5': handled(); this.refresh(); break;
      case 'F6': handled(); this.transferSelection(); break;
      case 'F7': handled(); this.newFolder(); break;
      case 'Tab': handled(); this.other.body.focus(); break;
      default:
        if (mod && e.key.toLowerCase() === 'a') {
          handled();
          this.sel = new Set(this.rows.filter((r) => !r.up).map((r) => r.name));
          this.paintSel();
        } else if (!mod && !e.altKey && e.key.length === 1 && /\S/.test(e.key)) {
          // Tippen springt zum ersten passenden Eintrag
          const now = Date.now();
          this.typeBuf = (now - (this.typeAt || 0) < 800 ? this.typeBuf : '') + e.key.toLowerCase();
          this.typeAt = now;
          const idx = this.rows.findIndex((r) => !r.up && r.name.toLowerCase().startsWith(this.typeBuf));
          if (idx >= 0) this.selectIndex(idx);
        }
    }
  }

  onContext(e) {
    e.preventDefault();
    this.activate();
    const i = this.rowIndex(e);
    if (i >= 0 && !this.sel.has(this.rows[i].name)) this.selectIndex(i);
    if (i < 0) { this.sel.clear(); this.paintSel(); }
    const sel = this.selectedEntries();
    const one = sel.length === 1;
    const file = one && !sel[0].isDir;
    const conn = state.connected;
    let items;
    if (this.remote) {
      if (!conn) return;
      items = [
        { label: '◀ Herunterladen', key: 'F6', disabled: !sel.length, action: () => this.transferSelection() },
        { label: 'Bearbeiten (lokal öffnen, Auto-Upload)', key: 'F4', disabled: !file, action: () => this.edit() },
        '-',
        { label: 'Terminal hier öffnen', action: () => openTerminal({ cwd: one && sel[0].isDir ? this.join(sel[0].name) : this.cwd }) },
        '-',
        { label: 'Umbenennen', key: 'F2', disabled: !one, action: () => this.rename() },
        { label: 'Löschen', key: 'Entf', disabled: !sel.length, action: () => this.remove() },
        { label: 'Rechte ändern …', disabled: !sel.length, action: () => this.chmod() },
        '-',
        { label: 'Neuer Ordner', key: 'F7', action: () => this.newFolder() },
        { label: 'Neue Datei', action: () => this.newFile() },
        { label: 'Pfad kopieren', action: () => this.copyPath() },
        { label: 'Aktualisieren', key: 'F5', action: () => this.refresh() },
      ];
    } else {
      items = [
        { label: 'Hochladen ▶', key: 'F6', disabled: !sel.length || !conn, action: () => this.transferSelection() },
        { label: 'Öffnen', key: 'F4', disabled: !file, action: () => this.edit() },
        '-',
        { label: 'Umbenennen', key: 'F2', disabled: !one, action: () => this.rename() },
        { label: 'Löschen', key: 'Entf', disabled: !sel.length, action: () => this.remove() },
        '-',
        { label: 'Neuer Ordner', key: 'F7', action: () => this.newFolder() },
        { label: 'Pfad kopieren', action: () => this.copyPath() },
        { label: 'Aktualisieren', key: 'F5', action: () => this.refresh() },
      ];
    }
    showMenu(e.clientX, e.clientY, items);
  }

  // ---------- Drag & Drop ----------
  onDragStart(e) {
    const i = this.rowIndex(e);
    if (i < 0) return;
    if (!this.sel.has(this.rows[i].name)) this.selectIndex(i);
    const paths = this.selectedPaths();
    dragState = { from: this, paths };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', paths.join('\n'));
  }

  dropTargetRow(e) {
    const i = this.rowIndex(e);
    if (i < 0) return null;
    const r = this.rows[i];
    if (!r.isDir) return null;
    if (dragState && dragState.from === this && this.sel.has(r.name)) return null;
    return { i, entry: r };
  }

  clearDrop() {
    this.body.classList.remove('drop');
    this.tbody.querySelector('.drop-target')?.classList.remove('drop-target');
  }

  onDragOver(e) {
    const external = !dragState && e.dataTransfer.types.includes('Files');
    if (!dragState && !external) return;
    if (external && !this.remote) return;
    e.preventDefault();
    this.clearDrop();
    const t = this.dropTargetRow(e);
    if (t) this.tbody.children[t.i].classList.add('drop-target');
    else if (!dragState || dragState.from !== this) this.body.classList.add('drop');
    e.dataTransfer.dropEffect = dragState && dragState.from === this ? 'move' : 'copy';
  }

  async onDrop(e) {
    e.preventDefault();
    const t = this.dropTargetRow(e);
    this.clearDrop();
    const ds = dragState;
    dragState = null;
    let target = this.cwd;
    if (t) target = t.entry.up ? this.parentDir : this.join(t.entry.name);

    if (!ds) {
      // Dateien aus dem Explorer/Finder auf den Server ziehen
      const files = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
      if (files.length && this.remote && state.connected) {
        await api.call('transfer:upload', files, target).catch((err) => toast(err.message, 'error'));
        switchBottom('queue');
      }
      return;
    }
    if (ds.from === this) {
      if (!t) return;
      // Innerhalb derselben Seite: in Ordner verschieben
      const joiner = this.remote ? rjoin : ljoin;
      try {
        for (const p of ds.paths) await api.call(this.remote ? 'remote:rename' : 'local:rename', p, joiner(target, basename(p)));
      } catch (err) { toast('Verschieben fehlgeschlagen: ' + err.message, 'error'); }
      this.refresh();
      return;
    }
    ds.from.transfer(ds.paths, target);
  }
}

document.addEventListener('dragend', () => { dragState = null; });

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) return '🖼';
  if (['zip', 'gz', 'tgz', 'bz2', 'xz', 'rar', '7z', 'tar', 'zst'].includes(ext)) return '📦';
  if (['sh', 'bash', 'py', 'js', 'ts', 'php', 'rb', 'go', 'rs', 'c', 'cpp', 'java', 'pl'].includes(ext)) return '📜';
  if (['conf', 'cfg', 'ini', 'yml', 'yaml', 'toml', 'json', 'xml', 'env'].includes(ext)) return '⚙';
  if (['log', 'txt', 'md'].includes(ext)) return '📝';
  if (['mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'flac'].includes(ext)) return '🎞';
  return '📄';
}

// ====================== Rechte-Dialog ======================
function permDialog(entries) {
  const start = entries[0].mode ?? 0o644;
  const who = ['Besitzer', 'Gruppe', 'Andere'];
  const what = ['Lesen', 'Schreiben', 'Ausführen'];
  const boxes = [];
  const octal = h('input', { value: start.toString(8).padStart(3, '0'), style: 'width:80px;font-family:var(--mono)' });
  const grid = h('div', { class: 'perm-grid' }, h('span'), what.map((w) => h('span', { class: 'h', text: w })));
  who.forEach((wname, wi) => {
    grid.append(h('span', { text: wname }));
    what.forEach((_, bi) => {
      const bit = 1 << (8 - (wi * 3 + bi));
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!(start & bit);
      cb.dataset.bit = bit;
      cb.addEventListener('change', sync);
      boxes.push(cb);
      grid.append(h('label', {}, cb));
    });
  });
  function sync() {
    let m = start & 0o7000;
    boxes.forEach((b) => { if (b.checked) m |= Number(b.dataset.bit); });
    octal.value = m.toString(8).padStart(3, '0');
  }
  octal.addEventListener('input', () => {
    const m = parseInt(octal.value, 8);
    if (!Number.isNaN(m)) boxes.forEach((b) => { b.checked = !!(m & Number(b.dataset.bit)); });
  });
  const label = entries.length === 1 ? `„${entries[0].name}“` : `${entries.length} Elemente`;
  return modal({
    title: 'Rechte ändern',
    body: h('div', {}, h('div', { style: 'margin-bottom:10px', text: `Dateirechte für ${label}:` }), grid, h('label', {}, 'Numerisch: ', octal)),
    buttons: [{ label: 'Abbrechen', value: null }, {
      label: 'Übernehmen', kind: 'primary', default: true,
      value: () => { const m = parseInt(octal.value, 8); return Number.isNaN(m) || m > 0o7777 ? false : m; },
    }],
  });
}

// ====================== Seiten-Manager ======================
async function siteManager() {
  let sites = await api.call('sites:list');
  const canEnc = await api.call('sites:canEncrypt');
  let current = null;
  const listEl = h('div', { class: 'slist' });
  const f = {
    name: h('input', { placeholder: 'z.B. Webserver Produktion' }),
    folder: h('input', { placeholder: 'optional, z.B. Kunden' }),
    host: h('input', { placeholder: 'server.example.com', spellcheck: 'false' }),
    port: h('input', { value: '22', style: 'width:80px' }),
    username: h('input', { spellcheck: 'false' }),
    password: h('input', { type: 'password' }),
    savePw: h('input', { type: 'checkbox', disabled: !canEnc }),
    privateKeyPath: h('input', { spellcheck: 'false', placeholder: 'optional: ~/.ssh/id_ed25519' }),
    passphrase: h('input', { type: 'password', placeholder: 'falls der Schlüssel geschützt ist' }),
    remoteDir: h('input', { spellcheck: 'false', placeholder: 'optional, z.B. /var/www' }),
    localDir: h('input', { spellcheck: 'false', placeholder: 'optional' }),
  };
  f.savePw.checked = canEnc;
  const pickKey = h('button', { onclick: async () => { const p = await api.call('dialog:pickKey'); if (p) f.privateKeyPath.value = p; } }, '…');
  const pickLocal = h('button', { onclick: async () => { const p = await api.call('dialog:pickDir'); if (p) f.localDir.value = p; } }, '…');
  const form = h('div', { class: 'form' },
    'Name', f.name, 'Ordner', f.folder, 'Host', f.host, 'Port', f.port, 'Benutzer', f.username,
    'Passwort', f.password, '', h('label', {}, f.savePw, canEnc ? ' Passwort verschlüsselt speichern' : ' Passwort speichern (vom System nicht unterstützt)'),
    'Schlüsseldatei', h('div', { class: 'row' }, f.privateKeyPath, pickKey), 'Passphrase', f.passphrase,
    'Server-Verzeichnis', f.remoteDir, 'Lokales Verzeichnis', h('div', { class: 'row' }, f.localDir, pickLocal));
  const note = h('div', { class: 'note', style: 'margin-top:10px' });

  function fill(s) {
    current = s;
    for (const k of ['name', 'folder', 'host', 'username', 'privateKeyPath', 'remoteDir', 'localDir']) f[k].value = s?.[k] || '';
    f.port.value = s?.port || 22;
    f.password.value = '';
    f.passphrase.value = '';
    f.password.placeholder = s?.hasPassword ? '•••••• (gespeichert – leer lassen zum Beibehalten)' : '';
    note.textContent = s ? '' : 'Neue Verbindung – Felder ausfüllen und speichern.';
    renderList();
  }
  function renderList() {
    const byFolder = {};
    for (const s of sites) (byFolder[s.folder || ''] ||= []).push(s);
    listEl.replaceChildren(...Object.keys(byFolder).sort().flatMap((fold) => [
      fold ? h('div', { class: 'folder', text: fold }) : null,
      ...byFolder[fold].sort((a, b) => a.name.localeCompare(b.name)).map((s) => h('div', {
        class: 's' + (current && current.id === s.id ? ' active' : ''), onclick: () => fill(s), ondblclick: () => doConnect(),
      }, h('span', { text: s.name }), h('small', { text: `${s.username}@${s.host}:${s.port}` }))),
    ].filter(Boolean)));
    if (!sites.length) listEl.append(h('div', { class: 'note', style: 'padding:10px', text: 'Noch keine gespeicherten Verbindungen.' }));
  }
  async function save() {
    if (!f.host.value.trim() || !f.username.value.trim()) { toast('Host und Benutzer sind erforderlich.', 'error'); return null; }
    const site = {
      id: current?.id,
      ...Object.fromEntries(['name', 'folder', 'host', 'port', 'username', 'privateKeyPath', 'remoteDir', 'localDir'].map((k) => [k, f[k].value.trim()])),
      password: f.savePw.checked ? f.password.value : '',
      clearPassword: !f.savePw.checked,
      passphrase: f.savePw.checked ? f.passphrase.value : '',
    };
    const id = await api.call('sites:save', site);
    sites = await api.call('sites:list');
    fill(sites.find((s) => s.id === id));
    note.textContent = 'Gespeichert.';
    return id;
  }
  let closeFn;
  async function doConnect() {
    // Eingaben vor dem Speichern sichern – save() leert die Passwortfelder.
    const extra = {};
    if (f.password.value) extra.password = f.password.value;
    if (f.passphrase.value) extra.passphrase = f.passphrase.value;
    const id = await save();
    if (!id) return;
    closeFn(null);
    connect({ siteId: id, ...extra }, { label: `„${current.name}“ (${current.username}@${current.host})` });
  }
  fill(sites[0] || null);
  await modal({
    title: 'Seiten-Manager',
    width: 760,
    body: h('div', { class: 'sites' }, listEl, h('div', { class: 'sform' }, form, note)),
    buttons: [
      { label: 'Neue Seite', value: () => { fill(null); f.name.focus(); return false; } },
      { label: 'Löschen', kind: 'danger', value: () => {
        if (current) confirmDlg('Seite löschen', `„${current.name}“ löschen?`, 'Löschen', true).then(async (ok) => { if (ok) { await api.call('sites:delete', current.id); sites = await api.call('sites:list'); fill(sites[0] || null); } });
        return false;
      } },
      { label: 'Speichern', value: () => { save(); return false; } },
      { label: 'Schließen', value: null },
      { label: 'Verbinden', kind: 'primary', default: true, value: () => { doConnect(); return false; } },
    ],
    onOpen: (_m, close) => { closeFn = close; },
  });
}

// ====================== Verbindung ======================
const panes = {};

function parseQuick() {
  let host = $('#qHost').value.trim();
  let user = $('#qUser').value.trim();
  let port = $('#qPort').value.trim() || '22';
  const m = host.match(/^(?:sftp:\/\/|ssh:\/\/)?(?:([^@]+)@)?([^:/]+)(?::(\d+))?/);
  if (m) { if (m[1]) user = m[1]; host = m[2]; if (m[3]) port = m[3]; }
  return { host, username: user, port, password: $('#qPass').value };
}

async function connect(params, meta = {}) {
  if (state.connected) await disconnect(true);
  setStatus('Verbinde …');
  $('#btnConnect').disabled = true;
  try {
    const r = await api.call('ssh:connect', params);
    state.connected = true;
    state.home = r.home;
    state.label = r.label;
    state.lastParams = params;
    panes.remote.titleEl.textContent = '🌐 ' + r.label;
    panes.remote.history = [];
    panes.remote.cwd = null;
    await panes.remote.navigate(r.startDir);
    if (r.localDir) panes.local.navigate(r.localDir);
    setConnectedUI(true);
    setStatus(`Verbunden mit ${r.info.username}@${r.info.host}:${r.info.port}`);
    toast(`Verbunden mit ${r.label}`, 'ok');
  } catch (e) {
    setStatus('Nicht verbunden');
    const authFail = /authentication|auth methods|permission denied/i.test(e.message);
    if (authFail && !params.password) {
      const pw = await modal({
        title: 'Passwort erforderlich',
        body: h('div', {}, h('div', { style: 'margin-bottom:6px', text: `Passwort für ${meta.label || `${params.username}@${params.host}`}:` }), h('input', { type: 'password', id: 'pwPrompt', style: 'width:100%' })),
        buttons: [{ label: 'Abbrechen', value: null }, { label: 'Verbinden', kind: 'primary', default: true, value: () => $('#pwPrompt').value || null }],
      });
      $('#btnConnect').disabled = false;
      if (pw) return connect({ ...params, password: pw }, meta);
      return;
    }
    toast('Verbindung fehlgeschlagen: ' + translateError(e.message), 'error', 8000);
    showRemotePlaceholder();
  }
  $('#btnConnect').disabled = false;
}

function translateError(m) {
  if (/All configured authentication methods failed/i.test(m)) return 'Anmeldung fehlgeschlagen (Benutzer/Passwort/Schlüssel prüfen).';
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return 'Host nicht gefunden.';
  if (/ECONNREFUSED/i.test(m)) return 'Verbindung abgelehnt (läuft SSH auf diesem Port?).';
  if (/Timed out|ETIMEDOUT/i.test(m)) return 'Zeitüberschreitung beim Verbinden.';
  if (/host key|Host denied/i.test(m)) return 'Server-Schlüssel wurde nicht akzeptiert.';
  return m;
}

async function disconnect(silent) {
  await api.call('ssh:disconnect').catch(() => {});
  onDisconnected();
  if (!silent) toast('Verbindung getrennt.');
}

function onDisconnected() {
  state.connected = false;
  setConnectedUI(false);
  setStatus('Nicht verbunden');
  panes.remote.titleEl.textContent = '🌐 Server';
  panes.remote.cwd = null;
  panes.remote.entries = [];
  panes.remote.pathInput.value = '';
  panes.remote.foot.textContent = '';
  showRemotePlaceholder();
  for (const t of terms.values()) t.markDead();
  state.updates = null;
  renderUpdates({ state: 'idle' });
}

function showRemotePlaceholder() {
  if (state.connected) return;
  const btns = h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => siteManager() }, 'Seiten-Manager öffnen'));
  if (state.lastParams) btns.append(h('button', { onclick: () => connect(state.lastParams) }, 'Erneut verbinden'));
  panes.remote.showPlaceholder('🔌', 'Nicht verbunden. Oben Host, Benutzer und Passwort eingeben oder eine gespeicherte Verbindung wählen.', btns);
}

function setConnectedUI(on) {
  $('#btnDisconnect').disabled = !on;
  $('#btnNewTerm').disabled = !on;
  for (const id of ['qCancel', 'qRetry', 'qClear']) $('#' + id).disabled = !on;
}
function setStatus(t) { $('#statusText').textContent = t; }

api.onHostKey(async (req) => {
  const changed = !!req.previous;
  const body = h('div', { style: 'max-width:560px' },
    changed ? h('div', { class: 'warnbox' }, h('b', { text: '⚠ ACHTUNG: Der Server-Schlüssel hat sich geändert! ' }),
      'Das kann auf einen Angriff (Man-in-the-Middle) hindeuten – oder der Server wurde neu installiert. Verbinde nur, wenn du sicher bist.') : '',
    h('p', { text: changed ? `Bisher gespeicherter Schlüssel für ${req.host}:${req.port}:` : `Der Server ${req.host}:${req.port} ist noch unbekannt. Prüfe den Fingerabdruck seines Schlüssels:` }),
    changed ? h('div', { class: 'fp', style: 'margin-bottom:8px;text-decoration:line-through', text: req.previous }) : '',
    changed ? h('p', { text: 'Neuer Schlüssel:' }) : '',
    h('div', { class: 'fp', text: req.fingerprint }),
    h('p', { class: 'note', text: 'Auf dem Server anzeigen mit: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub' }));
  const r = await modal({
    title: changed ? 'Server-Schlüssel geändert' : 'Unbekannter Server',
    body,
    buttons: [
      { label: 'Abbrechen', value: 'no' },
      { label: 'Nur einmal verbinden', value: 'once' },
      { label: 'Vertrauen & speichern', kind: changed ? 'danger' : 'primary', default: !changed, value: 'save' },
    ],
  });
  api.answerHostKey(req.id, r === 'once' || r === 'save', r === 'save');
});

api.onSessionClosed(() => { onDisconnected(); toast('Die Verbindung zum Server wurde getrennt.', 'error', 8000); });

// ====================== Tabs & Terminal ======================
const terms = new Map();
let termCounter = 0;

function switchView(name) {
  document.querySelectorAll('.tab[data-view]').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  const t = terms.get(name);
  if (t) setTimeout(() => { t.fit(); t.term.focus(); }, 0);
}
document.getElementById('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab[data-view]');
  if (tab && !e.target.classList.contains('x')) switchView(tab.dataset.view);
});

class TermTab {
  constructor(opts = {}) {
    this.id = 'term' + (++termCounter);
    this.alive = false;
    this.dot = h('span', { class: 'dot' });
    this.tab = h('button', { class: 'tab', 'data-view': this.id }, this.dot, `Terminal ${termCounter}`,
      h('span', { class: 'x', title: 'Schließen', onclick: (e) => { e.stopPropagation(); this.close(); } }, '×'));
    $('#termTabs').append(this.tab);
    this.wrap = h('div', { class: 'term-wrap' });
    this.view = h('section', { class: 'view', id: 'view-' + this.id }, this.wrap);
    $('#views').append(this.view);
    this.term = new Terminal({
      fontFamily: getComputedStyle(document.body).getPropertyValue('--mono'),
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      theme: { background: '#0f1215', foreground: '#d7dce2', selectionBackground: '#2c4a6e' },
    });
    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    terms.set(this.id, this);
    switchView(this.id);
    this.term.open(this.wrap);
    this.fit();
    // Strg+Umschalt+C / V für Kopieren/Einfügen; Rechtsklick fügt ein
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') { navigator.clipboard.writeText(this.term.getSelection()); return false; }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') { navigator.clipboard.readText().then((t) => this.term.paste(t)); return false; }
      return true;
    });
    this.wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const s = this.term.getSelection();
      if (s) { navigator.clipboard.writeText(s); this.term.clearSelection(); toast('Kopiert.'); } else navigator.clipboard.readText().then((t) => this.term.paste(t));
    });
    this.term.onData((d) => { if (this.alive) api.shellWrite(this.id, d); });
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.wrap);
    this.start(opts);
  }

  async start({ cwd, input } = {}) {
    try {
      await api.call('shell:open', this.id, this.term.cols, this.term.rows);
      this.alive = true;
      this.dot.classList.remove('dead');
      if (cwd) api.shellWrite(this.id, `cd ${shQuote(cwd)}\n`);
      if (input) setTimeout(() => api.shellWrite(this.id, input), cwd ? 400 : 300);
      this.term.focus();
    } catch (e) {
      this.term.write(`\r\n\x1b[31mTerminal konnte nicht geöffnet werden: ${e.message}\x1b[0m\r\n`);
      this.markDead();
    }
  }

  fit() {
    if (!this.view.classList.contains('active')) return;
    try {
      this.fitAddon.fit();
      if (this.alive && (this.lastCols !== this.term.cols || this.lastRows !== this.term.rows)) {
        this.lastCols = this.term.cols; this.lastRows = this.term.rows;
        api.shellResize(this.id, this.term.cols, this.term.rows);
      }
    } catch (_) { /* noch nicht sichtbar */ }
  }

  markDead() {
    if (!this.alive) return;
    this.alive = false;
    this.dot.classList.add('dead');
    this.term.write('\r\n\x1b[90m[Sitzung beendet]\x1b[0m\r\n');
  }

  close() {
    if (this.alive) api.call('shell:close', this.id).catch(() => {});
    this.ro.disconnect();
    this.term.dispose();
    this.tab.remove();
    this.view.remove();
    terms.delete(this.id);
    if (!document.querySelector('.view.active')) switchView('files');
  }
}

function openTerminal(opts) {
  if (!state.connected) return toast('Bitte zuerst verbinden.', 'error');
  return new TermTab(opts);
}

api.onShellData((id, data) => terms.get(id)?.term.write(data));
api.onShellExit((id) => terms.get(id)?.markDead());

// ====================== Updates ======================
api.onUpdates((s) => renderUpdates(s));

function renderUpdates(s) {
  state.updState = s.state;
  if (s.state === 'done') state.updates = s.result;
  const badge = $('#updBadge');
  const body = $('#updatesBody');
  const r = state.updates;
  badge.className = 'badge';
  if (!state.connected) {
    badge.classList.add('muted'); badge.textContent = 'Updates: –';
    body.replaceChildren(h('div', { class: 'placeholder' }, h('div', { class: 'big', text: '⬆' }), h('div', { text: 'Nach dem Verbinden wird hier automatisch angezeigt, ob auf dem Server Updates verfügbar sind.' })));
    return;
  }
  if (s.state === 'checking' && !r) {
    badge.classList.add('muted'); badge.textContent = '⏳ Prüfe Updates …';
    body.replaceChildren(h('div', { class: 'placeholder' }, h('div', { class: 'big', text: '⏳' }), h('div', { text: 'Suche nach verfügbaren Updates …' })));
    return;
  }
  if (s.state === 'error' && !r) {
    badge.classList.add('muted'); badge.textContent = 'Updates: Fehler';
    body.replaceChildren(h('div', { class: 'placeholder' }, h('div', { class: 'big', text: '⚠' }), h('div', { text: 'Update-Prüfung fehlgeschlagen: ' + s.error }), h('button', { onclick: () => api.call('updates:check') }, 'Erneut versuchen')));
    return;
  }
  if (!r) return;

  // Badge
  if (!r.supported) { badge.classList.add('muted'); badge.textContent = 'Updates: n/v'; } else if (r.count === 0) {
    badge.classList.add('ok'); badge.textContent = '✓ System aktuell';
  } else if (r.securityCount) {
    badge.classList.add('bad'); badge.textContent = `⚠ ${r.count} Updates (${r.securityCount} Sicherheit)`;
  } else { badge.classList.add('warn'); badge.textContent = `⬆ ${r.count} Updates`; }
  if (r.rebootRequired) badge.textContent += ' · Neustart nötig';
  if (s.state === 'checking') badge.textContent = '⏳ ' + badge.textContent;
  $('#tabUpdates').textContent = r.count ? `⬆ Updates (${r.count})` : '⬆ Updates';

  // Detailansicht
  const stale = r.listsUpdatedAt && Date.now() - r.listsUpdatedAt > 86400000;
  const card = (k, v, cls = '', small = false) => h('div', { class: 'card ' + cls }, h('div', { class: 'k', text: k }), h('div', { class: 'v' + (small ? ' small' : ''), text: v }));
  const cards = h('div', { class: 'upd-cards' },
    card('Verfügbare Updates', r.supported ? String(r.count) : 'nicht ermittelbar', r.count ? 'warn' : 'ok'),
    card('Sicherheitsupdates', r.securityCount === null ? '–' : String(r.securityCount), r.securityCount ? 'bad' : ''),
    card('Neustart erforderlich', r.rebootRequired ? 'Ja' : 'Nein', r.rebootRequired ? 'warn' : ''),
    card('System', r.os || 'unbekannt', '', true),
    card('Kernel', r.kernel || '', '', true),
    card('Paketmanager', r.packageManager, '', true),
    card('Paketlisten aktualisiert', r.listsUpdatedAt ? fmtAgo(r.listsUpdatedAt) : '–', stale ? 'warn' : '', true),
    card('Zuletzt geprüft', fmtAgo(r.checkedAt), '', true));

  const actions = h('div', { class: 'upd-actions' },
    h('button', { onclick: () => api.call('updates:check').catch((e) => toast(e.message, 'error')), disabled: s.state === 'checking' }, s.state === 'checking' ? '⏳ Prüfe …' : '⟳ Erneut prüfen'),
    r.refreshCommand ? h('button', { onclick: () => runInTerminal(r.refreshCommand) }, '📥 Paketlisten aktualisieren (Terminal)') : '',
    r.upgradeCommand && r.count ? h('button', { class: 'primary', onclick: () => runInTerminal(r.upgradeCommand) }, '⬆ Updates installieren (Terminal)') : '',
    h('span', { class: 'note', text: stale ? '⚠ Die Paketlisten sind älter als ein Tag – das Ergebnis ist evtl. nicht vollständig. Erst „Paketlisten aktualisieren“, dann erneut prüfen.' : 'Die Prüfung ist rein lesend und benötigt keine root-Rechte. Installieren erfolgt sichtbar im Terminal (mit sudo).' }));

  let table = '';
  if (r.packages.length) {
    const filter = h('input', { placeholder: '🔍 Pakete filtern', style: 'margin-bottom:8px;width:240px' });
    const tb = h('tbody');
    const fill = () => {
      const q = filter.value.toLowerCase();
      const pk = [...r.packages].sort((a, b) => (b.security ? 1 : 0) - (a.security ? 1 : 0) || a.name.localeCompare(b.name));
      tb.replaceChildren(...pk.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => h('tr', {},
        h('td', {}, h('span', { text: p.name + ' ' }), p.security ? h('span', { class: 'tag', text: 'Sicherheit' }) : ''),
        h('td', { class: 'mono dim', text: p.oldVersion || '' }),
        h('td', { class: 'mono', text: p.newVersion || '' }),
        h('td', { class: 'dim', text: p.repo || '' }))));
    };
    filter.addEventListener('input', fill);
    fill();
    table = h('div', {}, filter, h('div', { class: 'upd-table' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Paket' }), h('th', { text: 'Installiert' }), h('th', { text: 'Verfügbar' }), h('th', { text: 'Quelle' }))), tb)));
  } else if (r.supported) {
    table = h('div', { class: 'placeholder', style: 'position:static;padding:30px' }, h('div', { class: 'big', text: '✅' }), h('div', { text: 'Alle Pakete sind auf dem neuesten Stand.' }));
  } else {
    table = h('p', { class: 'note', text: 'Es wurde kein unterstützter Paketmanager gefunden (unterstützt: apt, dnf, yum, pacman, zypper, apk).' });
  }
  body.replaceChildren(h('h3', { style: 'margin-top:0', text: `Updates auf ${state.label}` }), cards, actions, table);
}

function runInTerminal(cmd) {
  openTerminal({ input: cmd });
  toast('Befehl wurde ins Terminal eingefügt – mit Enter bestätigen.', 'info', 6000);
}

$('#updBadge').addEventListener('click', () => switchView('updates'));

// ====================== Übertragungen & Protokoll ======================
const qRows = new Map();
function switchBottom(name) {
  document.querySelectorAll('.btab').forEach((b) => b.classList.toggle('active', b.dataset.b === name));
  document.querySelectorAll('.bpanel').forEach((p) => p.classList.toggle('active', p.id === 'b-' + name));
}
document.querySelectorAll('.btab').forEach((b) => b.addEventListener('click', () => switchBottom(b.dataset.b)));

function updateQueueCount() {
  const active = [...qRows.values()].filter((r) => r.job.status === 'wartend' || r.job.status === 'läuft').length;
  $('#queueCount').textContent = active || '';
}

api.onTransfer((j) => {
  let r = qRows.get(j.id);
  if (!r) {
    const bar = h('div', { style: 'width:0%' });
    r = {
      bar,
      size: h('td', { class: 'num' }),
      speed: h('td', { class: 'num dim' }),
      status: h('td'),
      pct: h('span', { class: 'dim', style: 'font-size:11px' }),
    };
    const src = j.direction === 'up' ? j.local : j.remote;
    const dst = j.direction === 'up' ? j.remote : j.local;
    r.tr = h('tr', {}, h('td', { text: j.direction === 'up' ? '⬆' : '⬇', title: j.direction === 'up' ? 'Hochladen' : 'Herunterladen' }),
      h('td', { text: basename(src), title: src }), h('td', { class: 'dim', text: dst, title: dst }), r.size,
      h('td', {}, h('div', { class: 'progress' }, bar), r.pct), r.speed, r.status);
    $('#queueBody').append(r.tr);
    qRows.set(j.id, r);
  }
  r.job = j;
  const pct = j.size ? Math.min(100, Math.round((j.transferred / j.size) * 100)) : (j.status === 'fertig' ? 100 : 0);
  r.bar.style.width = pct + '%';
  r.pct.textContent = j.status === 'läuft' ? ` ${pct}%` : '';
  r.size.textContent = fmtSize(j.size);
  r.speed.textContent = j.status === 'läuft' && j.speed ? fmtSize(j.speed) + '/s' : '';
  r.status.textContent = j.status + (j.error ? ': ' + j.error : '');
  r.status.title = j.error || '';
  r.status.className = 'st-' + j.status;
  updateQueueCount();
});
api.onTransferCleared((jobs) => {
  const keep = new Set(jobs.map((j) => j.id));
  for (const [id, r] of qRows) if (!keep.has(id)) { r.tr.remove(); qRows.delete(id); }
  updateQueueCount();
});
let idleTimer;
api.onTransferIdle(() => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { panes.local.refresh(); panes.remote.refresh(); }, 200);
});

const logEl = $('#logBody');
api.onLog(({ level, msg, time }) => {
  const t = new Date(time).toLocaleTimeString('de-DE');
  logEl.append(h('div', { class: level }, h('span', { class: 't', text: t }), msg));
  while (logEl.childElementCount > 2000) logEl.firstChild.remove();
  logEl.parentElement.scrollTop = logEl.parentElement.scrollHeight;
  if (level === 'error' && !/Übertragung/.test(msg)) setStatus(msg);
});

$('#qCancel').addEventListener('click', () => api.call('transfer:cancel'));
$('#qRetry').addEventListener('click', () => api.call('transfer:retry'));
$('#qClear').addEventListener('click', () => api.call('transfer:clear'));
$('#policy').addEventListener('change', (e) => api.call('transfer:policy', e.target.value));

// ====================== Größenänderung ======================
function dragResize(handle, onMove) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const move = (ev) => onMove(ev);
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); for (const t of terms.values()) t.fit(); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}
dragResize($('#paneSplit'), (e) => {
  const box = $('#panes').getBoundingClientRect();
  const pct = Math.min(80, Math.max(20, ((e.clientX - box.left) / box.width) * 100));
  $('#pane-local').style.flex = `0 0 calc(${pct}% - 3px)`;
  $('#pane-remote').style.flex = '1 1 0';
});
dragResize($('#bottomSplit'), (e) => {
  const hgt = Math.min(innerHeight - 250, Math.max(80, innerHeight - e.clientY - 24));
  $('#bottom').style.height = hgt + 'px';
});

// ====================== Start ======================
$('#btnSites').addEventListener('click', () => siteManager());
$('#btnConnect').addEventListener('click', () => {
  const p = parseQuick();
  if (!p.host) { $('#qHost').focus(); return toast('Bitte einen Host eingeben.', 'error'); }
  if (!p.username) { $('#qUser').focus(); return toast('Bitte einen Benutzernamen eingeben.', 'error'); }
  connect(p);
});
for (const id of ['qHost', 'qUser', 'qPass', 'qPort']) $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnConnect').click(); });
$('#btnDisconnect').addEventListener('click', () => disconnect());
$('#btnNewTerm').addEventListener('click', () => openTerminal({ cwd: panes.remote.cwd }));

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 't' && state.connected) { e.preventDefault(); openTerminal({ cwd: panes.remote.cwd }); }
  if (mod && e.key === 'Tab') {
    e.preventDefault();
    const tabs = [...document.querySelectorAll('.tab[data-view]')];
    const i = tabs.findIndex((t) => t.classList.contains('active'));
    switchView(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].dataset.view);
  }
});

(async function init() {
  const p = await api.call('platform');
  SEP = p.sep;
  panes.local = new Pane('local', $('#pane-local'));
  panes.remote = new Pane('remote', $('#pane-remote'));
  const settings = await api.call('settings:get');
  if (settings.policy) $('#policy').value = settings.policy;
  let start = settings.lastLocalDir;
  try { if (!start || !(await api.call('local:isDir', start))) start = null; } catch (_) { start = null; }
  await panes.local.navigate(start || await api.call('local:home'));
  panes.local.body.focus();
  showRemotePlaceholder();
  setConnectedUI(false);
  renderUpdates({ state: 'idle' });
})();
