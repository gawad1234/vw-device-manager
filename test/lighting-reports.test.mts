import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReport,
  compareValues,
  REPORT_PRESETS,
  type LightingReport
} from '../src/shared/lighting-reports.ts'
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
const preset = (id: string): LightingReport => REPORT_PRESETS.find((r) => r.id === id)!

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
  const r: LightingReport = {
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
