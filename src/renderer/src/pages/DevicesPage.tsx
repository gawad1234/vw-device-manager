import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Device, DeviceInput, DeviceWarning, Subnet } from '../../../shared/types'
import PortsSection from '../components/PortsSection'

const EMPTY_FORM: DeviceInput = {
  name: '',
  deviceType: null,
  macAddress: null,
  location: null,
  notes: null,
  isSwitch: false,
  managementIp: null,
  oobIp: null
}

interface Props {
  devices: Device[]
  subnets: Subnet[]
  onChanged: () => void
}

function DevicesPage({ devices, subnets, onChanged }: Props): React.JSX.Element {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<DeviceInput>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<DeviceWarning[]>([])
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    if (!showForm) {
      setEditingId(null)
      setForm(EMPTY_FORM)
      setError(null)
      setWarnings([])
    }
  }, [showForm])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return devices
    return devices.filter((d) => {
      const portText = d.ports.flatMap((p) => [p.label, p.ipAddress])
      return [d.name, d.deviceType, d.macAddress, d.location, d.notes, ...portText]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    })
  }, [devices, search])

  function startEdit(device: Device): void {
    setEditingId(device.id)
    setForm({
      name: device.name,
      deviceType: device.deviceType,
      macAddress: device.macAddress,
      location: device.location,
      notes: device.notes,
      isSwitch: device.isSwitch,
      managementIp: device.managementIp,
      oobIp: device.oobIp
    })
    setError(null)
    setWarnings([])
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Device name is required.')
      return
    }
    const result =
      editingId != null
        ? await window.api.devices.update(editingId, form)
        : await window.api.devices.create(form)

    if (result.error) {
      setError(result.error)
      setWarnings([])
      return
    }
    setError(null)
    onChanged()

    // Non-blocking warnings (e.g. a mistyped management IP): the save went
    // through, but keep the form open so they're seen. Adopt the new id so a
    // re-submit updates this device instead of creating a duplicate.
    if (result.warnings.length > 0) {
      setWarnings(result.warnings)
      if (result.device) setEditingId(result.device.id)
      return
    }
    setWarnings([])
    setShowForm(false)
  }

  async function handleDelete(device: Device): Promise<void> {
    if (!window.confirm(`Delete device "${device.name}" and its ports?`)) return
    await window.api.devices.remove(device.id)
    onChanged()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Devices</h2>
        <div className="page-header-actions">
          <input
            className="search"
            placeholder="Search devices…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add device'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="panel form-grid" onSubmit={handleSubmit}>
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
          <div className="form-actions span-2">
            <button type="submit" className="btn btn-primary">
              {editingId != null ? 'Save changes' : 'Create device'}
            </button>
          </div>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>MAC</th>
            <th>Location</th>
            <th>Ports</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-cell">
                {devices.length === 0 ? 'No devices yet.' : 'No devices match your search.'}
              </td>
            </tr>
          )}
          {filtered.map((d) => (
            <Fragment key={d.id}>
              <tr>
                <td>
                  {d.name}
                  {d.isSwitch && (
                    <span
                      className="badge"
                      title={`Switch — mgmt ${d.managementIp ?? '—'} · OOB ${d.oobIp ?? '—'}`}
                    >
                      switch
                    </span>
                  )}
                </td>
                <td className="muted">{d.deviceType ?? '—'}</td>
                <td className="muted">{d.macAddress ?? '—'}</td>
                <td className="muted">{d.location ?? '—'}</td>
                <td>
                  <button
                    className="btn btn-small"
                    onClick={() => setExpandedId((cur) => (cur === d.id ? null : d.id))}
                  >
                    {expandedId === d.id ? '▾' : '▸'} {d.ports.length}
                  </button>
                </td>
                <td className="row-actions">
                  <button className="btn btn-small" onClick={() => startEdit(d)}>
                    Edit
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => handleDelete(d)}>
                    Delete
                  </button>
                </td>
              </tr>
              {expandedId === d.id && (
                <tr className="ports-row">
                  <td colSpan={6}>
                    <PortsSection device={d} subnets={subnets} onChanged={onChanged} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default DevicesPage
