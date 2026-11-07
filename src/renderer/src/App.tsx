import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bundle, CableType, Device, ProjectInfo, Subnet } from '../../shared/types'
import { HOST_UNREACHABLE } from '../../shared/remote-scope'
import SubnetsPage from './pages/SubnetsPage'
import DevicesPage from './pages/DevicesPage'
import CablesPage from './pages/CablesPage'
import ConfigsPage from './pages/ConfigsPage'
import OrdersPage from './pages/OrdersPage'
import LabelsPage from './pages/LabelsPage'
import CasesPage from './pages/CasesPage'
import PatchingPage from './pages/PatchingPage'
import ProjectorsPage from './pages/ProjectorsPage'
import WallpapersPage from './pages/WallpapersPage'
import SoftwarePage from './pages/SoftwarePage'
import CrewPage from './pages/CrewPage'
import LoomLabelsPage from './pages/LoomLabelsPage'
import TruckingPage from './pages/TruckingPage'
import FixturesPage from './pages/FixturesPage'
import UniversesPage from './pages/UniversesPage'
import FixtureTypesPage from './pages/FixtureTypesPage'
import PaperworkPage from './pages/PaperworkPage'
import SettingsPage from './pages/SettingsPage'
import ProjectMenu from './components/ProjectMenu'

type Tab =
  | 'devices'
  | 'projectors'
  | 'wallpapers'
  | 'software'
  | 'crew'
  | 'trucking'
  | 'subnets'
  | 'cables'
  | 'loomlabels'
  | 'configs'
  | 'orders'
  | 'labels'
  | 'cases'
  | 'patching'
  | 'fixtures'
  | 'universes'
  | 'fixtureTypes'
  | 'paperwork'
  | 'settings'

// Sidebar, grouped by job. Groups fold; the one holding the open page stays open.
const NAV: { key: string; label: string; items: [Tab, string][] }[] = [
  {
    key: 'network',
    label: 'Network',
    items: [
      ['devices', 'Devices'],
      ['subnets', 'Subnets'],
      ['configs', 'Configs'],
      ['projectors', 'Projectors'],
      ['wallpapers', 'Wallpapers'],
      ['software', 'Software']
    ]
  },
  {
    key: 'cables',
    label: 'Cables',
    items: [
      ['cables', 'Cables'],
      ['patching', 'Patching'],
      ['loomlabels', 'Loom labels']
    ]
  },
  {
    key: 'lighting',
    label: 'Lighting',
    items: [
      ['fixtures', 'Fixtures'],
      ['universes', 'Universes'],
      ['fixtureTypes', 'Fixture types']
    ]
  },
  {
    key: 'paperwork',
    label: 'Paperwork',
    items: [
      ['orders', 'Orders'],
      ['paperwork', 'Paperwork']
    ]
  },
  {
    key: 'schedule',
    label: 'Schedule',
    items: [
      ['crew', 'Crew'],
      ['trucking', 'Trucking']
    ]
  },
  {
    key: 'packing',
    label: 'Packing',
    items: [
      ['labels', 'Labels'],
      ['cases', 'Cases']
    ]
  }
]

const OPEN_GROUPS_KEY = 'sidebar.openGroups'

function loadOpenGroups(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? '["network","cables"]'))
  } catch {
    return new Set(['network', 'cables'])
  }
}

function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('devices')
  // an export menu's "Edit layout…" opens Paperwork on that export's template
  const [paperworkFocus, setPaperworkFocus] = useState<string | null>(null)
  useEffect(() => {
    const open = (e: Event): void => {
      setPaperworkFocus((e as CustomEvent<string>).detail)
      setTab('paperwork')
    }
    window.addEventListener('open-paperwork', open)
    return () => window.removeEventListener('open-paperwork', open)
  }, [])
  const [openGroups, setOpenGroups] = useState<Set<string>>(loadOpenGroups)

  const toggleGroup = (key: string): void =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify([...next]))
      } catch {
        /* remembered per session only */
      }
      return next
    })
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [subnets, setSubnets] = useState<Subnet[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [cableTypes, setCableTypes] = useState<CableType[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [updateReady, setUpdateReady] = useState(false)
  // A save or action that failed where the page doesn't show its own error
  // (e.g. a change refused while viewing a shared show).
  const [notice, setNotice] = useState<string | null>(null)

  // Only the newest load may land: a slow read of a host you just left mustn't
  // put its rows on screen for the local project.
  const loadSeq = useRef(0)
  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current
    const [subnetList, deviceList, bundleList, cableTypeList, categoryList] = await Promise.all([
      window.api.subnets.list(),
      window.api.devices.list(),
      window.api.bundles.list(),
      window.api.cableTypes.list(),
      window.api.deviceCategories.list()
    ])
    if (seq !== loadSeq.current) return
    setSubnets(subnetList)
    setDevices(deviceList)
    setBundles(bundleList)
    setCableTypes(cableTypeList)
    setCategories(categoryList)
  }, [])

  useEffect(() => {
    window.api.projects.current().then(setProject)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  // Clickable table rows open with Enter, like the click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const row = e.target as HTMLElement
      if (e.key === 'Enter' && row.matches?.('tr.clickable')) row.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent): void => {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
      if (msg !== HOST_UNREACHABLE) setNotice(msg) // the shared-show banner covers that one
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  // Auto-refresh when a Vectorworks script writes to the open project file, or
  // the host of a shared show changes something (or goes offline / comes back).
  useEffect(
    () =>
      window.api.onDataChanged(() => {
        void refresh()
        window.api.projects.current().then(setProject)
      }),
    [refresh]
  )

  // Flag the Settings tab when an update is ready, so it's noticed without
  // opening Settings. Reflects the current state on mount, then live changes.
  useEffect(() => {
    const apply = (s: { phase: string }): void =>
      setUpdateReady(s.phase === 'available' || s.phase === 'downloaded')
    window.api.updates.getState().then(apply)
    return window.api.onUpdateStatus(apply)
  }, [])

  // Switching projects swaps the whole database — reload everything.
  const handleSwitch = useCallback(
    (info: ProjectInfo) => {
      setProject(info)
      setLoading(true)
      refresh().finally(() => setLoading(false))
    },
    [refresh]
  )

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <h1>Device Manager</h1>
          <ProjectMenu current={project} onSwitched={handleSwitch} />
        </div>
      </header>
      {notice && (
        <div className="banner banner-error remote-banner app-notice">
          {notice}
          <button className="btn btn-small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {project?.remote && (
        <div
          className={`banner ${project.remote.offline ? 'banner-warning' : 'banner-info'} remote-banner`}
        >
          {project.remote.offline
            ? `Can’t reach ${project.remote.host} — retrying. What you see may be out of date.`
            : `Viewing a shared show on ${project.remote.host} (view-only).`}
          <button
            className="btn btn-small"
            onClick={() => window.api.projects.leave().then((info) => info && handleSwitch(info))}
          >
            Leave
          </button>
        </div>
      )}

      <div className="app-body">
        <nav className="sidebar" aria-label="Sections">
          {NAV.map((g) => {
            const hasActive = g.items.some(([t]) => t === tab)
            // the group holding the open page can't fold away
            const open = hasActive || openGroups.has(g.key)
            return (
              <div className="side-group" key={g.key}>
                <button
                  className={`side-group-head ${hasActive ? 'has-active' : ''}`}
                  aria-expanded={open}
                  onClick={() => !hasActive && toggleGroup(g.key)}
                >
                  <span className="side-caret">{open ? '▾' : '▸'}</span>
                  {g.label}
                </button>
                {open && (
                  <div className="side-sub">
                    {g.items.map(([t, label]) => (
                      <button
                        key={t}
                        className={`side-item ${tab === t ? 'active' : ''}`}
                        aria-current={tab === t ? 'page' : undefined}
                        onClick={() => setTab(t)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          <div className="side-spacer" />
          <button
            className={`side-item ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Settings
            {updateReady && <span className="tab-dot" title="An update is available" />}
          </button>
        </nav>

        <main className="app-main">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : tab === 'devices' ? (
            <DevicesPage
              devices={devices}
              subnets={subnets}
              categories={categories}
              onChanged={refresh}
            />
          ) : tab === 'projectors' ? (
            <ProjectorsPage devices={devices} onChanged={refresh} />
          ) : tab === 'wallpapers' ? (
            <WallpapersPage devices={devices} onChanged={refresh} />
          ) : tab === 'software' ? (
            <SoftwarePage devices={devices} onChanged={refresh} />
          ) : tab === 'crew' ? (
            <CrewPage key={project?.path} />
          ) : tab === 'trucking' ? (
            <TruckingPage key={project?.path} />
          ) : tab === 'subnets' ? (
            <SubnetsPage subnets={subnets} onChanged={refresh} />
          ) : tab === 'cables' ? (
            <CablesPage
              bundles={bundles}
              devices={devices}
              cableTypes={cableTypes}
              onChanged={refresh}
            />
          ) : tab === 'loomlabels' ? (
            <LoomLabelsPage bundles={bundles} onChanged={refresh} />
          ) : tab === 'configs' ? (
            <ConfigsPage subnets={subnets} />
          ) : tab === 'orders' ? (
            <OrdersPage />
          ) : tab === 'labels' ? (
            <LabelsPage />
          ) : tab === 'cases' ? (
            <CasesPage />
          ) : tab === 'patching' ? (
            <PatchingPage />
          ) : tab === 'fixtures' ? (
            <FixturesPage key={project?.path} />
          ) : tab === 'universes' ? (
            <UniversesPage key={project?.path} devices={devices} />
          ) : tab === 'fixtureTypes' ? (
            <FixtureTypesPage key={project?.path} />
          ) : tab === 'paperwork' ? (
            <PaperworkPage key={`${project?.path}|${paperworkFocus}`} focusId={paperworkFocus} />
          ) : (
            <SettingsPage
              key={project?.path}
              cableTypes={cableTypes}
              categories={categories}
              onChanged={refresh}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
