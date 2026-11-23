import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checklistRecords,
  fillDetail,
  normalizeSteps,
  DEFAULT_STEPS,
  type ChecklistDevice
} from '../src/shared/checklist.ts'
import { buildReport, PRESETS } from '../src/shared/paperwork.ts'

const bare: ChecklistDevice = {
  name: 'Media 1',
  category: 'Servers',
  location: '',
  mac: '',
  isSwitch: false,
  mgmtIp: '',
  oobIp: '',
  ports: [],
  software: [],
  projectorModel: '',
  projectorSettings: 0,
  displays: 0,
  patch: [],
  racks: []
}

test('a bare device gets only the always-steps, no empty phases', () => {
  const recs = checklistRecords(DEFAULT_STEPS, bare)
  assert.deepEqual(
    recs.map((r) => r.step),
    [
      'Record serial / asset tag',
      'Physical check, no damage',
      'Power on and test',
      'Tech sign-off and date'
    ]
  )
  assert.deepEqual(
    [...new Set(recs.map((r) => r.phase))],
    ['1. Receive & inspect', '7. Burn-in / test', '9. Final sign-off']
  )
})

test('data-driven steps give one line per item, empty [parts] drop out', () => {
  const d: ChecklistDevice = {
    ...bare,
    ports: [
      { port: 'NIC 1', ip: '10.0.1.5', network: 'Media', vlan: '10', tagged: '' },
      { port: 'NIC 2', ip: '', network: '', vlan: '', tagged: '' }, // unused: no line
      { port: 'NIC 3', ip: '', network: 'Ctrl', vlan: '20', tagged: '30, 40' }
    ],
    racks: ['Rack A · U12']
  }
  const recs = checklistRecords(DEFAULT_STEPS, d)
  assert.deepEqual(
    recs.filter((r) => r.step === 'Set IP and VLAN').map((r) => r.detail),
    ['NIC 1: 10.0.1.5 (Media) VLAN 10', 'NIC 3: (Ctrl) VLAN 20 tagged 30, 40']
  )
  assert.deepEqual(
    recs.filter((r) => r.step === 'Install in rack').map((r) => r.detail),
    ['Rack A · U12']
  )
  assert.equal(
    fillDetail('[Mgmt {mgmtIp}] [OOB {oobIp}]', { mgmtIp: '', oobIp: '1.2.3.4' }),
    'OOB 1.2.3.4'
  )
})

test('a step limited to categories skips other devices (case-insensitive)', () => {
  const steps = [{ ...DEFAULT_STEPS[0], categories: ['servers'] }]
  assert.equal(checklistRecords(steps, bare).length, 1)
  assert.equal(checklistRecords(steps, { ...bare, category: 'Displays' }).length, 0)
})

test('steps read from library.json are cleaned, junk dropped', () => {
  assert.equal(normalizeSteps(null), DEFAULT_STEPS)
  const out = normalizeSteps([
    { phase: 4, trigger: 'ports', title: 'IP', signoff: 'nope', categories: 'x' },
    { phase: 12, trigger: 'ports' },
    { phase: 2, trigger: 'rm -rf' },
    'junk'
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].signoff, 'check')
  assert.deepEqual(out[0].categories, [])
})

test('the built-in template prints phases in order and names a multi-line step once', () => {
  const t = PRESETS.find((p) => p.id === 'checklist')!
  const d: ChecklistDevice = {
    ...bare,
    patch: [
      { direction: 'Out', socket: 'OUT 1', other: 'Proj A › IN', cable: 'C1', signal: 'HDMI' },
      { direction: 'Out', socket: 'OUT 2', other: 'Proj B › IN', cable: '', signal: '' }
    ]
  }
  const built = buildReport(t, checklistRecords(DEFAULT_STEPS, d))
  assert.deepEqual(built.headers, ['Step', 'Detail', 'Done'])
  assert.deepEqual(
    built.sections.map((s) => s.title),
    ['1. Receive & inspect', '6. Labeling', '7. Burn-in / test', '9. Final sign-off']
  )
  const labeling = built.sections[1]
  assert.deepEqual(
    labeling.rows.map((r) => r[1]),
    ['OUT 1 → Proj A › IN · cable C1 · HDMI', 'OUT 2 → Proj B › IN']
  )
  assert.deepEqual(
    labeling.spans?.map((s) => s[0]),
    [2, 0]
  ) // "Label and patch" once
  assert.equal(built.sections[0].rows[0][2], '______________') // serial: write-in
})
