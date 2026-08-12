import { useEffect, useMemo, useState } from 'react'
import type { Device, Subnet } from '../../../shared/types'
import DeviceModal from '../components/DeviceModal'
import ExportMenu, { type ExportSection } from '../components/ExportMenu'

const IP_SECTIONS: ExportSection[] = [
  {
    label: 'IP schedule',
    items: [
      { label: 'PDF', doc: 'ipschedule', format: 'pdf' },
      { label: 'Excel', doc: 'ipschedule', format: 'xlsx' },
      { label: 'CSV', doc: 'ipschedule', format: 'csv' }
    ]
  }
]

interface Props {
  devices: Device[]
  subnets: Subnet[]
  onChanged: () => void
}

function DevicesPage({ devices, subnets, onChanged }: Props): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | 'new' | null>(null)

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

  // If the open device was deleted, close the modal.
  useEffect(() => {
    if (typeof openId === 'number' && !devices.some((d) => d.id === openId)) setOpenId(null)
  }, [devices, openId])

  const openDevice =
    openId === 'new' ? null : typeof openId === 'number' ? devices.find((d) => d.id === openId) ?? null : null

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
          {devices.length > 0 && (
            <ExportMenu scope="all" label="Export IP schedule" sections={IP_SECTIONS} />
          )}
          <button className="btn btn-primary" onClick={() => setOpenId('new')}>
            + Add device
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>MAC</th>
            <th>Location</th>
            <th>Ports</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-cell">
                {devices.length === 0 ? 'No devices yet.' : 'No devices match your search.'}
              </td>
            </tr>
          )}
          {filtered.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => setOpenId(d.id)}>
              <td>
                {d.name}
                {d.isSwitch && <span className="badge">switch</span>}
              </td>
              <td className="muted">{d.deviceType ?? '—'}</td>
              <td className="muted">{d.macAddress ?? '—'}</td>
              <td className="muted">{d.location ?? '—'}</td>
              <td className="muted">{d.ports.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {openId != null && (
        <DeviceModal
          device={openDevice}
          subnets={subnets}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}

export default DevicesPage
