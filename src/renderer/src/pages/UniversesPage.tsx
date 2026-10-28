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
        const used = new Set<number>()
        rows.forEach((r) => {
          for (let a = r.start; a < r.start + (r.fp ?? 1); a++) used.add(a)
        })
        return (
          <div key={u} className="lx-universe">
            <div className="lx-universe-head">
              <h3>Universe {u}</h3>
              <span className="muted">{[...used].filter((a) => a <= 512).length} / 512 used</span>
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
            <div className="lx-bar" title="Addresses 1–512">
              {rows.map(({ f, start, fp }) => (
                <span
                  key={f.id}
                  className={`lx-bar-seg${overlapIds.has(f.id) ? ' lx-bar-bad' : ''}`}
                  style={{
                    left: `${((start - 1) / 512) * 100}%`,
                    width: `${(Math.min(fp ?? 1, 513 - start) / 512) * 100}%`
                  }}
                  title={`${fixtureLabel(f)} ${start}–${start + (fp ?? 1) - 1}`}
                />
              ))}
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
