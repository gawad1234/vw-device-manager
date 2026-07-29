import { useEffect, useMemo, useState } from 'react'
import type { Device, DeviceInput, DeviceWarning, Subnet } from '../../../shared/types'

const EMPTY_FORM: DeviceInput = {
  name: '',
  deviceType: null,
  ipAddress: null,
  macAddress: null,
  subnetId: null,
  location: null,
  notes: null
}

interface Props {
  devices: Device[]
  subnets: Subnet[]
  onChanged: () => void
}

function subnetName(subnets: Subnet[], id: number | null): string {
  if (id == null) return '—'
  return subnets.find((s) => s.id === id)?.name ?? '—'
}

function DevicesPage({ devices, subnets, onChanged }: Props): React.JSX.Element {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<DeviceInput>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<DeviceWarning[]>([])
  const [search, setSearch] = useState('')

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
    return devices.filter((d) =>
      [d.name, d.deviceType, d.ipAddress, d.macAddress, d.location, d.notes]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    )
  }, [devices, search])

  function startEdit(device: Device): void {
    setEditingId(device.id)
    setForm({
      name: device.name,
      deviceType: device.deviceType,
      ipAddress: device.ipAddress,
      macAddress: device.macAddress,
      subnetId: device.subnetId,
      location: device.location,
      notes: device.notes
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
    setWarnings(result.warnings)
    onChanged()
    if (result.warnings.length === 0) {
      setShowForm(false)
    }
  }

  async function handleDelete(device: Device): Promise<void> {
    if (!window.confirm(`Delete device "${device.name}"?`)) return
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
              onChange={(e) => setForm({ ...form, deviceType: e.target.value || null })}
              placeholder="Camera, Switch, DSP…"
            />
          </label>
          <label>
            IP address
            <input
              value={form.ipAddress ?? ''}
              onChange={(e) => setForm({ ...form, ipAddress: e.target.value || null })}
              placeholder="10.0.10.21"
            />
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
            Subnet
            <select
              value={form.subnetId ?? ''}
              onChange={(e) =>
                setForm({ ...form, subnetId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">— none —</option>
              {subnets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.cidr})
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <input
              value={form.location ?? ''}
              onChange={(e) => setForm({ ...form, location: e.target.value || null })}
              placeholder="Rack 3 / FOH"
            />
          </label>
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
            <th>IP address</th>
            <th>MAC</th>
            <th>Subnet</th>
            <th>Location</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-cell">
                {devices.length === 0 ? 'No devices yet.' : 'No devices match your search.'}
              </td>
            </tr>
          )}
          {filtered.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td className="muted">{d.deviceType ?? '—'}</td>
              <td>{d.ipAddress ? <code>{d.ipAddress}</code> : '—'}</td>
              <td className="muted">{d.macAddress ?? '—'}</td>
              <td>{subnetName(subnets, d.subnetId)}</td>
              <td className="muted">{d.location ?? '—'}</td>
              <td className="row-actions">
                <button className="btn btn-small" onClick={() => startEdit(d)}>
                  Edit
                </button>
                <button className="btn btn-small btn-danger" onClick={() => handleDelete(d)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default DevicesPage
