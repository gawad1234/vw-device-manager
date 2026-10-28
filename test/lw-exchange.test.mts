import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildExchange,
  fixtureFromExchange,
  fixtureToExchange,
  fromAbsolute,
  parseExchange,
  toAbsolute,
  utcStamp
} from '../src/shared/lw-exchange.ts'
import { checkPatch, type PatchWarning } from '../src/shared/lighting-checks.ts'
import type { Fixture } from '../src/shared/types.ts'

// A real Vectorworks export of a 5-fixture scratch drawing (no show data).
const sample = readFileSync(new URL('./fixtures/lx-test.xml', import.meta.url), 'utf8')

test('reads a Vectorworks full export', () => {
  const x = parseExchange(sample)
  assert.equal(x.appStamp, 'Vectorworks')
  assert.equal(x.action, 'Entire Plot')
  assert.equal(x.fixtures.length, 5)
  const unit5 = x.fixtures.find((f) => f.Unit_Number === '5')!
  assert.equal(unit5.UID, '1001.1.1.0.0')
  assert.equal(unit5.Template, 'G673-Linear Breakup 2')
  assert.equal(unit5.Inst_Type, 'ETC Source 4 LED Series 3 Lustr X8 XDLT 26°')
  assert.deepEqual(x.universes.A[1], { universe: 2, start: 513, end: 1024 })
  assert.deepEqual(Object.keys(x.universes), ['A', 'B', 'C', 'D', 'E', 'F'])
  assert.ok(x.fieldList.some(([t, l]) => t === 'Template' && l === 'Gobo 1'))
  assert.ok(x.header.some(([t]) => t === 'VWVersion'))
})

test('reads self-closing tags, entities and a consumed (empty) reply', () => {
  const x = parseExchange(
    '<SLData><InstrumentData><Action/><AppStamp>Vectorworks</AppStamp>' +
      '<UID_1_1><UID>1.1</UID><Lightwright_ID>7</Lightwright_ID><Purpose>Fill &amp; key</Purpose><Color/></UID_1_1>' +
      '</InstrumentData></SLData>'
  )
  assert.equal(x.action, '')
  assert.deepEqual(x.fixtures[0], {
    UID: '1.1',
    Lightwright_ID: '7',
    Purpose: 'Fill & key',
    Color: ''
  })
  assert.equal(
    parseExchange('<SLData><InstrumentData><Action/></InstrumentData></SLData>').fixtures.length,
    0
  )
})

test('absolute addresses ↔ universe/address', () => {
  const { universes } = parseExchange(sample)
  assert.deepEqual(fromAbsolute(513, 'A', universes), { universe: 2, address: 1 })
  assert.deepEqual(fromAbsolute(25, 'A', universes), { universe: 1, address: 25 })
  assert.deepEqual(fromAbsolute(0, 'A', universes), { universe: null, address: null })
  assert.deepEqual(fromAbsolute(1030, 'A', {}), { universe: 3, address: 6 })
  assert.equal(toAbsolute(2, 1, 'A', universes), 513)
  assert.equal(toAbsolute(null, 1, 'A', universes), 0)
})

test('what we write back reads as Lightwright with our ids and edits', () => {
  const x = parseExchange(sample)
  const fixtures = x.fixtures.map((f, i) => ({ ...fixtureFromExchange(f, x.universes), id: i + 1 }))
  const unit4 = fixtures.find((f) => f.unit === '4')!
  unit4.channel = '20'
  unit4.universe = 2
  unit4.address = 1
  unit4.purpose = 'Key <left>'
  const xml = buildExchange(
    fixtures.map((f) => fixtureToExchange(f, x.universes)),
    x,
    new Date('2026-10-27T23:09:09Z')
  )
  assert.ok(!xml.includes('Vectorworks</AppStamp>'), 'every AppStamp must be Lightwright')
  const back = parseExchange(xml)
  assert.equal(back.appStamp, 'Lightwright')
  assert.equal(back.action, 'Entire Plot')
  assert.equal(back.universeBlock.length > 0, true)
  const f4 = back.fixtures.find((f) => f.Unit_Number === '4')!
  assert.equal(f4.Channel, '20')
  assert.equal(f4.Absolute_Address, '513')
  assert.equal(f4.Purpose, 'Key <left>')
  assert.equal(f4.Lightwright_ID, String(unit4.id))
  assert.equal(f4.TimeStamp, '20261027230909')
  assert.equal(f4.X_Location_mm, '-177.800000', 'drawing-only fields go back untouched')
  assert.equal(utcStamp(new Date('2026-01-02T03:04:05.678Z')), '20260102030405')
})

test('an update keeps app-only mode and notes', () => {
  const x = parseExchange(sample)
  const prev = {
    ...fixtureFromExchange(x.fixtures[0], x.universes),
    mode: '8ch',
    notes: 'hang first'
  }
  const next = fixtureFromExchange({ UID: prev.vwUid, Channel: '99' }, x.universes, prev)
  assert.equal(next.channel, '99')
  assert.equal(next.mode, '8ch')
  assert.equal(next.notes, 'hang first')
  assert.equal(next.purpose, prev.purpose)
  assert.equal(next.address, prev.address)
})

test('patch checks: overlap, past 512, half patched, unknown footprint, no node', () => {
  const base = fixtureFromExchange({}, {})
  const fx = (id: number, o: Partial<typeof base>): Fixture => ({
    ...base,
    id,
    instType: 'Spot',
    ...o
  })
  const types = [{ name: 'Spot', modes: [{ name: '', footprint: 10 }] }]
  const w = checkPatch(
    [
      fx(1, { position: 'FOH', unit: '1', channel: '1', universe: 1, address: 1 }),
      fx(2, { position: 'FOH', unit: '2', channel: '2', universe: 1, address: 5 }),
      fx(3, { channel: '3', universe: 1, address: 15 }),
      fx(4, { channel: '4', universe: 2, address: 510 }),
      fx(5, { channel: '5' }),
      fx(6, { instType: 'Mystery', channel: '6', universe: 2, address: 100 })
    ],
    types,
    { universes: { '1': { deviceId: 3, label: '' } } }
  )
  const kinds = (k: string): PatchWarning[] => w.filter((x) => x.kind === k)
  assert.deepEqual(
    kinds('overlap').map((x) => x.ids),
    [[1, 2]]
  )
  assert.match(kinds('overlap')[0].message, /FOH #1 \(1\/1–10\) overlaps FOH #2 \(1\/5–14\)/)
  assert.deepEqual(
    kinds('past512').map((x) => x.ids),
    [[4]]
  )
  assert.deepEqual(
    kinds('halfPatched').map((x) => x.ids),
    [[5]]
  )
  assert.deepEqual(
    kinds('unknownFootprint').map((x) => x.ids),
    [[6]]
  )
  assert.deepEqual(
    kinds('noNode').map((x) => x.universe),
    [2]
  )
})
