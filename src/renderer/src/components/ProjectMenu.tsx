import { useEffect, useRef, useState } from 'react'
import type { ProjectInfo } from '../../../shared/types'

interface Props {
  current: ProjectInfo | null
  onSwitched: (info: ProjectInfo) => void
}

/** Header control: shows the active project and switches it (New/Open/Recent).
 *  There's no "Save" — the database auto-persists on every change. */
function ProjectMenu({ current, onSwitched }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<ProjectInfo[]>([])
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
      <button className="project-btn" onClick={() => setOpen((v) => !v)} title={current?.path}>
        <span className="project-icon">🗂</span>
        <span className="project-name">{current?.name ?? 'No project'}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="project-dropdown">
          <button className="menu-item" onClick={() => run(() => window.api.projects.new())}>
            New Project…
          </button>
          <button className="menu-item" onClick={() => run(() => window.api.projects.open())}>
            Open Project…
          </button>
          <button
            className="menu-item"
            onClick={() => run(() => window.api.projects.saveCopyAs())}
          >
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
    </div>
  )
}

export default ProjectMenu
