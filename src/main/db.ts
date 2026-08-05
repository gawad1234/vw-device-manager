import initSqlJs, { type Database } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { getDbPath } from './paths'

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS port_tagged_vlans (
  port_id INTEGER NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  subnet_id INTEGER NOT NULL REFERENCES subnets(id) ON DELETE CASCADE,
  UNIQUE(port_id, subnet_id)
);

-- ConnectCAD socket "signal" values the sync scripts treat as network ports.
-- Managed in the app's Settings tab; the scripts read this list from here.
CREATE TABLE IF NOT EXISTS network_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal TEXT NOT NULL UNIQUE COLLATE NOCASE
);

-- ---- Cable bundle manager -------------------------------------------------
-- Managed cable-type catalog (Cat6, Fiber SM, XLR, …). Managed in Settings.
-- outer_diameter (for conduit-fill %) is a deliberate future addition.
CREATE TABLE IF NOT EXISTS cable_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  notes TEXT
);

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
  cable_type_id INTEGER REFERENCES cable_types(id) ON DELETE SET NULL,
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

let db: Database | null = null
let dbPath: string | null = null

function tableHasColumn(database: Database, table: string, column: string): boolean {
  const res = database.exec(`PRAGMA table_info(${table})`)
  if (res.length === 0) return false
  const nameIdx = res[0].columns.indexOf('name')
  return res[0].values.some((row) => row[nameIdx] === column)
}

function tableExists(database: Database, name: string): boolean {
  const res = database.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`)
  return res.length > 0 && res[0].values.length > 0
}

/**
 * One-time migration from the pre-ports schema, where each device carried a
 * single ip_address + subnet_id. Moves that data into one port per device,
 * then rebuilds `devices` without those two columns. Gated on the old column
 * still existing, so it runs at most once and is a no-op on fresh DBs.
 */
function migrateDevicesToPorts(database: Database): void {
  if (!tableHasColumn(database, 'devices', 'ip_address')) return

  database.exec('BEGIN')
  try {
    // Backfill: one "Port 1" per device that actually had an IP or subnet.
    database.run(
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
 * includes them). ALTER TABLE ADD COLUMN is well-supported by sql.js.
 */
function migrateAddSwitchColumns(database: Database): void {
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
function migrateCableLengthToBundle(database: Database): void {
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
function migrateCableChecklist(database: Database): void {
  if (!tableExists(database, 'cables')) return
  if (tableHasColumn(database, 'cables', 'pulled')) return
  database.exec(`
    ALTER TABLE cables ADD COLUMN pulled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cables ADD COLUMN labeled INTEGER NOT NULL DEFAULT 0;
  `)
}

/** Adds `bundles.color` (hex color code for the bundle). Guarded, additive. */
function migrateBundleColor(database: Database): void {
  if (!tableExists(database, 'bundles')) return
  if (tableHasColumn(database, 'bundles', 'color')) return
  database.exec('ALTER TABLE bundles ADD COLUMN color TEXT')
}

export async function initDb(): Promise<void> {
  dbPath = getDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })

  const SQL = await initSqlJs()
  db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database()

  // Seed the default network signal only the first time the table is created,
  // so a user who deletes 'LAN' on purpose won't get it re-added on relaunch.
  const seedSignals = !tableExists(db, 'network_signals')
  db.exec(SCHEMA)
  migrateDevicesToPorts(db)
  migrateAddSwitchColumns(db)
  migrateCableLengthToBundle(db)
  migrateCableChecklist(db)
  migrateBundleColor(db)
  if (seedSignals) db.run("INSERT INTO network_signals (signal) VALUES ('LAN')")
  persist()
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized — call initDb() first')
  return db
}

export function persist(): void {
  if (!db || !dbPath) return
  writeFileSync(dbPath, Buffer.from(db.export()))
}
