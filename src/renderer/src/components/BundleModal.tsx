import { useEffect, useState } from 'react'
import type { Bundle, BundleInput, CableType, Device } from '../../../shared/types'
import Modal from './Modal'
import BundleCables from './BundleCables'
import ExportMenu from './ExportMenu'

// Preset palette for color-coding bundles (readable on the dark theme).
const BUNDLE_COLORS = [
  '#e0685f',
  '#e0954f',
  '#e0c24f',
  '#6fd06f',
  '#4fc0c0',
  '#3b6fe0',
  '#9b6fe0',
  '#e06fb0'
]

const EMPTY_FORM: BundleInput = {
  name: '',
  color: null,
  fromLocation: null,
  toLocation: null,
  length: null,
  notes: null
}

function toForm(b: Bundle): BundleInput {
  return {
    name: b.name,
    color: b.color,
    fromLocation: b.fromLocation,
    toLocation: b.toLocation,
    length: b.length,
    notes: b.notes
  }
}

interface Props {
  bundle: Bundle | null
  devices: Device[]
  cableTypes: CableType[]
  onClose: () => void
  onChanged: () => void
  onCreated: (id: number) => void
}

function BundleModal({
  bundle,
  devices,
  cableTypes,
  onClose,
  onChanged,
  onCreated
}: Props): React.JSX.Element {
  const [form, setForm] = useState<BundleInput>(bundle ? toForm(bundle) : EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setForm(bundle ? toForm(bundle) : EMPTY_FORM)
    setError(null)
  }, [bundle?.id])

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Bundle name is required.')
      return
    }
    const result = bundle
      ? await window.api.bundles.update(bundle.id, form)
      : await window.api.bundles.create(form)
    setError(null)
    onChanged()
    // New bundle: reopen in edit mode to add cables. Existing: close on save.
    if (!bundle) onCreated(result.id)
    else onClose()
  }

  async function handleDelete(): Promise<void> {
    if (!bundle) return
    if (!window.confirm(`Delete bundle "${bundle.name}" and its ${bundle.cables.length} cable(s)?`))
      return
    await window.api.bundles.remove(bundle.id)
    onChanged()
    onClose()
  }

  const title = (
    <>
      {bundle?.color && <span className="bundle-dot" style={{ background: bundle.color }} />}
      {bundle ? bundle.name : 'New bundle'}
    </>
  )

  const footer = (
    <>
      {bundle && (
        <>
          <button className="btn btn-danger" onClick={handleDelete}>
            Delete
          </button>
          <ExportMenu scope="bundle" bundleId={bundle.id} dropUp />
        </>
      )}
      <span className="footer-spacer" />
      <button className="btn" onClick={onClose}>
        Close
      </button>
      <button className="btn btn-primary" type="submit" form="bundle-form">
        {bundle ? 'Save changes' : 'Create bundle'}
      </button>
    </>
  )

  return (
    <Modal title={title} onClose={onClose} footer={footer}>
      <form id="bundle-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error">{error}</div>}
        <label>
          Name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Stage → Rack A conduit"
            autoFocus
          />
        </label>
        <label>
          Color
          <div className="swatch-picker">
            <button
              type="button"
              className={`swatch-option none ${form.color == null ? 'selected' : ''}`}
              onClick={() => setForm({ ...form, color: null })}
              title="No color"
            />
            {BUNDLE_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`swatch-option ${form.color === c ? 'selected' : ''}`}
                style={{ background: c }}
                onClick={() => setForm({ ...form, color: c })}
                title={c}
              />
            ))}
          </div>
        </label>
        <label>
          From (location)
          <input
            value={form.fromLocation ?? ''}
            onChange={(e) => setForm({ ...form, fromLocation: e.target.value || null })}
            placeholder="Stage left"
          />
        </label>
        <label>
          To (location)
          <input
            value={form.toLocation ?? ''}
            onChange={(e) => setForm({ ...form, toLocation: e.target.value || null })}
            placeholder="Rack A, FOH"
          />
        </label>
        <label>
          Length
          <input
            value={form.length ?? ''}
            onChange={(e) => setForm({ ...form, length: e.target.value || null })}
            placeholder="50'"
          />
          <small className="muted">Applies to every cable in the bundle.</small>
        </label>
        <label className="span-2">
          Notes
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
            rows={2}
          />
        </label>
      </form>

      {bundle ? (
        <div className="modal-section">
          <h3>Cables</h3>
          <BundleCables
            bundle={bundle}
            devices={devices}
            cableTypes={cableTypes}
            onChanged={onChanged}
          />
        </div>
      ) : (
        <p className="muted modal-section">Create the bundle first, then add its cables here.</p>
      )}
    </Modal>
  )
}

export default BundleModal
