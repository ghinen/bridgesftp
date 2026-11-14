// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
// Unit-Test für die Erkennung neuer Programmversionen (ohne Netzwerk).
const assert = require('assert');
const { compareVersions, pickAsset, checkForAppUpdate } = require('../src/appupdate');

assert(compareVersions('0.2.0', '0.1.0') > 0);
assert(compareVersions('v0.1.0', '0.1.0') === 0);
assert(compareVersions('0.1.10', '0.1.9') > 0);
assert(compareVersions('1.0.0', '0.99.99') > 0);
assert(compareVersions('0.2.0-beta.1', '0.2.0') < 0);
assert(compareVersions('0.2.0', '0.2.0-beta.2') > 0);
assert(compareVersions('0.2.0-beta.10', '0.2.0-beta.9') > 0);
assert(compareVersions('0.1.0', '0.2.0') < 0);

const assets = [
  { name: 'BridgeSFTP Setup 0.2.0.exe', browser_download_url: 'https://github.com/x/setup.exe', size: 1 },
  { name: 'BridgeSFTP-0.2.0-portable.exe', browser_download_url: 'https://github.com/x/portable.exe', size: 1 },
  { name: 'BridgeSFTP-0.2.0.AppImage', browser_download_url: 'https://github.com/x/app.AppImage', size: 1 },
  { name: 'BridgeSFTP-0.2.0-arm64.dmg', browser_download_url: 'https://github.com/x/app.dmg', size: 1 },
];
assert.strictEqual(pickAsset(assets, 'win32').name, 'BridgeSFTP Setup 0.2.0.exe');
assert.strictEqual(pickAsset(assets, 'linux').name, 'BridgeSFTP-0.2.0.AppImage');
assert.strictEqual(pickAsset(assets, 'darwin').name, 'BridgeSFTP-0.2.0-arm64.dmg');
assert.strictEqual(pickAsset([], 'win32'), null);
// Neuer Installer-Name ohne Leerzeichen (ab 0.2.0) und alter Name von GitHub (0.1.0)
assert.strictEqual(pickAsset([{ name: 'BridgeSFTP-0.2.0-portable.exe' }, { name: 'BridgeSFTP-Setup-0.2.0.exe' }], 'win32').name, 'BridgeSFTP-Setup-0.2.0.exe');
assert.strictEqual(pickAsset([{ name: 'BridgeSFTP-0.1.0-portable.exe' }, { name: 'BridgeSFTP.Setup.0.1.0.exe' }], 'win32').name, 'BridgeSFTP.Setup.0.1.0.exe');
assert.strictEqual(pickAsset([{ name: 'SHA256SUMS.txt' }, { name: 'BridgeSFTP-0.2.0.AppImage' }], 'linux').name, 'BridgeSFTP-0.2.0.AppImage');

const fake = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
(async () => {
  let r = await checkForAppUpdate('0.1.0', fake(200, { tag_name: 'v0.2.0', assets, html_url: 'https://github.com/r', body: 'Neu' }), 'win32');
  assert(r.available && r.latest === '0.2.0' && r.asset.name.includes('Setup'));
  r = await checkForAppUpdate('0.2.0', fake(200, { tag_name: 'v0.2.0', assets }));
  assert(!r.available);
  r = await checkForAppUpdate('0.1.0', fake(404, {}));
  assert(!r.available && r.latest === null);
  r = await checkForAppUpdate('0.1.0', fake(200, { tag_name: 'v0.3.0', prerelease: true }));
  assert(!r.available);
  await assert.rejects(checkForAppUpdate('0.1.0', fake(500, {})), /Status 500/);
  console.log('Alle Tests für die Versionsprüfung bestanden.');
})().catch((e) => { console.error(e); process.exit(1); });
