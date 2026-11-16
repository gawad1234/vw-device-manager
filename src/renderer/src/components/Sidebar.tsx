import { useEffect, useState } from 'react'
import type { ProjectInfo, ServerStatus, UpdateStatus } from '../../../shared/types'
import ProjectMenu from './ProjectMenu'
import Icon from './Icon'

export type SideGroup = { key: string; label: string; items: [string, string][] }

interface Props {
  appName: string
  modes: [string, string][]
  mode: string
  onPickMode: (m: string) => void
  /** extra marks on a mode button (e.g. ▶ while timecode plays) */
  modeBadges: Record<string, { text: string; label: string } | undefined>
  groups: SideGroup[]
  tab: string
  onTab: (t: string) => void
  /** optional right-aligned counts, keyed by page id */
  counts: Record<string, number | undefined>
  collapsed: boolean
  onToggleCollapsed: () => void
  project: ProjectInfo | null
  onSwitched: (info: ProjectInfo) => void
}

// Short forms of the mode names for the 80px rail.
const SHORT: Record<string, string> = { prep: 'P', program: 'Pr', show: 'S' }

function Sidebar(p: Props): React.JSX.Element {
  const { collapsed } = p
  const [server, setServer] = useState<ServerStatus | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [starting, setStarting] = useState(false)

  // Same source as Settings → Show Server: state on mount, then pushed changes.
  useEffect(() => {
    window.api.server.getState().then(setServer)
    return window.api.onServerStatus(setServer)
  }, [])

  // Same source as Settings → Updates.
  useEffect(() => {
    window.api.updates.getState().then(setUpdate)
    return window.api.onUpdateStatus(setUpdate)
  }, [])

  async function startServer(): Promise<void> {
    setStarting(true)
    try {
      setServer(await window.api.server.setEnabled(true))
    } finally {
      setStarting(false)
    }
  }

  // Arrow keys move between modes, as in any tab list.
  function onModeKey(e: React.KeyboardEvent): void {
    if (
      e.key !== 'ArrowLeft' &&
      e.key !== 'ArrowRight' &&
      e.key !== 'ArrowUp' &&
      e.key !== 'ArrowDown'
    )
      return
    e.preventDefault()
    const i = p.modes.findIndex(([m]) => m === p.mode)
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
    const next = p.modes[(i + step + p.modes.length) % p.modes.length][0]
    p.onPickMode(next)
    const btn = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-mode="${next}"]`)
    btn?.focus()
  }

  const running = server?.running ?? false
  const serverLine = running
    ? `${server!.clientCount} signed in${server!.appClients > 0 ? ` · ${server!.appClients} joined` : ''}`
    : null
  const upPhase = update?.phase
  const upVersion = update?.info?.version

  return (
    <nav className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Sections">
      <div className="side-brand">
        {!collapsed && <h1>{p.appName}</h1>}
        <button
          className="side-collapse"
          onClick={p.onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? 'expand' : 'collapse'} />
        </button>
      </div>

      <div className="side-modes" role="tablist" aria-label="Mode" onKeyDown={onModeKey}>
        {p.modes.map(([m, label]) => {
          const on = p.mode === m
          const badge = p.modeBadges[m]
          return (
            <button
              key={m}
              role="tab"
              data-mode={m}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className={on ? 'is-on' : ''}
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
              onClick={() => p.onPickMode(m)}
            >
              {collapsed ? (SHORT[m] ?? label[0]) : label}
              {badge && (
                <span
                  className="side-mode-badge"
                  role="img"
                  aria-label={badge.label}
                  title={badge.label}
                >
                  {badge.text}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="side-scroll">
        {p.groups.map((g) => (
          <div className="side-group" key={g.key} role="group" aria-label={g.label}>
            {collapsed ? (
              <div className="side-divider" aria-hidden="true" />
            ) : (
              <div className="side-label" aria-hidden="true">
                {g.label}
              </div>
            )}
            {g.items.map(([t, label]) => {
              const count = p.counts[t]
              return (
                <button
                  key={t}
                  className={`side-item ${p.tab === t ? 'active' : ''}`}
                  aria-current={p.tab === t ? 'page' : undefined}
                  aria-label={collapsed ? label : undefined}
                  title={collapsed ? label : undefined}
                  onClick={() => p.onTab(t)}
                >
                  <Icon name={t} />
                  {!collapsed && <span className="side-text">{label}</span>}
                  {!collapsed && count != null && <span className="side-count">{count}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className="side-bottom">
        <div className={`side-card ${running ? 'is-live' : ''}`}>
          <button
            className="side-card-main"
            onClick={() => p.onTab('settings')}
            title={
              collapsed
                ? running
                  ? `Show Server on · ${serverLine}`
                  : 'Show Server off'
                : 'Open Show Server settings'
            }
            aria-label={
              collapsed
                ? running
                  ? `Show Server on, ${serverLine}`
                  : 'Show Server off'
                : undefined
            }
          >
            <span className={`side-dot ${running ? 'on' : ''}`} aria-hidden="true" />
            {!collapsed && (
              <span className="side-card-text">
                <span className="side-card-title">
                  {running ? 'Show Server on' : 'Show Server off'}
                </span>
                {serverLine && <span className="side-card-sub">{serverLine}</span>}
                {server?.error && (
                  <span className="side-card-sub side-card-err">{server.error}</span>
                )}
              </span>
            )}
          </button>
          {!running && !collapsed && (
            <button className="btn btn-small" onClick={startServer} disabled={starting}>
              {starting ? 'Starting…' : 'Start'}
            </button>
          )}
        </div>

        {upPhase === 'downloaded' && upVersion && (
          <div className="side-card is-update">
            {collapsed ? (
              <button
                className="side-card-main"
                onClick={() => window.api.updates.install()}
                title={`v${upVersion} ready · Restart to install`}
                aria-label={`v${upVersion} ready. Restart to install`}
              >
                <span className="side-card-icon">
                  <Icon name="update" />
                </span>
              </button>
            ) : (
              <>
                <span className="side-card-icon">
                  <Icon name="update" />
                </span>
                <span className="side-card-title">v{upVersion} ready</span>
                <button className="btn btn-small" onClick={() => window.api.updates.install()}>
                  Restart
                </button>
              </>
            )}
          </div>
        )}
        {upPhase === 'available' && upVersion && (
          <div className="side-card is-update">
            <button
              className="side-card-main"
              onClick={() => p.onTab('settings')}
              title={`v${upVersion} available — open Settings → Updates`}
              aria-label={collapsed ? `v${upVersion} available` : undefined}
            >
              <span className="side-card-icon">
                <Icon name="update" />
              </span>
              {!collapsed && <span className="side-card-title">v{upVersion} available</span>}
            </button>
          </div>
        )}

        <div className="side-sep" />
        <div className="side-footer">
          <ProjectMenu current={p.project} onSwitched={p.onSwitched} compact={collapsed} />
          <button
            className={`side-settings ${p.tab === 'settings' ? 'active' : ''}`}
            aria-label="Settings"
            title="Settings"
            aria-current={p.tab === 'settings' ? 'page' : undefined}
            onClick={() => p.onTab('settings')}
          >
            <Icon name="settings" />
          </button>
        </div>
      </div>
    </nav>
  )
}

export default Sidebar
