import { app, dialog } from 'electron'
import { is } from '@electron-toolkit/utils'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { readCatalogsFromFile } from './db'
import { getDbPath } from './paths'
import { getProjectMeta, setProjectMeta } from './repository'
import { readSettings, writeSettings } from './settings'
import { DEFAULT_SWITCH_BASE_CONFIG } from './switch-config'
import type {
  CableType,
  CableTypeInput,
  CrewMember,
  CrewMemberInput,
  OrderKit,
  OrderKitInput,
  SoftwarePackage,
  StickerDesign,
  StickerDesignInput,
  StickerSheet,
  StickerSheetInput,
  SoftwarePackageInput,
  SwitchConfigSettings,
  FixtureType,
  LibraryLocation,
  SwitchMonitoring
} from '../shared/types'
import { DOC_TEMPLATES, withBuiltIns, type PaperworkTemplate } from '../shared/paperwork'
import { normalizeTableStyle, type TableStyle } from '../shared/table-style'
import { normalizeHeader, type PaperworkHeader } from '../shared/paperwork-header'

const LIBRARY_FILE = 'library.json'

/** Set when the chosen shared folder can't be reached, for this run only, so the
 *  app still works on this machine's own copy. */
let sharedFolderMissing = false

/** This machine's own library (where it lives until a shared folder is chosen). */
function localLibraryPath(): string {
  if (is.dev) return join(process.cwd(), 'data', LIBRARY_FILE)
  return join(app.getPath('userData'), LIBRARY_FILE)
}

/**
 * The universal library (crew, kits, cable types, templates...) is one JSON file
 * shared across ALL projects, NOT stored per project. To share it between
 * machines, each machine points at the same synced folder in Settings; that
 * choice is per-machine because the path differs on Mac and Windows.
 */
function libraryPath(): string {
  const folder = readSettings().libraryFolder
  if (folder && !sharedFolderMissing) return join(folder, LIBRARY_FILE)
  return localLibraryPath()
}

interface Library {
  networkSignals: string[]
  cableTypes: CableType[]
  deviceCategories: string[]
  /** Auto-add kits — shared across all projects, like the catalogs above. */
  orderKits: OrderKit[]
  /** Your company's letterhead, stamped on every project's paperwork. */
  companyName: string
  companyLogo: string | null
  /** Switch-config generator settings (base template + admin user), shared. */
  switchConfig: StoredSwitchConfig
  /** Windows installers for per-computer install kits, shared like kits. */
  software: SoftwarePackage[]
  /** Crew directory (names, contacts, default rates). library.json is never in
   *  the repo (data/ is gitignored), so this doesn't reach GitHub. */
  crew: CrewMember[]
  /** Cable loom sticker sheet types + designs. */
  stickerSheets: StickerSheet[]
  stickerDesigns: StickerDesign[]
  /** Lighting fixture types with their DMX modes + footprints. */
  fixtureTypes: FixtureType[]
  /** Paperwork templates (every export's layout + the user's own); null = never saved. */
  paperwork: PaperworkTemplate[] | null
  /** v2.9.0's lighting-only templates, read once to carry them into `paperwork`. */
  lightingReports?: Omit<PaperworkTemplate, 'source' | 'mergeRepeats'>[] | null
  /** How exported tables look (Excel + PDF); null = the default look. */
  tableStyle: TableStyle | null
  /** The header on every PDF (what goes left/center/right); null = the default look. */
  paperworkHeader?: PaperworkHeader | null
  /** Next id per list, so a deleted row's id is never handed to someone new:
   *  projects keep these ids (crew bookings, a computer's software). */
  nextIds?: Partial<Record<IdList, number>>
}

type IdList = 'crew' | 'software' | 'orderKits' | 'stickerSheets' | 'stickerDesigns'

/** What the library itself stores for switches. The password and everything under
 *  monitoring are added on read: see getSwitchConfig. */
type StoredSwitchConfig = Pick<SwitchConfigSettings, 'baseTemplate' | 'adminUser'> & {
  /** only in older libraries: moved to this computer's settings at launch */
  adminPassword?: string
}

function defaultSwitchConfig(): StoredSwitchConfig {
  return { baseTemplate: DEFAULT_SWITCH_BASE_CONFIG, adminUser: 'admin' }
}

function emptyLibrary(): Library {
  return {
    networkSignals: [],
    cableTypes: [],
    deviceCategories: [],
    orderKits: [],
    companyName: '',
    companyLogo: null,
    switchConfig: defaultSwitchConfig(),
    software: [],
    crew: [],
    stickerSheets: [],
    stickerDesigns: [],
    fixtureTypes: [],
    paperwork: null,
    tableStyle: null
  }
}

function parseLibrary(path: string): Partial<Library> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Partial<Library>
}

/** The file, or the copy kept by the last save if the file itself is damaged.
 *  Any other failure throws: treating it as empty would save over the library. */
function loadRaw(): Partial<Library> {
  const path = libraryPath()
  try {
    return parseLibrary(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    try {
      return parseLibrary(path + '.bak')
    } catch {
      throw new Error(
        `The shared library at ${path} can't be read, so nothing was changed. ` +
          `Restore it from Dropbox's version history, or fix the file. (${(e as Error).message})`
      )
    }
  }
}

function readLibrary(): Library {
  const raw = loadRaw()
  return {
    // First, so fields from a newer app version survive a save by this one.
    ...raw,
    networkSignals: raw.networkSignals ?? [],
    cableTypes: raw.cableTypes ?? [],
    deviceCategories: raw.deviceCategories ?? [],
    orderKits: raw.orderKits ?? [],
    companyName: raw.companyName ?? '',
    companyLogo: raw.companyLogo ?? null,
    switchConfig: { ...defaultSwitchConfig(), ...(raw.switchConfig ?? {}) },
    software: raw.software ?? [],
    crew: raw.crew ?? [],
    stickerSheets: raw.stickerSheets ?? [],
    stickerDesigns: raw.stickerDesigns ?? [],
    fixtureTypes: raw.fixtureTypes ?? [],
    paperwork: raw.paperwork ?? null,
    lightingReports: raw.lightingReports,
    tableStyle: raw.tableStyle ?? null,
    paperworkHeader: raw.paperworkHeader ?? null
  }
}

/** Windows and Dropbox can hold a file for a moment; a short retry rides that out. */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      return renameSync(from, to)
    } catch (e) {
      if (attempt === 10) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
}

/** Temp file then rename, so a crash can't leave a half-written library. */
function writeLibrary(lib: Library): void {
  const path = libraryPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(lib, null, 2))
  if (existsSync(path)) {
    try {
      parseLibrary(path)
      copyFileSync(path, path + '.bak')
    } catch {
      // Keep the last good .bak rather than backing up a damaged file.
    }
  }
  renameWithRetry(tmp, path)
}

function newId(lib: Library, list: IdList, rows: { id: number }[]): number {
  const max = rows.reduce((m, r) => Math.max(m, r.id), 0)
  const id = Math.max(lib.nextIds?.[list] ?? 1, max + 1)
  lib.nextIds = { ...lib.nextIds, [list]: id + 1 }
  return id
}

/** Remember a deleted id so it can't be reused; older libraries have no counter. */
function retireId(lib: Library, list: IdList, id: number): void {
  lib.nextIds = { ...lib.nextIds, [list]: Math.max(lib.nextIds?.[list] ?? 1, id + 1) }
}

/**
 * Create the shared library on first run, seeding it from the **pre-split legacy
 * database** (the single DB used before per-project files) so the catalogs the
 * user already built are carried over — regardless of which project happens to
 * be open. Defaults to a single 'LAN' signal if there's nothing to seed (fresh
 * install with no legacy DB).
 */
export async function ensureLibrary(): Promise<void> {
  const folder = readSettings().libraryFolder
  if (folder && !existsSync(join(folder, LIBRARY_FILE))) {
    // Never start an empty library in the shared folder: it would sync over the
    // real one if Dropbox simply hasn't arrived yet.
    sharedFolderMissing = true
    dialog.showMessageBoxSync({
      type: 'warning',
      message: 'Shared library not found',
      detail: `Nothing was found at ${folder}. Device Manager will use this computer's own library until the folder is back. Restart once it syncs.`
    })
  }
  if (existsSync(libraryPath())) {
    moveAdminPasswordOffLibrary()
    return
  }
  const seed = await readCatalogsFromFile(getDbPath())
  writeLibrary({
    ...emptyLibrary(),
    networkSignals: seed.networkSignals.length ? seed.networkSignals : ['LAN'],
    cableTypes: seed.cableTypes
  })
}

export function getLibraryLocation(): LibraryLocation {
  return {
    path: libraryPath(),
    shared: !!readSettings().libraryFolder && !sharedFolderMissing,
    missing: sharedFolderMissing
  }
}

/** Point this machine at a shared folder. If the folder is empty the current
 *  library moves in; if it already holds one, this machine adopts it and keeps
 *  its old library as library.before-sharing.json in the local folder. */
export async function chooseLibraryFolder(): Promise<LibraryLocation | null> {
  const res = await dialog.showOpenDialog({
    title: 'Choose a shared folder for the library',
    message: 'Pick a folder that syncs between your computers, such as one in Dropbox.',
    properties: ['openDirectory', 'createDirectory']
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const folder = res.filePaths[0]
  const target = join(folder, LIBRARY_FILE)
  const current = libraryPath()
  if (target === current) return getLibraryLocation()
  if (existsSync(target)) {
    const lib = parseLibrary(target) // throws, changing nothing, if it isn't a library
    const answer = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Use the library in that folder', 'Cancel'],
      cancelId: 1,
      defaultId: 1,
      message: 'That folder already has a library',
      detail: `It holds ${lib.crew?.length ?? 0} crew and ${lib.orderKits?.length ?? 0} kits. This computer will use it from now on. Its current library is kept as a backup, not merged.`
    })
    if (answer.response !== 0) return null
    if (existsSync(current)) {
      copyFileSync(current, join(dirname(localLibraryPath()), 'library.before-sharing.json'))
    }
  } else {
    const lib = readLibrary()
    mkdirSync(folder, { recursive: true })
    writeFileSync(target, JSON.stringify(lib, null, 2))
  }
  sharedFolderMissing = false
  writeSettings({ ...readSettings(), libraryFolder: folder })
  return getLibraryLocation()
}

/** Stop sharing: this machine keeps a copy of the shared library as its own. */
export function useLocalLibrary(): LibraryLocation {
  const lib = readLibrary()
  writeSettings({ ...readSettings(), libraryFolder: undefined })
  sharedFolderMissing = false
  writeLibrary(lib)
  return getLibraryLocation()
}

// ---- Switch-config generator settings (shared) --------------------------

const MONITORING_META = 'switchMonitoring'

export function getSwitchConfig(): SwitchConfigSettings {
  const { baseTemplate, adminUser, adminPassword } = readLibrary().switchConfig
  const settings = readSettings()
  let show: Partial<SwitchMonitoring> = {}
  try {
    show = JSON.parse(getProjectMeta(MONITORING_META) ?? '{}')
  } catch {
    // a damaged value just means the fields start blank
  }
  return {
    baseTemplate,
    adminUser,
    adminPassword: settings.switchAdminPassword ?? adminPassword ?? '',
    monitoring: {
      logServers: show.logServers ?? '',
      syslogPort: show.syslogPort ?? 514,
      m4300Snmp: show.m4300Snmp ?? false,
      poeAlerts: show.poeAlerts ?? false,
      snmpCommunity: settings.snmpCommunity ?? ''
    }
  }
}

export function setSwitchConfig(input: SwitchConfigSettings): void {
  const lib = readLibrary()
  lib.switchConfig = {
    baseTemplate: input.baseTemplate,
    adminUser: (input.adminUser ?? '').trim() || 'admin'
  }
  writeLibrary(lib)
  const { snmpCommunity, ...show } = input.monitoring
  writeSettings({
    ...readSettings(),
    switchAdminPassword: input.adminPassword ?? '',
    snmpCommunity: (snmpCommunity ?? '').trim()
  })
  setProjectMeta(MONITORING_META, JSON.stringify(show))
}

/** Older libraries hold the admin password. Move it to this computer's settings, and
 *  save twice so the .bak copy of the old file goes too. */
function moveAdminPasswordOffLibrary(): void {
  const lib = readLibrary()
  const { adminPassword } = lib.switchConfig
  if (adminPassword === undefined) return
  if (adminPassword && !readSettings().switchAdminPassword) {
    writeSettings({ ...readSettings(), switchAdminPassword: adminPassword })
  }
  delete lib.switchConfig.adminPassword
  writeLibrary(lib)
  writeLibrary(lib)
}

// ---- Company branding (shared letterhead) -------------------------------

export function getCompanyName(): string | null {
  return readLibrary().companyName || null
}

export function setCompanyName(name: string | null): void {
  const lib = readLibrary()
  lib.companyName = (name ?? '').trim()
  writeLibrary(lib)
}

export function getCompanyLogo(): string | null {
  return readLibrary().companyLogo
}

export function setCompanyLogo(dataUrl: string | null): void {
  const lib = readLibrary()
  lib.companyLogo = dataUrl
  writeLibrary(lib)
}

// ---- Network signals ----------------------------------------------------

export function listNetworkSignals(): string[] {
  return readLibrary().networkSignals
}

export function addNetworkSignal(signal: string): string[] {
  const s = signal.trim()
  if (!s) return listNetworkSignals()
  const lib = readLibrary()
  if (!lib.networkSignals.some((x) => x.toLowerCase() === s.toLowerCase())) {
    lib.networkSignals.push(s)
    lib.networkSignals.sort((a, b) => a.localeCompare(b))
    writeLibrary(lib)
  }
  return lib.networkSignals
}

export function removeNetworkSignal(signal: string): string[] {
  const lib = readLibrary()
  lib.networkSignals = lib.networkSignals.filter((x) => x !== signal)
  writeLibrary(lib)
  return lib.networkSignals
}

// ---- Cable types --------------------------------------------------------

export function listCableTypes(): CableType[] {
  return readLibrary().cableTypes
}

export function addCableType(input: CableTypeInput): CableType[] {
  const name = input.name.trim()
  if (!name) return listCableTypes()
  const lib = readLibrary()
  if (lib.cableTypes.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A cable type named "${name}" already exists.`)
  }
  lib.cableTypes.push({ name, notes: input.notes?.trim() || null })
  lib.cableTypes.sort((a, b) => a.name.localeCompare(b.name))
  writeLibrary(lib)
  return lib.cableTypes
}

export function removeCableType(name: string): CableType[] {
  const lib = readLibrary()
  lib.cableTypes = lib.cableTypes.filter((t) => t.name !== name)
  writeLibrary(lib)
  return lib.cableTypes
}

// ---- Device categories --------------------------------------------------

export function listDeviceCategories(): string[] {
  return readLibrary().deviceCategories
}

export function addDeviceCategory(name: string): string[] {
  const c = name.trim()
  if (!c) return listDeviceCategories()
  const lib = readLibrary()
  if (!lib.deviceCategories.some((x) => x.toLowerCase() === c.toLowerCase())) {
    lib.deviceCategories.push(c)
    lib.deviceCategories.sort((a, b) => a.localeCompare(b))
    writeLibrary(lib)
  }
  return lib.deviceCategories
}

export function removeDeviceCategory(name: string): string[] {
  const lib = readLibrary()
  lib.deviceCategories = lib.deviceCategories.filter((x) => x !== name)
  writeLibrary(lib)
  return lib.deviceCategories
}

// ---- Auto-add kits (shared) ---------------------------------------------

export function listOrderKits(): OrderKit[] {
  return readLibrary().orderKits
}

export function createOrderKit(input: OrderKitInput): OrderKit {
  const lib = readLibrary()
  const now = new Date().toISOString()
  const kit: OrderKit = {
    id: newId(lib, 'orderKits', lib.orderKits),
    trigger: input.trigger,
    addons: input.addons,
    createdAt: now,
    updatedAt: now
  }
  lib.orderKits.push(kit)
  lib.orderKits.sort((a, b) => a.trigger.localeCompare(b.trigger))
  writeLibrary(lib)
  return kit
}

export function updateOrderKit(id: number, input: OrderKitInput): OrderKit {
  const lib = readLibrary()
  const kit = lib.orderKits.find((k) => k.id === id)
  if (!kit) throw new Error(`Kit ${id} not found.`)
  kit.trigger = input.trigger
  kit.addons = input.addons
  kit.updatedAt = new Date().toISOString()
  lib.orderKits.sort((a, b) => a.trigger.localeCompare(b.trigger))
  writeLibrary(lib)
  return kit
}

export function deleteOrderKit(id: number): void {
  const lib = readLibrary()
  lib.orderKits = lib.orderKits.filter((k) => k.id !== id)
  retireId(lib, 'orderKits', id)
  writeLibrary(lib)
}

/** Carry kits that were saved in a project's DB (before kits were shared) into the
 *  shared library, skipping any trigger that's already there. */
export function importOrderKits(kits: OrderKitInput[]): void {
  if (!kits.length) return
  const lib = readLibrary()
  const now = new Date().toISOString()
  for (const k of kits) {
    const t = k.trigger.trim()
    if (!t || lib.orderKits.some((x) => x.trigger.toLowerCase() === t.toLowerCase())) continue
    const id = newId(lib, 'orderKits', lib.orderKits)
    lib.orderKits.push({ id, trigger: t, addons: k.addons, createdAt: now, updatedAt: now })
  }
  lib.orderKits.sort((a, b) => a.trigger.localeCompare(b.trigger))
  writeLibrary(lib)
}

// ---- Software library (shared) ------------------------------------------

export function listSoftware(): SoftwarePackage[] {
  return readLibrary().software
}

export function createSoftware(input: SoftwarePackageInput): SoftwarePackage {
  const lib = readLibrary()
  const now = new Date().toISOString()
  const pkg: SoftwarePackage = {
    ...input,
    id: newId(lib, 'software', lib.software),
    createdAt: now,
    updatedAt: now
  }
  lib.software.push(pkg)
  lib.software.sort((a, b) => a.name.localeCompare(b.name))
  writeLibrary(lib)
  return pkg
}

export function updateSoftware(id: number, input: SoftwarePackageInput): SoftwarePackage {
  const lib = readLibrary()
  const pkg = lib.software.find((p) => p.id === id)
  if (!pkg) throw new Error(`Software ${id} not found.`)
  Object.assign(pkg, input, { updatedAt: new Date().toISOString() })
  lib.software.sort((a, b) => a.name.localeCompare(b.name))
  writeLibrary(lib)
  return pkg
}

export function deleteSoftware(id: number): void {
  const lib = readLibrary()
  lib.software = lib.software.filter((p) => p.id !== id)
  retireId(lib, 'software', id)
  writeLibrary(lib)
}

// ---- Crew directory (shared) ----------------------------------------------

export function listCrew(): CrewMember[] {
  return readLibrary().crew
}

export function createCrewMember(input: CrewMemberInput): CrewMember {
  const lib = readLibrary()
  const member: CrewMember = { ...input, id: newId(lib, 'crew', lib.crew) }
  lib.crew.push(member)
  lib.crew.sort((a, b) => a.name.localeCompare(b.name))
  writeLibrary(lib)
  return member
}

export function updateCrewMember(id: number, input: CrewMemberInput): CrewMember {
  const lib = readLibrary()
  const member = lib.crew.find((c) => c.id === id)
  if (!member) throw new Error(`Crew member ${id} not found.`)
  Object.assign(member, input)
  lib.crew.sort((a, b) => a.name.localeCompare(b.name))
  writeLibrary(lib)
  return member
}

export function deleteCrewMember(id: number): void {
  const lib = readLibrary()
  lib.crew = lib.crew.filter((c) => c.id !== id)
  retireId(lib, 'crew', id)
  writeLibrary(lib)
}

// ---- Cable loom stickers (shared) -------------------------------------------

type Keyed = { id: number; name: string }
const byName = (a: Keyed, b: Keyed): number => a.name.localeCompare(b.name)

export function listStickerSheets(): StickerSheet[] {
  return readLibrary().stickerSheets
}

export function saveStickerSheet(id: number | null, input: StickerSheetInput): StickerSheet {
  const lib = readLibrary()
  const sheet: StickerSheet = { ...input, id: id ?? newId(lib, 'stickerSheets', lib.stickerSheets) }
  lib.stickerSheets = [...lib.stickerSheets.filter((s) => s.id !== sheet.id), sheet].sort(byName)
  writeLibrary(lib)
  return sheet
}

/** Deleting a sheet type also deletes the designs made for it. */
export function deleteStickerSheet(id: number): void {
  const lib = readLibrary()
  lib.stickerSheets = lib.stickerSheets.filter((s) => s.id !== id)
  retireId(lib, 'stickerSheets', id)
  for (const d of lib.stickerDesigns) if (d.sheetId === id) retireId(lib, 'stickerDesigns', d.id)
  lib.stickerDesigns = lib.stickerDesigns.filter((d) => d.sheetId !== id)
  writeLibrary(lib)
}

export function listStickerDesigns(): StickerDesign[] {
  return readLibrary().stickerDesigns
}

export function saveStickerDesign(id: number | null, input: StickerDesignInput): StickerDesign {
  const lib = readLibrary()
  const design: StickerDesign = {
    ...input,
    id: id ?? newId(lib, 'stickerDesigns', lib.stickerDesigns)
  }
  lib.stickerDesigns = [...lib.stickerDesigns.filter((d) => d.id !== design.id), design].sort(
    byName
  )
  writeLibrary(lib)
  return design
}

export function deleteStickerDesign(id: number): void {
  const lib = readLibrary()
  lib.stickerDesigns = lib.stickerDesigns.filter((d) => d.id !== id)
  retireId(lib, 'stickerDesigns', id)
  writeLibrary(lib)
}

// ---- Lighting fixture types (shared) -------------------------------------

export function listFixtureTypes(): FixtureType[] {
  return readLibrary().fixtureTypes
}

/** Replace one type's modes by name; a type with no modes is removed. */
export function saveFixtureType(type: FixtureType): FixtureType[] {
  const lib = readLibrary()
  const others = lib.fixtureTypes.filter((t) => t.name !== type.name)
  const modes = type.modes.filter((m) => m.footprint > 0)
  lib.fixtureTypes = modes.length ? [...others, { name: type.name, modes }] : others
  writeLibrary(lib)
  return lib.fixtureTypes
}

// ---- Paperwork templates (shared) --------------------------------------------

export function listPaperwork(): PaperworkTemplate[] {
  const lib = readLibrary()
  return withBuiltIns(lib.paperwork, lib.lightingReports ?? null)
}

/** Replace the whole template list (the page adds, edits and deletes). A template an
 *  export prints can't be deleted, so it is put back if missing. */
export function savePaperwork(list: PaperworkTemplate[]): PaperworkTemplate[] {
  const lib = readLibrary()
  lib.paperwork = withBuiltIns(list, null)
  delete lib.lightingReports
  writeLibrary(lib)
  return lib.paperwork
}

/** The template(s) an export prints, in order. */
export function templatesForDoc(doc: keyof typeof DOC_TEMPLATES): PaperworkTemplate[] {
  const list = listPaperwork()
  return DOC_TEMPLATES[doc].map((id) => list.find((t) => t.id === id)!)
}

// ---- Paperwork header (shared) ---------------------------------------------

export function getPaperworkHeader(): PaperworkHeader {
  return normalizeHeader(readLibrary().paperworkHeader)
}

export function setPaperworkHeader(h: PaperworkHeader): PaperworkHeader {
  const lib = readLibrary()
  lib.paperworkHeader = normalizeHeader(h)
  writeLibrary(lib)
  return lib.paperworkHeader
}

// ---- Exported table style (shared) ----------------------------------------

export function getTableStyle(): TableStyle {
  return normalizeTableStyle(readLibrary().tableStyle)
}

export function setTableStyle(style: TableStyle): TableStyle {
  const lib = readLibrary()
  lib.tableStyle = normalizeTableStyle(style)
  writeLibrary(lib)
  return lib.tableStyle
}
