import { useEffect, useState } from 'react'
import type { PackCase, Truck, TruckInput, TruckTrip } from '../../../shared/types'
import TripModal from '../components/TripModal'
import { TRIP_KINDS } from '../lib/trucking'

const BLANK_TRUCK: TruckInput = { name: '', vendor: '', size: '', cost: 0, contact: '', notes: '' }
const money = (n: number): string =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const range = (a: string, b: string): string => (a || b ? `${a || '?'}–${b || '?'}` : '')

/** Schedule › Trucking: the show's trucks and every trip they run, by date. */
function TruckingPage(): React.JSX.Element {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [trips, setTrips] = useState<TruckTrip[]>([])
  const [cases, setCases] = useState<PackCase[]>([])
  const [editTrip, setEditTrip] = useState<TruckTrip | 'new' | null>(null)
  const [truckDraft, setTruckDraft] = useState<(TruckInput & { id: number | null }) | null>(null)

  const load = (): void => {
    window.api.trucking.trucks().then(setTrucks)
    window.api.trucking.trips().then(setTrips)
  }
  useEffect(() => {
    load()
    window.api.cases.list().then(setCases)
  }, [])

  async function saveTruck(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!truckDraft?.name.trim()) return
    const { id, ...input } = truckDraft
    await window.api.trucking.saveTruck(id, input)
    setTruckDraft(null)
    load()
  }

  async function removeTruck(t: Truck): Promise<void> {
    if (!window.confirm(`Delete truck "${t.name}"? Its trips stay, with no truck set.`)) return
    await window.api.trucking.removeTruck(t.id)
    load()
  }

  const truckName = (id: number | null): string => trucks.find((t) => t.id === id)?.name ?? '—'
  const sorted = [...trips].sort((a, b) =>
    (a.date + a.departTime).localeCompare(b.date + b.departTime)
  )
  const kindLabel = (k: string): string => TRIP_KINDS.find((x) => x.value === k)?.label ?? k

  return (
    <div className="page">
      <div className="page-header">
        <h2>Trucking</h2>
        <div className="page-header-actions">
          <button
            className="btn"
            disabled={!trips.length}
            onClick={() =>
              window.api.exports.run({ scope: 'all', doc: 'loadsheet', format: 'pdf' })
            }
          >
            Print all load sheets
          </button>
          <button className="btn btn-primary" onClick={() => setEditTrip('new')}>
            + Add trip
          </button>
        </div>
      </div>

      <h3>Trips</h3>
      {sorted.length ? (
        <div className="trips-wrap">
          <table className="table trips-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Truck</th>
                <th>From → To</th>
                <th>Depart–Arrive</th>
                <th>Dock slot</th>
                <th>Driver</th>
                <th>Cases</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => setEditTrip(t)}>
                  <td>{t.date}</td>
                  <td>{kindLabel(t.kind)}</td>
                  <td>{truckName(t.truckId)}</td>
                  <td>
                    {t.origin || '?'} → {t.destination || '?'}
                  </td>
                  <td>{range(t.departTime, t.arriveTime)}</td>
                  <td>{range(t.dockStart, t.dockEnd)}</td>
                  <td>
                    {t.driver}
                    {t.phone && <small className="muted"> {t.phone}</small>}
                  </td>
                  <td>{t.caseIds.length || ''}</td>
                  <td>
                    <span className={`badge trip-${t.status}`}>{t.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No trips yet.</p>
      )}

      <h3 style={{ marginTop: 26 }}>Trucks</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Truck</th>
            <th>Vendor</th>
            <th>Size</th>
            <th>Cost</th>
            <th>Contact</th>
            <th>Trips</th>
          </tr>
        </thead>
        <tbody>
          {trucks.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => setTruckDraft({ ...t })}>
              <td>{t.name}</td>
              <td>{t.vendor}</td>
              <td>{t.size}</td>
              <td>{t.cost ? money(t.cost) : ''}</td>
              <td>{t.contact}</td>
              <td>{trips.filter((x) => x.truckId === t.id).length}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>
              <button
                className="btn btn-small"
                onClick={() => setTruckDraft({ ...BLANK_TRUCK, id: null })}
              >
                + Add truck
              </button>
            </td>
            <td>
              <strong>{money(trucks.reduce((s, t) => s + t.cost, 0))}</strong>
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>

      {truckDraft && (
        <form className="sched-editor form-grid" onSubmit={saveTruck}>
          {(['name', 'vendor', 'size', 'contact'] as const).map((k) => (
            <label key={k}>
              {k[0].toUpperCase() + k.slice(1)}
              <input
                value={truckDraft[k]}
                onChange={(e) => setTruckDraft({ ...truckDraft, [k]: e.target.value })}
                placeholder={k === 'size' ? "e.g. 26' box" : undefined}
              />
            </label>
          ))}
          <label>
            Cost ($)
            <input
              type="number"
              min={0}
              value={truckDraft.cost}
              onChange={(e) =>
                setTruckDraft({ ...truckDraft, cost: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label>
            Notes
            <input
              value={truckDraft.notes}
              onChange={(e) => setTruckDraft({ ...truckDraft, notes: e.target.value })}
            />
          </label>
          <div className="span-2" style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit">
              {truckDraft.id ? 'Save truck' : 'Add truck'}
            </button>
            <button type="button" className="btn" onClick={() => setTruckDraft(null)}>
              Cancel
            </button>
            {truckDraft.id && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const t = trucks.find((x) => x.id === truckDraft.id)
                  if (t) removeTruck(t).then(() => setTruckDraft(null))
                }}
              >
                Delete truck
              </button>
            )}
          </div>
        </form>
      )}

      {editTrip && (
        <TripModal
          trip={editTrip === 'new' ? null : editTrip}
          trucks={trucks}
          cases={cases}
          onClose={() => setEditTrip(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

export default TruckingPage
