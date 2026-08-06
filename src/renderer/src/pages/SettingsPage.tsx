import { useEffect, useState } from 'react'
import type { CableType } from '../../../shared/types'

interface Props {
  cableTypes: CableType[]
  onChanged: () => void
}

function SettingsPage({ cableTypes, onChanged }: Props): React.JSX.Element {
  const [signals, setSignals] = useState<string[]>([])
  const [signalInput, setSignalInput] = useState('')
  const [typeName, setTypeName] = useState('')
  const [typeNotes, setTypeNotes] = useState('')
  const [typeError, setTypeError] = useState<string | null>(null)

  useEffect(() => {
    window.api.networkSignals.list().then(setSignals)
  }, [])

  async function addSignal(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!signalInput.trim()) return
    setSignals(await window.api.networkSignals.add(signalInput))
    setSignalInput('')
  }

  async function removeSignal(signal: string): Promise<void> {
    setSignals(await window.api.networkSignals.remove(signal))
  }

  async function addCableType(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!typeName.trim()) return
    try {
      await window.api.cableTypes.add({ name: typeName.trim(), notes: typeNotes.trim() || null })
      setTypeName('')
      setTypeNotes('')
      setTypeError(null)
      onChanged()
    } catch {
      setTypeError(`A cable type named "${typeName.trim()}" already exists.`)
    }
  }

  async function removeCableType(t: CableType): Promise<void> {
    if (!window.confirm(`Remove cable type "${t.name}"? Cables already tagged with it keep the label.`))
      return
    await window.api.cableTypes.remove(t.name)
    onChanged()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <div className="panel">
        <h3>Network signal types</h3>
        <p className="muted">
          When linking, a ConnectCAD jack becomes a port if its <em>signal</em> matches one of
          these. Copper (RJ45), SFP/SFP+, and QSFP jacks usually all report as “LAN”, so the
          physical form factor doesn’t matter — match on the signal. Add any other signals your
          devices use (e.g. Dante, AES67). Matching is case-insensitive.
        </p>

        <form onSubmit={addSignal} className="signal-add">
          <input
            value={signalInput}
            onChange={(e) => setSignalInput(e.target.value)}
            placeholder="e.g. LAN, Dante, AES67"
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>

        <ul className="signal-list">
          {signals.length === 0 && (
            <li className="muted">None — no jacks will be discovered as ports.</li>
          )}
          {signals.map((s) => (
            <li key={s}>
              <code>{s}</code>
              <button className="btn btn-small btn-danger" onClick={() => removeSignal(s)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h3>Cable types</h3>
        <p className="muted">
          The catalog of cable types you can assign to cables in the Cables tab (e.g. Cat6,
          Fiber SM, XLR, Coax). Names are case-insensitive and must be unique.
        </p>

        <form onSubmit={addCableType} className="signal-add">
          <input
            value={typeName}
            onChange={(e) => setTypeName(e.target.value)}
            placeholder="e.g. Cat6"
          />
          <input
            value={typeNotes}
            onChange={(e) => setTypeNotes(e.target.value)}
            placeholder="Notes (optional)"
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>
        {typeError && <div className="banner banner-error">{typeError}</div>}

        <ul className="signal-list">
          {cableTypes.length === 0 && <li className="muted">No cable types yet.</li>}
          {cableTypes.map((t) => (
            <li key={t.name}>
              <span>
                <code>{t.name}</code>
                {t.notes && <span className="muted"> — {t.notes}</span>}
              </span>
              <button className="btn btn-small btn-danger" onClick={() => removeCableType(t)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default SettingsPage
