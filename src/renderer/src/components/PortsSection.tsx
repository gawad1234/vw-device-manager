import { useState } from 'react'
import type { Device, DeviceWarning, Port, Subnet } from '../../../shared/types'

function subnetLabel(s: Subnet): string {
  return s.vlan ? `${s.name} (VLAN ${s.vlan})` : s.name
}

interface PortRowProps {
  port: Port
  subnets: Subnet[]
  /** Switch ports are VLAN-only — no per-port IP (that lives on the device). */
  isSwitch: boolean
  onChanged: () => void
}

function PortRow({ port, subnets, isSwitch, onChanged }: PortRowProps): React.JSX.Element {
  const [label, setLabel] = useState(port.label)
  const [ip, setIp] = useState(port.ipAddress ?? '')
  const [untagged, setUntagged] = useState<number | null>(port.untaggedSubnetId)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<DeviceWarning[]>([])
  const [saving, setSaving] = useState(false)

  const fromVw = port.vwSocketKey != null

  async function save(): Promise<void> {
    setSaving(true)
    const result = await window.api.ports.update(port.id, {
      label: label.trim() || port.label,
      ipAddress: isSwitch ? null : ip.trim() || null,
      untaggedSubnetId: untagged
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      setWarnings([])
      return
    }
    setError(null)
    setWarnings(result.warnings)
    onChanged()
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Remove port "${port.label}"?`)) return
    await window.api.ports.remove(port.id)
    onChanged()
  }

  async function toggleTagged(subnetId: number, checked: boolean): Promise<void> {
    const next = checked
      ? [...port.taggedSubnetIds, subnetId]
      : port.taggedSubnetIds.filter((id) => id !== subnetId)
    await window.api.ports.setTaggedVlans(port.id, next)
    onChanged()
  }

  // A port can't tag its own untagged network; offer the rest as trunk VLANs.
  const taggableSubnets = subnets.filter((s) => s.id !== untagged)

  return (
    <div className="port-row">
      {error && <div className="banner banner-error">{error}</div>}
      {warnings.map((w, i) => (
        <div className="banner banner-warning" key={i}>
          {w.message}
        </div>
      ))}
      <div className="port-fields">
        <label>
          Jack
          <input
            value={label}
            readOnly={fromVw}
            title={fromVw ? 'Comes from the ConnectCAD jack — edit in Vectorworks.' : undefined}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        {!isSwitch && (
          <label>
            IP address
            <input value={ip} placeholder="10.0.10.21" onChange={(e) => setIp(e.target.value)} />
          </label>
        )}
        <label>
          Untagged network
          <select
            value={untagged ?? ''}
            onChange={(e) => setUntagged(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— none —</option>
            {subnets.map((s) => (
              <option key={s.id} value={s.id}>
                {subnetLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <div className="port-actions">
          <button className="btn btn-small btn-primary" onClick={save} disabled={saving}>
            Save
          </button>
          {!fromVw && (
            <button className="btn btn-small btn-danger" onClick={remove}>
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="port-tagged">
        <span className="muted">Tagged VLANs (trunk):</span>
        {taggableSubnets.length === 0 ? (
          <span className="muted"> none available</span>
        ) : (
          taggableSubnets.map((s) => (
            <label key={s.id} className="chk">
              <input
                type="checkbox"
                checked={port.taggedSubnetIds.includes(s.id)}
                onChange={(e) => toggleTagged(s.id, e.target.checked)}
              />
              {subnetLabel(s)}
            </label>
          ))
        )}
      </div>
    </div>
  )
}

interface Props {
  device: Device
  subnets: Subnet[]
  onChanged: () => void
}

function PortsSection({ device, subnets, onChanged }: Props): React.JSX.Element {
  async function addPort(): Promise<void> {
    await window.api.ports.create(device.id, {
      label: `Port ${device.ports.length + 1}`,
      ipAddress: null,
      untaggedSubnetId: null
    })
    onChanged()
  }

  return (
    <div className="ports-section">
      {device.isSwitch && (
        <p className="muted">Switch ports are VLAN-only — set the untagged network and any tagged (trunk) VLANs.</p>
      )}
      {device.ports.length === 0 && <p className="muted">No ports yet.</p>}
      {device.ports.map((p) => (
        <PortRow
          key={p.id}
          port={p}
          subnets={subnets}
          isSwitch={device.isSwitch}
          onChanged={onChanged}
        />
      ))}
      <button className="btn btn-small" onClick={addPort}>
        + Add port
      </button>
    </div>
  )
}

export default PortsSection
