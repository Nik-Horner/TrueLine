const semver = require('semver');

const RELEASES_URL = 'https://github.com/Nik-Horner/TrueLine/releases/latest';
const API_URL = 'https://api.github.com/repos/Nik-Horner/TrueLine/releases/latest';

async function latestUpdate(fetch, currentVersion) {
  const current = semver.valid(currentVersion);
  if (!current) return null;
  const response = await fetch(API_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const release = await response.json();
  const latest = typeof release?.tag_name === 'string' ? semver.valid(release.tag_name) : null;
  if (!latest || release.draft || release.prerelease || semver.prerelease(latest)) return null;
  return semver.gt(latest, current) ? latest : null;
}

async function offerUpdate(win, version, currentVersion, updater, dialog, shell, platform = process.platform, nativeUpdater = null) {
  const choice = await dialog.showMessageBox(win, {
    type: 'info', title: 'TrueLine update available',
    message: `TrueLine ${version} is available.`,
    detail: `You are using version ${currentVersion}.`,
    buttons: ['Update', 'Later'], defaultId: 0, cancelId: 1,
  });
  if (choice.response !== 0 || win.isDestroyed()) return;
  const progress = info => { if (!win.isDestroyed() && Number.isFinite(info?.percent)) win.setProgressBar(Math.max(0, Math.min(1, info.percent / 100))); };
  let nativeReady, nativeSuccess, nativeFailure, nativeTimer;
  try {
    if (!updater) throw new Error('Automatic updates unavailable');
    win.setProgressBar(2);
    updater.on('download-progress', progress);
    const update = await updater.checkForUpdates();
    const feedVersion = semver.valid(update?.updateInfo?.version || '');
    if (!feedVersion || !semver.eq(feedVersion, version)) throw new Error('Release update metadata unavailable');
    if (platform === 'darwin') {
      if (!nativeUpdater) throw new Error('macOS updater unavailable');
      // The file download can finish before Squirrel verifies and stages it.
      nativeReady = new Promise(resolve => {
        nativeSuccess = () => resolve(true);
        nativeFailure = () => resolve(false);
        nativeUpdater.once('update-downloaded', nativeSuccess);
        nativeUpdater.once('error', nativeFailure);
      });
    }
    await updater.downloadUpdate();
    if (nativeReady) {
      const ready = await Promise.race([nativeReady, new Promise(resolve => { nativeTimer = setTimeout(() => resolve(false), 60000); })]);
      if (!ready) throw new Error('macOS could not stage the update');
    }
  } catch {
    if (!win.isDestroyed()) {
      const fallback = await dialog.showMessageBox(win, {
        type: 'warning', title: 'Automatic update unavailable',
        message: 'TrueLine could not update automatically.',
        detail: 'The release page has the available installers for this version.',
        buttons: ['View release', 'Later'], defaultId: 0, cancelId: 1,
      });
      if (fallback.response === 0) await shell.openExternal(RELEASES_URL);
    }
    return;
  } finally {
    clearTimeout(nativeTimer);
    if (nativeUpdater && nativeSuccess) {
      nativeUpdater.removeListener('update-downloaded', nativeSuccess);
      nativeUpdater.removeListener('error', nativeFailure);
    }
    updater?.removeListener('download-progress', progress);
    if (!win.isDestroyed()) win.setProgressBar(-1);
  }
  if (win.isDestroyed()) return;
  const ready = await dialog.showMessageBox(win, {
    type: 'info', title: 'Update ready',
    message: 'The update is ready to install.',
    detail: 'Save your work, then restart TrueLine to finish updating. The update will also install when you quit.',
    buttons: ['Restart and update', 'Later'], defaultId: 0, cancelId: 1,
  });
  if (ready.response === 0 && !win.isDestroyed()) {
    const restart = () => { win.removeListener('trueline:update-cancelled', cancel); updater.quitAndInstall(); };
    const cancel = () => { win.removeListener('closed', restart); };
    win.once('closed', restart);
    win.once('trueline:update-cancelled', cancel);
    win.close();
  }
}

module.exports = { latestUpdate, offerUpdate, RELEASES_URL };
