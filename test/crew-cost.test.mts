import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crewTotals, dateRange, shiftHours } from '../src/shared/crew-cost.ts'

const hourly = {
  rateType: 'hourly' as const,
  dayRate: 0,
  hourlyRate: 40,
  otAfterHours: 10,
  otMultiplier: 1.5
}

test('shift hours, including past midnight', () => {
  assert.equal(shiftHours('08:00', '18:30'), 10.5)
  assert.equal(shiftHours('20:00', '02:00'), 6)
  assert.equal(shiftHours('08:00', ''), 0)
})

test('hourly pay goes to overtime after the daily threshold', () => {
  const t = crewTotals(hourly, [
    { status: 'work', call: '08:00', end: '20:00' }, // 12 h = 10 straight + 2 OT
    { status: 'off', call: '08:00', end: '20:00' }, // off days cost nothing
    { status: 'work', call: '', end: '' } // untimed: counted as a day, flagged, costs 0
  ])
  assert.deepEqual(t, {
    workDays: 2,
    hours: 12,
    otHours: 2,
    cost: 10 * 40 + 2 * 60,
    untimedDays: 1
  })
})

test('day rate pays per work day regardless of hours', () => {
  const t = crewTotals({ ...hourly, rateType: 'day', dayRate: 450 }, [
    { status: 'work', call: '', end: '' },
    { status: 'work', call: '06:00', end: '23:00' }
  ])
  assert.equal(t.cost, 900)
  assert.equal(t.untimedDays, 0)
})

test('date range is inclusive and empty when backwards', () => {
  assert.deepEqual(dateRange('2026-10-30', '2026-11-02'), [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02'
  ])
  assert.deepEqual(dateRange('2026-11-02', '2026-10-30'), [])
})
