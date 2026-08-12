import { dialog, shell, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

// The public repo's Releases page — where the installers live.
const RELEASES_URL = 'https://github.com/gawad1234/vw-device-manager/releases/latest'

/**
 * Check GitHub Releases for a newer version on startup.
 * - Windows: download + prompt to restart & install (Squirrel handles it).
 * - macOS: the app is unsigned, so it can't self-apply an update — we just
 *   notify and open the download page. (Signing would enable auto-install.)
 */
export function initUpdater(win: BrowserWindow): void {
  if (is.dev) return // no packaged app-update.yml in dev

  const isMac = process.platform === 'darwin'
  autoUpdater.autoDownload = !isMac
  autoUpdater.autoInstallOnAppQuit = !isMac

  autoUpdater.on('update-available', async (info) => {
    if (!isMac) return // Windows: autoDownload runs; 'update-downloaded' will prompt
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update available',
      message: `Version ${info.version} is available.`,
      detail:
        'A newer version is on GitHub. Automatic install needs code signing on macOS, so grab it manually for now.',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 0) shell.openExternal(RELEASES_URL)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart now to install it?',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })

  autoUpdater.on('error', (err) => {
    console.error('updater error:', err?.message ?? err)
  })

  autoUpdater.checkForUpdates().catch((e) => console.error('checkForUpdates failed:', e?.message))
}
