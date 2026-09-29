import { useCallback, useEffect, useState } from 'react'
import type { HostConfig, Subnet } from '../../../shared/types'
import ConfigModal from '../components/ConfigModal'

interface Props {
  subnets: Subnet[]
}

function ConfigsPage({ subnets }: Props): React.JSX.Element {
  const [configs, setConfigs] = useState<HostConfig[]>([])
  const [openId, setOpenId] = useState<number | 'new' | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setConfigs(await window.api.configs.list())
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    if (typeof openId === 'number' && !configs.some((c) => c.id === openId)) setOpenId(null)
  }, [configs, openId])

  const openConfig =
    openId === 'new'
      ? null
      : typeof openId === 'number'
        ? (configs.find((c) => c.id === openId) ?? null)
        : null

  return (
    <div className="page">
      <div className="page-header">
        <h2>Config scripts</h2>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setOpenId('new')}>
            + New config
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 18, maxWidth: 720 }}>
        Generate a Windows PowerShell script that builds a Hyper-V VLAN trunk on a host — one
        untagged (native) adapter plus one per tagged VLAN, each with its own IP. Build the VLAN
        list by hand or pull VLANs straight from this project&rsquo;s subnets.
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Switch</th>
            <th>VLANs</th>
          </tr>
        </thead>
        <tbody>
          {!loading && configs.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-cell">
                No configs yet — create one to generate a VLAN script.
              </td>
            </tr>
          )}
          {configs.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)}>
              <td>{c.name}</td>
              <td className="muted">{c.switchName}</td>
              <td className="muted">{c.vlans.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {openId != null && (
        <ConfigModal
          config={openConfig}
          subnets={subnets}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}

export default ConfigsPage
