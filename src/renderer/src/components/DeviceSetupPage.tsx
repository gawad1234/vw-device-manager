import { useState } from 'react'
import type { Device } from '../../../shared/types'

interface Props {
  title: string
  intro: React.ReactNode
  devices: Device[]
  /** devices already set up appear in the list */
  isSetUp: (d: Device) => boolean
  /** short line under each listed device */
  summary: (d: Device) => string
  addLabel: string
  /** turn a not-yet-set-up device into a set-up one */
  onAdd: (d: Device) => Promise<void>
  /** editor for the selected device */
  editor: (d: Device) => React.ReactNode
  headerActions?: React.ReactNode
}

/** Two-pane page under Devices: set-up devices on the left (plus an "add"
 *  picker for the rest), the selected device's editor on the right. */
function DeviceSetupPage({
  title,
  intro,
  devices,
  isSetUp,
  summary,
  addLabel,
  onAdd,
  editor,
  headerActions
}: Props): React.JSX.Element {
  const [activeId, setActiveId] = useState<number | null>(null)
  const candidates = devices.filter((d) => !d.isSwitch)
  const listed = candidates.filter(isSetUp).sort((a, b) => a.name.localeCompare(b.name))
  const addable = candidates.filter((d) => !isSetUp(d)).sort((a, b) => a.name.localeCompare(b.name))
  const active = listed.find((d) => d.id === activeId) ?? listed[0]

  async function add(id: string): Promise<void> {
    const d = addable.find((x) => x.id === Number(id))
    if (!d) return
    await onAdd(d)
    setActiveId(d.id)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>{title}</h2>
        {headerActions && <div className="page-header-actions">{headerActions}</div>}
      </div>
      <p className="muted">{intro}</p>
      <div className="kit-layout">
        <div className="kit-list">
          {listed.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`kit-list-row${active?.id === d.id ? ' active' : ''}`}
              onClick={() => setActiveId(d.id)}
            >
              <span className="kit-trigger">{d.name}</span>
              <span className="muted kit-summary">{summary(d)}</span>
            </button>
          ))}
          <select value="" onChange={(e) => add(e.target.value)} disabled={!addable.length}>
            <option value="">{addLabel}</option>
            {addable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.category ? ` — ${d.category}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="kit-form">
          {active ? (
            // key: reset the editor's local state when switching devices
            <div key={active.id}>
              <h3 style={{ marginTop: 0 }}>{active.name}</h3>
              {editor(active)}
            </div>
          ) : (
            <p className="muted">Nothing set up yet — pick a device from the list.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default DeviceSetupPage
