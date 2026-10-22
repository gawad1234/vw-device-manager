import type { CrewDay, CrewRates } from './types'

/** Hours between "HH:MM" call and end; an end at/before the call wraps past midnight. 0 if either is blank. */
export function shiftHours(call: string, end: string): number {
  const mins = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const a = mins(call)
  const b = mins(end)
  if (a == null || b == null) return 0
  return ((b - a + 1440) % 1440 || 1440) / 60
}

export interface CrewTotals {
  workDays: number
  hours: number
  otHours: number
  cost: number
  /** hourly crew with work days that have no call/end time (can't be costed) */
  untimedDays: number
}

/** Totals for one person over their days. Day rate: rate × work days. Hourly: straight time up to
 *  `otAfterHours` a day, then `otMultiplier`× for the rest. */
export function crewTotals(rates: CrewRates, days: CrewDay[]): CrewTotals {
  const t: CrewTotals = { workDays: 0, hours: 0, otHours: 0, cost: 0, untimedDays: 0 }
  for (const d of days) {
    if (d.status !== 'work') continue
    t.workDays++
    const h = shiftHours(d.call, d.end)
    t.hours += h
    if (rates.rateType === 'day') {
      t.cost += rates.dayRate
      continue
    }
    if (!h) t.untimedDays++
    const ot = Math.max(0, h - rates.otAfterHours)
    t.otHours += ot
    t.cost += (h - ot) * rates.hourlyRate + ot * rates.hourlyRate * rates.otMultiplier
  }
  return t
}

/** Every "YYYY-MM-DD" from start to end inclusive (empty if either is missing or end < start). */
export function dateRange(start: string, end: string): string[] {
  if (!start || !end) return []
  const out: string[] = []
  const d = new Date(start + 'T12:00:00Z')
  const last = new Date(end + 'T12:00:00Z')
  // shortcut: capped at a year so a typo in the end date can't build a huge grid
  while (d <= last && out.length < 366) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
