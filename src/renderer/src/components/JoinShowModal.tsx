import { useEffect, useState } from 'react'
import Modal from './Modal'
import type { DiscoveredShow, ProjectInfo } from '../../../shared/types'

interface Props {
  onClose: () => void
  onJoined: (info: ProjectInfo) => void
}

/** Join a show that another computer has open, through its Show Server. */
function JoinShowModal({ onClose, onJoined }: Props): React.JSX.Element {
  const [address, setAddress] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<DiscoveredShow[]>([])

  // list the shows announcing themselves on the LAN while this dialog is open
  useEffect(() => {
    let live = true
    const look = (): void => {
      window.api.projects
        .discover()
        .then((list) => live && setFound(list))
        .catch(() => {})
    }
    look()
    const t = setInterval(look, 1500)
    return () => {
      live = false
      clearInterval(t)
      void window.api.projects.stopDiscover()
    }
  }, [])

  function pick(show: DiscoveredShow): void {
    setAddress(show.address)
    document.getElementById('join-pin')?.focus()
  }

  async function join(e?: React.FormEvent): Promise<void> {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    const res = await window.api.projects.join(address, pin)
    setBusy(false)
    if ('error' in res) setError(res.error)
    else onJoined(res)
  }

  return (
    <Modal
      title="Join a show on the network"
      onClose={onClose}
      footer={
        <>
          <span className="footer-spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !address.trim()}
            onClick={() => join()}
          >
            {busy ? 'Joining…' : 'Join'}
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={join}>
        <p className="muted" style={{ gridColumn: 'span 2', margin: 0 }}>
          Shows with their Show Server on appear below — pick one and enter its Manager PIN (on the
          host under Settings → Show Server). Not listed? Type the address shown there. For now a
          joined computer can view everything but not change it.
        </p>
        {error && <div className="banner banner-error">{error}</div>}
        <div style={{ gridColumn: 'span 2' }}>
          <strong>On this network</strong>
          {found.length === 0 ? (
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Looking for shows…
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              {found.map((f) => (
                <button
                  key={f.address}
                  type="button"
                  className={`btn${f.address === address ? ' btn-primary' : ''}`}
                  style={{ justifyContent: 'space-between', display: 'flex' }}
                  onClick={() => pick(f)}
                >
                  <span>{f.showName}</span>
                  <span className="muted mono">
                    {f.hostName} · {f.address}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <label>
          Host address
          <input
            id="join-address"
            className="mono"
            value={address}
            placeholder="192.168.1.20:8787"
            autoFocus
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label>
          Manager PIN
          <input
            id="join-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export default JoinShowModal
