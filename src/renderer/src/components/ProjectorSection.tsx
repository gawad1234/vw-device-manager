import { useState } from 'react'
import type { Device, ProjectorConfig } from '../../../shared/types'
import {
  MMCS_MAX_COMMANDS,
  PROJECTOR_GROUPS,
  PROJECTOR_MODELS,
  PROJECTOR_SETTINGS,
  projectorCommands,
  type ProjectorSetting
} from '../../../shared/projector-settings'

interface Props {
  device: Device
  onChanged: () => void
}

/** Starting value when a setting is ticked: first option, or the minimum. */
function defaultValue(s: ProjectorSetting, deviceName: string): string {
  if (s.kind === 'choice') return s.options?.[0]?.cmd ?? ''
  if (s.kind === 'number') return String(s.min ?? 0)
  if (s.key === 'projectorName') return deviceName
  return ''
}

/** Panasonic RZ/RQ projector setup: tick the settings to change, pick values,
 *  then save a command list CSV for Multi Monitoring & Control. The same
 *  choices print on the "Projector setup sheet" export. */
function ProjectorSection({ device, onChanged }: Props): React.JSX.Element {
  const [config, setConfig] = useState<ProjectorConfig | null>(device.projector)
  const [note, setNote] = useState<string | null>(null)

  async function persist(next: ProjectorConfig | null): Promise<void> {
    setConfig(next)
    await window.api.devices.setProjector(device.id, next)
    onChanged()
  }
  function setValue(key: string, v: string | null, save = true): void {
    if (!config) return
    const values = { ...config.values }
    if (v === null) delete values[key]
    else values[key] = v
    const next = { ...config, values }
    if (save) persist(next)
    else setConfig(next) // typing: save on blur
  }

  async function saveCommands(): Promise<void> {
    setNote(null)
    const path = await window.api.projector.saveCommands(device.id)
    if (path) setNote(`Saved ${path}`)
  }

  if (!config) {
    return (
      <label className="chk">
        <input
          type="checkbox"
          checked={false}
          onChange={() => persist({ model: PROJECTOR_MODELS[0], values: {} })}
        />
        This is a Panasonic PT-RZ / PT-RQ projector
      </label>
    )
  }

  const commandCount = projectorCommands(config).length

  return (
    <div className="projector-section">
      <label className="chk">
        <input
          type="checkbox"
          checked
          onChange={() => {
            if (window.confirm('Remove this device’s projector settings?')) persist(null)
          }}
        />
        This is a Panasonic PT-RZ / PT-RQ projector
      </label>
      <label>
        Model{' '}
        <select
          value={config.model}
          onChange={(e) => persist({ ...config, model: e.target.value })}
        >
          {PROJECTOR_MODELS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <p className="muted">
        Tick the settings you want changed. Commands come from Panasonic’s PT-RQ32K / RQ22K /
        RQ13K-family command list — not every option exists on every model. ✋ = set at the
        projector (no command exists).
      </p>

      {PROJECTOR_GROUPS.map((group) => (
        <table className="table" key={group}>
          <thead>
            <tr>
              <th colSpan={3}>{group}</th>
            </tr>
          </thead>
          <tbody>
            {PROJECTOR_SETTINGS.filter((s) => s.group === group).map((s) => {
              const on = s.key in config.values
              const v = config.values[s.key] ?? ''
              return (
                <tr key={s.key}>
                  <td style={{ width: '45%' }}>
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setValue(s.key, e.target.checked ? defaultValue(s, device.name) : null)
                        }
                      />
                      {s.kind === 'manual' && '✋ '}
                      {s.label}
                    </label>
                  </td>
                  <td>
                    {on && s.kind === 'choice' && (
                      <select value={v} onChange={(e) => setValue(s.key, e.target.value)}>
                        {s.options?.map((o) => (
                          <option key={o.cmd} value={o.cmd}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {on && s.kind === 'number' && (
                      <input
                        type="number"
                        min={s.min}
                        max={s.max}
                        value={v}
                        onChange={(e) => setValue(s.key, e.target.value, false)}
                        onBlur={() => persist(config)}
                      />
                    )}
                    {on && (s.kind === 'text' || s.kind === 'manual') && (
                      <input
                        value={v}
                        onChange={(e) => setValue(s.key, e.target.value, false)}
                        onBlur={() => persist(config)}
                      />
                    )}
                    {on && s.unit && <span className="muted"> {s.unit}</span>}
                  </td>
                  <td className="muted">{s.note}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ))}

      <div className="signal-add" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-small btn-primary"
          onClick={saveCommands}
          disabled={commandCount === 0 || commandCount > MMCS_MAX_COMMANDS}
        >
          Save command list ({commandCount})…
        </button>
        <span className="muted">
          {commandCount > MMCS_MAX_COMMANDS
            ? `Multi Monitoring & Control reads at most ${MMCS_MAX_COMMANDS} commands — untick some.`
            : 'Load it in Panasonic Multi Monitoring & Control → Create command list → Read file.'}
        </span>
      </div>
      {note && (
        <p className="muted" style={{ marginTop: 8 }}>
          {note}
        </p>
      )}
    </div>
  )
}

export default ProjectorSection
