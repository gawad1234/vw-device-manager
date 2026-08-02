import { useEffect, useState } from 'react'

function SettingsPage(): React.JSX.Element {
  const [signals, setSignals] = useState<string[]>([])
  const [input, setInput] = useState('')

  useEffect(() => {
    window.api.networkSignals.list().then(setSignals)
  }, [])

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!input.trim()) return
    setSignals(await window.api.networkSignals.add(input))
    setInput('')
  }

  async function remove(signal: string): Promise<void> {
    setSignals(await window.api.networkSignals.remove(signal))
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

        <form onSubmit={add} className="signal-add">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
              <button className="btn btn-small btn-danger" onClick={() => remove(s)}>
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
