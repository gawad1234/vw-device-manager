import { useMemo, useRef, useState } from 'react'
import type { Device, DeviceInput, Port, Subnet } from '../../../shared/types'

// Spreadsheet view of every IP on the show: one row per port (switches add a
// Mgmt and an OOB row). IP and VLAN cells edit in place and save on leaving the
// cell, through the same checks as the device window.

type Row =
  | { key: string; kind: 'port'; device: Device; port: Port }
  | { key: string; kind: 'mgmt' | 'oob'; device: Device }

type Col = 'ip' | 'vlan'
const COLS: Col[] = ['ip', 'vlan']

interface Status {
  level: 'error' | 'warning'
  message: string
}

type Drafts = Record<string, { text: string; base: string }>

interface Props {
  /** already filtered + ordered by the Devices page, with their category */
  groups: (readonly [string, Device[]])[]
  subnets: Subnet[]
  onChanged: () => void
  onOpenDevice: (id: number) => void
}

const subnetLabel = (s: Subnet): string => (s.vlan ? `${s.vlan} · ${s.name}` : s.name)

function deviceInput(d: Device, patch: Partial<DeviceInput>): DeviceInput {
  return {
    name: d.name,
    deviceType: d.deviceType,
    macAddress: d.macAddress,
    location: d.location,
    notes: d.notes,
    category: d.category,
    isSwitch: d.isSwitch,
    managementIp: d.managementIp,
    oobIp: d.oobIp,
    ...patch
  }
}

/** A pasted VLAN: its number, name, or "number · name" as this sheet shows it. */
function matchSubnet(text: string, subnets: Subnet[]): number | null | undefined {
  const t = text.trim().toLowerCase()
  if (!t || t === '—' || t === 'none') return null
  const s = subnets.find(
    (x) =>
      subnetLabel(x).toLowerCase() === t ||
      x.name.toLowerCase() === t ||
      (x.vlan != null && String(x.vlan) === t)
  )
  return s ? s.id : undefined
}

function IpSheet({ groups, subnets, onChanged, onOpenDevice }: Props): React.JSX.Element {
  const [showUnused, setShowUnused] = useState(false)
  // typed values (cellKey → text + the saved value they were typed over). A draft
  // shows only while the saved value is unchanged, so a reload retires it.
  const [draft, setDraftState] = useState<Drafts>({})
  // saves read the latest drafts from here: a paste saves many rows in one tick,
  // before React re-renders (a switch's Mgmt + OOB go in one update)
  const latest = useRef<Drafts>({})
  const setDraft = (fn: (d: Drafts) => Drafts): void => {
    latest.current = fn(latest.current)
    setDraftState(latest.current)
  }
  const [status, setStatus] = useState<Record<string, Status>>({})
  const tableRef = useRef<HTMLTableElement>(null)

  const rows = useMemo(() => {
    const out: (Row & { category: string })[] = []
    for (const [category, list] of groups) {
      for (const d of list) {
        if (d.isSwitch) {
          out.push({ key: `m${d.id}`, kind: 'mgmt', device: d, category })
          out.push({ key: `o${d.id}`, kind: 'oob', device: d, category })
        }
        for (const p of d.ports) {
          if (p.isUnused && !showUnused) continue
          out.push({ key: `p${p.id}`, kind: 'port', device: d, port: p, category })
        }
      }
    }
    return out
  }, [groups, showUnused])

  const saved = (r: Row, c: Col): string => {
    if (r.kind !== 'port')
      return c === 'ip' ? ((r.kind === 'mgmt' ? r.device.managementIp : r.device.oobIp) ?? '') : ''
    if (c === 'ip') return r.port.ipAddress ?? ''
    return r.port.untaggedSubnetId != null ? String(r.port.untaggedSubnetId) : ''
  }
  const value = (r: Row, c: Col, from: Drafts = draft): string => {
    const d = from[`${r.key}:${c}`]
    const base = saved(r, c)
    return d && d.base === base ? d.text : base
  }
  const editable = (r: Row, c: Col): boolean =>
    r.kind === 'port' ? c === 'vlan' || !r.device.isSwitch : c === 'ip'

  /** Save one row with any of its cells replaced; returns once written. */
  async function saveRow(r: Row, patch: Partial<Record<Col, string>>): Promise<void> {
    const v = (c: Col): string => patch[c] ?? value(r, c, latest.current)
    let error: string | undefined
    let warnings: { message: string }[] = []
    if (r.kind === 'port') {
      const vlan = v('vlan')
      const res = await window.api.ports.update(r.port.id, {
        label: r.port.label,
        ipAddress: r.device.isSwitch ? null : v('ip').trim() || null,
        untaggedSubnetId: vlan ? Number(vlan) : null
      })
      error = res.error
      warnings = res.warnings
    } else {
      // both switch IPs go in one update, so take the other one's draft too
      const other = rows.find(
        (x) => x.device.id === r.device.id && x.kind === (r.kind === 'mgmt' ? 'oob' : 'mgmt')
      )
      const ip = v('ip').trim() || null
      const otherIp = other ? value(other, 'ip', latest.current).trim() || null : null
      const res = await window.api.devices.update(
        r.device.id,
        deviceInput(
          r.device,
          r.kind === 'mgmt'
            ? { managementIp: ip, oobIp: otherIp }
            : { oobIp: ip, managementIp: otherIp }
        )
      )
      error = res.error
      warnings = res.warnings
    }
    setStatus((s) => {
      const next = { ...s }
      if (error) next[r.key] = { level: 'error', message: error }
      else if (warnings.length)
        next[r.key] = { level: 'warning', message: warnings.map((w) => w.message).join(' ') }
      else delete next[r.key]
      return next
    })
  }

  function edit(r: Row, c: Col, text: string): void {
    setDraft((d) => ({ ...d, [`${r.key}:${c}`]: { text, base: saved(r, c) } }))
  }

  async function commit(r: Row, c: Col, text: string): Promise<void> {
    if (text === saved(r, c) && !status[r.key]) return
    await saveRow(r, { [c]: text })
    onChanged()
  }

  function focusCell(ri: number, ci: number): void {
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${ri}:${ci}"]`)
    if (el) {
      el.focus()
      if (el instanceof HTMLInputElement) el.select()
    }
  }

  /** Next row (in `dir`) whose cell in this column can be edited. */
  function step(ri: number, ci: number, dir: 1 | -1): void {
    for (let i = ri + dir; i >= 0 && i < rows.length; i += dir)
      if (editable(rows[i], COLS[ci])) return focusCell(i, ci)
  }

  function onKey(e: React.KeyboardEvent, ri: number, ci: number): void {
    const isSelect = e.currentTarget instanceof HTMLSelectElement
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !isSelect)) {
      e.preventDefault()
      step(ri, ci, e.shiftKey ? -1 : 1)
    } else if (e.key === 'ArrowUp' && !isSelect) {
      e.preventDefault()
      step(ri, ci, -1)
    } else if (e.key === 'Escape') {
      const r = rows[ri]
      setDraft((d) => {
        const next = { ...d }
        delete next[`${r.key}:${COLS[ci]}`]
        return next
      })
    }
  }

  /** Paste a block from Excel: lines fill down from this cell, tabs fill across. */
  async function onPaste(e: React.ClipboardEvent, ri: number, ci: number): Promise<void> {
    const text = e.clipboardData.getData('text/plain').replace(/\r/g, '').replace(/\n$/, '')
    if (!text.includes('\n') && !text.includes('\t')) return // one value: normal paste
    e.preventDefault()
    const lines = text.split('\n')
    const skipped: string[] = []
    let i = ri
    const jobs: Promise<void>[] = []
    for (const line of lines) {
      while (i < rows.length && !editable(rows[i], COLS[ci])) i++
      if (i >= rows.length) break
      const r = rows[i]
      const patch: Partial<Record<Col, string>> = {}
      line.split('\t').forEach((cellText, k) => {
        const c = COLS[ci + k]
        if (!c || !editable(r, c)) return
        if (c === 'vlan') {
          const id = matchSubnet(cellText, subnets)
          if (id === undefined) skipped.push(cellText.trim())
          else patch.vlan = id == null ? '' : String(id)
        } else patch.ip = cellText.trim()
      })
      for (const c of COLS) if (patch[c] !== undefined) edit(r, c, patch[c] as string)
      jobs.push(saveRow(r, patch))
      i++
    }
    await Promise.all(jobs)
    if (skipped.length) window.alert(`No VLAN matches: ${[...new Set(skipped)].join(', ')}`)
    onChanged()
  }

  async function togglePrimary(p: Port): Promise<void> {
    await window.api.ports.setPrimary(p.id, !p.isPrimary)
    onChanged()
  }

  const problems = Object.values(status)
  let lastDevice = -1

  return (
    <>
      <div className="ipsheet-bar muted">
        <span>
          Click a cell and type. Enter or ↑↓ moves, Esc undoes, and pasting a column from Excel
          fills down.
        </span>
        <label className="chk">
          <input
            type="checkbox"
            checked={showUnused}
            onChange={(e) => setShowUnused(e.target.checked)}
          />
          Show unused jacks
        </label>
        {problems.length > 0 && <span className="ipsheet-count">{problems.length} to check</span>}
      </div>
      <table className="table ipsheet" ref={tableRef}>
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '6%' }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Device</th>
            <th>Category</th>
            <th>Port</th>
            <th>IP address</th>
            <th>VLAN (untagged)</th>
            <th>Main</th>
            <th>Check</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-cell">
                No ports to show.
              </td>
            </tr>
          )}
          {rows.map((r, ri) => {
            const first = r.device.id !== lastDevice
            lastDevice = r.device.id
            const st = status[r.key]
            const portLabel = r.kind === 'port' ? r.port.label : r.kind === 'mgmt' ? 'Mgmt' : 'OOB'
            const unused = r.kind === 'port' && r.port.isUnused
            return (
              <tr
                key={r.key}
                className={`${first ? 'ipsheet-first' : ''}${unused ? ' port-unused' : ''}${st ? ` ipsheet-${st.level}` : ''}`}
              >
                <td>
                  {first && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => onOpenDevice(r.device.id)}
                    >
                      {r.device.name}
                    </button>
                  )}
                  {first && r.device.isSwitch && <span className="badge">switch</span>}
                </td>
                <td className="muted">{first ? r.category : ''}</td>
                <td className={r.kind === 'port' ? '' : 'muted'}>{portLabel}</td>
                <td className="ipsheet-cell">
                  {editable(r, 'ip') ? (
                    <input
                      data-cell={`${ri}:0`}
                      className="mono"
                      value={value(r, 'ip')}
                      placeholder="—"
                      spellCheck={false}
                      onChange={(e) => edit(r, 'ip', e.target.value)}
                      onBlur={(e) => commit(r, 'ip', e.target.value)}
                      onKeyDown={(e) => onKey(e, ri, 0)}
                      onPaste={(e) => onPaste(e, ri, 0)}
                    />
                  ) : (
                    <span className="muted">{r.kind === 'port' ? 'VLAN only' : ''}</span>
                  )}
                </td>
                <td className="ipsheet-cell">
                  {editable(r, 'vlan') && (
                    <select
                      data-cell={`${ri}:1`}
                      value={value(r, 'vlan')}
                      onChange={(e) => {
                        edit(r, 'vlan', e.target.value)
                        commit(r, 'vlan', e.target.value)
                      }}
                      onKeyDown={(e) => onKey(e, ri, 1)}
                      onPaste={(e) => onPaste(e, ri, 1)}
                    >
                      <option value="">—</option>
                      {subnets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {subnetLabel(s)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="center">
                  {r.kind === 'port' && !r.device.isSwitch && !r.port.isUnused && (
                    <button
                      type="button"
                      className={`star-btn${r.port.isPrimary ? ' is-on' : ''}`}
                      title="The device's main IP + VLAN (used in the Device list)"
                      onClick={() => togglePrimary(r.port)}
                    >
                      {r.port.isPrimary ? '★' : '☆'}
                    </button>
                  )}
                </td>
                <td className="ipsheet-msg">{st?.message ?? ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

export default IpSheet
