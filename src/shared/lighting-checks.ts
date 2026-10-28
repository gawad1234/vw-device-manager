import type { Fixture, FixtureType, LightingSettings } from './types'

export interface PatchWarning {
  /** fixture ids it's about ([] = a universe-level warning) */
  ids: number[]
  universe?: number
  kind: 'overlap' | 'past512' | 'halfPatched' | 'unknownFootprint' | 'noNode'
  message: string
}

/** How many addresses a fixture takes (1 when its type/mode isn't in Fixture types). */
export function footprintOf(f: Fixture, types: FixtureType[]): number | null {
  const t = types.find((x) => x.name === f.instType)
  const m =
    t?.modes.find((x) => x.name === f.mode) ?? (t?.modes.length === 1 ? t.modes[0] : undefined)
  return m ? m.footprint : null
}

export const fixtureLabel = (f: Fixture): string =>
  [f.position, f.unit && `#${f.unit}`].filter(Boolean).join(' ') || `Fixture ${f.id}`

/** Patch problems: overlapping addresses, running past 512, half-patched, unknown footprints, universes with no node. */
export function checkPatch(
  fixtures: Fixture[],
  types: FixtureType[],
  settings: Pick<LightingSettings, 'universes'>
): PatchWarning[] {
  const out: PatchWarning[] = []
  const byUniverse = new Map<number, { f: Fixture; start: number; end: number }[]>()
  for (const f of fixtures) {
    const patched = f.universe != null && f.address != null
    if (patched !== !!f.channel.trim())
      out.push({
        ids: [f.id],
        kind: 'halfPatched',
        message: patched
          ? `${fixtureLabel(f)} has an address but no channel`
          : `${fixtureLabel(f)} has a channel but no address`
      })
    if (!patched) continue
    const fp = footprintOf(f, types)
    if (fp == null)
      out.push({
        ids: [f.id],
        kind: 'unknownFootprint',
        message: `${fixtureLabel(f)}: footprint unknown for "${f.instType}"${f.mode ? ` (${f.mode})` : ''} — counted as 1`
      })
    const start = f.address!
    const end = start + (fp ?? 1) - 1
    if (end > 512)
      out.push({
        ids: [f.id],
        universe: f.universe!,
        kind: 'past512',
        message: `${fixtureLabel(f)} runs past 512 (${f.universe}/${start}–${end})`
      })
    const list = byUniverse.get(f.universe!) ?? []
    list.push({ f, start, end })
    byUniverse.set(f.universe!, list)
  }
  for (const [u, list] of byUniverse) {
    list.sort((a, b) => a.start - b.start)
    // shortcut: compares each fixture with the ones after it until they start past its end — fine for hundreds per universe
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length && list[j].start <= list[i].end; j++)
        out.push({
          ids: [list[i].f.id, list[j].f.id],
          universe: u,
          kind: 'overlap',
          message: `${fixtureLabel(list[i].f)} (${u}/${list[i].start}–${list[i].end}) overlaps ${fixtureLabel(list[j].f)} (${u}/${list[j].start}–${list[j].end})`
        })
    if (settings.universes[String(u)]?.deviceId == null)
      out.push({
        ids: [],
        universe: u,
        kind: 'noNode',
        message: `Universe ${u} isn't linked to a DMX node`
      })
  }
  return out
}
