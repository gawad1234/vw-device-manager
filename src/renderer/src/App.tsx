import { useCallback, useEffect, useState } from 'react'
import type { Bundle, CableType, Device, ProjectInfo, Subnet } from '../../shared/types'
import SubnetsPage from './pages/SubnetsPage'
import DevicesPage from './pages/DevicesPage'
import CablesPage from './pages/CablesPage'
import SettingsPage from './pages/SettingsPage'
import ProjectMenu from './components/ProjectMenu'

type Tab = 'devices' | 'subnets' | 'cables' | 'settings'

function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('devices')
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [subnets, setSubnets] = useState<Subnet[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [cableTypes, setCableTypes] = useState<CableType[]>([])
  const [loading, setLoading] = useState(true)
  const [updateReady, setUpdateReady] = useState(false)

  const refresh = useCallback(async () => {
    const [subnetList, deviceList, bundleList, cableTypeList] = await Promise.all([
      window.api.subnets.list(),
      window.api.devices.list(),
      window.api.bundles.list(),
      window.api.cableTypes.list()
    ])
    setSubnets(subnetList)
    setDevices(deviceList)
    setBundles(bundleList)
    setCableTypes(cableTypeList)
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
        <nav className="tabs">
          <button
            className={`tab ${tab === 'devices' ? 'active' : ''}`}
            onClick={() => setTab('devices')}
          >
            Devices
          </button>
          <button
            className={`tab ${tab === 'subnets' ? 'active' : ''}`}
            onClick={() => setTab('subnets')}
          >
            Subnets
          </button>
          <button
            className={`tab ${tab === 'cables' ? 'active' : ''}`}
            onClick={() => setTab('cables')}
          >
            Cables
          </button>
          <button
            className={`tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Settings
            {updateReady && <span className="tab-dot" title="An update is available" />}
          </button>
        </nav>
      </header>

      <main className="app-main">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : tab === 'devices' ? (
          <DevicesPage devices={devices} subnets={subnets} onChanged={refresh} />
        ) : tab === 'subnets' ? (
          <SubnetsPage subnets={subnets} onChanged={refresh} />
        ) : tab === 'cables' ? (
          <CablesPage
            bundles={bundles}
            devices={devices}
            cableTypes={cableTypes}
            onChanged={refresh}
          />
        ) : (
          <SettingsPage key={project?.path} cableTypes={cableTypes} onChanged={refresh} />
        )}
      </main>
    </div>
  )
}

export default App
