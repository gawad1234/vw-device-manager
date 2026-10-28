import { useEffect, useMemo, useState } from 'react'
import type { Fixture, FixtureType, LightingSyncStatus } from '../../../shared/types'
import { checkPatch, type PatchWarning } from '../../../shared/lighting-checks'
import FixtureModal from '../components/FixtureModal'

const numeric = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })
const ua = (f: Fixture): string =>
  f.universe != null && f.address != null ? `${f.universe}/${f.address}` : ''
const time = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString() : '—')

/** Lighting › Fixtures: the rig by position (or by channel), live-synced with Vectorworks. */
function FixturesPage(): React.JSX.Element {
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [types, setTypes] = useState<FixtureType[]>([])
  const [warnings, setWarnings] = useState<PatchWarning[]>([])
  const [sync, setSync] = useState<LightingSyncStatus | null>(null)
  const [byChannel, setByChannel] = useState(false)
  const [edit, setEdit] = useState<Fixture | null>(null)

  const load = (): void => {
    Promise.all([
      window.api.fixtures.list(),
      window.api.fixtureTypes.list(),
      window.api.lighting.get()
    ]).then(([f, t, s]) => {
      setFixtures(f)
      setTypes(t)
      setWarnings(checkPatch(f, t, s))
    })
  }
  useEffect(() => {
    load()
    window.api.lighting.syncStatus().then(setSync)
    const offData = window.api.onDataChanged(load)
    const offSync = window.api.lighting.onSyncStatus(setSync)
    return () => {
      offData()
      offSync()
    }
  }, [])

  const warnFor = (id: number): PatchWarning[] => warnings.filter((w) => w.ids.includes(id))
  const groups = useMemo((): [string, Fixture[]][] => {
    if (byChannel)
      return [['', [...fixtures].sort((a, b) => numeric(a.channel || '~', b.channel || '~'))]]
    const m = new Map<string, Fixture[]>()
    for (const f of fixtures) m.set(f.position, [...(m.get(f.position) ?? []), f])
    return [...m.entries()]
      .sort(([a], [b]) => numeric(a, b))
      .map(([p, list]): [string, Fixture[]] => [p, list.sort((a, b) => numeric(a.unit, b.unit))])
  }, [fixtures, byChannel])

  return (
    <div className="page">
      <div className="page-header">
        <h2>Fixtures</h2>
        <div className="page-header-actions">
          {warnings.length > 0 && (
            <span className="badge badge-warn">{warnings.length} to check</span>
          )}
          <button className="btn" onClick={() => setByChannel(!byChannel)}>
            {byChannel ? 'Group by position' : 'Sort by channel'}
          </button>
        </div>
      </div>

      {sync && (
        <div className={`banner ${sync.error ? 'banner-error' : 'banner-info'} lx-sync`}>
          <label className="toggle-field" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={sync.syncOn}
              onChange={(e) => window.api.lighting.setSync(e.target.checked).then(setSync)}
            />
            Live sync with Vectorworks
          </label>
          <span className="mono lx-sync-path" title={sync.path}>
            {sync.path ? sync.path.split(/[\\/]/).pop() : 'No show open'}
            {sync.path && !sync.found && ' — not found'}
          </span>
          {sync.syncOn && (
            <span className="muted">
              {sync.waitingForVw ? 'Waiting for Vectorworks to pick up changes…' : 'In step'} · in{' '}
              {time(sync.lastIn)} · out {time(sync.lastOut)}
            </span>
          )}
          <button
            className="btn btn-small"
            onClick={() => window.api.lighting.chooseFile().then(setSync)}
          >
            Choose file…
          </button>
          {sync.error && <span>{sync.error}</span>}
        </div>
      )}

      {fixtures.length === 0 ? (
        <div className="muted" style={{ maxWidth: 620 }}>
          <p>No fixtures yet. They come from the Vectorworks drawing:</p>
          <ol>
            <li>
              In Vectorworks, open <strong>Spotlight preferences › Lightwright</strong>, turn on the
              automatic data exchange and tick the fields to share.
            </li>
            <li>
              Keep the show file beside the drawing with the same name (<code>Show.vwx</code> ↔{' '}
              <code>Show.vwdm</code>), or pick the exchange <code>.xml</code> with Choose file….
            </li>
            <li>
              Turn on live sync above. Edits on either side then reach the other within a minute.
            </li>
          </ol>
        </div>
      ) : (
        groups.map(([position, list]) => (
          <div key={position || 'all'} className="lx-group">
            {!byChannel && <h3>{position || 'No position'}</h3>}
            <table className="table">
              <thead>
                <tr>
                  {byChannel && <th>Chan</th>}
                  {byChannel && <th>Position</th>}
                  <th>Unit</th>
                  <th>Type</th>
                  <th>Purpose</th>
                  {!byChannel && <th>Chan</th>}
                  <th>U/A</th>
                  <th>Color</th>
                  <th>Gobo</th>
                  <th>Dimmer</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {list.map((f) => {
                  const w = warnFor(f.id)
                  return (
                    <tr key={f.id} className="clickable" onClick={() => setEdit(f)}>
                      {byChannel && <td className="mono">{f.channel}</td>}
                      {byChannel && <td>{f.position}</td>}
                      <td>{f.unit}</td>
                      <td>
                        {f.instType}
                        {f.mode && <small className="muted"> · {f.mode}</small>}
                      </td>
                      <td>{f.purpose}</td>
                      {!byChannel && <td className="mono">{f.channel}</td>}
                      <td className="mono">
                        {ua(f)}
                        {w.length > 0 && (
                          <span
                            className="badge badge-warn lx-warn"
                            title={w.map((x) => x.message).join('\n')}
                          >
                            !
                          </span>
                        )}
                      </td>
                      <td>{f.color}</td>
                      <td>{[f.gobo1, f.gobo2].filter(Boolean).join(', ')}</td>
                      <td>{f.dimmer}</td>
                      <td>{f.notes}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {warnings.length > 0 && (
        <>
          <h3 style={{ marginTop: 26 }}>To check</h3>
          <ul className="lx-warnings">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </>
      )}

      {edit && (
        <FixtureModal fixture={edit} types={types} onClose={() => setEdit(null)} onSaved={load} />
      )}
    </div>
  )
}

export default FixturesPage
