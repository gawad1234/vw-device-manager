import { useState } from 'react'
import type { Fixture, FixtureInput, FixtureType } from '../../../shared/types'
import Modal from './Modal'

interface Props {
  fixture: Fixture
  types: FixtureType[]
  onClose: () => void
  onSaved: () => void
}

const TEXT: [keyof FixtureInput, string][] = [
  ['position', 'Position'],
  ['unit', 'Unit #'],
  ['instType', 'Instrument type'],
  ['purpose', 'Purpose'],
  ['channel', 'Channel'],
  ['color', 'Color'],
  ['gobo1', 'Gobo 1'],
  ['gobo2', 'Gobo 2'],
  ['accessories', 'Accessories'],
  ['wattage', 'Wattage'],
  ['dimmer', 'Dimmer'],
  ['circuitName', 'Circuit name'],
  ['circuitNumber', 'Circuit #'],
  ['mark', 'Mark']
]

const num = (v: string): number | null => (v.trim() && Number(v) > 0 ? Math.floor(Number(v)) : null)

/** Edit one fixture. Changes go to Vectorworks through the exchange file when sync is on. */
function FixtureModal({ fixture, types, onClose, onSaved }: Props): React.JSX.Element {
  const [d, setD] = useState<Fixture>({ ...fixture, userFields: [...fixture.userFields] })
  const [error, setError] = useState('')
  const modes = types.find((t) => t.name === d.instType)?.modes ?? []
  const set = (k: keyof FixtureInput, v: string): void => setD({ ...d, [k]: v })

  async function save(e?: React.FormEvent): Promise<void> {
    e?.preventDefault()
    if ((d.universe == null) !== (d.address == null))
      return setError('Set both universe and address, or neither.')
    if (d.address != null && d.address > 512) return setError('Addresses run 1–512.')
    const { id, ...input } = d
    await window.api.fixtures.save(id, input)
    onSaved()
    onClose()
  }

  return (
    <Modal
      title={`${d.position || 'Fixture'}${d.unit ? ` #${d.unit}` : ''}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="footer-spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()}>
            Save
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error span-2">{error}</div>}
        {TEXT.map(([k, label]) => (
          <label key={k}>
            {label}
            <input value={d[k] as string} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        <label>
          Mode
          <input
            value={d.mode}
            list="fixture-modes"
            onChange={(e) => set('mode', e.target.value)}
          />
          <datalist id="fixture-modes">
            {modes.map((m) => (
              <option key={m.name} value={m.name}>{`${m.footprint} ch`}</option>
            ))}
          </datalist>
        </label>
        <label>
          Universe / address
          <span style={{ display: 'flex', gap: 6 }}>
            <input
              className="mono"
              inputMode="numeric"
              placeholder="U"
              value={d.universe ?? ''}
              onChange={(e) => setD({ ...d, universe: num(e.target.value) })}
            />
            <input
              className="mono"
              inputMode="numeric"
              placeholder="Address"
              value={d.address ?? ''}
              onChange={(e) => setD({ ...d, address: num(e.target.value) })}
            />
          </span>
        </label>
        {d.userFields.map((v, i) => (
          <label key={i}>
            User field {i + 1}
            <input
              value={v}
              onChange={(e) => {
                const userFields = [...d.userFields]
                userFields[i] = e.target.value
                setD({ ...d, userFields })
              }}
            />
          </label>
        ))}
        <label className="span-2">
          Notes <small>(Device Manager only)</small>
          <input value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
        <p className="muted span-2" style={{ margin: 0 }}>
          {d.vw.Symbol_Name && <>Symbol: {d.vw.Symbol_Name} · </>}
          {d.vw.Layer && <>Layer: {d.vw.Layer} · </>}
          {d.vwUid ? `Vectorworks UID ${d.vwUid}` : 'Not linked to the drawing'}
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export default FixtureModal
