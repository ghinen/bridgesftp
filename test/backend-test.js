// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
// Backend-Test gegen einen echten SSH-Server.
// Aufruf: SSH_HOST=127.0.0.1 SSH_PORT=2222 SSH_USER=tester SSH_PASS=... node test/backend-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { SshSession } = require('../src/session');
const { TransferQueue } = require('../src/transfers');
const { checkUpdates } = require('../src/updates');

(async () => {
  const s = new SshSession();
  let seenFp = null;
  await s.connect({ host: process.env.SSH_HOST, port: process.env.SSH_PORT, username: process.env.SSH_USER, password: process.env.SSH_PASS },
    async (fp) => { seenFp = fp; return true; });
  console.log('✓ verbunden, Host-Fingerprint', seenFp);
  const home = await s.realpath('.');
  const list = await s.list(home);
  console.log('✓ Liste', home, list.map((e) => `${e.isDir ? 'd' : '-'} ${e.perms} ${e.name}`).join(', '));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsftp-test-'));
  fs.mkdirSync(path.join(tmp, 'upl/inner'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'upl/inner/big.bin'), Buffer.alloc(3 * 1024 * 1024, 7));
  fs.writeFileSync(path.join(tmp, 'upl/a.txt'), 'abc');

  const q = new TransferQueue(s);
  const done = () => new Promise((r) => q.once('idle', r));
  let p = done();
  await q.upload([path.join(tmp, 'upl')], home);
  await p;
  assert(q.jobs.every((j) => j.status === 'fertig'), JSON.stringify(q.jobs));
  const st = await s.stat(home + '/upl/inner/big.bin');
  assert.strictEqual(st.size, 3 * 1024 * 1024);
  console.log('✓ rekursiver Upload', q.jobs.length, 'Dateien');

  p = done();
  await q.download([home + '/projekt', home + '/upl'], path.join(tmp, 'dl'));
  await p;
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'dl/projekt/sub/a.txt'), 'utf8'), 'x\n');
  assert.strictEqual(fs.statSync(path.join(tmp, 'dl/upl/inner/big.bin')).size, 3 * 1024 * 1024);
  console.log('✓ rekursiver Download');

  q.setPolicy('skip');
  p = done();
  await q.upload([path.join(tmp, 'upl/a.txt')], home + '/upl');
  await p;
  assert.strictEqual(q.jobs[q.jobs.length - 1].status, 'übersprungen');
  console.log('✓ Richtlinie "überspringen"');

  await s.mkdir(home + '/neu');
  await s.rename(home + '/neu', home + '/neu2');
  await s.chmod(home + '/upl/a.txt', 0o600);
  assert.strictEqual((await s.stat(home + '/upl/a.txt')).mode & 0o777, 0o600);
  await s.remove(home + '/upl');
  await s.remove(home + '/neu2');
  assert(!(await s.list(home)).some((e) => e.name === 'upl'));
  console.log('✓ mkdir / rename / chmod / rekursives Löschen');

  let out = '';
  s.on('shell-data', (_id, d) => { out += d; });
  await s.openShell('t1', 80, 24);
  s.writeShell('t1', 'echo BRIDGE_$((6*7))\nexit\n');
  await new Promise((r) => s.once('shell-exit', r));
  assert(out.includes('BRIDGE_42'));
  console.log('✓ interaktive Shell');

  const u = await checkUpdates(s);
  console.log('✓ Update-Prüfung:', JSON.stringify({ os: u.os, pm: u.packageManager, count: u.count, security: u.securityCount, reboot: u.rebootRequired, beispiel: u.packages.slice(0, 3) }));
  assert(u.supported);

  s.disconnect();
  fs.rmSync(tmp, { recursive: true });
  console.log('\nAlle Backend-Tests bestanden.');
})().catch((e) => { console.error('FEHLER:', e); process.exit(1); });
