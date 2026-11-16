import { useEffect, useRef, useState } from 'react'
import type { ProjectInfo } from '../../../shared/types'
import JoinShowModal from './JoinShowModal'
import Icon from './Icon'

interface Props {
  current: ProjectInfo | null
  onSwitched: (info: ProjectInfo) => void
  /** icon-only button (collapsed sidebar); the name moves to the tooltip */
  compact?: boolean
}

/** Sidebar footer control: shows the active project and switches it (New/Open/Recent).
 *  The menu opens upward, since it sits at the bottom of the window.
 *  There's no "Save" — the database auto-persists on every change. */
function ProjectMenu({ current, onSwitched, compact }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<ProjectInfo[]>([])
  const [joining, setJoining] = useState(false)
  const remote = current?.remote
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) window.api.projects.recent().then(setRecent)
  }, [open])

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // A null result means the user cancelled the dialog — leave the project as-is.
  async function run(fn: () => Promise<ProjectInfo | null>): Promise<void> {
    const info = await fn()
    setOpen(false)
    if (info) onSwitched(info)
  }

  const others = recent.filter((r) => r.path !== current?.path)

  return (
    <div className="project-menu" ref={ref}>
      <button
        className="project-btn"
        onClick={() => setOpen((v) => !v)}
        title={
          compact
            ? `${current?.name ?? 'No project'}${remote ? ` · on ${remote.host}` : ''}`
            : current?.path
        }
        aria-label={compact ? `Project: ${current?.name ?? 'No project'}` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="project-icon">
          <Icon name="project" />
        </span>
        {!compact && (
          <>
            <span className="project-name">
              {current?.name ?? 'No project'}
              {remote && <span className="muted"> · on {remote.host}</span>}
            </span>
            <span className="caret" aria-hidden="true">
              ▴
            </span>
          </>
        )}
      </button>
      {open && remote && (
        <div className="project-dropdown drop-up">
          <button className="menu-item" onClick={() => run(() => window.api.projects.leave())}>
            Leave shared show
          </button>
        </div>
      )}
      {open && !remote && (
        <div className="project-dropdown drop-up">
          <button className="menu-item" onClick={() => run(() => window.api.projects.new())}>
            New Project…
          </button>
          <button className="menu-item" onClick={() => run(() => window.api.projects.open())}>
            Open Project…
          </button>
          <button className="menu-item" onClick={() => run(() => window.api.projects.saveCopyAs())}>
            Save a Copy As…
          </button>
          <button
            className="menu-item"
            onClick={async () => {
              await window.api.projects.reveal()
              setOpen(false)
            }}
          >
            Reveal in Finder
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false)
              setJoining(true)
            }}
          >
            Join a show on the network…
          </button>
          {others.length > 0 && (
            <>
              <div className="menu-sep" />
              <div className="menu-label">Recent</div>
              {others.map((r) => (
                <button
                  key={r.path}
                  className="menu-item menu-recent"
                  title={r.path}
                  onClick={() => run(() => window.api.projects.openRecent(r.path))}
                >
                  {r.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {joining && (
        <JoinShowModal
          onClose={() => setJoining(false)}
          onJoined={(info) => {
            setJoining(false)
            onSwitched(info)
          }}
        />
      )}
    </div>
  )
}

export default ProjectMenu
