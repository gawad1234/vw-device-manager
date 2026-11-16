import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Fixture, FixtureType, LightingSyncStatus } from '../../../shared/types'
import { checkPatch, isAccessory, type PatchWarning } from '../../../shared/lighting-checks'
import FixtureModal from '../components/FixtureModal'
import PageHeader from '../components/PageHeader'

const numeric = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })
const ua = (f: Fixture): string =>
  f.universe != null && f.address != null ? `${f.universe}/${f.address}` : ''
const time = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString() : '—')

/** Lighting › Fixtures: the rig by position (or by channel), live-synced with Vectorworks. */
function FixturesPage(): React.JSX.Element {
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [accessories, setAccessories] = useState(0)
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
    ]).then(([all, t, s]) => {
      const f = all.filter((x) => !isAccessory(x))
      setFixtures(f)
      setAccessories(all.length - f.length)
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
      <PageHeader
        title="Fixtures"
        count={fixtures.length}
        description={
          accessories > 0
            ? `${accessories} accessor${accessories === 1 ? 'y' : 'ies'} (template holders etc.) from the drawing not counted.`
            : undefined
        }
        secondary={
          warnings.length > 0 ? (
            <button
              className="badge badge-warn lx-warn-jump"
              title="Go to the first one"
              onClick={() =>
                document
                  .querySelector('.lx-warn-row, .lx-warnings')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              ⚠ {warnings.length} to check
            </button>
          ) : undefined
        }
        filters={
          fixtures.length > 0 ? (
            <div className="seg" role="group" aria-label="Order">
              <button
                className={!byChannel ? 'is-on' : ''}
                aria-pressed={!byChannel}
                onClick={() => setByChannel(false)}
              >
                By position
              </button>
              <button
                className={byChannel ? 'is-on' : ''}
                aria-pressed={byChannel}
                onClick={() => setByChannel(true)}
              >
                By channel
              </button>
            </div>
          ) : undefined
        }
      />

      {sync && (
        <div className={`banner ${sync.error ? 'banner-error' : 'banner-info'} lx-sync`}>
          <label className="toggle-field">
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
        <div className="muted page-prose">
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
            <table className="table table-fixed">
              {byChannel ? (
                <colgroup>
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '7%' }} />
                  <col />
                </colgroup>
              ) : (
                <colgroup>
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '21%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '8%' }} />
                  <col />
                </colgroup>
              )}
              <thead>
                <tr>
                  {byChannel && <th className="num">Chan</th>}
                  {byChannel && <th>Position</th>}
                  <th className="num">Unit</th>
                  <th>Type</th>
                  <th>Purpose</th>
                  {!byChannel && <th className="num">Chan</th>}
                  <th className="num">U/A</th>
                  <th>Color</th>
                  <th>Gobo</th>
                  <th className="num">Dimmer</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {list.map((f) => {
                  const w = warnFor(f.id)
                  return (
                    <Fragment key={f.id}>
                      <tr
                        className="clickable"
                        tabIndex={0}
                        onClick={() => setEdit(f)}
                        onKeyDown={(e) => e.key === 'Enter' && setEdit(f)}
                      >
                        {byChannel && <td className="num">{f.channel}</td>}
                        {byChannel && <td>{f.position}</td>}
                        <td className="num">{f.unit}</td>
                        <td>
                          {f.instType}
                          {f.mode && <small className="muted"> · {f.mode}</small>}
                        </td>
                        <td>{f.purpose}</td>
                        {!byChannel && <td className="num">{f.channel}</td>}
                        <td className="num">
                          {w.length > 0 && (
                            <span
                              className="badge badge-warn lx-warn"
                              title={`${w.length} to check`}
                              aria-label={`${w.length} to check`}
                            >
                              ⚠
                            </span>
                          )}
                          {ua(f)}
                        </td>
                        <td>{f.color}</td>
                        <td>{[f.gobo1, f.gobo2].filter(Boolean).join(', ')}</td>
                        <td className="num">{f.dimmer}</td>
                        <td>{f.notes}</td>
                      </tr>
                      {w.length > 0 && (
                        <tr className="lx-warn-row">
                          <td colSpan={byChannel ? 10 : 9}>
                            {w.map((x, i) => (
                              <div key={i}>⚠ {x.message}</div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* fixture warnings sit under their rows; these are about a whole universe */}
      {warnings.some((w) => w.ids.length === 0) && (
        <>
          <h3 className="section-gap">Universes to check</h3>
          <ul className="lx-warnings">
            {warnings
              .filter((w) => w.ids.length === 0)
              .map((w, i) => (
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
