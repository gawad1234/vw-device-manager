import type { Fixture } from './types'

// Lighting paperwork: user-built report templates (channel hookup, instrument
// schedule, color schedule…) turned into tables. Pure, so the page preview, the
// PDF/Excel/CSV export and the tests all build the exact same rows.

export interface ReportColumn {
  /** a REPORT_FIELDS key */
  field: string
  label: string
  /** px in the preview; relative weight in the PDF; ~7px per Excel character */
  width: number
}

export interface LightingReport {
  id: string
  name: string
  /** list = one row per fixture; count = one row per distinct combination + a Count column */
  kind: 'list' | 'count'
  columns: ReportColumn[]
  /** a field to start a new section on ('' = none) */
  groupBy: string
  /** fields to sort by, in order */
  sortBy: string[]
  orientation: 'portrait' | 'landscape'
  /** body text size in the PDF, px */
  fontSize: number
}

export interface ReportSection {
  title: string
  rows: string[][]
}

export interface BuiltReport {
  headers: string[]
  widths: number[]
  sections: ReportSection[]
}

const ua = (f: Fixture): string =>
  f.universe != null && f.address != null ? `${f.universe}/${f.address}` : ''

/** Every field a column can show. */
export const REPORT_FIELDS: { key: string; label: string; get: (f: Fixture) => string }[] = [
  { key: 'channel', label: 'Channel', get: (f) => f.channel },
  { key: 'ua', label: 'U/A', get: ua },
  {
    key: 'universe',
    label: 'Universe',
    get: (f) => (f.universe == null ? '' : String(f.universe))
  },
  { key: 'address', label: 'Address', get: (f) => (f.address == null ? '' : String(f.address)) },
  { key: 'position', label: 'Position', get: (f) => f.position },
  { key: 'unit', label: 'Unit', get: (f) => f.unit },
  { key: 'instType', label: 'Instrument type', get: (f) => f.instType },
  { key: 'mode', label: 'Mode', get: (f) => f.mode },
  { key: 'purpose', label: 'Purpose', get: (f) => f.purpose },
  { key: 'color', label: 'Color', get: (f) => f.color },
  { key: 'gobo1', label: 'Gobo 1', get: (f) => f.gobo1 },
  { key: 'gobo2', label: 'Gobo 2', get: (f) => f.gobo2 },
  { key: 'accessories', label: 'Accessories', get: (f) => f.accessories },
  { key: 'wattage', label: 'Wattage', get: (f) => f.wattage },
  { key: 'dimmer', label: 'Dimmer', get: (f) => f.dimmer },
  { key: 'circuitName', label: 'Circuit name', get: (f) => f.circuitName },
  { key: 'circuitNumber', label: 'Circuit #', get: (f) => f.circuitNumber },
  { key: 'system', label: 'System', get: (f) => f.system },
  { key: 'mark', label: 'Mark', get: (f) => f.mark },
  ...[0, 1, 2, 3, 4, 5].map((i) => ({
    key: `user${i + 1}`,
    label: `User field ${i + 1}`,
    get: (f: Fixture) => f.userFields[i] ?? ''
  })),
  { key: 'notes', label: 'Notes', get: (f) => f.notes },
  { key: 'blank', label: '(blank — write-in)', get: () => '' }
]

const FIELD = new Map(REPORT_FIELDS.map((x) => [x.key, x]))

export const fieldLabel = (key: string): string => FIELD.get(key)?.label ?? key

export function fieldValue(f: Fixture, key: string): string {
  return FIELD.get(key)?.get(f) ?? ''
}

/** Numbers sort as numbers ("2" before "10"), U/A by universe then address, blanks last. */
export function compareValues(a: string, b: string): number {
  if (!a || !b) return a === b ? 0 : a ? -1 : 1
  const pa = /^(\d+)\/(\d+)$/.exec(a)
  const pb = /^(\d+)\/(\d+)$/.exec(b)
  if (pa && pb) return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2])
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

const col = (field: string, width: number, label = fieldLabel(field)): ReportColumn => ({
  field,
  label,
  width
})

/** The built-in templates, offered until the user saves their own. */
export const REPORT_PRESETS: LightingReport[] = [
  {
    id: 'channel-hookup',
    name: 'Channel hookup',
    kind: 'list',
    columns: [
      col('channel', 60, 'Chan'),
      col('ua', 60),
      col('position', 140),
      col('unit', 50, 'Unit'),
      col('instType', 220),
      col('purpose', 160),
      col('color', 80),
      col('gobo1', 110, 'Gobo')
    ],
    groupBy: '',
    sortBy: ['channel', 'ua'],
    orientation: 'landscape',
    fontSize: 11
  },
  {
    id: 'instrument-schedule',
    name: 'Instrument schedule',
    kind: 'list',
    columns: [
      col('unit', 50),
      col('instType', 220),
      col('purpose', 160),
      col('channel', 60, 'Chan'),
      col('ua', 60),
      col('color', 80),
      col('gobo1', 110, 'Gobo'),
      col('accessories', 120)
    ],
    groupBy: 'position',
    sortBy: ['unit'],
    orientation: 'landscape',
    fontSize: 11
  },
  {
    id: 'patch',
    name: 'Patch (by address)',
    kind: 'list',
    columns: [
      col('ua', 70),
      col('channel', 60, 'Chan'),
      col('instType', 220),
      col('mode', 100),
      col('position', 140),
      col('unit', 50)
    ],
    groupBy: '',
    sortBy: ['ua'],
    orientation: 'portrait',
    fontSize: 11
  },
  {
    id: 'color-schedule',
    name: 'Color schedule',
    kind: 'count',
    columns: [col('color', 120), col('instType', 260)],
    groupBy: '',
    sortBy: ['color', 'instType'],
    orientation: 'portrait',
    fontSize: 12
  },
  {
    id: 'gobo-pull',
    name: 'Gobo pull list',
    kind: 'count',
    columns: [col('gobo1', 200, 'Gobo'), col('instType', 260)],
    groupBy: '',
    sortBy: ['gobo1', 'instType'],
    orientation: 'portrait',
    fontSize: 12
  }
]

/** Turn a template + the rig into the table the preview and every export print. */
export function buildReport(r: LightingReport, fixtures: Fixture[]): BuiltReport {
  const fields = r.columns.map((c) => c.field)
  const sortKeys = [r.groupBy, ...r.sortBy].filter(Boolean)
  const cmp = (a: Fixture, b: Fixture): number => {
    for (const k of sortKeys) {
      const d = compareValues(fieldValue(a, k), fieldValue(b, k))
      if (d) return d
    }
    return 0
  }
  // a count report's first column is what's counted (the color, the gobo…): skip fixtures without one
  const rig = [...fixtures]
    .filter((f) => r.kind === 'list' || !fields.length || fieldValue(f, fields[0]))
    .sort(cmp)

  const sections = new Map<string, Fixture[]>()
  for (const f of rig) {
    const t = r.groupBy ? fieldValue(f, r.groupBy) || '(none)' : ''
    sections.set(t, [...(sections.get(t) ?? []), f])
  }

  const out: ReportSection[] = []
  for (const [title, list] of sections) {
    if (r.kind === 'list') {
      out.push({ title, rows: list.map((f) => fields.map((k) => fieldValue(f, k))) })
      continue
    }
    // count: distinct combinations in sorted order, each with how many fixtures share it
    const counts = new Map<string, { cells: string[]; n: number }>()
    for (const f of list) {
      const cells = fields.map((k) => fieldValue(f, k))
      const key = JSON.stringify(cells)
      const c = counts.get(key)
      if (c) c.n++
      else counts.set(key, { cells, n: 1 })
    }
    out.push({ title, rows: [...counts.values()].map((c) => [...c.cells, String(c.n)]) })
  }

  const count = r.kind === 'count'
  return {
    headers: [...r.columns.map((c) => c.label), ...(count ? ['Count'] : [])],
    widths: [...r.columns.map((c) => c.width), ...(count ? [60] : [])],
    sections: out
  }
}
