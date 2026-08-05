import { useState } from 'react'
import type { Bundle, Cable, CableEndpoint, CableType, Device } from '../../../shared/types'

/** Source/destination editor: pick a device (and optionally a specific port),
 *  or fall back to free text when the device isn't in the app. */
interface EndpointFieldProps {
  label: string
  value: CableEndpoint
  devices: Device[]
  onChange: (next: CableEndpoint) => void
}

function EndpointField({ label, value, devices, onChange }: EndpointFieldProps): React.JSX.Element {
  const device = value.deviceId != null ? devices.find((d) => d.id === value.deviceId) : undefined

  return (
    <label className="endpoint-field">
      {label}
      <div className="endpoint-inputs">
        <select
          value={value.deviceId ?? ''}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null
            // switching to a device clears free text; switching to free text keeps it
            onChange({ deviceId: id, portId: null, text: id != null ? null : value.text })
          }}
        >
          <option value="">— free text —</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {device ? (
          <select
            value={value.portId ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                portId: e.target.value ? Number(e.target.value) : null,
                text: null
              })
            }
          >
            <option value="">— whole device —</option>
            {device.ports.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={value.text ?? ''}
            placeholder="e.g. Patch panel A-12"
            onChange={(e) => onChange({ deviceId: null, portId: null, text: e.target.value || null })}
          />
        )}
      </div>
    </label>
  )
}

interface CableRowProps {
  cable: Cable
  devices: Device[]
  cableTypes: CableType[]
  onChanged: () => void
}

function CableRow({ cable, devices, cableTypes, onChanged }: CableRowProps): React.JSX.Element {
  const [name, setName] = useState(cable.name)
  const [typeId, setTypeId] = useState<number | null>(cable.cableTypeId)
  const [source, setSource] = useState<CableEndpoint>(cable.source)
  const [destination, setDestination] = useState<CableEndpoint>(cable.destination)
  const [pulled, setPulled] = useState(cable.pulled)
  const [labeled, setLabeled] = useState(cable.labeled)
  const [saving, setSaving] = useState(false)

  // `patch` lets the check sheet persist a single toggle immediately while still
  // carrying along any edits in progress in this row.
  async function save(patch?: { pulled?: boolean; labeled?: boolean }): Promise<void> {
    setSaving(true)
    await window.api.cables.update(cable.id, {
      name: name.trim() || cable.name,
      cableTypeId: typeId,
      source,
      destination,
      pulled: patch?.pulled ?? pulled,
      labeled: patch?.labeled ?? labeled,
      notes: cable.notes
    })
    setSaving(false)
    onChanged()
  }

  function togglePulled(value: boolean): void {
    setPulled(value)
    save({ pulled: value })
  }

  function toggleLabeled(value: boolean): void {
    setLabeled(value)
    save({ labeled: value })
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Remove cable "${cable.name}"?`)) return
    await window.api.cables.remove(cable.id)
    onChanged()
  }

  return (
    <div className="port-row">
      <div className="port-fields">
        <label>
          Cable
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Type
          <select
            value={typeId ?? ''}
            onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— none —</option>
            {cableTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="chk">
          <input
            type="checkbox"
            checked={pulled}
            onChange={(e) => togglePulled(e.target.checked)}
          />
          Pulled
        </label>
        <label className="chk">
          <input
            type="checkbox"
            checked={labeled}
            onChange={(e) => toggleLabeled(e.target.checked)}
          />
          Labeled
        </label>
        <div className="port-actions">
          <button className="btn btn-small btn-primary" onClick={() => save()} disabled={saving}>
            Save
          </button>
          <button className="btn btn-small btn-danger" onClick={remove}>
            Remove
          </button>
        </div>
      </div>
      <div className="endpoint-row">
        <EndpointField label="Source" value={source} devices={devices} onChange={setSource} />
        <EndpointField
          label="Destination"
          value={destination}
          devices={devices}
          onChange={setDestination}
        />
      </div>
    </div>
  )
}

interface Props {
  bundle: Bundle
  devices: Device[]
  cableTypes: CableType[]
  onChanged: () => void
}

function BundleCables({ bundle, devices, cableTypes, onChanged }: Props): React.JSX.Element {
  async function addCable(): Promise<void> {
    await window.api.cables.create(bundle.id, {
      name: `Cable ${bundle.cables.length + 1}`,
      cableTypeId: null,
      source: { deviceId: null, portId: null, text: null },
      destination: { deviceId: null, portId: null, text: null },
      pulled: false,
      labeled: false,
      notes: null
    })
    onChanged()
  }

  const total = bundle.cables.length
  const pulledCount = bundle.cables.filter((c) => c.pulled).length
  const labeledCount = bundle.cables.filter((c) => c.labeled).length

  return (
    <div className="ports-section">
      {total > 0 && (
        <p className="muted">
          Pulled {pulledCount}/{total} · Labeled {labeledCount}/{total}
        </p>
      )}
      {bundle.cables.length === 0 && <p className="muted">No cables in this bundle yet.</p>}
      {bundle.cables.map((c) => (
        <CableRow
          key={c.id}
          cable={c}
          devices={devices}
          cableTypes={cableTypes}
          onChanged={onChanged}
        />
      ))}
      <button className="btn btn-small" onClick={addCable}>
        + Add cable
      </button>
    </div>
  )
}

export default BundleCables
