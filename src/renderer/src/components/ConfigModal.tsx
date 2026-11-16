import { useEffect, useRef, useState } from 'react'
import type { HostConfig, HostConfigInput, Subnet, VlanEntry } from '../../../shared/types'
import { isValidIpv4 } from '../../../shared/ip-utils'
import Modal, { ModalDismiss, type ModalControl } from './Modal'
import Field from './Field'

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

type VlanErrors = Partial<
  Record<'vlanId' | 'ipAddress' | 'prefixLength' | 'gateway' | 'dns', string>
>

/** Per-row problems. `forScript` also needs an address on every non-DHCP VLAN
 *  (a saved draft may leave it blank; a generated script can't). */
function checkVlans(vlans: VlanEntry[], forScript: boolean): VlanErrors[] {
  return vlans.map((v, i) => {
    const e: VlanErrors = {}
    const label = v.name.trim() || `VLAN ${v.vlanId}`
    if (!Number.isInteger(v.vlanId) || v.vlanId < 1 || v.vlanId > 4094) {
      e.vlanId = 'VLAN IDs run 1–4094.'
    } else {
      const other = vlans.findIndex((o, j) => j !== i && o.vlanId === v.vlanId)
      if (other !== -1 && other < i)
        e.vlanId = `VLAN ${v.vlanId} is already used by "${vlans[other].name.trim() || `row ${other + 1}`}". Pick another ID.`
    }
    if (v.dhcp) return e
    const ip = (v.ipAddress ?? '').trim()
    if (ip && !isValidIpv4(ip))
      e.ipAddress = `"${ip}" isn’t an IPv4 address. Use the form 10.134.10.61.`
    else if (!ip && forScript) e.ipAddress = `Give ${label} an IP address, or tick DHCP.`
    if (!Number.isInteger(v.prefixLength) || v.prefixLength < 0 || v.prefixLength > 32)
      e.prefixLength = 'Prefix runs 0–32 (24 = 255.255.255.0).'
    const gw = (v.gateway ?? '').trim()
    if (gw && !isValidIpv4(gw))
      e.gateway = `"${gw}" isn’t an IPv4 address. Fix it or leave it empty.`
    const badDns = (v.dnsServers ?? []).find((d) => !isValidIpv4(d))
    if (badDns) e.dns = `"${badDns}" isn’t an IPv4 address. List servers like 10.0.0.1, 1.1.1.1.`
    return e
  })
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
  /** not about one field (save failed, no VLANs to export) */
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  /** after a save/script attempt, VLAN problems show live until fixed */
  const [check, setCheck] = useState<null | 'save' | 'script'>(null)
  const [addSubnetId, setAddSubnetId] = useState('')
  const modal = useRef<ModalControl>(null)
  const vlanErrors = check ? checkVlans(vlans, check === 'script') : []

  useEffect(() => {
    setName(config?.name ?? '')
    setSwitchName(config?.switchName ?? 'VLAN-Trunk')
    setVlans(config?.vlans ?? [])
    setError(null)
    setNameError(null)
    setCheck(null)
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
    modal.current?.markDirty()
  }
  function addBlank(): void {
    setVlans((prev) => [...prev, { ...BLANK }])
    modal.current?.markDirty()
  }
  function addFromSubnet(): void {
    const s = subnets.find((x) => x.id === Number(addSubnetId))
    if (s) {
      setVlans((prev) => [...prev, entryFromSubnet(s)])
      modal.current?.markDirty()
    }
    setAddSubnetId('')
  }

  function currentInput(): HostConfigInput {
    return { name: name.trim(), switchName: switchName.trim() || 'VLAN-Trunk', vlans }
  }

  /** Validate, then save. `forScript` = the save is for Generate / Export. */
  async function persist(forScript = false): Promise<HostConfig | null> {
    setError(null)
    setCheck(forScript ? 'script' : 'save')
    let ok = true
    if (!name.trim()) {
      setNameError('Give the config a name, e.g. MGR61 — it becomes the script filename.')
      ok = false
    } else setNameError(null)
    if (forScript && vlans.length === 0) {
      setError('Add at least one VLAN before generating or exporting.')
      ok = false
    }
    if (checkVlans(vlans, forScript).some((e) => Object.keys(e).length > 0)) ok = false
    if (!ok) return null
    try {
      const saved = config
        ? await window.api.configs.update(config.id, currentInput())
        : await window.api.configs.create(currentInput())
      modal.current?.markClean()
      return saved
    } catch (err) {
      setError(`Couldn’t save the config: ${(err as Error).message}`)
      return null
    }
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
    const saved = await persist(true)
    if (!saved) return
    onChanged()
    if (!config) onCreated(saved.id)
    try {
      await window.api.configs.generate(saved.id)
    } catch (err) {
      setError(`Saved, but the script couldn’t be written: ${(err as Error).message}`)
    }
  }

  async function exportJson(): Promise<void> {
    const saved = await persist(true)
    if (!saved) return
    onChanged()
    if (!config) onCreated(saved.id)
    try {
      await window.api.configs.exportJson(saved.id)
    } catch (err) {
      setError(`Saved, but the JSON couldn’t be written: ${(err as Error).message}`)
    }
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
        <button type="button" className="btn btn-danger" onClick={handleDelete}>
          Delete…
        </button>
      )}
      <span className="footer-spacer" />
      <button
        className="btn"
        type="button"
        onClick={exportJson}
        title="Save, then export the VLAN list as JSON for the host VLAN Manager tool"
      >
        Export JSON…
      </button>
      <button
        className="btn"
        type="button"
        onClick={generate}
        title="Save, then write the PowerShell script"
      >
        Generate script…
      </button>
      <ModalDismiss />
      <button className="btn btn-primary" type="submit" form="config-form">
        {config ? 'Save config' : 'Create config'}
      </button>
    </>
  )

  return (
    <Modal
      title={config ? config.name : 'New config'}
      onClose={onClose}
      footer={footer}
      controlRef={modal}
    >
      <form id="config-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error span-2">{error}</div>}
        <Field label="Config name" hint="Used as the script filename." error={nameError}>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError(null)
            }}
            placeholder="e.g. MGR61"
            autoFocus
          />
        </Field>
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

        {vlans.map((v, i) => {
          const err = vlanErrors[i] ?? {}
          return (
            <div className="port-row" key={i}>
              <div className="port-grid port-grid-vlan">
                <Field label="Name">
                  <input
                    value={v.name}
                    onChange={(e) => patchVlan(i, { name: e.target.value })}
                    placeholder="VLAN 10 - Device Net"
                  />
                </Field>
                <Field label="VLAN ID" error={err.vlanId}>
                  <input
                    type="number"
                    className="mono"
                    min={1}
                    max={4094}
                    value={v.vlanId}
                    onChange={(e) => patchVlan(i, { vlanId: Number(e.target.value) })}
                  />
                </Field>
                <label className="port-check">
                  <input type="checkbox" checked={!v.tagged} onChange={() => toggleNative(i)} />
                  Native
                </label>
                <label className="port-check">
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
                    aria-label={`Remove ${v.name.trim() || `VLAN ${v.vlanId}`}`}
                    onClick={() => removeVlan(i)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {!v.dhcp && (
                <div className="port-grid port-grid-vlan-ip">
                  <Field label="IP" error={err.ipAddress}>
                    <input
                      className="mono"
                      value={v.ipAddress ?? ''}
                      onChange={(e) => patchVlan(i, { ipAddress: e.target.value })}
                      placeholder="10.134.10.61"
                    />
                  </Field>
                  <Field label="Prefix" error={err.prefixLength}>
                    <input
                      type="number"
                      className="mono"
                      min={0}
                      max={32}
                      value={v.prefixLength}
                      onChange={(e) => patchVlan(i, { prefixLength: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Gateway" hint="Optional" error={err.gateway}>
                    <input
                      className="mono"
                      value={v.gateway ?? ''}
                      onChange={(e) => patchVlan(i, { gateway: e.target.value })}
                    />
                  </Field>
                  <Field label="DNS" hint="Optional; comma-separated" error={err.dns}>
                    <input
                      className="mono"
                      value={(v.dnsServers ?? []).join(', ')}
                      onChange={(e) =>
                        patchVlan(i, {
                          dnsServers: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)
                        })
                      }
                    />
                  </Field>
                </div>
              )}
            </div>
          )
        })}

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
