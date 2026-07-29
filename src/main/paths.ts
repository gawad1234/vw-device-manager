import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'

/**
 * In dev the DB lives inside the project folder (this Dropbox-synced
 * directory), so it syncs between machines automatically. Packaged builds
 * fall back to the OS user-data folder until a "choose data folder" setting
 * is added.
 */
export function getDbPath(): string {
  if (is.dev) {
    return join(process.cwd(), 'data', 'vw-device-manager.sqlite3')
  }
  return join(app.getPath('userData'), 'vw-device-manager.sqlite3')
}
