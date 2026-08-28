import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'

/**
 * Settings → Updates. Shows the running version, a manual "Check for updates"
 * button with a real result, patch notes when a newer version exists, and an
 * automatic-vs-manual preference. Live status is pushed from the main process
 * (onUpdateStatus) and also returned by check().
 */
function UpdatesPanel(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [autoCheck, setAutoCheck] = useState(true)

  useEffect(() => {
    window.api.updates.getState().then(setStatus)
    window.api.updates.getAutoCheck().then(setAutoCheck)
    return window.api.onUpdateStatus(setStatus)
  }, [])

  const phase = status?.phase ?? 'idle'
  const version = status?.currentVersion ?? ''
  const info = status?.info ?? null
  const busy = phase === 'checking' || phase === 'downloading'

  async function check(): Promise<void> {
    setStatus(await window.api.updates.check())
  }

  async function toggleAuto(value: boolean): Promise<void> {
    setAutoCheck(await window.api.updates.setAutoCheck(value))
  }

  function statusLine(): React.JSX.Element | null {
    switch (phase) {
      case 'checking':
        return <span className="muted">Checking for updates…</span>
      case 'not-available':
        return <span className="update-ok">✓ You’re on the latest version.</span>
      case 'downloading':
        return <span className="muted">Downloading… {status?.percent ?? 0}%</span>
      case 'error':
        return null // shown as a banner below
      case 'available':
      case 'downloaded':
        return null // shown in the highlighted block below
      default:
        return <span className="muted">Check to see if a newer version is available.</span>
    }
  }

  return (
    <div className="panel">
      <h3>Updates</h3>
      <p className="muted">
        Device Manager is version <code>{version}</code>. Updates are published on GitHub.
      </p>

      <div className="update-controls">
        <button className="btn btn-primary" onClick={check} disabled={busy}>
          {phase === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
        {statusLine()}
      </div>

      {phase === 'error' && status?.error && (
        <div className="banner banner-error">{status.error}</div>
      )}

      {(phase === 'available' || phase === 'downloaded') && info && (
        <div className="update-available">
          <div className="update-available-head">
            <div>
              <strong>Version {info.version} is available</strong>
              {info.releaseDate && (
                <span className="muted"> — {new Date(info.releaseDate).toLocaleDateString()}</span>
              )}
            </div>
            {phase === 'downloaded' ? (
              <button className="btn btn-primary" onClick={() => window.api.updates.install()}>
                Restart &amp; install
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => window.api.updates.download()}>
                {status?.canSelfInstall ? 'Download update' : 'Get the update'}
              </button>
            )}
          </div>

          {!status?.canSelfInstall && phase === 'available' && (
            <p className="muted update-mac-note">
              Opens the download page — grab the new <code>.dmg</code>, then drag it over the old
              app. (Automatic install needs Apple code-signing, which this free build skips.)
            </p>
          )}

          {info.releaseNotes ? (
            <div
              className="patch-notes"
              // Patch notes are this repo's own GitHub release body (sanitized HTML).
              dangerouslySetInnerHTML={{ __html: info.releaseNotes }}
            />
          ) : (
            <p className="muted">No release notes were provided for this version.</p>
          )}
        </div>
      )}

      <label className="toggle-field">
        <input
          type="checkbox"
          checked={autoCheck}
          onChange={(e) => toggleAuto(e.target.checked)}
        />
        <span>
          Automatically check for updates on launch
          <small className="muted">
            {' '}
            — when off, updates are only checked when you press the button above.
          </small>
        </span>
      </label>
    </div>
  )
}

export default UpdatesPanel
