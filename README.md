# BridgeSFTP

**von ARWEH · Arne Wolter**

Ein SFTP-Client, der die Zwei-Fenster-Bedienung von **FileZilla** und **WinSCP** verbindet, mit **integriertem SSH-Terminal** und einer **Anzeige verfügbarer Server-Updates**.

Läuft auf Windows, macOS und Linux (Electron + [ssh2](https://github.com/mscdex/ssh2) + [xterm.js](https://xtermjs.org)).

## Funktionen

**Verbinden**
- Schnellverbindung in der Werkzeugleiste (wie FileZilla). Das Host-Feld versteht auch `benutzer@host:port`.
- Seiten-Manager mit Ordnern, Startverzeichnissen (Server und lokal) und Schlüsseldateien (wie WinSCP).
- Passwörter werden nur gespeichert, wenn das Betriebssystem sie verschlüsseln kann (Windows DPAPI, macOS Keychain, Linux libsecret).
- Anmeldung per Passwort, keyboard-interactive, privatem Schlüssel (mit Passphrase) oder SSH-Agent/Pageant.
- Hostschlüssel werden geprüft: Bei unbekannten Servern erscheint der Fingerabdruck, bei **geändertem** Schlüssel eine deutliche Warnung.

**Dateien**
- Zwei Fenster (lokal | Server), sortierbar, mit Schnellfilter, Pfadeingabe, Verlauf (Zurück) und Mehrfachauswahl (Strg/Umschalt).
- Drag & Drop zwischen den Fenstern, auf Ordner und aus dem Explorer/Finder direkt auf den Server.
- Drag & Drop innerhalb eines Fensters auf einen Ordner verschiebt die Dateien.
- Doppelklick auf eine Datei überträgt sie (FileZilla-Verhalten).
- **Bearbeiten (F4)**: Die Datei wird lokal im Standardprogramm geöffnet und bei jedem Speichern automatisch hochgeladen (WinSCP-Verhalten).
- Umbenennen, Löschen (rekursiv), neuer Ordner, neue Datei, Rechte ändern (chmod-Dialog), Pfad kopieren.
- Übertragungswarteschlange mit Fortschritt, Tempo und Ordner-Rekursion. Regel für vorhandene Dateien: überschreiben, nur wenn neuer oder überspringen. Fehlgeschlagene Übertragungen lassen sich wiederholen.
- Protokoll aller Aktionen.

**Terminal**
- Beliebig viele SSH-Terminal-Tabs über dieselbe Verbindung (kein zweites Login nötig).
- „Terminal hier öffnen“ im Kontextmenü wechselt direkt in den gewählten Server-Ordner.
- Strg+Umschalt+C/V zum Kopieren/Einfügen; Rechtsklick kopiert die Auswahl oder fügt ein.

**Server-Updates**
- Nach dem Verbinden wird automatisch geprüft (danach alle 30 Minuten) und oben rechts angezeigt:
  - ✓ grün: System aktuell
  - ⬆ orange: Updates verfügbar
  - ⚠ rot: Sicherheitsupdates verfügbar
  - Hinweis, wenn ein Neustart nötig ist
- Detailansicht mit Paketliste (installiert → verfügbar, Quelle, Sicherheits-Markierung), Betriebssystem, Kernel und Alter der Paketlisten.
- Unterstützt **apt** (Debian/Ubuntu), **dnf/yum** (Fedora/RHEL/Alma/Rocky), **pacman** (Arch), **zypper** (openSUSE) und **apk** (Alpine).
- Die Prüfung ist rein lesend und braucht **keine root-Rechte**. „Paketlisten aktualisieren“ und „Updates installieren“ fügen den passenden `sudo`-Befehl in ein neues Terminal ein. Ausgeführt wird er erst, wenn du ihn mit Enter bestätigst.

**Programm**
- Menü *Hilfe*: eingebaute Hilfe mit Erklärungen und Tastenkürzeln (F1), Online-Dokumentation, Problem melden, Lizenz.
- *Über BridgeSFTP*: Version, Herausgeber, Lizenzhinweis, verwendete Komponenten.
- **Hinweis auf neue Versionen:** Beim Start fragt BridgeSFTP bei GitHub nach, ob ein neueres Release veröffentlicht wurde, und zeigt dann einen Hinweis mit Download-Knopf und Änderungen. Eine Version lässt sich überspringen, die automatische Suche im Über-Dialog abschalten.

## Tastenkürzel

| Taste | Aktion |
|---|---|
| Enter / Doppelklick | Ordner öffnen bzw. Datei übertragen |
| Backspace | übergeordneter Ordner |
| F1 | Hilfe |
| F2 | umbenennen |
| F4 | bearbeiten (Server) / öffnen (lokal) |
| F5 | aktualisieren |
| F6 | Auswahl auf die andere Seite übertragen |
| F7 | neuer Ordner |
| Entf | löschen |
| Tab | zwischen lokal und Server wechseln |
| Strg+A | alles auswählen |
| Buchstaben tippen | zum passenden Eintrag springen |
| Strg+T | neues Terminal |
| Strg+Tab | nächster Tab |
| Strg+N | neues Fenster (für eine zweite Verbindung) |

## Starten (Entwicklung)

Voraussetzung: [Node.js](https://nodejs.org) 20.17 oder neuer (empfohlen: 22). Die Node-Version von Ubuntu ist zu alt – am einfachsten über [nvm](https://github.com/nvm-sh/nvm) installieren.

```bash
npm install
npm start
```

## Installationspaket bauen

```bash
npm run dist
```

Das erzeugt je nach System einen Windows-Installer (`.exe`), ein Linux-AppImage oder ein macOS-`.dmg` im Ordner `dist/`.

Unter Linux baut `npm run dist:win` auch die Windows-Dateien (Installer und portable `.exe`). Dafür muss Wine installiert sein (`sudo apt install wine`).

## Neue Version veröffentlichen (automatisch über GitHub)

GitHub Actions baut die App auf echten Windows-, Linux- und macOS-Rechnern (`.github/workflows/build.yml`):

- **Bei jedem Pull Request** wird zur Kontrolle gebaut. Die Dateien hängen am Lauf unter *Actions → Lauf → Artifacts*.
- **Bei einem Versions-Tag** entsteht zusätzlich ein Release mit den Installationsdateien zum Download.

**Einfachster Weg – auf der GitHub-Seite:**

1. Falls nötig, zuerst die Version in `package.json` erhöhen (z. B. auf `0.2.0`) und auf `main` bringen.
2. Auf GitHub rechts auf *Releases* → *Draft a new release*.
3. Bei *Choose a tag* `v0.2.0` eintippen und „Create new tag on publish“ wählen, Ziel `main`.
4. Titel z. B. „BridgeSFTP 0.2.0“, auf *Generate release notes* klicken, dann *Publish release*.

Nach etwa 10 Minuten hängen die Installationsdateien für Windows, Linux und macOS automatisch am Release.

**Alternativ über die Kommandozeile**, z. B. für 0.2.0:

```bash
npm version 0.2.0
```

Das setzt die Version in `package.json`, committet und legt den Tag `v0.2.0` an. Dann hochladen:

```bash
git push --follow-tags
```

Nach etwa 10 Minuten erscheint das Release unter *Releases* auf der GitHub-Seite. Der Tag muss zur Version in `package.json` passen, sonst bricht der Build mit einer Meldung ab.

Zu jedem Release gehört eine Datei `SHA256SUMS.txt` mit den Prüfsummen aller Installationsdateien. GitHub zeigt die SHA-256-Prüfsumme außerdem neben jeder Datei auf der Release-Seite an.

Die Dateien sind nicht signiert. Windows zeigt deshalb beim ersten Start die SmartScreen-Warnung („Weitere Informationen“ → „Trotzdem ausführen“), macOS verlangt Rechtsklick → „Öffnen“.

## Tests

Unit-Test für die Versionsprüfung (ohne Netzwerk, läuft auch automatisch bei jedem Pull Request):

```bash
npm run test:unit
```

### Backend-Test gegen einen echten Server

```bash
SSH_HOST=127.0.0.1 SSH_PORT=22 SSH_USER=ich SSH_PASS=geheim npm run test:backend
```

Der Test verbindet sich, lädt Ordner rekursiv hoch und herunter, prüft chmod/rename/delete, die Shell und die Update-Erkennung. Er legt dabei temporär `~/upl` und `~/neu2` auf dem Server an und löscht sie danach wieder.

## Projektstruktur

```
main.js            Electron-Hauptprozess: Fenster, IPC, Verbindungsablauf, „Bearbeiten“ mit Auto-Upload
preload.js         sichere Brücke zwischen Oberfläche und Hauptprozess (contextIsolation, sandbox)
src/session.js     SSH-Verbindung: SFTP-Operationen, Shells, exec, Hostschlüssel-Prüfung
src/transfers.js   Übertragungswarteschlange (rekursiv, parallel, Konfliktregeln)
src/updates.js     Paketmanager-Erkennung und Auswertung verfügbarer Updates
src/store.js       Seiten-Manager, bekannte Hostschlüssel, Einstellungen (im Benutzerdatenordner)
src/localfs.js     lokales Dateisystem
src/appupdate.js   Suche nach neuen BridgeSFTP-Versionen (GitHub-Releases)
renderer/          Oberfläche (HTML/CSS/JS ohne Build-Schritt); help.js: Hilfe, Über, Update-Hinweis
test/              Unit-Test und Backend-Integrationstest
```

## Mögliche nächste Schritte

- Mehrere Verbindungen als Tabs in einem Fenster
- Verzeichnisse synchronisieren bzw. vergleichen (wie WinSCP „Synchronisieren“)
- Import der Seiten aus FileZilla (`sitemanager.xml`) und WinSCP (`WinSCP.ini`)
- Lesezeichen pro Verbindung, Übertragungen pausieren/fortsetzen
- Jump-Host/Proxy-Unterstützung, Import aus `~/.ssh/config`
- Update-Prüfung für mehrere Server gleichzeitig (Dashboard)

## Datenschutz

BridgeSFTP sendet keine Nutzungsdaten. Die einzige Verbindung, die das Programm von sich aus aufbaut, ist die Suche nach neuen Versionen bei `api.github.com`. Dabei wird nur die installierte Versionsnummer übertragen. Passwörter werden nur auf Wunsch und nur verschlüsselt über das Betriebssystem gespeichert. Gespeicherte Verbindungen und vertraute Server-Schlüssel bleiben lokal im Benutzerprofil.

## Lizenz

Copyright © 2026 Arne Wolter · ARWEH

BridgeSFTP ist freie Software: Du darfst das Programm unter den Bedingungen der
[GNU General Public License](LICENSE), Version 3 oder (nach deiner Wahl) jeder späteren Version,
weitergeben und verändern. Es wird ohne jede Gewährleistung bereitgestellt; Einzelheiten stehen in der Datei [LICENSE](LICENSE).

Verwendete Open-Source-Komponenten: [Electron](https://www.electronjs.org) (MIT), [ssh2](https://github.com/mscdex/ssh2) (MIT), [xterm.js](https://xtermjs.org) (MIT).

„ARWEH“ ist die Marke von Arne Wolter. Die GPL erlaubt das Verändern und Weitergeben des Codes, gewährt aber keine Rechte an Namen oder Marke.

## Download prüfen

Mit der Datei `SHA256SUMS.txt` aus dem Release lässt sich prüfen, dass ein Download vollständig und unverändert ist. Beide Dateien in denselben Ordner legen, dann:

**Linux / macOS**

```bash
sha256sum --ignore-missing -c SHA256SUMS.txt
```

(Unter macOS ohne `sha256sum`: `shasum -a 256 --ignore-missing -c SHA256SUMS.txt`.) Für die geprüfte Datei muss `OK` erscheinen.

**Windows (PowerShell)**

```powershell
Get-FileHash .\BridgeSFTP-Setup-0.2.0.exe -Algorithm SHA256
```

Der angezeigte Wert muss mit der Zeile für diese Datei in `SHA256SUMS.txt` übereinstimmen (Groß-/Kleinschreibung egal).
