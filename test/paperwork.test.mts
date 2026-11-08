import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReport,
  compareValues,
  fieldsFor,
  PRESETS,
  usedBy,
  withBuiltIns,
  type CableRec,
  type PaperworkTemplate,
  type PatchRec,
  type PortRec
} from '../src/shared/paperwork.ts'
import type { Fixture } from '../src/shared/types.ts'

const fx = (id: number, p: Partial<Fixture>): Fixture => ({
  id,
  vwUid: '',
  position: '',
  unit: '',
  instType: 'Source 4',
  mode: '',
  purpose: '',
  channel: '',
  universe: null,
  address: null,
  system: '',
  color: '',
  gobo1: '',
  gobo2: '',
  accessories: '',
  wattage: '',
  dimmer: '',
  circuitName: '',
  circuitNumber: '',
  mark: '',
  userFields: ['', '', '', '', '', ''],
  notes: '',
  vw: {},
  ...p
})

const rig = [
  fx(1, { position: '1E', unit: '10', channel: '10', universe: 2, address: 1, color: 'L201' }),
  fx(2, { position: '1E', unit: '2', channel: '2', universe: 1, address: 101, color: 'L201' }),
  fx(3, { position: 'FOH', unit: '1', channel: '1', universe: 1, address: 11, color: 'R02' }),
  fx(4, { position: 'FOH', unit: '3', channel: '', color: '' })
]
const preset = (id: string): PaperworkTemplate => PRESETS.find((r) => r.id === id)!

test('values sort as numbers, U/A by universe then address, blanks last', () => {
  assert.deepEqual(['10', '2', '', '1'].sort(compareValues), ['1', '2', '10', ''])
  assert.deepEqual(['2/1', '1/101', '1/11'].sort(compareValues), ['1/11', '1/101', '2/1'])
})

test('channel hookup: one row per fixture in channel order', () => {
  const b = buildReport(preset('channel-hookup'), rig)
  assert.equal(b.sections.length, 1)
  assert.deepEqual(
    b.sections[0].rows.map((r) => r[0]),
    ['1', '2', '10', '']
  )
  assert.equal(b.headers[0], 'Chan')
  assert.equal(b.widths.length, b.headers.length)
})

test('instrument schedule: a section per position, units in order', () => {
  const b = buildReport(preset('instrument-schedule'), rig)
  assert.deepEqual(
    b.sections.map((s) => [s.title, s.rows.map((r) => r[0])]),
    [
      ['1E', ['2', '10']],
      ['FOH', ['1', '3']]
    ]
  )
})

test('color schedule counts each color + type and skips fixtures with no color', () => {
  const b = buildReport(preset('color-schedule'), rig)
  assert.deepEqual(b.headers, ['Color', 'Instrument type', 'Count'])
  assert.deepEqual(b.sections[0].rows, [
    ['L201', 'Source 4', '2'],
    ['R02', 'Source 4', '1']
  ])
})

test('custom columns keep their heading, order and width', () => {
  const r: PaperworkTemplate = {
    ...preset('patch'),
    columns: [
      { field: 'purpose', label: 'What', width: 200 },
      { field: 'blank', label: 'Checked', width: 40 }
    ]
  }
  const b = buildReport(r, rig)
  assert.deepEqual(b.headers, ['What', 'Checked'])
  assert.deepEqual(b.widths, [200, 40])
  assert.equal(b.sections[0].rows[0][1], '')
})

const cable = (bundle: string, name: string, pulled: boolean): CableRec => ({
  bundle,
  bundleColor: bundle === 'FOH snake' ? '#e0685f' : '#4f8fdf',
  bundleFrom: 'FOH',
  bundleTo: 'Stage L',
  cable: name,
  type: 'Cat6',
  from: 'A',
  to: 'B',
  length: "150'",
  pulled,
  labeled: false,
  notes: ''
})

test('pull sheet: a section per bundle with its color and route, check boxes centered', () => {
  const b = buildReport(preset('pullsheet'), [
    cable('Video run', 'V-001', true),
    cable('FOH snake', 'A-002', false),
    cable('FOH snake', 'A-001', true)
  ])
  assert.deepEqual(b.headers, ['Cable', 'Type', 'From', 'To', 'Pulled', 'Labeled'])
  assert.deepEqual(
    b.sections.map((s) => [s.title, s.color, s.note, s.rows.map((r) => r[0] + r[4])]),
    [
      ['FOH snake', '#e0685f', "FOH → Stage L · 150'", ['A-001☑', 'A-002☐']],
      ['Video run', '#4f8fdf', "FOH → Stage L · 150'", ['V-001☑']]
    ]
  )
  assert.deepEqual(b.center, [false, false, false, false, true, true])
})

test('device list sections put Uncategorized last', () => {
  const dev = (name: string, category: string): object => ({
    name,
    category,
    type: '',
    location: '',
    vlan: '',
    ip: ''
  })
  const b = buildReport(preset('devicelist'), [dev('Laptop', ''), dev('Console', 'Audio')])
  assert.deepEqual(
    b.sections.map((s) => [s.title, s.count]),
    [
      ['Audio', 1],
      ['Uncategorized', 1]
    ]
  )
})

test('IP schedule merges a device’s own cells across its ports and bands per device', () => {
  const port = (device: string, port: string, vlan: string): PortRec => ({
    device,
    mac: device === 'Console' ? 'AA' : '',
    type: 'T',
    location: 'FOH',
    category: '',
    port,
    ip: '',
    network: '',
    vlan
  })
  const b = buildReport(preset('ipschedule-devices'), [
    port('Console', 'Dante', '20'),
    port('Media', 'Eth1', '10'),
    port('Console', 'Ctrl', '10')
  ])
  const s = b.sections[0]
  assert.deepEqual(
    s.rows.map((r) => r[0] + ':' + r[4]),
    ['Console:Ctrl', 'Console:Dante', 'Media:Eth1']
  )
  assert.deepEqual(s.spans, [
    [2, 2, 2, 2, 1, 1, 1, 1],
    [0, 0, 0, 0, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1]
  ])
  assert.deepEqual(s.bands, [0, 0, 1])
})

test('case fields become columns; the load sheet lists cases with a Loaded box', () => {
  const cases = [
    {
      tripId: 1,
      trip: 'Load-in',
      name: 'B',
      description: '',
      contents: '',
      fields: { Weight: '9' }
    },
    { tripId: 1, trip: 'Load-in', name: 'A', description: '', contents: '', fields: {} }
  ]
  assert.ok(fieldsFor('cases', cases).some((f) => f.key === 'field:Weight'))
  const t = preset('loadsheet')
  const b = buildReport(
    { ...t, columns: [...t.columns, { field: 'field:Weight', label: 'Weight', width: 50 }] },
    cases
  )
  assert.deepEqual(b.sections[0].rows, [
    ['A', '', '', '☐', ''],
    ['B', '', '', '☐', '9']
  ])
})

test('v2.9.0 lighting templates carry over and every export’s built-in is added', () => {
  const legacy = [{ ...preset('patch'), name: 'My patch' }].map(
    ({ source: _s, mergeRepeats: _m, ...t }) => t
  )
  const list = withBuiltIns(null, legacy)
  assert.equal(list[0].name, 'My patch')
  assert.equal(list[0].source, 'fixtures')
  for (const id of [
    'pullsheet',
    'schedule',
    'devicelist',
    'ipschedule-switches',
    'ipschedule-devices',
    'loadsheet'
  ])
    assert.ok(
      list.some((t) => t.id === id),
      id
    )
  // a deleted lighting preset stays deleted; a saved edit to a built-in is kept
  const saved = withBuiltIns([{ ...preset('pullsheet'), name: 'Mine' }], null)
  assert.equal(saved.filter((t) => t.id === 'pullsheet').length, 1)
  assert.equal(saved[0].name, 'Mine')
  assert.ok(!saved.some((t) => t.id === 'channel-hookup'))
  assert.equal(usedBy('channel-hookup'), null)
  assert.match(usedBy('ipschedule-devices') ?? '', /IP schedule/)
})

test('patch sheet: inputs then outputs, each sorted by socket, "device › socket" ends', () => {
  const rec = (o: Partial<PatchRec>): PatchRec => ({
    device: 'MTX1',
    direction: 'Inputs',
    socket: '',
    srcDevice: '',
    srcSocket: '',
    dstDevice: '',
    dstSocket: '',
    signal: 'HDMI',
    cable: '',
    connector: '',
    rack: '',
    patched: false,
    tested: false,
    notes: '',
    ...o
  })
  const recs = [
    rec({
      direction: 'Outputs',
      socket: 'OUT 1',
      srcDevice: 'MTX1',
      srcSocket: 'OUT 1',
      dstDevice: 'PJ1',
      dstSocket: 'HDMI 1'
    }),
    rec({
      socket: 'IN 10',
      srcDevice: 'SRV2',
      srcSocket: 'OUT 1',
      dstDevice: 'MTX1',
      dstSocket: 'IN 10',
      patched: true
    }),
    rec({
      socket: 'IN 2',
      srcDevice: 'SRV1',
      srcSocket: 'OUT 1',
      dstDevice: 'MTX1',
      dstSocket: 'IN 2'
    })
  ]
  const r = buildReport(preset('patchsheet'), recs)
  assert.deepEqual(r.headers, ['Source', 'Destination', 'Signal', 'Cable #', 'Patched'])
  assert.deepEqual(
    r.sections.map((s) => s.title),
    ['Inputs', 'Outputs']
  )
  assert.deepEqual(
    r.sections[0].rows.map((row) => [row[0], row[1], row[4]]),
    [
      ['SRV1 › OUT 1', 'MTX1 › IN 2', '☐'],
      ['SRV2 › OUT 1', 'MTX1 › IN 10', '☑']
    ]
  )
  assert.equal(usedBy('patchsheet'), 'Patching › Patch sheets')
})
