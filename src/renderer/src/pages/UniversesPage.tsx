import { useEffect, useState } from 'react'
import type { Device, Fixture, FixtureType, LightingSettings } from '../../../shared/types'
import {
  checkPatch,
  fixtureLabel,
  footprintOf,
  type PatchWarning
} from '../../../shared/lighting-checks'

interface Props {
  devices: Device[]
}

// one hue per fixture so neighbours in the grid read apart; skips reds, which mean overlap
const fixtureHue = (i: number): number => 30 + ((i * 137.5) % 300)

const deviceIp = (d: Device): string =>
  d.managementIp || d.ports.find((p) => p.ipAddress)?.ipAddress || ''

/** Lighting › Universes: what's patched where in each universe, and which node it comes out of. */
function UniversesPage({ devices }: Props): React.JSX.Element {
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [types, setTypes] = useState<FixtureType[]>([])
  const [settings, setSettings] = useState<LightingSettings | null>(null)
  const [warnings, setWarnings] = useState<PatchWarning[]>([])

  const load = (): void => {
    Promise.all([
      window.api.fixtures.list(),
      window.api.fixtureTypes.list(),
      window.api.lighting.get()
    ]).then(([f, t, s]) => {
      setFixtures(f)
      setTypes(t)
      setSettings(s)
      setWarnings(checkPatch(f, t, s))
    })
  }
  useEffect(() => {
    load()
    return window.api.onDataChanged(load)
  }, [])

  async function link(u: number, deviceId: number | null, label: string): Promise<void> {
    await window.api.lighting.setUniverse(u, deviceId, label)
    load()
  }

  const universes = [
    ...new Set(fixtures.map((f) => f.universe).filter((u): u is number => u != null))
  ].sort((a, b) => a - b)
  if (!settings) return <div className="page" />

  return (
    <div className="page">
      <div className="page-header">
        <h2>Universes</h2>
      </div>
      {universes.length === 0 && <p className="muted">No fixtures are patched yet.</p>}
      {universes.map((u) => {
        const link_ = settings.universes[String(u)] ?? { deviceId: null, label: '' }
        const overlapIds = new Set(
          warnings.filter((w) => w.universe === u && w.kind === 'overlap').flatMap((w) => w.ids)
        )
        const rows = fixtures
          .filter((f) => f.universe === u && f.address != null)
          .map((f) => ({ f, start: f.address!, fp: footprintOf(f, types) }))
          .sort((a, b) => a.start - b.start)
        // address → indexes into rows of the fixtures on it
        const cells = new Map<number, number[]>()
        rows.forEach((r, i) => {
          for (let a = r.start; a < r.start + (r.fp ?? 1) && a <= 512; a++)
            cells.set(a, [...(cells.get(a) ?? []), i])
        })
        return (
          <div key={u} className="lx-universe">
            <div className="lx-universe-head">
              <h3>Universe {u}</h3>
              <span className="muted">{cells.size} / 512 used</span>
              <select
                value={link_.deviceId ?? ''}
                onChange={(e) =>
                  link(u, e.target.value ? Number(e.target.value) : null, link_.label)
                }
              >
                <option value="">— DMX node —</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {deviceIp(d) && ` (${deviceIp(d)})`}
                  </option>
                ))}
              </select>
              <input
                placeholder="Port / label"
                defaultValue={link_.label}
                onBlur={(e) =>
                  e.target.value !== link_.label && link(u, link_.deviceId, e.target.value)
                }
              />
            </div>
            <div className="lx-grid" role="grid" aria-label={`Universe ${u} addresses 1–512`}>
              {Array.from({ length: 512 }, (_, k) => {
                const addr = k + 1
                const on = cells.get(addr) ?? []
                const starter = on.map((i) => rows[i]).find((r) => r.start === addr)
                const title = on.length
                  ? `${addr}: ` +
                    on
                      .map(
                        (i) =>
                          `${fixtureLabel(rows[i].f)}${rows[i].f.channel ? ` (ch ${rows[i].f.channel})` : ''}`
                      )
                      .join(' + ')
                  : String(addr)
                return (
                  <span
                    key={addr}
                    title={title}
                    className={`lx-cell${on.length > 1 ? ' lx-cell-bad' : ''}${starter ? ' lx-cell-start' : ''}`}
                    style={
                      on.length === 1
                        ? { background: `hsl(${fixtureHue(on[0])} 55% 42%)` }
                        : undefined
                    }
                  >
                    {starter ? starter.f.channel || starter.f.unit || '•' : on.length ? '' : addr}
                  </span>
                )
              })}
            </div>
            <table className="table">
              <tbody>
                {rows.map(({ f, start, fp }) => (
                  <tr key={f.id} className={overlapIds.has(f.id) ? 'lx-row-bad' : ''}>
                    <td className="mono">
                      {start}
                      {fp != null && fp > 1 && `–${start + fp - 1}`}
                    </td>
                    <td>{fixtureLabel(f)}</td>
                    <td>{f.instType}</td>
                    <td className="mono">{f.channel && `ch ${f.channel}`}</td>
                    <td className="muted">{fp == null ? 'footprint unknown' : `${fp} ch`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

export default UniversesPage
