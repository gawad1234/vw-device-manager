import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dbAll, dbRun, getCurrentDbPath, openDb, withTx } from '../src/main/db.ts'
import * as repo from '../src/main/repository.ts'
import type { OrderItem } from '../src/shared/types.ts'

const dir = mkdtempSync(join(tmpdir(), 'vwdm-db-'))
const file = (name: string): string => join(dir, name)

/** A project from before the ports table: one IP per device, right on the device. */
function legacyProject(path: string): void {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE subnets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, cidr TEXT NOT NULL, vlan TEXT, gateway TEXT, notes TEXT);
    CREATE TABLE devices (id INTEGER PRIMARY KEY, name TEXT NOT NULL, device_type TEXT, mac_address TEXT,
      location TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
      ip_address TEXT, subnet_id INTEGER);
    INSERT INTO devices (id, name, ip_address) VALUES (1, 'CAM1', '10.0.0.1'), (2, 'CAM2', '10.0.0.2');
    CREATE TABLE ports (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      label TEXT NOT NULL, ip_address TEXT, untagged_subnet_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  `)
  db.close()
}

test('upgrading an old project keeps every port', async () => {
  const path = file('old.vwdm')
  legacyProject(path)
  await openDb(path)
  assert.deepEqual(
    dbAll('SELECT ip_address FROM ports ORDER BY id').map((r) => r.ip_address),
    ['10.0.0.1', '10.0.0.2']
  )
  await openDb(path) // opening again changes nothing
  assert.equal(dbAll('SELECT * FROM ports').length, 2)
  assert.equal((dbAll('PRAGMA foreign_keys')[0] as { foreign_keys: number }).foreign_keys, 1)
})

test('a bad file leaves the open project in place', async () => {
  const good = file('good.vwdm')
  await openDb(good)
  const bad = file('bad.vwdm')
  writeFileSync(bad, 'this is not a database, just some text '.repeat(40))
  await assert.rejects(openDb(bad))
  assert.equal(getCurrentDbPath(), good)
  assert.deepEqual(repo.listDevices(), [])
})

test('a failed multi-step write leaves nothing behind', async () => {
  await openDb(file('tx.vwdm'))
  dbRun("INSERT INTO subnets (name, cidr) VALUES ('A', '10.0.0.0/24')")
  assert.throws(() =>
    withTx(() => {
      dbRun("INSERT INTO subnets (name, cidr) VALUES ('B', '10.0.1.0/24')")
      throw new Error('boom')
    })
  )
  assert.equal(dbAll('SELECT * FROM subnets').length, 1)
})

test('subnets refuse what a switch can not use', async () => {
  await openDb(file('subnets.vwdm'))
  const base = { name: 'A', cidr: '10.0.0.0/24', vlan: '10', gateway: null, notes: null }
  assert.throws(() => repo.createSubnet({ ...base, cidr: '10.0.0.0/' }), /valid range/)
  assert.throws(() => repo.createSubnet({ ...base, vlan: '5000' }), /1 to 4093/)
  assert.throws(() => repo.createSubnet({ ...base, vlan: '10a' }), /1 to 4093/)
  assert.equal(repo.createSubnet(base).vlan, '10')
})

test('deleting a device leaves its name on the cable', async () => {
  await openDb(file('cables.vwdm'))
  dbRun("INSERT INTO devices (id, name) VALUES (1, 'CAM1')")
  dbRun("INSERT INTO ports (id, device_id, label) VALUES (5, 1, 'SDI')")
  dbRun("INSERT INTO bundles (id, name) VALUES (1, 'B')")
  dbRun("INSERT INTO cables (bundle_id, name, source_device_id, source_port_id) VALUES (1, 'C1', 1, 5)")
  repo.deleteDevice(1)
  const [c] = dbAll('SELECT source_device_id, source_text FROM cables')
  assert.equal(c.source_device_id, null)
  assert.equal(c.source_text, 'CAM1 · SDI')
})

test('a saved port can not be both native and tagged on a VLAN', async () => {
  await openDb(file('ports.vwdm'))
  dbRun("INSERT INTO devices (id, name) VALUES (1, 'SW')")
  const a = repo.createSubnet({ name: 'A', cidr: '10.0.0.0/24', vlan: '10', gateway: null, notes: null })
  const { port } = repo.createPort(1, { label: '1', ipAddress: null, untaggedSubnetId: null })
  repo.setPortTaggedVlans(port!.id, [a.id])
  repo.updatePort(port!.id, { label: '1', ipAddress: null, untaggedSubnetId: a.id })
  assert.deepEqual(repo.getDeviceById(1)?.ports[0].taggedSubnetIds, [])
})

test('patching one end leaves the other alone', async () => {
  await openDb(file('circuits.vwdm'))
  dbRun("INSERT INTO circuits (conn_key) VALUES ('k')")
  const [{ id }] = dbAll('SELECT id FROM circuits') as { id: number }[]
  repo.setCircuitStatus(id, { dstPatched: true })
  const c = repo.setCircuitStatus(id, { srcPatched: true })
  assert.equal(c.dstPatched, true)
  assert.equal(c.srcPatched, true)
})

test('every format of one revision compares to the same baseline', async () => {
  await openDb(file('orders.vwdm'))
  const item = (quantity: number): OrderItem =>
    ({ name: 'Cam', manufacturer: null, modelNumber: null, category: null, quantity, received: 0, notes: null })
  const order = repo.createShopOrder({ name: 'O', vendor: null, orderDate: null, notes: null, items: [item(2)], cables: [] })
  assert.equal(repo.getOrderBaseline(order.id, [item(2)]), null) // never exported
  repo.markOrderExported(order.id, [item(2)])
  assert.equal(repo.getOrderBaseline(order.id, [item(2)]), null) // same lines again: still first
  assert.equal(repo.getOrderBaseline(order.id, [item(4)])?.items[0].quantity, 2) // PDF of the change
  repo.markOrderExported(order.id, [item(4)])
  assert.equal(repo.getOrderBaseline(order.id, [item(4)])?.items[0].quantity, 2) // its Excel
})
