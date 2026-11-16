import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface Settings {
  lastProject?: string
  recentProjects?: string[]
  /** check GitHub for a newer version on launch (default true) */
  autoCheckUpdates?: boolean
  /** run the LAN "Show Server" (auto-start on launch); per-machine */
  showServerEnabled?: boolean
  /** TCP port for the Show Server (per-machine) */
  showServerPort?: number
  /** folder holding the shared library.json (per-machine: paths differ per OS) */
  libraryFolder?: string
  /** switch logins stay on each computer: the library can sync through Dropbox */
  switchAdminPassword?: string
  snmpCommunity?: string
  /** VectorLabel's watch folder (has Exports/ inside), per-machine; unset = ~/Documents/VectorLabel */
  vectorLabelFolder?: string
}

// Settings live in this machine's userData (NOT the Dropbox folder), so Mac
// absolute paths and Windows absolute paths never collide across machines.
function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function readSettings(): Settings {
  let text: string
  try {
    text = readFileSync(settingsPath(), 'utf-8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw e
  }
  try {
    return JSON.parse(text) as Settings
  } catch (e) {
    // Unreadable: set it aside (never save over it) and start fresh so the app still opens.
    const aside = `${settingsPath()}.unreadable-${Date.now()}`
    console.error(`settings.json is unreadable (${(e as Error).message}); moved to ${aside}`)
    renameSync(settingsPath(), aside)
    return {}
  }
}

export function writeSettings(s: Settings): void {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true })
    // temp file + rename: a crash mid-write can't leave a half-written settings.json
    const tmp = `${settingsPath()}.tmp`
    writeFileSync(tmp, JSON.stringify(s, null, 2))
    renameSync(tmp, settingsPath())
  } catch {
    // Settings are a convenience (recent list / reopen) — never fatal.
  }
}
