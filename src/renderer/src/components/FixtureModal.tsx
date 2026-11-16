import { useRef, useState } from 'react'
import type { Fixture, FixtureInput, FixtureType } from '../../../shared/types'
import Modal, { ModalDismiss, type ModalControl } from './Modal'
import Field from './Field'

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
  /** save failed (not about one field) */
  const [error, setError] = useState('')
  const [patchError, setPatchError] = useState<{
    field: 'universe' | 'address'
    message: string
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const modal = useRef<ModalControl>(null)
  const modes = types.find((t) => t.name === d.instType)?.modes ?? []
  const fromVw = !!fixture.vw?.Fixture_Mode
  const set = (k: keyof FixtureInput, v: string): void => setD({ ...d, [k]: v })

  async function save(e?: React.FormEvent): Promise<void> {
    e?.preventDefault()
    if (saving) return
    setError('')
    if (d.universe != null && d.address == null)
      return setPatchError({
        field: 'address',
        message: `Universe ${d.universe} needs an address (1–512) — or clear the universe.`
      })
    if (d.address != null && d.universe == null)
      return setPatchError({
        field: 'universe',
        message: `Address ${d.address} needs a universe — or clear the address.`
      })
    if (d.address != null && d.address > 512)
      return setPatchError({
        field: 'address',
        message: `${d.address} is past the end of the universe. Addresses run 1–512.`
      })
    setPatchError(null)
    setSaving(true)
    try {
      // Vectorworks may have changed this fixture while the window was open: start
      // from the current row and lay on only what was edited here.
      const current = (await window.api.fixtures.list()).find((f) => f.id === d.id) ?? fixture
      const edited = Object.fromEntries(
        Object.entries(d).filter(
          ([k, v]) => JSON.stringify(v) !== JSON.stringify(fixture[k as keyof Fixture])
        )
      )
      const { id, ...input } = { ...current, ...edited }
      await window.api.fixtures.save(id, input)
    } catch (err) {
      // stay open so nothing typed is lost
      setError(`Couldn’t save the fixture: ${(err as Error).message}`)
      return
    } finally {
      setSaving(false)
    }
    modal.current?.markClean()
    onSaved()
    onClose()
  }

  return (
    <Modal
      title={`${d.position || 'Fixture'}${d.unit ? ` #${d.unit}` : ''}`}
      onClose={onClose}
      wide
      controlRef={modal}
      footer={
        <>
          <span className="footer-spacer" />
          <ModalDismiss />
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => save()}
          >
            {saving ? 'Saving…' : 'Save fixture'}
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
        <label title={fromVw ? 'Set in Vectorworks (Fixture Mode)' : undefined}>
          Mode{fromVw && <small className="muted"> · from Vectorworks</small>}
          <input
            value={d.mode}
            list="fixture-modes"
            disabled={fromVw}
            onChange={(e) => set('mode', e.target.value)}
          />
          <datalist id="fixture-modes">
            {modes.map((m) => (
              <option key={m.name} value={m.name}>{`${m.footprint} ch`}</option>
            ))}
          </datalist>
        </label>
        <Field
          label="Universe"
          error={patchError?.field === 'universe' ? patchError.message : null}
        >
          <input
            className="mono"
            inputMode="numeric"
            value={d.universe ?? ''}
            onChange={(e) => {
              setD({ ...d, universe: num(e.target.value) })
              setPatchError(null)
            }}
          />
        </Field>
        <Field
          label="Address"
          hint="1–512; set with a universe, or leave both empty"
          error={patchError?.field === 'address' ? patchError.message : null}
        >
          <input
            className="mono"
            inputMode="numeric"
            value={d.address ?? ''}
            onChange={(e) => {
              setD({ ...d, address: num(e.target.value) })
              setPatchError(null)
            }}
          />
        </Field>
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
