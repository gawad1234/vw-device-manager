import { useState } from 'react'
import Modal from './Modal'
import type { ProjectInfo } from '../../../shared/types'

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
          Open the show from the computer that has it (usually the Vectorworks machine). You get the
          address and Manager PIN on that computer under Settings → Show Server. For now a joined
          computer can view everything but not change it.
        </p>
        {error && <div className="banner banner-error">{error}</div>}
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
