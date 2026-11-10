import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dbAll as rawAll, dbRun, openDb } from '../src/main/db.ts'

// node:sqlite rows have a null prototype; spread them so deepEqual compares values
const dbAll = (sql: string): Record<string, unknown>[] => rawAll(sql).map((r) => ({ ...r }))
import { planShowImport } from '../src/shared/showsandbox.ts'
import { applyShowPlan } from '../src/main/showsandbox-import.ts'
import * as repo from '../src/main/repository.ts'

const lib = {
  'yamaha-dm7': {
    name: 'DM7',
    manufacturer: 'Yamaha',
    category: 'Console',
    ports: [
      { id: 'dante-pri', label: 'Dante Primary', connector: 'etherCON' },
      {
        template: true,
        id: 'local-out-{n}',
        label: 'OUT {n}',
        connector: 'XLR3M',
        direction: 'out',
        count: 2
      }
    ]
  },
  'netgear-m4250': {
    name: 'M4250',
    manufacturer: 'NETGEAR',
    category: 'Network Switch',
    ports: [{ template: true, id: 'access-{n}', label: 'Port {n}', connector: 'RJ45', count: 2 }]
  },
  'generic-amp': {
    name: 'Generic Amp',
    manufacturer: 'Generic',
    category: 'Amplifier',
    ports: [{ id: 'in-a', label: 'IN A', connector: 'XLR3F', direction: 'in' }]
  }
}

const show = {
  schema: 'showsandbox-show/1',
  meta: {
    name: 'Proof',
    ip_scheme: { 'Dante Primary': { subnet: '10.101.1.0', mask: 24, first: 11 } },
    vlans: { 'Dante Primary': { tag: 101 } }
  },
  positions: [{ id: 'p1', label: 'FOH' }],
  devices: [
    {
      uid: 'd1',
      device_id: 'yamaha-dm7',
      label: 'DM7',
      ident: 'CON1',
      rack_u: 10,
      rack: 'FOH Rack',
      ips: { 'dante-pri': '10.101.1.11' }
    },
    { uid: 'd2', device_id: 'netgear-m4250', label: 'M4250', ident: 'SW1', rack: 'FOH Rack' },
    { uid: 'd3', device_id: 'generic-amp', label: 'Generic Amp', position: 'p1' },
    { uid: 'd4', device_id: 'generic-amp', label: 'Generic Amp', rack: 'Stage Rack' }
  ],
  connections: [
    {
      from: { device: 'd1', port: 'dante-pri' },
      to: { device: 'd2', port: 'access-1' },
      cable_name: 'DA-001',
      cable_type: 'Cat6',
      bundle: ''
    },
    {
      // drawn backwards (input → output): the import flips it
      from: { device: 'd4', port: 'in-a' },
      to: { device: 'd1', port: 'local-out-1' },
      length_m: 30,
      cable_name: '',
      bundle: ''
    }
  ],
  library_snapshot: lib
}

test('plan: names, network ports, subnets, looms', () => {
  const plan = planShowImport(show)
  assert.deepEqual(
    plan.devices.map((d) => d.name),
    ['CON1', 'SW1', 'Generic Amp', 'Generic Amp (2)']
  )
  const con = plan.devices[0]
  assert.equal(con.deviceType, 'Yamaha DM7')
  assert.equal(plan.devices[2].deviceType, 'Generic Amp') // maker not doubled
  assert.equal(plan.cables[1].name, 'CON1 OUT 1 → Generic Amp (2) IN A') // unnamed cable
  assert.equal(con.location, 'FOH Rack')
  assert.deepEqual(con.ports, [{ label: 'Dante Primary', ip: '10.101.1.11' }]) // XLR outs aren't network ports
  assert.equal(plan.devices[1].isSwitch, true)
  assert.equal(plan.devices[2].location, 'FOH') // no rack → the position's label
  assert.deepEqual(plan.subnets, [{ name: 'Dante Primary', cidr: '10.101.1.0/24', vlan: '101' }])
  assert.equal(plan.cables[0].bundle, 'FOH RACK INBOARD')
  assert.equal(plan.cables[1].bundle, 'FOH RACK-STAGE RACK LOOM')
  assert.equal(plan.cables[1].notes, 'From: OUT 1 · To: IN A')
  assert.deepEqual(plan.circuits[1], {
    cableNumber: '',
    signal: '',
    estLength: '30 m',
    srcName: 'CON1',
    srcSocket: 'OUT 1',
    srcConnector: 'XLR3M',
    srcRack: 'FOH Rack',
    srcRackU: '10',
    srcSlot: '',
    dstName: 'Generic Amp (2)',
    dstSocket: 'IN A',
    dstConnector: 'XLR3F',
    dstRack: 'Stage Rack',
    dstRackU: '',
    dstSlot: ''
  })
  assert.equal(plan.circuits[0].cableNumber, 'DA-001')
  assert.throws(() => planShowImport({ schema: 'something-else' }), /not a ShowSandbox show/)
})

test('apply: writes the project, and a second import fills only what is empty', async () => {
  await openDb(join(mkdtempSync(join(tmpdir(), 'vwdm-ss-')), 'p.vwdm'))
  const plan = planShowImport(show)
  const first = applyShowPlan(plan)
  assert.equal(first.devicesAdded, 4)
  assert.equal(first.portsAdded, 3)
  assert.equal(first.subnetsAdded, 1)
  assert.equal(first.cablesAdded, 2)
  assert.equal(first.circuitsAdded, 2)
  assert.deepEqual(first.warnings, [])

  const port = dbAll(
    `SELECT p.ip_address, s.vlan FROM ports p JOIN devices d ON d.id = p.device_id
     LEFT JOIN subnets s ON s.id = p.untagged_subnet_id WHERE d.name = 'CON1'`
  )
  assert.deepEqual(port, [{ ip_address: '10.101.1.11', vlan: '101' }])
  const da = dbAll(
    `SELECT c.source_port_id IS NOT NULL AS sp, c.dest_port_id IS NOT NULL AS dp FROM cables c WHERE name = 'DA-001'`
  )
  assert.deepEqual(da, [{ sp: 1, dp: 1 }])

  // edits made on site must survive a re-import
  dbRun(`UPDATE devices SET mac_address = 'aa:bb', location = 'Moved' WHERE name = 'CON1'`)
  dbRun(`UPDATE ports SET ip_address = '10.101.1.99' WHERE label = 'Dante Primary'`)
  // the Patching page: a circuit from a ConnectCAD report, patch ticks, and a drawing-side number
  repo.mergeCircuits([{ ...plan.circuits[0], srcName: 'VW-ONLY', cableNumber: 'CC-1' }], {
    addOnly: true
  })
  dbRun(`UPDATE circuits SET src_patched = 1, cable_number = 'CC-77' WHERE cable_number = 'DA-001'`)
  const again = applyShowPlan(plan)
  assert.equal(again.devicesAdded, 0)
  assert.equal(again.devicesMatched, 4)
  assert.equal(again.portsAdded, 0)
  assert.equal(again.cablesAdded, 0)
  assert.equal(again.cablesSkipped, 2)
  assert.deepEqual(
    dbAll(
      `SELECT d.mac_address, d.location, p.ip_address FROM devices d JOIN ports p ON p.device_id = d.id WHERE d.name = 'CON1'`
    ),
    [{ mac_address: 'aa:bb', location: 'Moved', ip_address: '10.101.1.99' }]
  )
  assert.equal(dbAll('SELECT id FROM devices').length, 4)
  assert.equal(again.circuitsAdded, 0)
  assert.equal(again.circuitsKept, 2)
  assert.deepEqual(dbAll('SELECT src_name, cable_number, src_patched FROM circuits ORDER BY id'), [
    { src_name: 'CON1', cable_number: 'CC-77', src_patched: 1 },
    { src_name: 'CON1', cable_number: '', src_patched: 0 },
    { src_name: 'VW-ONLY', cable_number: 'CC-1', src_patched: 0 }
  ])
})
