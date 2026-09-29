import { useEffect, useState } from 'react'
import type { HostConfig, HostConfigInput, Subnet, VlanEntry } from '../../../shared/types'
import Modal from './Modal'

function prefixFromCidr(cidr: string | null): number {
  const m = /\/(\d{1,2})\s*$/.exec(cidr ?? '')
  const n = m ? Number(m[1]) : 24
  return n >= 0 && n <= 32 ? n : 24
}

function entryFromSubnet(s: Subnet): VlanEntry {
  return {
    name: s.vlan ? `VLAN ${s.vlan} - ${s.name}` : s.name,
    vlanId: s.vlan ? parseInt(s.vlan, 10) || 0 : 0,
    tagged: true,
    dhcp: false,
    ipAddress: '',
    prefixLength: prefixFromCidr(s.cidr),
    gateway: s.gateway ?? '',
    dnsServers: []
  }
}

const BLANK: VlanEntry = {
  name: '',
  vlanId: 1,
  tagged: true,
  dhcp: false,
  ipAddress: '',
  prefixLength: 24,
  gateway: '',
  dnsServers: []
}

interface Props {
  config: HostConfig | null
  subnets: Subnet[]
  onClose: () => void
  onChanged: () => void
  onCreated: (id: number) => void
}

function ConfigModal({ config, subnets, onClose, onChanged, onCreated }: Props): React.JSX.Element {
  const [name, setName] = useState(config?.name ?? '')
  const [switchName, setSwitchName] = useState(config?.switchName ?? 'VLAN-Trunk')
  const [vlans, setVlans] = useState<VlanEntry[]>(config?.vlans ?? [])
  const [error, setError] = useState<string | null>(null)
  const [addSubnetId, setAddSubnetId] = useState('')

  useEffect(() => {
    setName(config?.name ?? '')
    setSwitchName(config?.switchName ?? 'VLAN-Trunk')
    setVlans(config?.vlans ?? [])
    setError(null)
  }, [config?.id])

  function patchVlan(i: number, patch: Partial<VlanEntry>): void {
    setVlans((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  }

  // Exactly one native/untagged network: toggling one native tags the rest.
  function toggleNative(i: number): void {
    setVlans((prev) => {
      const becomingNative = prev[i].tagged
      return prev.map((v, idx) => {
        if (idx === i) return { ...v, tagged: !becomingNative }
        return becomingNative ? { ...v, tagged: true } : v
      })
    })
  }

  function removeVlan(i: number): void {
    setVlans((prev) => prev.filter((_, idx) => idx !== i))
  }
  function addBlank(): void {
    setVlans((prev) => [...prev, { ...BLANK }])
  }
  function addFromSubnet(): void {
    const s = subnets.find((x) => x.id === Number(addSubnetId))
    if (s) setVlans((prev) => [...prev, entryFromSubnet(s)])
    setAddSubnetId('')
  }

  function currentInput(): HostConfigInput {
    return { name: name.trim(), switchName: switchName.trim() || 'VLAN-Trunk', vlans }
  }

  async function persist(): Promise<HostConfig | null> {
    if (!name.trim()) {
      setError('Config name is required.')
      return null
    }
    setError(null)
    return config
      ? window.api.configs.update(config.id, currentInput())
      : window.api.configs.create(currentInput())
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const saved = await persist()
    if (!saved) return
    onChanged()
    if (!config) onCreated(saved.id)
    else onClose()
  }

  async function generate(): Promise<void> {
    const saved = await persist()
    if (!saved) return
    onChanged()
    if (!config) onCreated(saved.id)
    await window.api.configs.generate(saved.id)
  }

  async function handleDelete(): Promise<void> {
    if (!config) return
    if (!window.confirm(`Delete config "${config.name}"?`)) return
    await window.api.configs.remove(config.id)
    onChanged()
    onClose()
  }

  const footer = (
    <>
      {config && (
        <button className="btn btn-danger" onClick={handleDelete}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <button className="btn" type="button" onClick={onClose}>
        Close
      </button>
      <button
        className="btn"
        type="button"
        onClick={generate}
        disabled={!name.trim() || vlans.length === 0}
      >
        Generate script…
      </button>
      <button className="btn btn-primary" type="submit" form="config-form">
        {config ? 'Save changes' : 'Create config'}
      </button>
    </>
  )

  return (
    <Modal title={config ? config.name : 'New config'} onClose={onClose} footer={footer}>
      <form id="config-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error">{error}</div>}
        <label>
          Config name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. MGR61"
            autoFocus
          />
          <small className="muted">Used as the script filename.</small>
        </label>
        <label>
          Hyper-V switch name
          <input
            value={switchName}
            onChange={(e) => setSwitchName(e.target.value)}
            placeholder="VLAN-Trunk"
          />
        </label>
      </form>

      <div className="modal-section">
        <h3>VLANs</h3>
        <p className="muted">
          One network per host NIC. Mark exactly one as <strong>Native</strong> (untagged) — the
          rest are tagged. Give each an IP, or tick DHCP.
        </p>

        {vlans.length === 0 && <p className="muted">No VLANs yet — add one below.</p>}

        {vlans.map((v, i) => (
          <div className="port-row" key={i}>
            <div className="port-fields">
              <label>
                Name
                <input
                  value={v.name}
                  onChange={(e) => patchVlan(i, { name: e.target.value })}
                  placeholder="VLAN 10 - Device Net"
                />
              </label>
              <label>
                VLAN ID
                <input
                  type="number"
                  min={1}
                  max={4094}
                  value={v.vlanId}
                  onChange={(e) => patchVlan(i, { vlanId: Number(e.target.value) })}
                  style={{ minWidth: 80 }}
                />
              </label>
              <label className="chk">
                <input type="checkbox" checked={!v.tagged} onChange={() => toggleNative(i)} />
                Native
              </label>
              <label className="chk">
                <input
                  type="checkbox"
                  checked={v.dhcp}
                  onChange={(e) => patchVlan(i, { dhcp: e.target.checked })}
                />
                DHCP
              </label>
              <div className="port-actions">
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  onClick={() => removeVlan(i)}
                >
                  Remove
                </button>
              </div>
            </div>
            {!v.dhcp && (
              <div className="endpoint-row">
                <label className="endpoint-field" style={{ flex: '1 1 160px' }}>
                  IP address
                  <input
                    value={v.ipAddress ?? ''}
                    onChange={(e) => patchVlan(i, { ipAddress: e.target.value })}
                    placeholder="10.134.10.61"
                  />
                </label>
                <label className="endpoint-field" style={{ flex: '0 1 90px' }}>
                  Prefix
                  <input
                    type="number"
                    min={0}
                    max={32}
                    value={v.prefixLength}
                    onChange={(e) => patchVlan(i, { prefixLength: Number(e.target.value) })}
                  />
                </label>
                <label className="endpoint-field" style={{ flex: '1 1 150px' }}>
                  Gateway
                  <input
                    value={v.gateway ?? ''}
                    onChange={(e) => patchVlan(i, { gateway: e.target.value })}
                    placeholder="(optional)"
                  />
                </label>
                <label className="endpoint-field" style={{ flex: '1 1 170px' }}>
                  DNS (comma-sep)
                  <input
                    value={(v.dnsServers ?? []).join(', ')}
                    onChange={(e) =>
                      patchVlan(i, {
                        dnsServers: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                      })
                    }
                    placeholder="(optional)"
                  />
                </label>
              </div>
            )}
          </div>
        ))}

        <div className="signal-add" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-small" onClick={addBlank}>
            + Add VLAN
          </button>
          <select
            value={addSubnetId}
            onChange={(e) => setAddSubnetId(e.target.value)}
            style={{ maxWidth: 280 }}
          >
            <option value="">Add from a subnet…</option>
            {subnets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.vlan ? `VLAN ${s.vlan} — ${s.name}` : s.name}
                {s.cidr ? ` (${s.cidr})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-small"
            onClick={addFromSubnet}
            disabled={!addSubnetId}
          >
            Add
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default ConfigModal
