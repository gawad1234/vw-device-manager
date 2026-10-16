import { useEffect, useRef, useState } from 'react'
import type { ServerStatus, ServerPins } from '../../../shared/types'

/**
 * Settings → Show Server. Turns the embedded LAN web server on/off, shows the
 * URL(s) crew connect to (+ a QR), sets the port and the crew/manager PINs.
 * Live status (running, client count) is pushed from main via onServerStatus.
 */
function ServerPanel(): React.JSX.Element {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [pins, setPins] = useState<ServerPins>({ crew: '', manager: '' })
  const [portDraft, setPortDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState<string>('')
  const portInit = useRef(false)

  useEffect(() => {
    window.api.server.getState().then((s) => {
      setStatus(s)
      if (!portInit.current) {
        setPortDraft(String(s.port))
        portInit.current = true
      }
    })
    window.api.server.getPins().then(setPins)
    return window.api.onServerStatus((s) => setStatus(s))
  }, [])

  const url = status?.urls?.[0] ?? ''

  // The connect QR is generated in the main process (where qrcode lives) and
  // returned as a data-URL, so the renderer never bundles the Node lib.
  useEffect(() => {
    let cancelled = false
    if (!url) {
      setQr('')
      return
    }
    window.api.server.connectQr().then((d) => {
      if (!cancelled) setQr(d ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [url])

  async function toggle(value: boolean): Promise<void> {
    setBusy(true)
    try {
      setStatus(await window.api.server.setEnabled(value))
    } finally {
      setBusy(false)
    }
  }

  async function applyPort(): Promise<void> {
    const p = Math.max(1, Math.min(65535, Number(portDraft) || 0))
    setPortDraft(String(p))
    setBusy(true)
    try {
      setStatus(await window.api.server.setPort(p))
    } finally {
      setBusy(false)
    }
  }

  async function savePins(): Promise<void> {
    await window.api.server.setPins(pins)
  }

  const running = status?.running ?? false

  return (
    <div className="panel">
      <h3>Show Server (beta)</h3>
      <p className="muted">
        Serve this show over the local WiFi so crew can check in received items and pull up
        paperwork, device configs, and case labels from their own phones. The first time it starts,
        your OS will ask to <strong>allow incoming connections</strong> — say yes (Private network).
      </p>

      <label className="toggle-field">
        <input type="checkbox" checked={running} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span>
          Run the Show Server on this computer
          <small className="muted"> — it serves whatever project is currently open.</small>
        </span>
      </label>

      {status?.error && <div className="banner banner-error">{status.error}</div>}

      {running && (
        <div className="server-live">
          <div className="server-live-main">
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Crew connect to</div>
              {status!.urls.length ? (
                status!.urls.map((u) => (
                  <div key={u} className="server-url">
                    {u}
                  </div>
                ))
              ) : (
                <div className="server-url">No LAN address found — is WiFi connected?</div>
              )}
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                {status!.clientCount} signed in
              </div>
            </div>
            {qr && (
              <div className="server-qr">
                <img src={qr} alt="Connect QR" width={120} height={120} />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="server-row">
        <label>
          Port
          <input
            type="number"
            min={1}
            max={65535}
            value={portDraft}
            onChange={(e) => setPortDraft(e.target.value)}
          />
        </label>
        <button className="btn" type="button" onClick={applyPort} disabled={busy}>
          Apply port
        </button>
      </div>

      <div className="server-pins">
        <label>
          Crew PIN <small className="muted">(blank = anyone on the WiFi)</small>
          <input
            type="text"
            value={pins.crew}
            onChange={(e) => setPins({ ...pins, crew: e.target.value })}
            placeholder="e.g. 1234"
          />
        </label>
        <label>
          Manager PIN <small className="muted">(unlocks QR setup &amp; admin)</small>
          <input
            type="text"
            value={pins.manager}
            onChange={(e) => setPins({ ...pins, manager: e.target.value })}
            placeholder="e.g. 9999"
          />
        </label>
        <button className="btn" type="button" onClick={savePins}>
          Save PINs
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        PINs are saved with the show (the project file), so any computer that opens this project
        serves it with the same PINs.
      </p>
    </div>
  )
}

export default ServerPanel
