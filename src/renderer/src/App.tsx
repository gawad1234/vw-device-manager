import { useCallback, useEffect, useState } from 'react'
import type { Bundle, CableType, Device, ProjectInfo, Subnet } from '../../shared/types'
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
import SettingsPage from './pages/SettingsPage'
import ProjectMenu from './components/ProjectMenu'

type Tab =
  | 'devices'
  | 'projectors'
  | 'wallpapers'
  | 'subnets'
  | 'cables'
  | 'configs'
  | 'orders'
  | 'labels'
  | 'cases'
  | 'patching'
  | 'settings'

// Collapsible sidebar groups and the tabs they contain.
const NAV_GROUPS: Record<string, Tab[]> = {
  networking: ['subnets', 'configs'],
  packing: ['labels', 'cases']
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

  // Auto-refresh when a Vectorworks script writes to the open project file.
  useEffect(() => window.api.onDataChanged(() => void refresh()), [refresh])

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
        ) : tab === 'subnets' ? (
          <SubnetsPage subnets={subnets} onChanged={refresh} />
        ) : tab === 'cables' ? (
          <CablesPage
            bundles={bundles}
            devices={devices}
            cableTypes={cableTypes}
            onChanged={refresh}
          />
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
