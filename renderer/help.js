// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
/* global api, h, $, modal, toast */
// Über-Dialog, Hilfe, Lizenzanzeige und Hinweis auf neue Programmversionen.

let appInfoCache = null;
async function appInfo() {
  if (!appInfoCache) appInfoCache = await api.call('app:info');
  return appInfoCache;
}

function extLink(label, url) {
  return h('a', {
    href: url,
    class: 'ext',
    title: url,
    onclick: (e) => { e.preventDefault(); api.call('app:openExternal', url).catch((err) => toast(err.message, 'error')); },
  }, label);
}

// ====================== Über ======================
async function showAbout() {
  const i = await appInfo();
  const settings = await api.call('settings:get');
  const auto = h('input', { type: 'checkbox' });
  auto.checked = settings.appUpdateCheck !== false;
  auto.addEventListener('change', () => api.call('settings:set', { appUpdateCheck: auto.checked }));

  const row = (k, v) => h('tr', {}, h('td', { class: 'dim', text: k }), h('td', { text: v }));
  const body = h('div', { class: 'about' },
    h('div', { class: 'about-head' },
      h('img', { class: 'about-logo', src: 'logo.png', alt: 'ARWEH-Logo' }),
      h('div', {},
        h('div', { class: 'about-name', text: i.name }),
        h('div', { class: 'about-ver', text: `Version ${i.version}` }),
        h('div', { class: 'about-brand' }, 'von ', h('b', { text: i.brand }), ` · ${i.author}`))),
    h('p', { text: 'SFTP-Client mit Zwei-Fenster-Ansicht, integriertem SSH-Terminal und Anzeige verfügbarer Server-Updates.' }),
    h('p', { class: 'about-copy', text: i.copyright }),
    h('div', { class: 'about-license' },
      h('p', { text: 'BridgeSFTP ist freie Software: Du darfst das Programm unter den Bedingungen der GNU General Public License, Version 3 oder (nach deiner Wahl) jeder späteren Version, weitergeben und verändern.' }),
      h('p', { text: 'Das Programm wird in der Hoffnung bereitgestellt, dass es nützlich ist, aber OHNE JEDE GEWÄHRLEISTUNG – sogar ohne die implizite Gewährleistung der MARKTREIFE oder der EIGNUNG FÜR EINEN BESTIMMTEN ZWECK.' }),
      h('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap' },
        h('a', { href: '#', class: 'ext', onclick: (e) => { e.preventDefault(); showLicense(); } }, 'Lizenztext anzeigen'),
        extLink('Quellcode auf GitHub', i.repoUrl),
        extLink('Problem melden', i.issuesUrl))),
    h('table', { class: 'about-tech' },
      row('Electron', i.electron), row('Chromium', i.chrome), row('Node.js', i.node), row('System', i.platform)),
    h('p', { class: 'note', text: 'Verwendete Open-Source-Komponenten: Electron (MIT), ssh2 (MIT), xterm.js (MIT) sowie deren Abhängigkeiten.' }),
    h('label', { class: 'about-auto' }, auto, ' Beim Start automatisch nach neuen BridgeSFTP-Versionen suchen'));

  const r = await modal({
    title: 'Über BridgeSFTP',
    width: 560,
    body,
    buttons: [
      { label: 'Nach neuer Version suchen', value: 'check' },
      { label: 'Schließen', kind: 'primary', default: true, value: null },
    ],
  });
  if (r === 'check') checkAppUpdate(true);
}

async function showLicense() {
  let text;
  try { text = await api.call('app:license'); } catch (e) { return toast('Lizenztext nicht gefunden: ' + e.message, 'error'); }
  await modal({
    title: 'Lizenz – GNU General Public License v3',
    width: 760,
    body: h('div', {},
      h('p', { class: 'note' }, 'Verbindlich ist der englische Originaltext. Eine inoffizielle deutsche Übersetzung gibt es bei der ',
        extLink('Free Software Foundation', 'https://www.gnu.org/licenses/gpl-3.0.html'), '.'),
      h('pre', { class: 'license-text', text })),
    buttons: [{ label: 'Schließen', kind: 'primary', default: true, value: null }],
  });
}

// ====================== Hilfe ======================
const P = (t) => h('p', { text: t });
const UL = (...items) => h('ul', {}, items.map((t) => h('li', {}, t)));
const K = (t) => h('kbd', { text: t });

function helpSections(i) {
  return [
    {
      title: 'Erste Schritte',
      body: () => [
        h('h3', { text: 'Mit einem Server verbinden' }),
        UL(
          'Schnell: Oben Host, Benutzer und Passwort eingeben und „Verbinden“ klicken. Im Host-Feld geht auch benutzer@server:port.',
          'Dauerhaft: Im Seiten-Manager eine Verbindung anlegen und speichern. Dort lassen sich auch Schlüsseldatei und Startordner festlegen.',
          'Ohne Passwort und Schlüssel wird der SSH-Agent (unter Windows Pageant) verwendet.'),
        h('h3', { text: 'Unbekannter Server' }),
        P('Beim ersten Verbinden zeigt BridgeSFTP den Fingerabdruck des Server-Schlüssels. Vergleiche ihn mit dem Wert vom Server (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub) und wähle dann „Vertrauen & speichern“.'),
        P('Ändert sich der Schlüssel später, erscheint eine rote Warnung. Verbinde dann nur, wenn du weißt, warum (z. B. Server neu installiert).'),
      ],
    },
    {
      title: 'Dateien',
      body: () => [
        P('Links siehst du deinen Computer, rechts den Server. Klick auf einen Spaltenkopf sortiert, das Filterfeld blendet nicht passende Einträge aus.'),
        h('h3', { text: 'Übertragen' }),
        UL(
          'Doppelklick auf eine Datei überträgt sie auf die andere Seite.',
          h('span', {}, 'Auswahl markieren und ', K('F6'), ' drücken oder „Hochladen ▶“ / „◀ Herunterladen“ klicken.'),
          'Dateien und Ordner per Drag & Drop auf die andere Seite oder direkt auf einen Ordner ziehen.',
          'Dateien aus dem Explorer bzw. Finder lassen sich direkt auf die Server-Seite ziehen.',
          'Unten unter „Vorhandene Dateien“ legst du fest, ob bestehende Dateien überschrieben, nur bei neuerer Quelle ersetzt oder übersprungen werden.'),
        h('h3', { text: 'Bearbeiten' }),
        P('Mit F4 (oder Rechtsklick → Bearbeiten) öffnet sich eine Server-Datei in deinem Standardprogramm. Jedes Speichern lädt sie automatisch wieder hoch.'),
        h('h3', { text: 'Weitere Aktionen (Rechtsklick)' }),
        P('Umbenennen, Löschen, Rechte ändern, neuer Ordner, neue Datei, Pfad kopieren und „Terminal hier öffnen“.'),
      ],
    },
    {
      title: 'Terminal',
      body: () => [
        P('„＋ Terminal“ oder Strg+T öffnet ein SSH-Terminal über die bestehende Verbindung, ohne erneute Anmeldung. Es sind beliebig viele Terminal-Tabs möglich.'),
        UL(
          'Rechtsklick auf einen Server-Ordner → „Terminal hier öffnen“ wechselt direkt in diesen Ordner.',
          h('span', {}, K('Strg+Umschalt+C'), ' kopiert, ', K('Strg+Umschalt+V'), ' fügt ein.'),
          'Rechtsklick ins Terminal kopiert die Auswahl oder fügt ein, wenn nichts markiert ist.'),
      ],
    },
    {
      title: 'Server-Updates',
      body: () => [
        P('Nach dem Verbinden prüft BridgeSFTP automatisch (danach alle 30 Minuten), ob auf dem Server Paket-Updates verfügbar sind. Die Anzeige oben rechts bedeutet:'),
        UL('✓ grün: System ist aktuell', '⬆ orange: Updates verfügbar', '⚠ rot: Sicherheitsupdates verfügbar', '„Neustart nötig“: der Server sollte neu gestartet werden'),
        P('Unterstützt werden apt (Debian/Ubuntu), dnf/yum (Fedora/RHEL), pacman (Arch), zypper (openSUSE) und apk (Alpine).'),
        P('Die Prüfung liest nur und braucht keine root-Rechte. „Updates installieren“ schreibt den passenden sudo-Befehl in ein Terminal. Ausgeführt wird er erst, wenn du Enter drückst.'),
        P('Hinweis: Sind die Paketlisten auf dem Server älter als einen Tag, zuerst „Paketlisten aktualisieren“ ausführen, sonst fehlen evtl. neue Updates.'),
      ],
    },
    {
      title: 'Tastenkürzel',
      body: () => {
        const rows = [
          ['Enter / Doppelklick', 'Ordner öffnen bzw. Datei übertragen'], ['Backspace', 'übergeordneter Ordner'],
          ['F1', 'diese Hilfe'], ['F2', 'umbenennen'], ['F4', 'bearbeiten (Server) / öffnen (lokal)'], ['F5', 'aktualisieren'],
          ['F6', 'Auswahl auf die andere Seite übertragen'], ['F7', 'neuer Ordner'], ['Entf', 'löschen'],
          ['Tab', 'zwischen lokal und Server wechseln'], ['Strg+A', 'alles auswählen'], ['Buchstaben tippen', 'zum passenden Eintrag springen'],
          ['Strg+T', 'neues Terminal'], ['Strg+Tab', 'nächster Tab'], ['Strg+N', 'neues Fenster (zweite Verbindung)'],
        ];
        return [h('table', { class: 'list keys' }, h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('td', {}, K(k)), h('td', { text: v })))))];
      },
    },
    {
      title: 'Datenschutz & Sicherheit',
      body: () => [
        UL(
          'Passwörter werden nur gespeichert, wenn du es im Seiten-Manager wählst – und nur verschlüsselt über das Betriebssystem (Windows DPAPI, macOS-Schlüsselbund, Linux libsecret). Ist das nicht verfügbar, wird kein Passwort gespeichert.',
          'Vertraute Server-Schlüssel und gespeicherte Verbindungen liegen nur lokal in deinem Benutzerprofil.',
          'BridgeSFTP sendet keine Nutzungsdaten. Die einzige Verbindung, die das Programm selbst aufbaut, ist die Suche nach neuen Versionen bei api.github.com. Dabei wird nur die installierte Versionsnummer übertragen. Abschalten kannst du sie unter Hilfe → Über BridgeSFTP.'),
      ],
    },
    {
      title: 'Hilfe bekommen',
      body: () => [
        P('Ausführliche Beschreibung, Fragen, Fehlermeldungen und Vorschläge:'),
        UL(extLink('Online-Dokumentation', i.docsUrl), extLink('Problem melden / Vorschlag machen', i.issuesUrl), extLink('Alle Versionen & Downloads', i.releasesUrl)),
        P(`BridgeSFTP ${i.version} · ${i.copyright} · Lizenz: GPL-3.0`),
      ],
    },
  ];
}

async function showHelp(start = 0) {
  const i = await appInfo();
  const sections = helpSections(i);
  const content = h('div', { class: 'help-content' });
  const nav = h('div', { class: 'help-nav' });
  const select = (n) => {
    [...nav.children].forEach((b, k) => b.classList.toggle('active', k === n));
    content.replaceChildren(h('h2', { class: 'help-title', text: sections[n].title }), ...sections[n].body());
    content.scrollTop = 0;
  };
  sections.forEach((s, n) => nav.append(h('button', { class: 'help-tab', onclick: () => select(n) }, s.title)));
  select(start);
  await modal({
    title: 'Hilfe – BridgeSFTP',
    width: 860,
    body: h('div', { class: 'help' }, nav, content),
    buttons: [{ label: 'Schließen', kind: 'primary', default: true, value: null }],
  });
}

// ====================== Neue Programmversion ======================
function hideUpdateBanner() { $('#appUpdateBanner').classList.add('hidden'); }

function showReleaseNotes(r) {
  return modal({
    title: `Neu in ${r.name}`,
    width: 640,
    body: h('div', {},
      h('p', { class: 'note', text: r.publishedAt ? `Veröffentlicht am ${new Date(r.publishedAt).toLocaleDateString('de-DE')}` : '' }),
      h('pre', { class: 'release-notes', text: r.notes || 'Keine Beschreibung vorhanden.' })),
    buttons: [{ label: 'Schließen', value: null }, { label: 'Herunterladen', kind: 'primary', default: true, value: 'dl' }],
  }).then((v) => { if (v === 'dl') downloadUpdate(r); });
}

function downloadUpdate(r) {
  const url = r.asset ? r.asset.url : r.url;
  api.call('app:openExternal', url).then(
    () => toast(r.asset ? `Download von ${r.asset.name} gestartet. Danach die Datei ausführen, um BridgeSFTP zu aktualisieren.` : 'Die Download-Seite wurde im Browser geöffnet.', 'ok', 8000),
    (e) => toast(e.message, 'error'));
}

function showUpdateBanner(r) {
  const el = $('#appUpdateBanner');
  el.replaceChildren(
    h('span', { class: 'au-icon', text: '🎉' }),
    h('span', { class: 'au-text' }, 'Neue Version verfügbar: ', h('b', { text: `BridgeSFTP ${r.latest}` }), ` (installiert: ${r.current})`),
    h('span', { class: 'spacer' }),
    h('button', { class: 'small primary', onclick: () => downloadUpdate(r) }, 'Herunterladen'),
    h('button', { class: 'small', onclick: () => showReleaseNotes(r) }, 'Was ist neu?'),
    h('button', {
      class: 'small',
      onclick: () => { api.call('settings:set', { skippedVersion: r.latest }); hideUpdateBanner(); toast(`Version ${r.latest} wird nicht mehr angezeigt.`); },
    }, 'Diese Version überspringen'),
    h('button', { class: 'small icon', title: 'Später erinnern', onclick: hideUpdateBanner }, '×'));
  el.classList.remove('hidden');
}

async function checkAppUpdate(manual) {
  try {
    const r = await api.call('appupdate:check');
    if (r.available) {
      showUpdateBanner(r);
      if (manual) showReleaseNotes(r);
    } else if (manual) {
      toast(r.latest ? `Du verwendest die neueste Version (${r.current}).` : 'Auf GitHub ist noch keine BridgeSFTP-Version veröffentlicht.', 'ok');
    }
  } catch (e) {
    if (manual) toast('Suche nach neuer Version fehlgeschlagen: ' + e.message, 'error', 8000);
  }
}

// ====================== Verdrahtung ======================
api.onAppUpdate((r) => showUpdateBanner(r));
api.onMenu((action) => {
  const actions = { about: showAbout, help: () => showHelp(), license: showLicense, appupdate: () => checkAppUpdate(true) };
  if (document.querySelector('.backdrop') && action !== 'appupdate') return; // kein Dialog über einem Dialog
  if (actions[action]) actions[action]();
});
$('#btnHelp').addEventListener('click', () => showHelp());
appInfo().then((i) => {
  const v = $('#appVersion');
  v.textContent = `BridgeSFTP ${i.version} · ${i.brand}`;
  v.addEventListener('click', showAbout);
}).catch(() => {});
