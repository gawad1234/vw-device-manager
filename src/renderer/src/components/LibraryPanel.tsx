import { useEffect, useState } from 'react'
import type { LibraryLocation } from '../../../shared/types'

/** Choose where this computer keeps the library, so several computers can share it. */
function LibraryPanel(): React.JSX.Element {
  const [location, setLocation] = useState<LibraryLocation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.library.location().then(setLocation)
  }, [])

  async function change(action: () => Promise<LibraryLocation | null>): Promise<void> {
    setError(null)
    try {
      // Everything on screen came from the old library, so reload the lot.
      if (await action()) window.location.reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="panel">
      <h3>Shared library</h3>
      <p className="muted">
        Crew, kits, cable types, templates and other lists used across all shows. To use them on
        more than one computer, keep them in a folder that syncs, such as one in Dropbox, and
        choose that same folder on each computer.
      </p>
      {error && <div className="banner banner-error">{error}</div>}
      {location?.missing && (
        <div className="banner banner-warning">
          The shared folder wasn&rsquo;t found at launch, so this computer is using its own copy.
          Restart once the folder is back.
        </div>
      )}
      {location && (
        <p>
          {location.shared ? 'Shared from' : 'On this computer only'}: <code>{location.path}</code>
        </p>
      )}
      <div className="form-actions">
        <button className="btn" onClick={() => change(window.api.library.chooseFolder)}>
          Choose shared folder…
        </button>
        {location?.shared && (
          <button className="btn" onClick={() => change(window.api.library.useLocal)}>
            Keep a copy on this computer only
          </button>
        )}
      </div>
    </div>
  )
}

export default LibraryPanel
