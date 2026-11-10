import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cableLabelCsv, cableLabelFile, VECTORLABEL_HEADERS } from '../src/shared/vectorlabel.ts'
import type { Circuit } from '../src/shared/types.ts'

const c = {
  id: 7,
  cableNumber: 'M9003',
  signal: 'HDMI',
  estLength: '25',
  srcName: 'ACT102',
  srcSocket: 'DP_OUT 2',
  srcConnector: 'HDMI',
  srcRack: 'VIDEO RACK 1',
  srcRackU: '12',
  srcSlot: '',
  dstName: 'CNV-21',
  dstSocket: 'IN "A", 1',
  dstConnector: 'HDMI',
  dstRack: 'VIDEO RACK 1',
  dstRackU: '18',
  dstSlot: ''
} as Circuit

test('one row per end, in VectorLabel export columns, quoted where needed', () => {
  const lines = cableLabelCsv(c).split('\r\n')
  assert.equal(lines[0], VECTORLABEL_HEADERS.join(','))
  assert.equal(lines.length, 4) // header, Source, Destination, trailing ''
  assert.equal(
    lines[1],
    'Source,M9003,,HDMI,1,25,,,,,,ACT102,ACT102,DP_OUT 2,DP_OUT 2,HDMI,HDMI,1,,VIDEO RACK 1,12,CNV-21,"IN ""A"", 1",HDMI'
  )
  assert.ok(lines[2].startsWith('Destination,M9003,,HDMI,1,25,,,,,,CNV-21,CNV-21,"IN ""A"", 1",'))
  assert.ok(lines[2].endsWith(',VIDEO RACK 1,18,ACT102,DP_OUT 2,HDMI'))
})

test("file name matches Auto Print's _export_YYYYMMDD_HHMMSS.csv pattern", () => {
  const { folder, file } = cableLabelFile('Gala: Night/1', c, new Date(2026, 10, 10, 9, 5, 7))
  assert.equal(folder, 'Gala- Night-1')
  assert.equal(file, 'Gala- Night-1 M9003_export_20261110_090507.csv')
  assert.match(file, /_export_\d{8}_\d{6}\.csv$/)
  assert.equal(cableLabelFile('', { ...c, cableNumber: '' }).folder, 'Device Manager')
})
