import { useEffect, useState } from 'react'
import type { FixtureMode, FixtureType } from '../../../shared/types'

/** Lighting › Fixture types: the DMX modes + footprints of every type in the rig (shared across shows). */
function FixtureTypesPage(): React.JSX.Element {
  const [types, setTypes] = useState<FixtureType[]>([])
  const [inRig, setInRig] = useState<string[]>([])

  const load = (): void => {
    window.api.fixtureTypes.list().then(setTypes)
    window.api.fixtures
      .list()
      .then((f) => setInRig([...new Set(f.map((x) => x.instType).filter(Boolean))]))
  }
  useEffect(load, [])

  const names = [...new Set([...inRig, ...types.map((t) => t.name)])].sort()
  const modesOf = (name: string): FixtureMode[] => types.find((t) => t.name === name)?.modes ?? []
  const save = (name: string, modes: FixtureMode[]): void => {
    window.api.fixtureTypes.save({ name, modes }).then(setTypes)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Fixture types</h2>
      </div>
      <p className="muted">
        How many DMX addresses each mode takes, for the overlap checks. Shared by all shows. A type
        with one mode needs no mode set on its fixtures.
      </p>
      {names.length === 0 && <p className="muted">No fixtures in this show yet.</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Modes (name · footprint)</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => {
            const modes = modesOf(name)
            return (
              <tr key={name}>
                <td>
                  {name}
                  {!inRig.includes(name) && <small className="muted"> · not in this show</small>}
                </td>
                <td>
                  {[...modes, { name: '', footprint: 0 }].map((m, i) => (
                    <span key={`${name}-${i}-${modes.length}`} className="lx-mode">
                      <input
                        placeholder={i === modes.length ? 'New mode' : 'Mode'}
                        defaultValue={m.name}
                        onBlur={(e) => {
                          if (i === modes.length) return
                          save(
                            name,
                            modes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                          )
                        }}
                      />
                      <input
                        className="mono"
                        type="number"
                        min={0}
                        max={512}
                        placeholder="ch"
                        defaultValue={m.footprint || ''}
                        onBlur={(e) => {
                          const footprint = Number(e.target.value) || 0
                          const next =
                            i === modes.length
                              ? footprint > 0
                                ? [
                                    ...modes,
                                    {
                                      name: (e.target.previousSibling as HTMLInputElement).value,
                                      footprint
                                    }
                                  ]
                                : modes
                              : modes.map((x, j) => (j === i ? { ...x, footprint } : x))
                          if (next !== modes) save(name, next)
                        }}
                      />
                    </span>
                  ))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default FixtureTypesPage
