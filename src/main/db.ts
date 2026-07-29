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
  ip_address TEXT,
  mac_address TEXT,
  subnet_id INTEGER REFERENCES subnets(id) ON DELETE SET NULL,
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

let db: Database | null = null
let dbPath: string | null = null

export async function initDb(): Promise<void> {
  dbPath = getDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })

  const SQL = await initSqlJs()
  db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database()
  db.exec(SCHEMA)
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
