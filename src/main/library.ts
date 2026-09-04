import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { readCatalogsFromFile } from './db'
import { getDbPath } from './paths'
import type { CableType, CableTypeInput } from '../shared/types'

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
}

function readLibrary(): Library {
  try {
    const raw = JSON.parse(readFileSync(libraryPath(), 'utf-8')) as Partial<Library>
    return {
      networkSignals: raw.networkSignals ?? [],
      cableTypes: raw.cableTypes ?? [],
      deviceCategories: raw.deviceCategories ?? []
    }
  } catch {
    return { networkSignals: [], cableTypes: [], deviceCategories: [] }
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
    deviceCategories: []
  })
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
