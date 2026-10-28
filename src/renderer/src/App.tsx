import { useCallback, useEffect, useState } from 'react'
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
  | 'settings'

// Collapsible sidebar groups and the tabs they contain.
const NAV_GROUPS: Record<string, Tab[]> = {
  networking: ['subnets', 'configs'],
  schedule: ['crew', 'trucking'],
  packing: ['labels', 'cases'],
  lighting: ['fixtures', 'universes', 'fixtureTypes']
}

function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('devices')
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  const toggleGroup = (key: string): void =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // A group shows expanded if the user opened it, or it holds the active tab.
  const groupOpen = (key: string): boolean => openGroups.has(key) || NAV_GROUPS[key].includes(tab)
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

  const refresh = useCallback(async () => {
    const [subnetList, deviceList, bundleList, cableTypeList, categoryList] = await Promise.all([
      window.api.subnets.list(),
      window.api.devices.list(),
      window.api.bundles.list(),
      window.api.cableTypes.list(),
      window.api.deviceCategories.list()
    ])
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
        <div className="banner banner-error remote-banner">
          {notice}
          <button className="btn btn-small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {project?.remote && (
        <div className={`banner ${project.remote.offline ? 'banner-warning' : 'banner-info'} remote-banner`}>
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
        <nav className="sidebar">
          <button
            className={`side-item ${tab === 'devices' ? 'active' : ''}`}
            onClick={() => setTab('devices')}
          >
            Devices
          </button>
          <div className="side-sub">
            <button
              className={`side-item ${tab === 'projectors' ? 'active' : ''}`}
              onClick={() => setTab('projectors')}
            >
              Projectors
            </button>
            <button
              className={`side-item ${tab === 'wallpapers' ? 'active' : ''}`}
              onClick={() => setTab('wallpapers')}
            >
              Wallpapers
            </button>
            <button
              className={`side-item ${tab === 'software' ? 'active' : ''}`}
              onClick={() => setTab('software')}
            >
              Software
            </button>
          </div>

          <div className="side-group">
            <button
              className={`side-group-head ${NAV_GROUPS.networking.includes(tab) ? 'has-active' : ''}`}
              onClick={() => toggleGroup('networking')}
            >
              <span className="side-caret">{groupOpen('networking') ? '▾' : '▸'}</span>
              Networking
            </button>
            {groupOpen('networking') && (
              <div className="side-sub">
                <button
                  className={`side-item ${tab === 'subnets' ? 'active' : ''}`}
                  onClick={() => setTab('subnets')}
                >
                  Subnets
                </button>
                <button
                  className={`side-item ${tab === 'configs' ? 'active' : ''}`}
                  onClick={() => setTab('configs')}
                >
                  Configs
                </button>
              </div>
            )}
          </div>

          <button
            className={`side-item ${tab === 'cables' ? 'active' : ''}`}
            onClick={() => setTab('cables')}
          >
            Cables
          </button>
          <div className="side-sub">
            <button
              className={`side-item ${tab === 'loomlabels' ? 'active' : ''}`}
              onClick={() => setTab('loomlabels')}
            >
              Loom labels
            </button>
          </div>
          <div className="side-group">
            <button
              className={`side-group-head ${NAV_GROUPS.lighting.includes(tab) ? 'has-active' : ''}`}
              onClick={() => toggleGroup('lighting')}
            >
              <span className="side-caret">{groupOpen('lighting') ? '▾' : '▸'}</span>
              Lighting
            </button>
            {groupOpen('lighting') && (
              <div className="side-sub">
                {(
                  [
                    ['fixtures', 'Fixtures'],
                    ['universes', 'Universes'],
                    ['fixtureTypes', 'Fixture types']
                  ] as const
                ).map(([t, label]) => (
                  <button
                    key={t}
                    className={`side-item ${tab === t ? 'active' : ''}`}
                    onClick={() => setTab(t)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={`side-item ${tab === 'patching' ? 'active' : ''}`}
            onClick={() => setTab('patching')}
          >
            Patching
          </button>
          <button
            className={`side-item ${tab === 'orders' ? 'active' : ''}`}
            onClick={() => setTab('orders')}
          >
            Orders
          </button>

          <div className="side-group">
            <button
              className={`side-group-head ${NAV_GROUPS.schedule.includes(tab) ? 'has-active' : ''}`}
              onClick={() => toggleGroup('schedule')}
            >
              <span className="side-caret">{groupOpen('schedule') ? '▾' : '▸'}</span>
              Schedule
            </button>
            {groupOpen('schedule') && (
              <div className="side-sub">
                <button
                  className={`side-item ${tab === 'crew' ? 'active' : ''}`}
                  onClick={() => setTab('crew')}
                >
                  Crew
                </button>
                <button
                  className={`side-item ${tab === 'trucking' ? 'active' : ''}`}
                  onClick={() => setTab('trucking')}
                >
                  Trucking
                </button>
              </div>
            )}
          </div>

          <div className="side-group">
            <button
              className={`side-group-head ${NAV_GROUPS.packing.includes(tab) ? 'has-active' : ''}`}
              onClick={() => toggleGroup('packing')}
            >
              <span className="side-caret">{groupOpen('packing') ? '▾' : '▸'}</span>
              Packing
            </button>
            {groupOpen('packing') && (
              <div className="side-sub">
                <button
                  className={`side-item ${tab === 'labels' ? 'active' : ''}`}
                  onClick={() => setTab('labels')}
                >
                  Labels
                </button>
                <button
                  className={`side-item ${tab === 'cases' ? 'active' : ''}`}
                  onClick={() => setTab('cases')}
                >
                  Cases
                </button>
              </div>
            )}
          </div>

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
