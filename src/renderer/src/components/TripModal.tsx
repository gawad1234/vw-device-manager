import { useState } from 'react'
import type { PackCase, TripKind, Truck, TruckTrip, TruckTripInput } from '../../../shared/types'
import Modal from './Modal'
import { TRIP_KINDS } from '../lib/trucking'

const BLANK: TruckTripInput = {
  truckId: null,
  kind: 'load-in',
  date: '',
  departTime: '',
  arriveTime: '',
  dockStart: '',
  dockEnd: '',
  origin: '',
  destination: '',
  driver: '',
  phone: '',
  status: 'planned',
  caseIds: [],
  notes: ''
}

interface Props {
  trip: TruckTrip | null
  trucks: Truck[]
  cases: PackCase[]
  onClose: () => void
  onSaved: () => void
}

/** Edit one truck trip: when, from → to, driver, dock slot and which cases ride on it. */
function TripModal({ trip, trucks, cases, onClose, onSaved }: Props): React.JSX.Element {
  const [d, setD] = useState<TruckTripInput>(trip ? { ...trip } : BLANK)
  const [error, setError] = useState('')

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!d.date) {
      setError('A date is required.')
      return
    }
    await window.api.trucking.saveTrip(trip?.id ?? null, d)
    onSaved()
    onClose()
  }

  async function remove(): Promise<void> {
    if (!trip || !window.confirm('Delete this trip?')) return
    await window.api.trucking.removeTrip(trip.id)
    onSaved()
    onClose()
  }

  const field = (
    key: keyof TruckTripInput,
    label: string,
    type = 'text',
    span = false
  ): React.JSX.Element => (
    <label className={span ? 'span-2' : undefined}>
      {label}
      <input
        type={type}
        value={d[key] as string}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
      />
    </label>
  )

  const footer = (
    <>
      {trip && (
        <button className="btn btn-danger" onClick={remove}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <button className="btn" onClick={onClose}>
        Cancel
      </button>
      <button className="btn btn-primary" type="submit" form="trip-form">
        {trip ? 'Save changes' : 'Add trip'}
      </button>
    </>
  )

  return (
    <Modal title={trip ? 'Edit trip' : 'New trip'} onClose={onClose} footer={footer} wide>
      <form id="trip-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error span-2">{error}</div>}
        <label>
          Type
          <select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as TripKind })}>
            {TRIP_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Truck
          <select
            value={d.truckId ?? ''}
            onChange={(e) =>
              setD({ ...d, truckId: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">— none yet —</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.vendor ? ` (${t.vendor})` : ''}
              </option>
            ))}
          </select>
        </label>
        {field('date', 'Date', 'date')}
        <label>
          Status
          <select
            value={d.status}
            onChange={(e) => setD({ ...d, status: e.target.value as TruckTripInput['status'] })}
          >
            <option value="planned">Planned</option>
            <option value="confirmed">Confirmed</option>
            <option value="done">Done</option>
          </select>
        </label>
        {field('origin', 'From')}
        {field('destination', 'To')}
        {field('departTime', 'Depart', 'time')}
        {field('arriveTime', 'Arrive', 'time')}
        {field('dockStart', 'Dock slot — start', 'time')}
        {field('dockEnd', 'Dock slot — end', 'time')}
        {field('driver', 'Driver')}
        {field('phone', 'Driver phone', 'tel')}
        <div className="span-2">
          <div style={{ marginBottom: 6 }}>On board ({d.caseIds.length} cases)</div>
          {cases.length ? (
            <div className="trip-cases">
              {cases.map((c) => (
                <label key={c.id} className="chk">
                  <input
                    type="checkbox"
                    checked={d.caseIds.includes(c.id)}
                    onChange={(e) =>
                      setD({
                        ...d,
                        caseIds: e.target.checked
                          ? [...d.caseIds, c.id]
                          : d.caseIds.filter((x) => x !== c.id)
                      })
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">No cases yet — pack them on the Packing › Cases page.</p>
          )}
        </div>
        <label className="span-2">
          Notes
          <textarea
            value={d.notes}
            onChange={(e) => setD({ ...d, notes: e.target.value })}
            rows={2}
          />
        </label>
      </form>
    </Modal>
  )
}

export default TripModal
