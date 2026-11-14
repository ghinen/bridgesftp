// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright © 2026 Arne Wolter · ARWEH
'use strict';
// Prüft, ob auf GitHub eine neuere BridgeSFTP-Version veröffentlicht wurde.
// Übertragen wird nur die eigene Versionsnummer im User-Agent – keine
// persönlichen Daten, keine Server- oder Verbindungsinformationen.

const REPO = 'ghinen/bridgesftp';
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
// Nur für Tests: alternative Adresse für die Abfrage
const API_URL = process.env.BRIDGESFTP_UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;

/** "v1.2.3" / "1.2.3-beta.1" → { nums: [1,2,3], pre: 'beta.1' } */
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)], pre: m[4] || '' };
}

/** >0 wenn a neuer als b, <0 wenn älter, 0 bei Gleichheit. Vorabversionen sind älter als die finale Version. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre, 'en', { numeric: true });
}

/** Passende Download-Datei für dieses Betriebssystem aus dem Release wählen. */
function pickAsset(assets, platform) {
  const list = assets || [];
  const by = (re) => list.find((a) => re.test(a.name));
  let a = null;
  if (platform === 'win32') a = by(/setup.*\.exe$/i) || by(/\.exe$/i);
  else if (platform === 'darwin') a = by(/\.dmg$/i);
  else a = by(/\.AppImage$/i);
  return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null;
}

/**
 * @param {string} currentVersion
 * @param {(url:string, opts:object)=>Promise<Response>} fetchFn  z. B. Electron net.fetch
 */
async function checkForAppUpdate(currentVersion, fetchFn, platform = process.platform) {
  const res = await fetchFn(API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `BridgeSFTP/${currentVersion}` },
  });
  if (res.status === 404) {
    // Noch kein Release veröffentlicht
    return { available: false, current: currentVersion, latest: null, releasesPage: RELEASES_PAGE };
  }
  if (!res.ok) throw new Error(`GitHub antwortete mit Status ${res.status}`);
  const rel = await res.json();
  if (rel.draft || rel.prerelease) return { available: false, current: currentVersion, latest: null, releasesPage: RELEASES_PAGE };
  const latest = String(rel.tag_name || '').replace(/^v/i, '');
  return {
    available: compareVersions(latest, currentVersion) > 0,
    current: currentVersion,
    latest,
    name: rel.name || `BridgeSFTP ${latest}`,
    notes: String(rel.body || '').slice(0, 4000),
    publishedAt: rel.published_at || null,
    url: rel.html_url || RELEASES_PAGE,
    asset: pickAsset(rel.assets, platform),
    releasesPage: RELEASES_PAGE,
  };
}

module.exports = { checkForAppUpdate, compareVersions, parseVersion, pickAsset, REPO, RELEASES_PAGE };
