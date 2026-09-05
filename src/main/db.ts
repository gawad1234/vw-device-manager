import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS subnets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cidr TEXT NOT NULL,
  vlan TEXT,
  gateway TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  device_type TEXT,
  mac_address TEXT,
  location TEXT,
  notes TEXT,
  -- User-assigned grouping (from the shared category list); NULL = uncategorized.
  category TEXT,
  -- A switch has no per-port IP; instead it carries a device-level management
  -- IP + an out-of-band (OOB) IP, and its ports are VLAN-only (see ports).
  is_switch INTEGER NOT NULL DEFAULT 0,
  management_ip TEXT,
  oob_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A device has many ports (one per network jack). IP lives here now; MAC
-- stays on the device. untagged_subnet_id is the port's native/untagged
-- network; tagged VLANs are the trunk membership in port_tagged_vlans.
-- vw_socket_key ties a port to its ConnectCAD jack (NULL = added by hand).
CREATE TABLE IF NOT EXISTS ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  ip_address TEXT,
  untagged_subnet_id INTEGER REFERENCES subnets(id) ON DELETE SET NULL,
  vw_socket_key TEXT,
  -- at most one port per device flagged the device's "main" access route
  is_primary INTEGER NOT NULL DEFAULT 0,
  -- a jack that isn't used for the network — hidden from schedules/labels/sync
  is_unused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS port_tagged_vlans (
  port_id INTEGER NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  subnet_id INTEGER NOT NULL REFERENCES subnets(id) ON DELETE CASCADE,
  UNIQUE(port_id, subnet_id)
);

-- Per-project (per-show) key/value settings, e.g. the show logo (a data URL)
-- stamped onto generated paperwork. Travels inside the .vwdm.
CREATE TABLE IF NOT EXISTS project_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Network signals and cable types are NOT per-project — they live in the shared
-- library (data/library.json, see library.ts) so they're universal across every
-- project. Older project files may still carry vestigial network_signals /
-- cable_types tables; they're ignored (the library was seeded from them once).

-- ---- Cable bundle manager -------------------------------------------------
-- A bundle is a group of cables that travel together (conduit/tray/snake).
-- length is bundle-level: cables in a bundle share the same run.
CREATE TABLE IF NOT EXISTS bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT,
  from_location TEXT,
  to_location TEXT,
  length TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A cable belongs to one bundle. Each endpoint (source/dest) links to a device
-- and optionally a specific port, OR falls back to free text (*_text) when the
-- device isn't in the app. FK cascade/set-null is declarative — like the rest
-- of the app, deletes are cascaded manually in the repository (pragma off).
CREATE TABLE IF NOT EXISTS cables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- cable type by NAME (from the shared library, not a per-project id).
  cable_type TEXT,
  source_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  source_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
  source_text TEXT,
  dest_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  dest_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
  dest_text TEXT,
  -- install check sheet: ticked off as each cable is pulled / labeled.
  pulled INTEGER NOT NULL DEFAULT 0,
  labeled INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

// A real embedded SQLite (Node's built-in node:sqlite — no native module) that
// writes rows in place with OS file locking. This lets the app AND the VW
// scripts hold the same .vwdm open at once without clobbering (see openDb's
// busy_timeout), unlike the old sql.js whole-file rewrite.
let db: DatabaseSync | null = null
let dbPath: string | null = null

/** Bind values node:sqlite accepts for a positional `?` parameter. */
type SqlParam = string | number | bigint | null | Uint8Array

function tableHasColumn(database: DatabaseSync, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((r) => r.name === column)
}

function tableExists(database: DatabaseSync, name: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name)
  return row !== undefined
}

/**
 * One-time migration from the pre-ports schema, where each device carried a
 * single ip_address + subnet_id. Moves that data into one port per device,
 * then rebuilds `devices` without those two columns. Gated on the old column
 * still existing, so it runs at most once and is a no-op on fresh DBs.
 */
function migrateDevicesToPorts(database: DatabaseSync): void {
  if (!tableHasColumn(database, 'devices', 'ip_address')) return

  database.exec('BEGIN')
  try {
    // Backfill: one "Port 1" per device that actually had an IP or subnet.
    database.exec(
      `INSERT INTO ports (device_id, label, ip_address, untagged_subnet_id)
       SELECT id, 'Port 1', ip_address, subnet_id FROM devices
       WHERE ip_address IS NOT NULL OR subnet_id IS NOT NULL`
    )
    // Rebuild devices without ip_address / subnet_id (portable across SQLite
    // versions — avoids relying on ALTER TABLE DROP COLUMN).
    database.exec(`
      CREATE TABLE devices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        device_type TEXT,
        mac_address TEXT,
        location TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO devices_new (id, name, device_type, mac_address, location, notes, created_at, updated_at)
        SELECT id, name, device_type, mac_address, location, notes, created_at, updated_at FROM devices;
      DROP TABLE devices;
      ALTER TABLE devices_new RENAME TO devices;
    `)
    database.exec('COMMIT')
  } catch (e) {
    database.exec('ROLLBACK')
    throw e
  }
}

/**
 * Adds the switch-role columns (is_switch / management_ip / oob_ip) to an
 * existing `devices` table that predates them. Guarded on the column not yet
 * existing, so it's a no-op once applied and on fresh DBs (SCHEMA already
 * includes them).
 */
function migrateAddSwitchColumns(database: DatabaseSync): void {
  if (!tableExists(database, 'devices')) return
  if (tableHasColumn(database, 'devices', 'is_switch')) return
  database.exec(`
    ALTER TABLE devices ADD COLUMN is_switch INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE devices ADD COLUMN management_ip TEXT;
    ALTER TABLE devices ADD COLUMN oob_ip TEXT;
  `)
}

/**
 * Moves cable length from per-cable to per-bundle. Adds `bundles.length` if
 * missing, and rebuilds `cables` without its `length` column (dropping any
 * per-cable lengths — length is now the bundle's). Guarded so it runs once and
 * is a no-op on fresh DBs (SCHEMA already has the final shape).
 */
function migrateCableLengthToBundle(database: DatabaseSync): void {
  if (tableExists(database, 'bundles') && !tableHasColumn(database, 'bundles', 'length')) {
    database.exec('ALTER TABLE bundles ADD COLUMN length TEXT')
  }
  if (!tableExists(database, 'cables') || !tableHasColumn(database, 'cables', 'length')) return

  database.exec('BEGIN')
  try {
    database.exec(`
      CREATE TABLE cables_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cable_type_id INTEGER REFERENCES cable_types(id) ON DELETE SET NULL,
        source_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
        source_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
        source_text TEXT,
        dest_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
        dest_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
        dest_text TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO cables_new
        (id, bundle_id, name, cable_type_id, source_device_id, source_port_id, source_text,
         dest_device_id, dest_port_id, dest_text, notes, created_at, updated_at)
        SELECT id, bundle_id, name, cable_type_id, source_device_id, source_port_id, source_text,
         dest_device_id, dest_port_id, dest_text, notes, created_at, updated_at FROM cables;
      DROP TABLE cables;
      ALTER TABLE cables_new RENAME TO cables;
    `)
    database.exec('COMMIT')
  } catch (e) {
    database.exec('ROLLBACK')
    throw e
  }
}

/**
 * Adds the install-checklist columns (pulled / labeled) to an existing `cables`
 * table. Guarded on the column not yet existing → no-op once applied and on
 * fresh DBs (SCHEMA already has them).
 */
function migrateCableChecklist(database: DatabaseSync): void {
  if (!tableExists(database, 'cables')) return
  if (tableHasColumn(database, 'cables', 'pulled')) return
  database.exec(`
    ALTER TABLE cables ADD COLUMN pulled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cables ADD COLUMN labeled INTEGER NOT NULL DEFAULT 0;
  `)
}

/** Adds `bundles.color` (hex color code for the bundle). Guarded, additive. */
function migrateBundleColor(database: DatabaseSync): void {
  if (!tableExists(database, 'bundles')) return
  if (tableHasColumn(database, 'bundles', 'color')) return
  database.exec('ALTER TABLE bundles ADD COLUMN color TEXT')
}

/**
 * Cable types moved to the shared library (by name), so a cable now stores its
 * type NAME instead of a per-project `cable_type_id`. Rebuilds `cables` with a
 * `cable_type` TEXT column, resolving each old id to its name from the (still
 * present) `cable_types` table. Guarded on the old column existing.
 */
function migrateCableTypeToName(database: DatabaseSync): void {
  if (!tableExists(database, 'cables')) return
  if (!tableHasColumn(database, 'cables', 'cable_type_id')) return

  database.exec('BEGIN')
  try {
    database.exec(`
      CREATE TABLE cables_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cable_type TEXT,
        source_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
        source_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
        source_text TEXT,
        dest_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
        dest_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
        dest_text TEXT,
        pulled INTEGER NOT NULL DEFAULT 0,
        labeled INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO cables_new
        (id, bundle_id, name, cable_type, source_device_id, source_port_id, source_text,
         dest_device_id, dest_port_id, dest_text, pulled, labeled, notes, created_at, updated_at)
        SELECT c.id, c.bundle_id, c.name, ct.name, c.source_device_id, c.source_port_id,
         c.source_text, c.dest_device_id, c.dest_port_id, c.dest_text, c.pulled, c.labeled,
         c.notes, c.created_at, c.updated_at
        FROM cables c LEFT JOIN cable_types ct ON ct.id = c.cable_type_id;
      DROP TABLE cables;
      ALTER TABLE cables_new RENAME TO cables;
    `)
    database.exec('COMMIT')
  } catch (e) {
    database.exec('ROLLBACK')
    throw e
  }
}

/** Adds `ports.is_primary` (marks a device's main access-route port). Guarded, additive. */
function migrateAddPortPrimary(database: DatabaseSync): void {
  if (!tableExists(database, 'ports')) return
  if (tableHasColumn(database, 'ports', 'is_primary')) return
  database.exec('ALTER TABLE ports ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0')
}

/** Adds `devices.category` (user-assigned grouping). Guarded, additive. */
function migrateAddDeviceCategory(database: DatabaseSync): void {
  if (!tableExists(database, 'devices')) return
  if (tableHasColumn(database, 'devices', 'category')) return
  database.exec('ALTER TABLE devices ADD COLUMN category TEXT')
}

/** Adds `ports.is_unused` (jacks not used for the network). Guarded, additive. */
function migrateAddPortUnused(database: DatabaseSync): void {
  if (!tableExists(database, 'ports')) return
  if (tableHasColumn(database, 'ports', 'is_unused')) return
  database.exec('ALTER TABLE ports ADD COLUMN is_unused INTEGER NOT NULL DEFAULT 0')
}

/** Bring a freshly opened DB up to date: schema + all migrations. Network
 *  signals / cable types are NOT here — they live in the shared library. */
function applySchemaAndMigrations(database: DatabaseSync): void {
  database.exec(SCHEMA)
  migrateDevicesToPorts(database)
  migrateAddSwitchColumns(database)
  migrateCableLengthToBundle(database)
  migrateCableChecklist(database)
  migrateBundleColor(database)
  migrateCableTypeToName(database)
  migrateAddPortPrimary(database)
  migrateAddDeviceCategory(database)
  migrateAddPortUnused(database)
}

/**
 * Open (or create) the project database at `path` and make it the active DB.
 * node:sqlite writes rows straight to the file (no whole-file persist), and the
 * busy_timeout lets the app coexist with a Vectorworks script holding the same
 * file. Switching projects just calls this again with another path.
 */
export async function openDb(path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  db?.close()
  db = new DatabaseSync(path)
  dbPath = path
  // Wait up to 5s for a lock instead of erroring, so a concurrent VW-script
  // write doesn't fail the app (and vice versa).
  db.exec('PRAGMA busy_timeout = 5000')
  applySchemaAndMigrations(db)
}

export function getCurrentDbPath(): string | null {
  return dbPath
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialized — call openDb() first')
  return db
}

// ---- Engine-agnostic query helpers (used by repository + migrations) -----

export function dbExec(sql: string): void {
  getDb().exec(sql)
}

export function dbRun(
  sql: string,
  params: SqlParam[] = []
): { lastInsertRowid: number; changes: number } {
  const info = getDb()
    .prepare(sql)
    .run(...params)
  return { lastInsertRowid: Number(info.lastInsertRowid), changes: Number(info.changes) }
}

export function dbAll(sql: string, params: SqlParam[] = []): Record<string, unknown>[] {
  return getDb()
    .prepare(sql)
    .all(...params) as Record<string, unknown>[]
}

export function dbGet(sql: string, params: SqlParam[] = []): Record<string, unknown> | undefined {
  return getDb()
    .prepare(sql)
    .get(...params) as Record<string, unknown> | undefined
}

export function lastInsertRowId(): number {
  return (getDb().prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
}

/**
 * `PRAGMA data_version` — a token that bumps whenever ANOTHER connection commits
 * to this file, but NOT for our own writes. The main process polls it to detect
 * writes from the Vectorworks scripts and auto-refresh the UI (no self-refresh
 * loop).
 */
export function getDataVersion(): number {
  const row = getDb().prepare('PRAGMA data_version').get() as { data_version: number }
  return row.data_version
}

/**
 * Read only the network-signal + cable-type catalogs out of a database file,
 * read-only, without disturbing the active project. Used once to seed the
 * shared library from the pre-split legacy database. Missing tables → empty.
 */
export async function readCatalogsFromFile(
  path: string
): Promise<{ networkSignals: string[]; cableTypes: { name: string; notes: string | null }[] }> {
  const out = {
    networkSignals: [] as string[],
    cableTypes: [] as { name: string; notes: string | null }[]
  }
  if (!existsSync(path)) return out
  const tmp = new DatabaseSync(path, { readOnly: true })
  try {
    try {
      out.networkSignals = (
        tmp.prepare('SELECT signal FROM network_signals ORDER BY signal COLLATE NOCASE').all() as {
          signal: string
        }[]
      ).map((r) => r.signal)
    } catch {
      /* no network_signals table */
    }
    try {
      out.cableTypes = (
        tmp.prepare('SELECT name, notes FROM cable_types ORDER BY name COLLATE NOCASE').all() as {
          name: string
          notes: string | null
        }[]
      ).map((r) => ({ name: r.name, notes: r.notes ?? null }))
    } catch {
      /* no cable_types table */
    }
  } finally {
    tmp.close()
  }
  return out
}
