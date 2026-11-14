// SPDX-License-Identifier: GPL-3.0-or-later
// BridgeSFTP – Copyright © 2026 Arne Wolter · ARWEH
'use strict';
// Erkennt den Paketmanager auf dem Server und listet verfügbare Updates –
// ohne root-Rechte und ohne etwas am System zu verändern (nur lesende Abfragen).

const SCRIPT = String.raw`
export LC_ALL=C LANG=C
if [ -r /etc/os-release ]; then . /etc/os-release; [ -n "$PRETTY_NAME" ] || PRETTY_NAME="$NAME"; echo "@@OS $PRETTY_NAME"; fi
echo "@@KERNEL $(uname -r)"
[ -f /var/run/reboot-required ] && echo "@@REBOOT yes"
if command -v apt-get >/dev/null 2>&1; then
  echo "@@PM apt"
  for f in /var/lib/apt/periodic/update-success-stamp /var/lib/apt/lists/partial /var/cache/apt/pkgcache.bin; do
    if [ -e "$f" ]; then echo "@@STAMP $(stat -c %Y "$f" 2>/dev/null)"; break; fi
  done
  if [ -x /usr/lib/update-notifier/apt-check ]; then echo "@@APTCHECK $(/usr/lib/update-notifier/apt-check 2>&1)"; fi
  echo "@@BEGIN"
  apt list --upgradable 2>/dev/null
  echo "@@END"
elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
  PM=dnf; command -v dnf >/dev/null 2>&1 || PM=yum
  echo "@@PM $PM"
  echo "@@BEGIN"
  $PM -q check-update 2>/dev/null
  echo "@@RC $?"
  echo "@@END"
  echo "@@SECBEGIN"
  $PM -q updateinfo list --security 2>/dev/null || $PM -q updateinfo list security 2>/dev/null
  echo "@@SECEND"
elif command -v pacman >/dev/null 2>&1; then
  echo "@@PM pacman"
  echo "@@BEGIN"
  if command -v checkupdates >/dev/null 2>&1; then checkupdates 2>/dev/null; else pacman -Qu 2>/dev/null; fi
  echo "@@END"
elif command -v zypper >/dev/null 2>&1; then
  echo "@@PM zypper"
  echo "@@BEGIN"
  zypper -q --non-interactive --no-refresh list-updates 2>/dev/null
  echo "@@END"
  echo "@@SECBEGIN"
  zypper -q --non-interactive --no-refresh list-patches --category security 2>/dev/null | grep -c '| needed'
  echo "@@SECEND"
elif command -v apk >/dev/null 2>&1; then
  echo "@@PM apk"
  echo "@@BEGIN"
  apk list -u 2>/dev/null || apk version -l '<' 2>/dev/null
  echo "@@END"
else
  echo "@@PM unknown"
fi
`;

// Befehle, die der Benutzer im Terminal ausführen kann (mit sudo, sichtbar).
const UPGRADE_CMDS = {
  apt: 'sudo apt update && sudo apt upgrade',
  dnf: 'sudo dnf upgrade',
  yum: 'sudo yum update',
  pacman: 'sudo pacman -Syu',
  zypper: 'sudo zypper update',
  apk: 'sudo apk upgrade',
};
const REFRESH_CMDS = {
  apt: 'sudo apt update',
  dnf: 'sudo dnf makecache',
  yum: 'sudo yum makecache',
  pacman: 'sudo pacman -Sy',
  zypper: 'sudo zypper refresh',
  apk: 'sudo apk update',
};

function section(out, begin, end) {
  const a = out.indexOf(begin);
  const b = out.indexOf(end, a + 1);
  if (a < 0 || b < 0) return [];
  return out.slice(a + begin.length, b).split('\n').map((l) => l.trim()).filter(Boolean);
}

function tag(out, name) {
  const m = out.match(new RegExp('^@@' + name + ' (.*)$', 'm'));
  return m ? m[1].trim() : null;
}

function parse(out) {
  const pm = tag(out, 'PM') || 'unknown';
  const res = {
    os: tag(out, 'OS'),
    kernel: tag(out, 'KERNEL'),
    rebootRequired: tag(out, 'REBOOT') === 'yes',
    packageManager: pm,
    packages: [],
    securityCount: null,
    listsUpdatedAt: tag(out, 'STAMP') ? Number(tag(out, 'STAMP')) * 1000 : null,
    upgradeCommand: UPGRADE_CMDS[pm] || null,
    refreshCommand: REFRESH_CMDS[pm] || null,
    supported: pm !== 'unknown',
  };
  const lines = section(out, '@@BEGIN', '@@END');

  if (pm === 'apt') {
    // z.B. "openssl/jammy-security 3.0.2-0ubuntu1.15 amd64 [upgradable from: 3.0.2-0ubuntu1.14]"
    for (const l of lines) {
      const m = l.match(/^(\S+?)\/(\S+)\s+(\S+)\s+(\S+)\s+\[upgradable from: ([^\]]+)\]/);
      if (m) res.packages.push({ name: m[1], repo: m[2], newVersion: m[3], oldVersion: m[5], security: /-security/.test(m[2]) });
    }
    const ac = tag(out, 'APTCHECK');
    const am = ac && ac.match(/^(\d+);(\d+)/);
    res.securityCount = am ? Number(am[2]) : res.packages.filter((p) => p.security).length;
  } else if (pm === 'dnf' || pm === 'yum') {
    for (const l of lines) {
      if (/^Obsoleting/i.test(l)) break;
      if (l.startsWith('@@RC') || /^(Last metadata|Security:)/i.test(l)) continue;
      const parts = l.split(/\s+/);
      if (parts.length === 3 && parts[0].includes('.')) {
        const dot = parts[0].lastIndexOf('.');
        res.packages.push({ name: parts[0].slice(0, dot), arch: parts[0].slice(dot + 1), newVersion: parts[1], repo: parts[2] });
      }
    }
    const sec = section(out, '@@SECBEGIN', '@@SECEND');
    const secPkgs = new Set(sec.map((l) => l.split(/\s+/)[2]).filter(Boolean));
    res.packages.forEach((p) => { p.security = [...secPkgs].some((s) => s.startsWith(p.name + '-')); });
    res.securityCount = sec.length ? res.packages.filter((p) => p.security).length : null;
  } else if (pm === 'pacman') {
    // "linux 6.1.1-1 -> 6.1.2-1"
    for (const l of lines) {
      const m = l.match(/^(\S+)\s+(\S+)\s+->\s+(\S+)/);
      if (m) res.packages.push({ name: m[1], oldVersion: m[2], newVersion: m[3] });
    }
  } else if (pm === 'zypper') {
    // "v | Repo | Name | Current | Available | Arch"
    for (const l of lines) {
      const c = l.split('|').map((x) => x.trim());
      if (c.length >= 6 && c[0] === 'v') res.packages.push({ repo: c[1], name: c[2], oldVersion: c[3], newVersion: c[4], arch: c[5] });
    }
    const sec = section(out, '@@SECBEGIN', '@@SECEND');
    res.securityCount = sec.length ? Number(sec[0]) || 0 : null;
  } else if (pm === 'apk') {
    // "musl-1.2.4-r2 x86_64 {musl} (MIT) [upgradable from: musl-1.2.4-r1]"
    for (const l of lines) {
      let m = l.match(/^(\S+)\s+\S+\s+\{[^}]*\}\s+\([^)]*\)\s+\[upgradable from: (\S+)\]/);
      if (m) {
        const nm = m[1].match(/^(.+?)-(\d.*)$/);
        const om = m[2].match(/^(.+?)-(\d.*)$/);
        res.packages.push({ name: nm ? nm[1] : m[1], newVersion: nm ? nm[2] : '', oldVersion: om ? om[2] : m[2] });
        continue;
      }
      m = l.match(/^(\S+?)-(\d\S*)\s+<\s+(\S+)/);
      if (m) res.packages.push({ name: m[1], oldVersion: m[2], newVersion: m[3] });
    }
  }
  res.count = res.packages.length;
  return res;
}

async function checkUpdates(session) {
  const { stdout } = await session.exec('sh -s', { input: SCRIPT, timeout: 180000 });
  const r = parse(stdout);
  r.checkedAt = Date.now();
  return r;
}

module.exports = { checkUpdates, parse };
