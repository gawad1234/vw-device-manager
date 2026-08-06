import { app, dialog, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { openDb, getCurrentDbPath } from './db'
import { getDbPath } from './paths'
import type { ProjectInfo } from '../shared/types'

// A project is a plain SQLite database; this friendly extension keeps it
// distinct and lets the VW scripts find it beside the .vwx (Foo.vwx ↔ Foo.vwdm).
const PROJECT_EXT = '.vwdm'
const FILTERS = [{ name: 'VW Device Manager Project', extensions: ['vwdm'] }]
const MAX_RECENT = 12

interface Settings {
  lastProject?: string
  recentProjects?: string[]
}

// Settings live in this machine's userData (NOT the Dropbox folder), so Mac
// absolute paths and Windows absolute paths never collide across machines.
function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Settings
  } catch {
    return {}
  }
}

function writeSettings(s: Settings): void {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch {
    // Settings are a convenience (recent list / reopen) — never fatal.
  }
}

function toInfo(path: string): ProjectInfo {
  return { path, name: basename(path, extname(path)) }
}

function rememberProject(path: string): void {
  const s = readSettings()
  const recent = (s.recentProjects ?? []).filter((p) => p !== path)
  recent.unshift(path)
  writeSettings({ lastProject: path, recentProjects: recent.slice(0, MAX_RECENT) })
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

async function switchTo(path: string): Promise<ProjectInfo> {
  await openDb(path)
  rememberProject(path)
  return toInfo(path)
}

/** Called once at launch to open the startup project. */
export async function openStartupProject(): Promise<ProjectInfo> {
  return switchTo(resolveStartupProject())
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
    filters: [{ name: 'VW Device Manager Project', extensions: ['vwdm', 'sqlite3'] }]
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
