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

-- Saved host VLAN configurations (for generating PowerShell config scripts).
-- The VLAN list is stored as a JSON array in vlans_json.
CREATE TABLE IF NOT EXISTS host_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  switch_name TEXT NOT NULL DEFAULT 'VLAN-Trunk',
  vlans_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Shop orders (equipment purchasing / receiving). Line items are a JSON array
-- in items_json; each item tracks quantity ordered vs. received.
CREATE TABLE IF NOT EXISTS shop_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vendor TEXT,
  order_date TEXT,
  notes TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  -- cable lines (type · length · quantity), kept separate from equipment items
  cables_json TEXT NOT NULL DEFAULT '[]',
  -- snapshot of items_json at the last export + when, for change highlighting
  last_export_json TEXT,
  last_export_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Case label templates (printed 2-up on Uline S-19323 8.5"x5.5" sheets).
-- User-defined fields are a JSON array in fields_json.
CREATE TABLE IF NOT EXISTS label_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT,
  color TEXT,
  show_name INTEGER NOT NULL DEFAULT 1,
  fields_json TEXT NOT NULL DEFAULT '[]',
  -- freeform positioned elements (text/shapes); when non-empty, this is what prints
  elements_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reusable shop-order export formats ("order types"): which columns + widths,
-- grouping, sort, and page layout. columns_json = [{key,show,width}].
CREATE TABLE IF NOT EXISTS order_export_formats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  columns_json TEXT NOT NULL DEFAULT '[]',
  group_by_category INTEGER NOT NULL DEFAULT 1,
  sort TEXT NOT NULL DEFAULT 'category',
  orientation TEXT NOT NULL DEFAULT 'portrait',
  density TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Auto-add kits: "when an order item matches <trigger>, also add these companions."
-- addons_json is a KitAddon[] (equipment or cable lines, each with a per-unit count).
CREATE TABLE IF NOT EXISTS order_kits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,
  addons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Patching: circuits imported from a ConnectCAD circuit report. conn_key is the
-- stable physical-connection identity (src dev+socket → dst dev+socket), used to
-- merge on re-import while preserving patched/tested/notes. The drawing owns
-- which circuits exist; status lives only here.
CREATE TABLE IF NOT EXISTS circuits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conn_key TEXT NOT NULL UNIQUE,
  cable_number TEXT NOT NULL DEFAULT '',
  signal TEXT NOT NULL DEFAULT '',
  est_length TEXT NOT NULL DEFAULT '',
  src_name TEXT NOT NULL DEFAULT '',
  src_socket TEXT NOT NULL DEFAULT '',
  src_connector TEXT NOT NULL DEFAULT '',
  src_rack TEXT NOT NULL DEFAULT '',
  src_rack_u TEXT NOT NULL DEFAULT '',
  src_slot TEXT NOT NULL DEFAULT '',
  dst_name TEXT NOT NULL DEFAULT '',
  dst_socket TEXT NOT NULL DEFAULT '',
  dst_connector TEXT NOT NULL DEFAULT '',
  dst_rack TEXT NOT NULL DEFAULT '',
  dst_rack_u TEXT NOT NULL DEFAULT '',
  dst_slot TEXT NOT NULL DEFAULT '',
  -- patched is tracked PER END so a half-patched run is visible; tested is
  -- circuit-level and implies both ends patched.
  src_patched INTEGER NOT NULL DEFAULT 0,
  dst_patched INTEGER NOT NULL DEFAULT 0,
  tested INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cases (what's packed in each case). fields_json = [{label,value}]; contents is
-- free text (one item per line). Printed to labels via a template's {tokens}.
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '[]',
  contents TEXT NOT NULL DEFAULT '',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Crew + trucking schedule (per show). Each row's fields live in data_json
-- (CrewAssignment / Truck / TruckTrip minus id); crew contact details and
-- default rates stay in the shared library, not here.
CREATE TABLE IF NOT EXISTS crew_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trucks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS truck_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_json TEXT NOT NULL
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

/** Adds `devices.wallpaper_json` (per-computer wallpaper setup). Guarded, additive. */
function migrateAddDeviceWallpaper(database: DatabaseSync): void {
  if (!tableExists(database, 'devices')) return
  if (tableHasColumn(database, 'devices', 'wallpaper_json')) return
  database.exec('ALTER TABLE devices ADD COLUMN wallpaper_json TEXT')
}

/** Adds `devices.projector_json` (Panasonic projector settings). Guarded, additive. */
function migrateAddDeviceProjector(database: DatabaseSync): void {
  if (!tableExists(database, 'devices')) return
  if (tableHasColumn(database, 'devices', 'projector_json')) return
  database.exec('ALTER TABLE devices ADD COLUMN projector_json TEXT')
}

/** Adds `devices.software_json` (installers for the computer's install kit). Guarded, additive. */
function migrateAddDeviceSoftware(database: DatabaseSync): void {
  if (!tableExists(database, 'devices')) return
  if (tableHasColumn(database, 'devices', 'software_json')) return
  database.exec('ALTER TABLE devices ADD COLUMN software_json TEXT')
}

/** Adds `ports.is_unused` (jacks not used for the network). Guarded, additive. */
function migrateAddPortUnused(database: DatabaseSync): void {
  if (!tableExists(database, 'ports')) return
  if (tableHasColumn(database, 'ports', 'is_unused')) return
  database.exec('ALTER TABLE ports ADD COLUMN is_unused INTEGER NOT NULL DEFAULT 0')
}

/** Adds `ports.lag_group` (free-text LAG name; ports sharing it are one link). Guarded, additive. */
function migrateAddPortLag(database: DatabaseSync): void {
  if (!tableExists(database, 'ports')) return
  if (tableHasColumn(database, 'ports', 'lag_group')) return
  database.exec('ALTER TABLE ports ADD COLUMN lag_group TEXT')
}

/** Adds the shop-order export snapshot columns (change highlighting). Guarded. */
function migrateAddOrderExportSnapshot(database: DatabaseSync): void {
  if (!tableExists(database, 'shop_orders')) return
  if (tableHasColumn(database, 'shop_orders', 'last_export_at')) return
  database.exec(`
    ALTER TABLE shop_orders ADD COLUMN last_export_json TEXT;
    ALTER TABLE shop_orders ADD COLUMN last_export_at TEXT;
  `)
}

/** Adds `shop_orders.cables_json` (cable lines, separate from equipment). Guarded. */
function migrateAddOrderCables(database: DatabaseSync): void {
  if (!tableExists(database, 'shop_orders')) return
  if (tableHasColumn(database, 'shop_orders', 'cables_json')) return
  database.exec("ALTER TABLE shop_orders ADD COLUMN cables_json TEXT NOT NULL DEFAULT '[]'")
}

/** Adds `label_templates.elements_json` (freeform label layout). Guarded. */
function migrateAddLabelElements(database: DatabaseSync): void {
  if (!tableExists(database, 'label_templates')) return
  if (tableHasColumn(database, 'label_templates', 'elements_json')) return
  database.exec("ALTER TABLE label_templates ADD COLUMN elements_json TEXT NOT NULL DEFAULT '[]'")
}

/** Splits circuits' single `patched` into per-end src_patched/dst_patched.
 *  Guarded — only the brief first-cut `circuits` table had `patched`. */
function migrateCircuitEnds(database: DatabaseSync): void {
  if (!tableExists(database, 'circuits')) return
  if (tableHasColumn(database, 'circuits', 'src_patched')) return
  database.exec(`
    ALTER TABLE circuits ADD COLUMN src_patched INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE circuits ADD COLUMN dst_patched INTEGER NOT NULL DEFAULT 0;
  `)
  if (tableHasColumn(database, 'circuits', 'patched')) {
    database.exec('UPDATE circuits SET src_patched = patched, dst_patched = patched')
  }
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
  migrateAddDeviceWallpaper(database)
  migrateAddPortUnused(database)
  migrateAddPortLag(database)
  migrateAddOrderExportSnapshot(database)
  migrateAddOrderCables(database)
  migrateAddLabelElements(database)
  migrateCircuitEnds(database)
  migrateAddDeviceProjector(database)
  migrateAddDeviceSoftware(database)
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
