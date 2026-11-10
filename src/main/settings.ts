import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
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
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Settings
  } catch {
    return {}
  }
}

export function writeSettings(s: Settings): void {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch {
    // Settings are a convenience (recent list / reopen) — never fatal.
  }
}
