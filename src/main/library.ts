import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { readCatalogsFromFile } from './db'
import { getDbPath } from './paths'
import { DEFAULT_SWITCH_BASE_CONFIG } from './switch-config'
import type {
  CableType,
  CableTypeInput,
  OrderKit,
  OrderKitInput,
  SoftwarePackage,
  SoftwarePackageInput,
  SwitchConfigSettings
} from '../shared/types'

/**
 * The universal library — network signals + cable types — is shared across ALL
 * projects (and machines). It's a single JSON file in the Dropbox-synced
 * workspace, NOT stored per project. Managed once in the Settings tab.
 */
function libraryPath(): string {
  if (is.dev) return join(process.cwd(), 'data', 'library.json')
  return join(app.getPath('userData'), 'library.json')
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
  /** Switch-config generator settings (base template + admin login), shared. */
  switchConfig: SwitchConfigSettings
  /** Windows installers for per-computer install kits, shared like kits. */
  software: SoftwarePackage[]
}

function defaultSwitchConfig(): SwitchConfigSettings {
  return { baseTemplate: DEFAULT_SWITCH_BASE_CONFIG, adminUser: 'admin', adminPassword: '' }
}

function readLibrary(): Library {
  try {
    const raw = JSON.parse(readFileSync(libraryPath(), 'utf-8')) as Partial<Library>
    return {
      networkSignals: raw.networkSignals ?? [],
      cableTypes: raw.cableTypes ?? [],
      deviceCategories: raw.deviceCategories ?? [],
      orderKits: raw.orderKits ?? [],
      companyName: raw.companyName ?? '',
      companyLogo: raw.companyLogo ?? null,
      switchConfig: { ...defaultSwitchConfig(), ...(raw.switchConfig ?? {}) },
      software: raw.software ?? []
    }
  } catch {
    return {
      networkSignals: [],
      cableTypes: [],
      deviceCategories: [],
      orderKits: [],
      companyName: '',
      companyLogo: null,
      switchConfig: defaultSwitchConfig(),
      software: []
    }
  }
}

function writeLibrary(lib: Library): void {
  mkdirSync(dirname(libraryPath()), { recursive: true })
  writeFileSync(libraryPath(), JSON.stringify(lib, null, 2))
}

/**
 * Create the shared library on first run, seeding it from the **pre-split legacy
 * database** (the single DB used before per-project files) so the catalogs the
 * user already built are carried over — regardless of which project happens to
 * be open. Defaults to a single 'LAN' signal if there's nothing to seed (fresh
 * install with no legacy DB).
 */
export async function ensureLibrary(): Promise<void> {
  if (existsSync(libraryPath())) return
  const seed = await readCatalogsFromFile(getDbPath())
  writeLibrary({
    networkSignals: seed.networkSignals.length ? seed.networkSignals : ['LAN'],
    cableTypes: seed.cableTypes,
    deviceCategories: [],
    orderKits: [],
    companyName: '',
    companyLogo: null,
    switchConfig: defaultSwitchConfig(),
    software: []
  })
}

// ---- Switch-config generator settings (shared) --------------------------

export function getSwitchConfig(): SwitchConfigSettings {
  return readLibrary().switchConfig
}

export function setSwitchConfig(input: SwitchConfigSettings): void {
  const lib = readLibrary()
  lib.switchConfig = {
    baseTemplate: input.baseTemplate,
    adminUser: (input.adminUser ?? '').trim() || 'admin',
    adminPassword: input.adminPassword ?? ''
  }
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

function nextKitId(kits: OrderKit[]): number {
  return kits.reduce((m, k) => Math.max(m, k.id), 0) + 1
}

export function listOrderKits(): OrderKit[] {
  return readLibrary().orderKits
}

export function createOrderKit(input: OrderKitInput): OrderKit {
  const lib = readLibrary()
  const now = new Date().toISOString()
  const kit: OrderKit = {
    id: nextKitId(lib.orderKits),
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
  writeLibrary(lib)
}

/** Carry kits that were saved in a project's DB (before kits were shared) into the
 *  shared library, skipping any trigger that's already there. */
export function importOrderKits(kits: OrderKitInput[]): void {
  if (!kits.length) return
  const lib = readLibrary()
  let id = nextKitId(lib.orderKits)
  const now = new Date().toISOString()
  for (const k of kits) {
    const t = k.trigger.trim()
    if (!t || lib.orderKits.some((x) => x.trigger.toLowerCase() === t.toLowerCase())) continue
    lib.orderKits.push({ id: id++, trigger: t, addons: k.addons, createdAt: now, updatedAt: now })
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
    id: lib.software.reduce((m, p) => Math.max(m, p.id), 0) + 1,
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
  writeLibrary(lib)
}
