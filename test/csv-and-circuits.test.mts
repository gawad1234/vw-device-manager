import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell } from '../src/main/csv.ts'
import { parseCircuitReport } from '../src/main/circuit-import.ts'

test('csvCell defuses formula-looking cells but leaves signed numbers alone', () => {
  for (const v of ['=SUM(A1)', '+cmd', '-x', '@foo']) assert.equal(csvCell(v), "'" + v)
  assert.equal(csvCell('-12.5'), '-12.5')
  assert.equal(csvCell('+44'), '+44')
  assert.equal(csvCell('a,"b"'), '"a,""b"""')
  assert.equal(csvCell('=a,b'), `"'=a,b"`)
})

test('parseCircuitReport keeps circuit rows and skips header and width rows', () => {
  const row = (c: Record<number, string>): string =>
    Array.from({ length: 22 }, (_, i) => c[i] ?? '').join(',')
  const text = [
    row({ 0: 'Number', 2: 'Signal', 9: 'Src_Dev', 17: 'Dst_Dev' }),
    row({ 2: '12', 9: '30', 17: '30' }),
    row({
      0: 'C-1',
      2: 'Dante',
      4: '10m',
      9: 'Switch 1',
      10: 'P1',
      12: 'RJ45',
      17: 'Amp',
      18: 'Net'
    }),
    '"C-2",x,"SDI, 3G"' // too few fields
  ].join('\r\n')
  const rows = parseCircuitReport(text)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].cableNumber, 'C-1')
  assert.equal(rows[0].signal, 'Dante')
  assert.equal(rows[0].srcName, 'Switch 1')
  assert.equal(rows[0].srcSocket, 'P1')
  assert.equal(rows[0].estLength, '10m')
})
