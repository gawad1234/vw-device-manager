import { dialog, shell } from 'electron'
import { existsSync, copyFileSync } from 'fs'
import { basename, extname } from 'path'
import { openDb, getCurrentDbPath } from './db'
import {
  clearProjectOrderKits,
  getProjectMeta,
  listProjectOrderKits,
  setProjectMeta
} from './repository'
import { importOrderKits, listNetworkSignals } from './library'
import { getDbPath } from './paths'
import { readSettings, writeSettings } from './settings'
import { bumpChange } from './rpc-registry'
import type { ProjectInfo } from '../shared/types'

// A project is a plain SQLite database; this friendly extension keeps it
// distinct and lets the VW scripts find it beside the .vwx (Foo.vwx ↔ Foo.vwdm).
const PROJECT_EXT = '.vwdm'
const FILTERS = [{ name: 'Device Manager Project', extensions: ['vwdm'] }]
const MAX_RECENT = 12

/** Default Show Server port — an uncommon high port to dodge collisions. */
export const DEFAULT_SERVER_PORT = 8787

function toInfo(path: string): ProjectInfo {
  return { path, name: basename(path, extname(path)) }
}

function rememberProject(path: string): void {
  const s = readSettings()
  const recent = (s.recentProjects ?? []).filter((p) => p !== path)
  recent.unshift(path)
  // Spread `s` so other prefs (e.g. autoCheckUpdates) survive a project switch.
  writeSettings({ ...s, lastProject: path, recentProjects: recent.slice(0, MAX_RECENT) })
}

/** Whether to check GitHub for updates on launch (per-machine; default true). */
export function getAutoCheckUpdates(): boolean {
  return readSettings().autoCheckUpdates ?? true
}

export function setAutoCheckUpdates(value: boolean): void {
  writeSettings({ ...readSettings(), autoCheckUpdates: value })
}

/** Whether the LAN Show Server should run / auto-start (per-machine; default off). */
export function getShowServerEnabled(): boolean {
  return readSettings().showServerEnabled ?? false
}

export function setShowServerEnabled(value: boolean): void {
  writeSettings({ ...readSettings(), showServerEnabled: value })
}

/** The Show Server's TCP port (per-machine; default DEFAULT_SERVER_PORT). */
export function getShowServerPort(): number {
  const p = readSettings().showServerPort
  return typeof p === 'number' && p >= 1 && p <= 65535 ? p : DEFAULT_SERVER_PORT
}

export function setShowServerPort(port: number): void {
  writeSettings({ ...readSettings(), showServerPort: Math.max(1, Math.min(65535, Math.trunc(port))) })
}

/** Recent projects that still exist on THIS machine (paths differ per OS). */
export function listRecent(): ProjectInfo[] {
  return (readSettings().recentProjects ?? []).filter(existsSync).map(toInfo)
}

export function getCurrentProject(): ProjectInfo | null {
  const p = getCurrentDbPath()
  return p ? toInfo(p) : null
}

/**
 * Path to open at launch: the last project if it still exists on this machine,
 * otherwise the legacy default database (adopts existing data, or creates it on
 * first run). openDb() applies migrations either way.
 */
export function resolveStartupProject(): string {
  const s = readSettings()
  if (s.lastProject && existsSync(s.lastProject)) return s.lastProject
  return getDbPath()
}

/** The Vectorworks scripts can't know where this computer's library lives, so the
 *  project carries a copy of the one list they need. */
export function publishNetworkSignals(): void {
  const value = JSON.stringify(listNetworkSignals())
  if (getProjectMeta('networkSignals') !== value) setProjectMeta('networkSignals', value)
}

async function switchTo(path: string): Promise<ProjectInfo> {
  await openDb(path)
  // One-time carry-over: kits used to live in the project DB; move any into the
  // shared library so they travel across projects from now on.
  // Delete only after the library saved them, so a failed write loses nothing.
  const kits = listProjectOrderKits()
  if (kits.length) {
    importOrderKits(kits)
    clearProjectOrderKits()
  }
  publishNetworkSignals()
  rememberProject(path)
  bumpChange() // joined computers must reload: every row just changed
  return toInfo(path)
}

/** Called once at launch to open the startup project. */
export async function openStartupProject(): Promise<ProjectInfo> {
  const path = resolveStartupProject()
  try {
    return await switchTo(path)
  } catch (e) {
    // A damaged last project must not stop the app from opening at all.
    dialog.showErrorBox('Could not open the last project', `${path}\n\n${(e as Error).message}`)
    if (path === getDbPath()) throw e
    return switchTo(getDbPath())
  }
}

function ensureExt(path: string): string {
  return extname(path).toLowerCase() === PROJECT_EXT ? path : path + PROJECT_EXT
}

export async function newProject(): Promise<ProjectInfo | null> {
  const res = await dialog.showSaveDialog({
    title: 'New Project',
    defaultPath: 'Untitled' + PROJECT_EXT,
    filters: FILTERS
  })
  if (res.canceled || !res.filePath) return null
  // openDb creates a fresh empty DB if the path is new; if the user picked an
  // existing file it opens it (migrations applied) rather than wiping it.
  return switchTo(ensureExt(res.filePath))
}

export async function openProject(): Promise<ProjectInfo | null> {
  const res = await dialog.showOpenDialog({
    title: 'Open Project',
    properties: ['openFile'],
    filters: [{ name: 'Device Manager Project', extensions: ['vwdm', 'sqlite3'] }]
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return switchTo(res.filePaths[0])
}

export async function openProjectPath(path: string): Promise<ProjectInfo | null> {
  if (!existsSync(path)) return null
  return switchTo(path)
}

export async function saveCopyAs(): Promise<ProjectInfo | null> {
  const current = getCurrentDbPath()
  if (!current) return null
  const res = await dialog.showSaveDialog({
    title: 'Save a Copy As',
    defaultPath: (getCurrentProject()?.name ?? 'Project') + ' copy' + PROJECT_EXT,
    filters: FILTERS
  })
  if (res.canceled || !res.filePath) return null
  const path = ensureExt(res.filePath)
  // node:sqlite writes are already durable on disk, so the copy is up to date.
  copyFileSync(current, path)
  return switchTo(path) // continue working on the copy
}

export function revealCurrent(): void {
  const p = getCurrentDbPath()
  if (p) shell.showItemInFolder(p)
}
