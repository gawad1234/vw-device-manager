import { useEffect, useState } from 'react'
import type { Device, DeviceInput, DeviceWarning, Subnet } from '../../../shared/types'
import Modal from './Modal'
import PortsSection from './PortsSection'

const EMPTY_FORM: DeviceInput = {
  name: '',
  deviceType: null,
  macAddress: null,
  location: null,
  notes: null,
  category: null,
  isSwitch: false,
  managementIp: null,
  oobIp: null
}

function toForm(d: Device): DeviceInput {
  return {
    name: d.name,
    deviceType: d.deviceType,
    macAddress: d.macAddress,
    location: d.location,
    notes: d.notes,
    category: d.category,
    isSwitch: d.isSwitch,
    managementIp: d.managementIp,
    oobIp: d.oobIp
  }
}

interface Props {
  /** the device being edited, or null to create a new one */
  device: Device | null
  subnets: Subnet[]
  /** shared device-category names for the Category dropdown */
  categories: string[]
  onClose: () => void
  onChanged: () => void
  /** after a create, hand the new id back so the parent re-opens it in edit mode */
  onCreated: (id: number) => void
}

function DeviceModal({
  device,
  subnets,
  categories,
  onClose,
  onChanged,
  onCreated
}: Props): React.JSX.Element {
  const [form, setForm] = useState<DeviceInput>(device ? toForm(device) : EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<DeviceWarning[]>([])
  const [saving, setSaving] = useState(false)

  // Re-seed the form only when a different device is opened — NOT on every
  // ports refresh (which re-renders with the same id and would wipe edits).
  useEffect(() => {
    setForm(device ? toForm(device) : EMPTY_FORM)
    setError(null)
    setWarnings([])
  }, [device?.id])

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Device name is required.')
      return
    }
    setSaving(true)
    const result = device
      ? await window.api.devices.update(device.id, form)
      : await window.api.devices.create(form)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      setWarnings([])
      return
    }
    setError(null)
    setWarnings(result.warnings)
    onChanged()
    if (!device && result.device) {
      // New device: reopen in edit mode so ports can be added.
      onCreated(result.device.id)
    } else if (device && result.warnings.length === 0) {
      // Editing an existing device saved cleanly — close the window. (If there
      // are advisory warnings, stay open so they're seen.)
      onClose()
    }
  }

  async function handleDelete(): Promise<void> {
    if (!device) return
    if (!window.confirm(`Delete device "${device.name}" and its ports?`)) return
    await window.api.devices.remove(device.id)
    onChanged()
    onClose()
  }

  const title = (
    <>
      {device ? device.name : 'New device'}
      {device?.isSwitch && <span className="badge">switch</span>}
    </>
  )

  const footer = (
    <>
      {device && (
        <button className="btn btn-danger" onClick={handleDelete}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <button className="btn" onClick={onClose}>
        Close
      </button>
      <button className="btn btn-primary" type="submit" form="device-form" disabled={saving}>
        {device ? 'Save changes' : 'Create device'}
      </button>
    </>
  )

  return (
    <Modal title={title} onClose={onClose} footer={footer}>
      <form id="device-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error">{error}</div>}
        {warnings.map((w, i) => (
          <div className="banner banner-warning" key={i}>
            {w.message}
          </div>
        ))}
        <label>
          Name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="STAGE-CAM-01"
            autoFocus
          />
        </label>
        <label>
          Type
          <input
            value={form.deviceType ?? ''}
            readOnly
            placeholder="— from Vectorworks —"
            title="Synced from the drawing (Model field) — edit it in Vectorworks."
          />
          <small className="muted">Synced from Vectorworks (Model)</small>
        </label>
        <label>
          MAC address
          <input
            value={form.macAddress ?? ''}
            onChange={(e) => setForm({ ...form, macAddress: e.target.value || null })}
            placeholder="00:1A:2B:3C:4D:5E"
          />
        </label>
        <label>
          Location
          <input
            value={form.location ?? ''}
            readOnly
            placeholder="— from Vectorworks —"
            title="Synced from the drawing (Room / Rack / Rack U / Slot) — edit it in Vectorworks."
          />
          <small className="muted">Synced from Vectorworks (Room / Rack / Rack U / Slot)</small>
        </label>
        <label>
          Category
          <select
            value={form.category ?? ''}
            onChange={(e) => setForm({ ...form, category: e.target.value || null })}
          >
            <option value="">— none —</option>
            {form.category && !categories.includes(form.category) && (
              <option value={form.category}>{form.category}</option>
            )}
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <small className="muted">Manage the list in Settings → Device categories.</small>
        </label>
        <label className="checkbox-field span-2">
          <input
            type="checkbox"
            checked={form.isSwitch}
            onChange={(e) => setForm({ ...form, isSwitch: e.target.checked })}
          />
          This is a network switch
          <small className="muted">
            Switches use a management + OOB IP instead of a per-port IP; their ports are VLAN-only.
          </small>
        </label>
        {form.isSwitch && (
          <>
            <label>
              Management IP
              <input
                value={form.managementIp ?? ''}
                onChange={(e) => setForm({ ...form, managementIp: e.target.value || null })}
                placeholder="10.0.10.2"
              />
            </label>
            <label>
              Out-of-band (OOB) IP
              <input
                value={form.oobIp ?? ''}
                onChange={(e) => setForm({ ...form, oobIp: e.target.value || null })}
                placeholder="192.168.100.2"
              />
            </label>
          </>
        )}
        <label className="span-2">
          Notes
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
            rows={2}
          />
        </label>
      </form>

      {device ? (
        <div className="modal-section">
          <h3>Ports</h3>
          <PortsSection device={device} subnets={subnets} onChanged={onChanged} />
        </div>
      ) : (
        <p className="muted modal-section">Create the device first, then add its ports here.</p>
      )}
    </Modal>
  )
}

export default DeviceModal
