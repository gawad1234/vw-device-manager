import type { Fixture, FixtureInput } from './types'

// The Vectorworks Spotlight ↔ Lightwright exchange file (<drawing>.xml beside the
// .vwx). Undocumented; the protocol was worked out by hand — see
// _Master/knowledge/vectorworks-lightwright-exchange.md. Vectorworks writes it
// (AppStamp Vectorworks: "Entire Plot" on open, then only changed fixtures); we
// answer as Lightwright (every AppStamp Lightwright, Lightwright_ID filled in) and
// Vectorworks applies it, then empties the fixture list. Pure — tests import it.

export interface UniverseRange {
  universe: number
  start: number
  end: number
}

export interface Exchange {
  /** who wrote the fixture list: 'Vectorworks' or 'Lightwright' */
  appStamp: string
  /** 'Entire Plot' for a full dump, '' for only-changed fixtures */
  action: string
  /** ExportFieldList as [tag, label], in order */
  fieldList: [string, string][]
  /** InstrumentData's own simple tags (VWVersion, VWBuild, AutoRot2D…) */
  header: [string, string][]
  /** the raw <UniverseSettings> block, echoed back when we write; '' if absent */
  universeBlock: string
  /** system letter → its universes' absolute-address ranges */
  universes: Record<string, UniverseRange[]>
  /** each fixture's tags, in order (Action, UID, Lightwright_ID, Channel…) */
  fixtures: Record<string, string>[]
}

const decode = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const encode = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The simple <Tag>text</Tag> / <Tag/> children of a block, in order. */
function simpleTags(block: string): [string, string][] {
  const out: [string, string][] = []
  for (const m of block.matchAll(/<(\w+)\s*\/>|<(\w+)>([^<]*)<\/\2>/g))
    out.push(m[1] ? [m[1], ''] : [m[2], decode(m[3])])
  return out
}

const inner = (xml: string, tag: string): string =>
  xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? ''

export function parseExchange(xml: string): Exchange {
  const data = inner(xml, 'InstrumentData')
  const fixtures: Record<string, string>[] = []
  const rest = data.replace(/<(UID_\w+)>([\s\S]*?)<\/\1>/g, (_, _tag, body: string) => {
    fixtures.push(Object.fromEntries(simpleTags(body)))
    return ''
  })
  const head = simpleTags(rest)
  const get = (k: string): string => head.find(([t]) => t === k)?.[1] ?? ''

  const universeBlock = xml.match(/<UniverseSettings>[\s\S]*?<\/UniverseSettings>/)?.[0] ?? ''
  const universes: Record<string, UniverseRange[]> = {}
  for (const s of universeBlock.matchAll(/<System(\w+)>([\s\S]*?)<\/System\1>/g)) {
    universes[s[1]] = [...s[2].matchAll(/<Universe(\d+)>([\s\S]*?)<\/Universe\1>/g)].map((u) => {
      const f = Object.fromEntries(simpleTags(u[2]))
      return {
        universe: parseInt(f.Label) || Number(u[1]),
        start: Number(f.Start),
        end: Number(f.End)
      }
    })
  }

  return {
    appStamp: get('AppStamp'),
    action: get('Action'),
    fieldList: simpleTags(inner(xml, 'ExportFieldList')).filter(
      ([t]) => t !== 'AppStamp' && t !== 'TimeStamp'
    ),
    header: head.filter(([t]) => t !== 'Action' && t !== 'AppStamp'),
    universeBlock,
    universes,
    fixtures
  }
}

/** "YYYYMMDDhhmmss" in UTC — Vectorworks ignores a stamp older than its own. */
export const utcStamp = (d: Date): string => d.toISOString().replace(/\D/g, '').slice(0, 14)

/** The file Vectorworks accepts from Lightwright: every AppStamp Lightwright, a fresh stamp, ids set. */
export function buildExchange(
  fixtures: Record<string, string>[],
  base: Pick<Exchange, 'fieldList' | 'header' | 'universeBlock'>,
  now: Date
): string {
  const ts = utcStamp(now)
  const nl = '\r\n'
  const tag = (indent: string, t: string, v: string): string =>
    v === '' ? `${indent}<${t}></${t}>` : `${indent}<${t}>${encode(v)}</${t}>`
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<SLData>',
    '',
    '  <ExportFieldList>',
    tag('    ', 'AppStamp', 'Lightwright'),
    tag('    ', 'TimeStamp', ts),
    ...base.fieldList.map(([t, v]) => tag('    ', t, v)),
    '  </ExportFieldList>',
    '',
    '  <InstrumentData>',
    tag('    ', 'Action', 'Entire Plot'),
    tag('    ', 'AppStamp', 'Lightwright'),
    ...base.header.map(([t, v]) => tag('    ', t, v))
  ]
  for (const f of fixtures) {
    const el = 'UID_' + f.UID.replace(/\W/g, '_')
    const fields = { ...f, Action: 'Update', TimeStamp: ts, AppStamp: 'Lightwright' }
    lines.push(
      `    <${el}>`,
      ...Object.entries(fields).map(([t, v]) => tag('      ', t, v)),
      `    </${el}>`
    )
  }
  lines.push('  </InstrumentData>', '')
  if (base.universeBlock)
    lines.push(
      '  ' +
        base.universeBlock
          .replace(/<AppStamp>[^<]*<\/AppStamp>/, '<AppStamp>Lightwright</AppStamp>')
          .replace(/<TimeStamp>[^<]*<\/TimeStamp>/, `<TimeStamp>${ts}</TimeStamp>`),
      ''
    )
  lines.push('</SLData>', '')
  return lines.join(nl)
}

/** Absolute address → universe/address, through the drawing's universe table. 0 = unpatched. */
export function fromAbsolute(
  abs: number,
  system: string,
  universes: Record<string, UniverseRange[]>
): { universe: number | null; address: number | null } {
  if (!abs || abs < 1) return { universe: null, address: null }
  const r = universes[system || 'A']?.find((u) => abs >= u.start && abs <= u.end)
  if (r) return { universe: r.universe, address: abs - r.start + 1 }
  return { universe: Math.floor((abs - 1) / 512) + 1, address: ((abs - 1) % 512) + 1 }
}

export function toAbsolute(
  universe: number | null,
  address: number | null,
  system: string,
  universes: Record<string, UniverseRange[]>
): number {
  if (!universe || !address) return 0
  const r = universes[system || 'A']?.find((u) => u.universe === universe)
  return r ? r.start + address - 1 : (universe - 1) * 512 + address
}

/** Our field ↔ Vectorworks tag, for the fields both sides edit. */
const TEXT_FIELDS: [keyof FixtureInput, string][] = [
  ['position', 'Position'],
  ['unit', 'Unit_Number'],
  ['instType', 'Inst_Type'],
  ['purpose', 'Purpose'],
  ['channel', 'Channel'],
  ['system', 'System'],
  ['color', 'Color'],
  ['gobo1', 'Template'],
  ['gobo2', 'Template2'],
  ['accessories', 'Accessories'],
  ['wattage', 'Wattage'],
  ['dimmer', 'Dimmer'],
  ['circuitName', 'Circuit_Name'],
  ['circuitNumber', 'Circuit_Number'],
  ['mark', 'Mark']
]
const USER_FIELDS = [1, 2, 3, 4, 5, 6].map((n) => `User_Field_${n}`)

/** What a Vectorworks fixture says, over what we had (app-only mode + notes are kept). */
export function fixtureFromExchange(
  f: Record<string, string>,
  universes: Record<string, UniverseRange[]>,
  prev?: FixtureInput
): FixtureInput {
  const out = {
    mode: prev?.mode ?? '',
    notes: prev?.notes ?? '',
    vwUid: f.UID ?? prev?.vwUid ?? '',
    vw: { ...prev?.vw, ...f },
    userFields: USER_FIELDS.map((t, i) => f[t] ?? prev?.userFields[i] ?? '')
  } as FixtureInput
  for (const [key, t] of TEXT_FIELDS)
    (out as unknown as Record<string, string>)[key] = f[t] ?? (prev?.[key] as string) ?? ''
  const abs = f.Absolute_Address
  const ua =
    abs !== undefined
      ? fromAbsolute(Number(abs), out.system, universes)
      : { universe: prev?.universe ?? null, address: prev?.address ?? null }
  return { ...out, ...ua }
}

/** A fixture as exchange tags: what Vectorworks sent, with our edits and our id on top. */
export function fixtureToExchange(
  fx: Fixture,
  universes: Record<string, UniverseRange[]>
): Record<string, string> {
  const out: Record<string, string> = { ...fx.vw, UID: fx.vwUid, Lightwright_ID: String(fx.id) }
  for (const [key, t] of TEXT_FIELDS) out[t] = fx[key] as string
  USER_FIELDS.forEach((t, i) => (out[t] = fx.userFields[i] ?? ''))
  out.Absolute_Address = String(toAbsolute(fx.universe, fx.address, fx.system, universes))
  return out
}
