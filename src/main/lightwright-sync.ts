import { BrowserWindow, dialog } from 'electron'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname, join, parse as parsePath } from 'path'
import {
  buildExchange,
  fixtureFromExchange,
  fixtureToExchange,
  parseExchange,
  type Exchange
} from '../shared/lw-exchange'
import type { LightingSyncStatus } from '../shared/types'
import { getCurrentProject } from './projects'
import { isJoined } from './remote'
import {
  deleteFixture,
  getLightingSettings,
  getProjectMeta,
  listFixtures,
  saveFixture,
  setLightingSettings,
  setProjectMeta
} from './repository'
import { bumpChange } from './rpc-registry'
import { withTx } from './db'

// Live sync with Vectorworks Spotlight through its Lightwright exchange file: we
// read what Vectorworks writes and answer as Lightwright. The file is one shared
// mailbox, so always read it before writing — writing over an unread Vectorworks
// change loses it. Runs only on the computer that has the show open.

/** What Vectorworks last told us about the drawing, echoed back when we write. */
type VwBase = Pick<Exchange, 'fieldList' | 'header' | 'universeBlock' | 'universes'>

let win: BrowserWindow | null = null
let project = ''
let lastMtime = 0
let dirty = false
/** Fixtures edited here and not yet in the exchange file. Saved with the project so
 *  they survive a restart, and a file from Vectorworks can't overwrite them. */
let unsent = new Set<number>()
let writeTimer: ReturnType<typeof setTimeout> | null = null
const status: LightingSyncStatus = {
  path: '',
  found: false,
  syncOn: false,
  lastIn: null,
  lastOut: null,
  waitingForVw: false,
  error: null
}

export function setLightingWindow(w: BrowserWindow): void {
  win = w
}

function emit(): void {
  if (win && !win.isDestroyed()) win.webContents.send('lighting-sync-status', { ...status })
}

/** The chosen exchange file, else the .xml named after the open show (Foo.vwdm → Foo.xml). */
function exchangePath(): string {
  // The choice travels with the project but only means something if it's a local
  // .xml here: not on another computer, and never a network path from a project
  // file (just looking one up on Windows sends that server your login).
  const chosen = getLightingSettings().exchangePath
  if (chosen && /\.xml$/i.test(chosen) && !/^[\\/]{2}/.test(chosen) && existsSync(chosen)) {
    return chosen
  }
  const p = getCurrentProject()?.path
  return p ? join(dirname(p), parsePath(p).name + '.xml') : ''
}

function loadUnsent(): Set<number> {
  try {
    return new Set(JSON.parse(getProjectMeta('lightingUnsent') ?? '[]'))
  } catch {
    return new Set()
  }
}

function saveUnsent(): void {
  setProjectMeta('lightingUnsent', JSON.stringify([...unsent]))
}

function loadBase(): VwBase | null {
  try {
    return JSON.parse(getProjectMeta('lightingVw') ?? 'null')
  } catch {
    return null
  }
}

function ingest(x: Exchange): void {
  const prevBase = loadBase()
  const base: VwBase = {
    fieldList: x.fieldList,
    header: x.header,
    // only a full export carries the universe table
    universeBlock: x.universeBlock || prevBase?.universeBlock || '',
    universes: x.universeBlock ? x.universes : (prevBase?.universes ?? {})
  }
  setProjectMeta('lightingVw', JSON.stringify(base))

  const rows = listFixtures()
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  const byUid = new Map(rows.filter((r) => r.vwUid).map((r) => [r.vwUid, r]))
  const uidsInFile = new Set(x.fixtures.map((f) => f.UID))
  const kept = new Set<number>()
  let needIds = false
  const entirePlot = x.action === 'Entire Plot'
  withTx(() => {
    for (const f of x.fixtures) {
      // UID first; trust a Lightwright_ID only if it isn't another fixture's row (old
      // ids from a real Lightwright can collide with ours). A partial file lists only
      // what changed, so there a row owned by any other UID is off limits too: a
      // copied fixture carries the original's id.
      const idRow = byId.get(f.Lightwright_ID ?? '')
      const idFree = idRow && (entirePlot ? !uidsInFile.has(idRow.vwUid) : !idRow.vwUid)
      const prev = byUid.get(f.UID ?? '') ?? (idFree ? idRow : undefined)
      if (f.Action === 'Delete') {
        if (prev) deleteFixture(prev.id)
        continue
      }
      // Edited here and not sent yet: the app's copy wins, and goes out next.
      if (prev && unsent.has(prev.id)) {
        kept.add(prev.id)
        continue
      }
      const saved = saveFixture(prev?.id ?? null, fixtureFromExchange(f, base.universes, prev))
      kept.add(saved.id)
      if (String(saved.id) !== f.Lightwright_ID) needIds = true
    }
    if (entirePlot) {
      // the drawing owns which fixtures exist
      for (const r of rows) if (r.vwUid && !kept.has(r.id)) deleteFixture(r.id)
    }
  })
  status.lastIn = new Date().toISOString()
  bumpChange()
  if (win && !win.isDestroyed()) win.webContents.send('data-changed')
  if (needIds) markLightingDirty() // so Vectorworks learns our ids
}

/** Read the file if it changed; ingest it when Vectorworks wrote it. */
function readIfChanged(path: string): void {
  const m = statSync(path).mtimeMs
  if (m === lastMtime) return
  const text = readFileSync(path, 'utf8')
  if (!text.includes('</SLData>')) return // still being written; look again next tick
  const x = parseExchange(text)
  status.waitingForVw = x.appStamp === 'Lightwright'
  if (!status.waitingForVw && x.fixtures.length) ingest(x)
  lastMtime = m // last, so a failed read or a locked database is tried again
}

function writeNow(path: string): void {
  readIfChanged(path) // never write over a Vectorworks change we haven't read
  if (statSync(path).mtimeMs !== lastMtime) return // not fully read yet
  if (status.waitingForVw) return // our last write isn't picked up yet; try again next tick
  const base = loadBase()
  if (!base) {
    status.error = 'Open the drawing in Vectorworks so it writes the exchange file first.'
    return
  }
  // shortcut: writes the whole rig each time (the tested shape); send only changed fixtures once that's tested against Vectorworks
  const fixtures = listFixtures()
    .filter((f) => f.vwUid)
    .map((f) => fixtureToExchange(f, base.universes))
  const tmp = path + '.tmp'
  writeFileSync(tmp, buildExchange(fixtures, base, new Date()))
  renameSync(tmp, path) // whole file at once, so Vectorworks never reads half of it
  lastMtime = statSync(path).mtimeMs
  dirty = false
  unsent.clear()
  saveUnsent()
  status.waitingForVw = true
  status.lastOut = new Date().toISOString()
}

function tick(): void {
  const settings = getLightingSettings()
  const p = getCurrentProject()?.path ?? ''
  if (p !== project) {
    project = p
    lastMtime = 0
    unsent = p ? loadUnsent() : new Set()
    dirty = unsent.size > 0
  }
  const path = exchangePath()
  status.syncOn = settings.syncOn
  status.path = path
  status.found = !!path && existsSync(path)
  if (!settings.syncOn || !status.found || isJoined()) return emit()
  try {
    status.error = null
    readIfChanged(path)
    if (dirty) writeNow(path)
  } catch (e) {
    status.error = (e as Error).message
  }
  emit()
}

/** Fixtures changed in the app: send them to Vectorworks after a moment of quiet. */
export function markLightingDirty(fixtureId?: number): void {
  dirty = true
  if (fixtureId != null) {
    unsent.add(fixtureId)
    saveUnsent()
  }
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(tick, 1000)
}

export function startLightingSync(): void {
  setInterval(() => {
    try {
      tick()
    } catch {
      /* db not ready or mid project-switch */
    }
  }, 1500)
}

export function getLightingSyncStatus(): LightingSyncStatus {
  return { ...status }
}

export function setLightingSync(on: boolean): LightingSyncStatus {
  setLightingSettings({ ...getLightingSettings(), syncOn: on })
  lastMtime = 0 // read the file fresh when turned on
  tick()
  return getLightingSyncStatus()
}

export async function chooseExchangeFile(): Promise<LightingSyncStatus> {
  const res = await dialog.showOpenDialog({
    title: 'Choose the Vectorworks exchange file',
    properties: ['openFile'],
    filters: [{ name: 'Lightwright exchange (.xml)', extensions: ['xml'] }]
  })
  if (!res.canceled && res.filePaths[0]) {
    setLightingSettings({ ...getLightingSettings(), exchangePath: res.filePaths[0] })
    lastMtime = 0
    tick()
  }
  return getLightingSyncStatus()
}
