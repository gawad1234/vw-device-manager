import { app, shell, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import electronUpdater from 'electron-updater'
import { getAutoCheckUpdates, setAutoCheckUpdates } from './projects'
import type { UpdateStatus } from '../shared/types'

const { autoUpdater } = electronUpdater

// The public repo's Releases page — where the installers live.
const RELEASES_URL = 'https://github.com/gawad1234/vw-device-manager/releases/latest'
const isMac = process.platform === 'darwin'

// electron-updater drives download+install itself; we never auto-download so the
// UI stays in control (the user presses a button). On unsigned macOS we can't
// self-apply, so "download" just opens the Releases page.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

let win: BrowserWindow | null = null
let status: UpdateStatus = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  info: null,
  error: null,
  percent: null,
  canSelfInstall: !isMac
}

/** GitHub's feed gives releaseNotes as an HTML string, or an array of
 *  {version, note} across skipped versions — flatten either to one string. */
function normalizeNotes(notes: unknown): string | null {
  if (!notes) return null
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    const joined = notes
      .map((n) => (typeof n === 'string' ? n : ((n as { note?: string })?.note ?? '')))
      .filter(Boolean)
      .join('\n')
    return joined || null
  }
  return null
}

function emit(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  if (win && !win.isDestroyed()) win.webContents.send('update-status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function getAutoCheck(): boolean {
  return getAutoCheckUpdates()
}

export function setAutoCheck(value: boolean): boolean {
  setAutoCheckUpdates(value)
  return value
}

/** Manually check GitHub for a newer version. Resolves with the latest status;
 *  live transitions also stream to the renderer via 'update-status'. */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (is.dev) {
    emit({ phase: 'error', error: 'Update checks are disabled while running in development.' })
    return status
  }
  emit({ phase: 'checking', error: null, percent: null })
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    emit({ phase: 'error', error: (e as Error)?.message ?? String(e) })
  }
  return status
}

/** Windows: download the update (progress streams, then 'downloaded').
 *  macOS: open the Releases page so the user can grab the new installer. */
export async function downloadUpdate(): Promise<void> {
  if (isMac) {
    await shell.openExternal(RELEASES_URL)
    return
  }
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    emit({ phase: 'error', error: (e as Error)?.message ?? String(e) })
  }
}

/** Windows only: restart and install the downloaded update. */
export function quitAndInstall(): void {
  if (!isMac) autoUpdater.quitAndInstall()
}

/**
 * Wire electron-updater's events to our status model and, if the user hasn't
 * turned it off, kick off a check on launch. The Settings → Updates panel is
 * the UI for all of this.
 */
export function initUpdater(window: BrowserWindow): void {
  win = window
  status = { ...status, currentVersion: app.getVersion(), canSelfInstall: !isMac }
  if (is.dev) return // no packaged app-update.yml in dev

  autoUpdater.on('checking-for-update', () => emit({ phase: 'checking', error: null }))
  autoUpdater.on('update-available', (info) =>
    emit({
      phase: 'available',
      info: {
        version: info.version,
        releaseNotes: normalizeNotes(info.releaseNotes),
        releaseDate: info.releaseDate ?? null
      }
    })
  )
  autoUpdater.on('update-not-available', () => emit({ phase: 'not-available', info: null }))
  autoUpdater.on('download-progress', (p) =>
    emit({ phase: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    emit({
      phase: 'downloaded',
      percent: 100,
      info: {
        version: info.version,
        releaseNotes: normalizeNotes(info.releaseNotes),
        releaseDate: info.releaseDate ?? null
      }
    })
  )
  autoUpdater.on('error', (err) => emit({ phase: 'error', error: err?.message ?? String(err) }))

  if (getAutoCheckUpdates()) {
    autoUpdater
      .checkForUpdates()
      .catch((e) => emit({ phase: 'error', error: (e as Error)?.message ?? String(e) }))
  }
}
