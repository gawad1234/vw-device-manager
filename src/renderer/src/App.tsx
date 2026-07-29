import { useCallback, useEffect, useState } from 'react'
import type { Device, Subnet } from '../../shared/types'
import SubnetsPage from './pages/SubnetsPage'
import DevicesPage from './pages/DevicesPage'

type Tab = 'devices' | 'subnets'

function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('devices')
  const [subnets, setSubnets] = useState<Subnet[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [subnetList, deviceList] = await Promise.all([
      window.api.subnets.list(),
      window.api.devices.list()
    ])
    setSubnets(subnetList)
    setDevices(deviceList)
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  return (
    <div className="app">
      <header className="app-header">
        <h1>ConnectCAD Device Manager</h1>
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
        </nav>
      </header>

      <main className="app-main">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : tab === 'devices' ? (
          <DevicesPage devices={devices} subnets={subnets} onChanged={refresh} />
        ) : (
          <SubnetsPage subnets={subnets} onChanged={refresh} />
        )}
      </main>
    </div>
  )
}

export default App
