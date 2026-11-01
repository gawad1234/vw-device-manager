import type { Fixture } from './types'

// Paperwork: user-built report templates (pull sheet, IP schedule, channel
// hookup, load sheet…) turned into tables. Every source of rows (cables,
// devices, ports, fixtures, cases) is read through one field list, so the
// Paperwork preview, the PDF/Excel/CSV exports and the tests all build the
// exact same rows. Pure: the main process supplies the records.

export type PaperworkSource = 'cables' | 'devices' | 'switchPorts' | 'ports' | 'cases' | 'fixtures'

export interface ReportColumn {
  /** a field key of the template's source */
  field: string
  label: string
  /** px in the preview; relative weight in the PDF; ~7px per Excel character */
  width: number
}

export interface PaperworkTemplate {
  id: string
  name: string
  /** which rows it lists */
  source: PaperworkSource
  /** list = one row per record; count = one row per distinct combination + a Count column */
  kind: 'list' | 'count'
  columns: ReportColumn[]
  /** a field to start a new section on ('' = none) */
  groupBy: string
  /** fields to sort by, in order */
  sortBy: string[]
  /** merge repeated values down the first N columns into one cell (0 = off) */
  mergeRepeats: number
  orientation: 'portrait' | 'landscape'
  /** body text size in the PDF, px */
  fontSize: number
}

// ---- Records (plain objects the main process builds from the database) -----

export interface CableRec {
  bundle: string
  bundleColor: string
  bundleFrom: string
  bundleTo: string
  cable: string
  type: string
  from: string
  to: string
  length: string
  pulled: boolean
  labeled: boolean
  notes: string
}

export interface DeviceRec {
  name: string
  /** '' = uncategorized */
  category: string
  type: string
  location: string
  vlan: string
  ip: string
}

/** One row per used jack of a non-switch device ('—' port for a device with none). */
export interface PortRec {
  device: string
  mac: string
  type: string
  location: string
  category: string
  port: string
  ip: string
  network: string
  vlan: string
}

/** One row per used port of a switch. */
export interface SwitchPortRec {
  switch: string
  mgmtIp: string
  oobIp: string
  location: string
  port: string
  /** numeric VLAN of the native network, for sorting */
  vlan: string
  nativeVlan: string
  taggedVlans: string
}

/** One case on a truck trip. */
export interface CaseRec {
  tripId: number
  trip: string
  name: string
  description: string
  contents: string
  /** the case's own fields by label (e.g. Weight) */
  fields: Record<string, string>
}

// ---- Sources -----------------------------------------------------------------

interface Field {
  key: string
  label: string
  get: (r: object) => string
  /** centered (check boxes, short codes) */
  center?: boolean
  /** a section heading for a blank value */
  blank?: string
}

export interface SourceDef {
  label: string
  /** sidebar grouping on the Paperwork page */
  area: string
  fields: Field[]
  /** extra heading info when a template sections by `field` (a bundle's color, its route) */
  section?: { field: string; color: (r: object) => string; note: (r: object) => string }
  /** fields read from each record's own `fields` map (case fields); key = `field:<label>` */
  dynamic?: (r: object) => Record<string, string>
}

const box = (on: boolean): string => (on ? '☑' : '☐')

function fieldsOf<T>(
  list: { key: string; label: string; get: (r: T) => string; center?: boolean; blank?: string }[]
): Field[] {
  return list as unknown as Field[]
}

const fixtureFields = fieldsOf<Fixture>([
  { key: 'channel', label: 'Channel', get: (f) => f.channel },
  {
    key: 'ua',
    label: 'U/A',
    get: (f) => (f.universe != null && f.address != null ? `${f.universe}/${f.address}` : '')
  },
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
  { key: 'notes', label: 'Notes', get: (f) => f.notes }
])

const BLANK: Field = { key: 'blank', label: '(blank — write-in)', get: () => '' }

export const SOURCES: Record<PaperworkSource, SourceDef> = {
  cables: {
    label: 'Cables',
    area: 'Cables',
    fields: fieldsOf<CableRec>([
      { key: 'bundle', label: 'Bundle', get: (r) => r.bundle },
      { key: 'cable', label: 'Cable', get: (r) => r.cable },
      { key: 'type', label: 'Type', get: (r) => r.type },
      { key: 'from', label: 'From', get: (r) => r.from },
      { key: 'to', label: 'To', get: (r) => r.to },
      { key: 'length', label: 'Length', get: (r) => r.length },
      { key: 'bundleFrom', label: 'Bundle from', get: (r) => r.bundleFrom },
      { key: 'bundleTo', label: 'Bundle to', get: (r) => r.bundleTo },
      { key: 'pulledBox', label: 'Pulled ☐', get: (r) => box(r.pulled), center: true },
      { key: 'labeledBox', label: 'Labeled ☐', get: (r) => box(r.labeled), center: true },
      { key: 'pulled', label: 'Pulled ✓', get: (r) => (r.pulled ? '☑' : ''), center: true },
      { key: 'labeled', label: 'Labeled ✓', get: (r) => (r.labeled ? '☑' : ''), center: true },
      { key: 'notes', label: 'Notes', get: (r) => r.notes }
    ]),
    section: {
      field: 'bundle',
      color: (r) => (r as CableRec).bundleColor,
      note: (r) => {
        const c = r as CableRec
        return `${c.bundleFrom || '—'} → ${c.bundleTo || '—'}${c.length ? ` · ${c.length}` : ''}`
      }
    }
  },
  devices: {
    label: 'Devices',
    area: 'Devices & network',
    fields: fieldsOf<DeviceRec>([
      { key: 'name', label: 'Device', get: (r) => r.name },
      { key: 'category', label: 'Category', get: (r) => r.category, blank: 'Uncategorized' },
      { key: 'type', label: 'Type', get: (r) => r.type },
      { key: 'location', label: 'Location', get: (r) => r.location },
      { key: 'vlan', label: 'Main VLAN', get: (r) => r.vlan },
      { key: 'ip', label: 'Main IP', get: (r) => r.ip }
    ])
  },
  switchPorts: {
    label: 'Switch ports',
    area: 'Devices & network',
    fields: fieldsOf<SwitchPortRec>([
      { key: 'switch', label: 'Switch', get: (r) => r.switch },
      { key: 'mgmtIp', label: 'Mgmt IP', get: (r) => r.mgmtIp },
      { key: 'oobIp', label: 'OOB IP', get: (r) => r.oobIp },
      { key: 'location', label: 'Location', get: (r) => r.location },
      { key: 'port', label: 'Port', get: (r) => r.port },
      { key: 'vlan', label: 'VLAN #', get: (r) => r.vlan },
      { key: 'nativeVlan', label: 'Native VLAN', get: (r) => r.nativeVlan },
      { key: 'taggedVlans', label: 'Tagged VLANs', get: (r) => r.taggedVlans }
    ])
  },
  ports: {
    label: 'Device ports (IPs)',
    area: 'Devices & network',
    fields: fieldsOf<PortRec>([
      { key: 'device', label: 'Device', get: (r) => r.device },
      { key: 'mac', label: 'MAC', get: (r) => r.mac },
      { key: 'type', label: 'Type', get: (r) => r.type },
      { key: 'location', label: 'Location', get: (r) => r.location },
      { key: 'category', label: 'Category', get: (r) => r.category, blank: 'Uncategorized' },
      { key: 'port', label: 'Port', get: (r) => r.port },
      { key: 'ip', label: 'IP Address', get: (r) => r.ip },
      { key: 'network', label: 'Network', get: (r) => r.network },
      { key: 'vlan', label: 'VLAN', get: (r) => r.vlan }
    ])
  },
  cases: {
    label: 'Cases on trucks',
    area: 'Trucking',
    fields: fieldsOf<CaseRec>([
      { key: 'name', label: 'Case', get: (r) => r.name },
      { key: 'description', label: 'Description', get: (r) => r.description },
      { key: 'contents', label: 'Contents', get: (r) => r.contents },
      { key: 'trip', label: 'Trip', get: (r) => r.trip },
      { key: 'loadedBox', label: 'Loaded ☐', get: () => '☐', center: true }
    ]),
    dynamic: (r) => (r as CaseRec).fields
  },
  fixtures: { label: 'Lighting fixtures', area: 'Lighting', fields: fixtureFields }
}

function findField(source: PaperworkSource, key: string): Field | undefined {
  if (key === 'blank') return BLANK
  const s = SOURCES[source]
  const f = s.fields.find((x) => x.key === key)
  if (f || !s.dynamic || !key.startsWith('field:')) return f
  const label = key.slice(6)
  return { key, label, get: (r) => s.dynamic!(r)[label] ?? '' }
}

export const fieldLabel = (source: PaperworkSource, key: string): string =>
  findField(source, key)?.label ?? key

export function fieldValue(source: PaperworkSource, r: object, key: string): string {
  return findField(source, key)?.get(r) ?? ''
}

/** Every field a column of this source can show (case fields found in `records` included). */
export function fieldsFor(
  source: PaperworkSource,
  records: object[] = []
): { key: string; label: string }[] {
  const s = SOURCES[source]
  const dyn = new Set<string>()
  // a case field named like a built-in one (Description) is already covered by it
  const builtIn = new Set(s.fields.map((f) => f.label.toLowerCase()))
  if (s.dynamic)
    for (const r of records)
      for (const k of Object.keys(s.dynamic(r))) if (!builtIn.has(k.toLowerCase())) dyn.add(k)
  return [
    ...s.fields.map(({ key, label }) => ({ key, label })),
    ...[...dyn].sort().map((l) => ({ key: `field:${l}`, label: l })),
    { key: BLANK.key, label: BLANK.label }
  ]
}

/** Numbers sort as numbers ("2" before "10"), U/A by universe then address, blanks last. */
export function compareValues(a: string, b: string): number {
  if (!a || !b) return a === b ? 0 : a ? -1 : 1
  const pa = /^(\d+)\/(\d+)$/.exec(a)
  const pb = /^(\d+)\/(\d+)$/.exec(b)
  if (pa && pb) return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2])
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

// ---- Built-in templates --------------------------------------------------------

const col = (
  source: PaperworkSource,
  field: string,
  width: number,
  label = fieldLabel(source, field)
): ReportColumn => ({ field, label, width })

type Preset = Omit<PaperworkTemplate, 'mergeRepeats' | 'kind'> &
  Partial<Pick<PaperworkTemplate, 'mergeRepeats' | 'kind'>>
const preset = (p: Preset): PaperworkTemplate => ({ kind: 'list', mergeRepeats: 0, ...p })

const fx = (f: string, w: number, l?: string): ReportColumn => col('fixtures', f, w, l)
const cb = (f: string, w: number, l?: string): ReportColumn => col('cables', f, w, l)

/** The built-in templates. Ones bound to an export (DOC_TEMPLATES) can be reset but never deleted. */
export const PRESETS: PaperworkTemplate[] = [
  preset({
    id: 'pullsheet',
    name: 'Pull sheet',
    source: 'cables',
    columns: [
      cb('cable', 120),
      cb('type', 90),
      cb('from', 180),
      cb('to', 180),
      cb('pulledBox', 70, 'Pulled'),
      cb('labeledBox', 70, 'Labeled')
    ],
    groupBy: 'bundle',
    sortBy: ['cable'],
    orientation: 'portrait',
    fontSize: 12
  }),
  preset({
    id: 'schedule',
    name: 'Cable schedule',
    source: 'cables',
    columns: [
      cb('bundle', 120),
      cb('cable', 90),
      cb('type', 80),
      cb('from', 160),
      cb('to', 160),
      cb('length', 70),
      cb('pulled', 70, 'Pulled'),
      cb('labeled', 70, 'Labeled'),
      cb('notes', 140)
    ],
    groupBy: '',
    sortBy: ['bundle', 'cable'],
    orientation: 'landscape',
    fontSize: 12
  }),
  preset({
    id: 'devicelist',
    name: 'Device list',
    source: 'devices',
    columns: [
      col('devices', 'name', 180),
      col('devices', 'type', 140),
      col('devices', 'location', 140),
      col('devices', 'vlan', 90),
      col('devices', 'ip', 120)
    ],
    groupBy: 'category',
    sortBy: ['name'],
    orientation: 'portrait',
    fontSize: 12
  }),
  preset({
    id: 'ipschedule-switches',
    name: 'IP schedule — switches',
    source: 'switchPorts',
    columns: [
      col('switchPorts', 'switch', 140),
      col('switchPorts', 'mgmtIp', 110),
      col('switchPorts', 'oobIp', 110),
      col('switchPorts', 'port', 90),
      col('switchPorts', 'nativeVlan', 160),
      col('switchPorts', 'taggedVlans', 220)
    ],
    groupBy: '',
    sortBy: ['switch', 'vlan', 'port'],
    mergeRepeats: 3,
    orientation: 'landscape',
    fontSize: 12
  }),
  preset({
    id: 'ipschedule-devices',
    name: 'IP schedule — devices',
    source: 'ports',
    columns: [
      col('ports', 'device', 150),
      col('ports', 'mac', 130),
      col('ports', 'type', 120),
      col('ports', 'location', 110),
      col('ports', 'port', 90),
      col('ports', 'ip', 110),
      col('ports', 'network', 100),
      col('ports', 'vlan', 60)
    ],
    groupBy: '',
    sortBy: ['device', 'vlan', 'port'],
    mergeRepeats: 4,
    orientation: 'landscape',
    fontSize: 12
  }),
  preset({
    id: 'loadsheet',
    name: 'Truck load sheet (case list)',
    source: 'cases',
    columns: [
      col('cases', 'name', 90),
      col('cases', 'description', 200),
      col('cases', 'contents', 220),
      col('cases', 'loadedBox', 70, 'Loaded')
    ],
    groupBy: '',
    sortBy: ['name'],
    orientation: 'portrait',
    fontSize: 12
  }),
  preset({
    id: 'channel-hookup',
    name: 'Channel hookup',
    source: 'fixtures',
    columns: [
      fx('channel', 60, 'Chan'),
      fx('ua', 60),
      fx('position', 140),
      fx('unit', 50, 'Unit'),
      fx('instType', 220),
      fx('purpose', 160),
      fx('color', 80),
      fx('gobo1', 110, 'Gobo')
    ],
    groupBy: '',
    sortBy: ['channel', 'ua'],
    orientation: 'landscape',
    fontSize: 11
  }),
  preset({
    id: 'instrument-schedule',
    name: 'Instrument schedule',
    source: 'fixtures',
    columns: [
      fx('unit', 50),
      fx('instType', 220),
      fx('purpose', 160),
      fx('channel', 60, 'Chan'),
      fx('ua', 60),
      fx('color', 80),
      fx('gobo1', 110, 'Gobo'),
      fx('accessories', 120)
    ],
    groupBy: 'position',
    sortBy: ['unit'],
    orientation: 'landscape',
    fontSize: 11
  }),
  preset({
    id: 'patch',
    name: 'Patch (by address)',
    source: 'fixtures',
    columns: [
      fx('ua', 70),
      fx('channel', 60, 'Chan'),
      fx('instType', 220),
      fx('mode', 100),
      fx('position', 140),
      fx('unit', 50)
    ],
    groupBy: '',
    sortBy: ['ua'],
    orientation: 'portrait',
    fontSize: 11
  }),
  preset({
    id: 'color-schedule',
    name: 'Color schedule',
    source: 'fixtures',
    kind: 'count',
    columns: [fx('color', 120), fx('instType', 260)],
    groupBy: '',
    sortBy: ['color', 'instType'],
    orientation: 'portrait',
    fontSize: 12
  }),
  preset({
    id: 'gobo-pull',
    name: 'Gobo pull list',
    source: 'fixtures',
    kind: 'count',
    columns: [fx('gobo1', 200, 'Gobo'), fx('instType', 260)],
    groupBy: '',
    sortBy: ['gobo1', 'instType'],
    orientation: 'portrait',
    fontSize: 12
  })
]

/** Which templates each export prints (the IP schedule prints two, one after the other). */
export const DOC_TEMPLATES = {
  pullsheet: ['pullsheet'],
  schedule: ['schedule'],
  devicelist: ['devicelist'],
  ipschedule: ['ipschedule-switches', 'ipschedule-devices'],
  loadsheet: ['loadsheet']
} as const

export type TemplatedDoc = keyof typeof DOC_TEMPLATES

/** "Export → Pull sheet" for a template an export uses; null for the user's own. */
export function usedBy(id: string): string | null {
  const label: Record<TemplatedDoc, string> = {
    pullsheet: 'Cables › Export › Pull sheet',
    schedule: 'Cables › Export › Cable schedule',
    devicelist: 'Devices › Export › Device list',
    ipschedule: 'Devices › Export › IP schedule',
    loadsheet: 'Trucking › Load sheets'
  }
  for (const [doc, ids] of Object.entries(DOC_TEMPLATES))
    if ((ids as readonly string[]).includes(id)) return label[doc as TemplatedDoc]
  return null
}

/**
 * The saved list with every built-in an export needs: missing ones are appended,
 * so a new version's built-ins appear and an export always has its template.
 * `legacy` = the v2.9.0 lighting-only list (no `source`), read when nothing newer is saved.
 */
export function withBuiltIns(
  saved: PaperworkTemplate[] | null,
  legacy: Omit<PaperworkTemplate, 'source' | 'mergeRepeats'>[] | null
): PaperworkTemplate[] {
  const list: PaperworkTemplate[] =
    saved ??
    legacy?.map((t) => ({ ...t, source: 'fixtures' as const, mergeRepeats: 0 })) ??
    PRESETS.filter((p) => p.source === 'fixtures')
  const have = new Set(list.map((t) => t.id))
  const bound = new Set<string>(Object.values(DOC_TEMPLATES).flat())
  return [...list, ...PRESETS.filter((p) => !have.has(p.id) && bound.has(p.id))]
}

// ---- Building ------------------------------------------------------------------

export interface ReportSection {
  title: string
  /** how many records the section holds */
  count: number
  rows: string[][]
  /** per row, per cell: rowspan (1 = normal, 0 = covered by the cell above); set when merging */
  spans?: number[][]
  /** per row: 0/1 alternating per merged group; set when merging */
  bands?: number[]
  /** heading extras from the source (a bundle's color and route) */
  color?: string
  note?: string
}

export interface BuiltReport {
  headers: string[]
  widths: number[]
  center: boolean[]
  sections: ReportSection[]
}

/** rowspans for merging repeats down the first `n` columns: a cell merges while
 *  it and every cell to its left match the row above. */
function mergeSpans(rows: string[][], n: number): { spans: number[][]; bands: number[] } {
  const spans = rows.map((r) => r.map(() => 1))
  const bands: number[] = []
  let band = 0
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    if (i > 0 && prev[0] !== r[0]) band ^= 1
    bands.push(band)
    for (let c = 0; c < Math.min(n, r.length); c++) {
      if (!prev || r.slice(0, c + 1).some((v, k) => v !== prev[k])) continue
      // walk up to the cell that owns the span
      let top = i - 1
      while (spans[top][c] === 0) top--
      spans[top][c]++
      spans[i][c] = 0
    }
  })
  return { spans, bands }
}

/** Turn a template + its records into the table the preview and every export print. */
export function buildReport(t: PaperworkTemplate, records: object[]): BuiltReport {
  const val = (r: object, k: string): string => fieldValue(t.source, r, k)
  const fields = t.columns.map((c) => c.field)
  const sortKeys = [t.groupBy, ...t.sortBy].filter(Boolean)
  const cmp = (a: object, b: object): number => {
    for (const k of sortKeys) {
      const d = compareValues(val(a, k), val(b, k))
      if (d) return d
    }
    return 0
  }
  // a count report's first column is what's counted (the color, the gobo…): skip records without one
  const rows = [...records]
    .filter((r) => t.kind === 'list' || !fields.length || val(r, fields[0]))
    .sort(cmp)

  const blank = t.groupBy ? (findField(t.source, t.groupBy)?.blank ?? '(none)') : ''
  const groups = new Map<string, object[]>()
  for (const r of rows) {
    const title = t.groupBy ? val(r, t.groupBy) || blank : ''
    groups.set(title, [...(groups.get(title) ?? []), r])
  }

  const src = SOURCES[t.source]
  const out: ReportSection[] = []
  for (const [title, list] of groups) {
    const extra =
      src.section && t.groupBy === src.section.field
        ? { color: src.section.color(list[0]), note: src.section.note(list[0]) }
        : {}
    if (t.kind === 'list') {
      const cells = list.map((r) => fields.map((k) => val(r, k)))
      out.push({
        title,
        count: list.length,
        rows: cells,
        ...(t.mergeRepeats > 0 ? mergeSpans(cells, t.mergeRepeats) : {}),
        ...extra
      })
      continue
    }
    // count: distinct combinations in sorted order, each with how many records share it
    const counts = new Map<string, { cells: string[]; n: number }>()
    for (const r of list) {
      const cells = fields.map((k) => val(r, k))
      const key = JSON.stringify(cells)
      const c = counts.get(key)
      if (c) c.n++
      else counts.set(key, { cells, n: 1 })
    }
    out.push({
      title,
      count: list.length,
      rows: [...counts.values()].map((c) => [...c.cells, String(c.n)]),
      ...extra
    })
  }

  const count = t.kind === 'count'
  return {
    headers: [...t.columns.map((c) => c.label), ...(count ? ['Count'] : [])],
    widths: [...t.columns.map((c) => c.width), ...(count ? [60] : [])],
    center: [...fields.map((k) => !!findField(t.source, k)?.center), ...(count ? [false] : [])],
    sections: out
  }
}
