import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Device, Subnet } from '../../../shared/types'
import { mainRoute } from '../../../shared/ip-utils'
import DeviceModal from '../components/DeviceModal'

interface Props {
  devices: Device[]
  subnets: Subnet[]
  categories: string[]
  onChanged: () => void
}

const EVERY_MS = 30_000
const time = (d: Date): string => d.toLocaleTimeString([], { hour12: false })

function ShowStatusPage({ devices, subnets, categories, onChanged }: Props): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [up, setUp] = useState<Record<string, boolean>>({})
  const [seen, setSeen] = useState<Record<string, Date>>({})
  const [lastCheck, setLastCheck] = useState<Date | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false) // a slow sweep mustn't overlap the next one

  const rows = useMemo(
    () =>
      devices
        .map((d) => ({ d, ip: mainRoute(d, subnets).ip.trim() }))
        .filter((r) => r.ip)
        .sort((a, b) => a.d.name.localeCompare(b.d.name)),
    [devices, subnets]
  )
  // keyed on the IPs' text so an unrelated device edit doesn't re-ping
  const ipKey = rows.map((r) => r.ip).join('\n')
  const ips = useMemo(() => (ipKey ? ipKey.split('\n') : []), [ipKey])

  const check = useCallback(async () => {
    if (!ips.length || busy.current) return
    busy.current = true
    setChecking(true)
    try {
      const res = await window.api.show.ping(ips)
      const now = new Date()
      setUp(res)
      setSeen((prev) => {
        const next = { ...prev }
        for (const [ip, ok] of Object.entries(res)) if (ok) next[ip] = now
        return next
      })
      setLastCheck(now)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      busy.current = false
      setChecking(false)
    }
  }, [ips])

  useEffect(() => {
    const first = setTimeout(() => void check(), 0) // not synchronously: check() sets state
    const id = setInterval(() => void check(), EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [check])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(({ d, ip }) =>
      [d.name, ip, d.macAddress ?? ''].some((v) => v.toLowerCase().includes(q))
    )
  }, [rows, search])

  const online = rows.filter((r) => up[r.ip] === true).length
  const missing = rows.filter((r) => up[r.ip] === false).length
  const openDevice = devices.find((d) => d.id === openId) ?? null

  return (
    <div className="page">
      <div className="page-header">
        <h2>Show status</h2>
        <div className="page-header-actions">
          <input
            className="search"
            type="search"
            placeholder="Pull up a config: name, IP or MAC…"
            aria-label="Pull up a config"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" disabled={checking} onClick={() => void check()}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 18, maxWidth: 720 }}>
        What&rsquo;s answering on the network while the show runs, and each device&rsquo;s setup
        one search away. This computer pings every device that has a main IP, every 30 seconds
        while this page is open.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="status-tiles">
        <div className="panel">
          <div className="muted">Devices online</div>
          <div className="mono status-tile-value">
            {online} / {rows.length}
          </div>
        </div>
        <div className="panel">
          <div className="muted">Not answering</div>
          <div className="mono status-tile-value">{missing}</div>
        </div>
      </div>

      <p className="muted status-last">
        {lastCheck ? `Last check ${time(lastCheck)} · every 30 s` : 'Not checked yet'}
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Device</th>
            <th>IP</th>
            <th>Seen</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-cell">
                {rows.length === 0
                  ? 'No devices with an IP yet — add them on the Devices page.'
                  : 'No devices match your search.'}
              </td>
            </tr>
          )}
          {shown.map(({ d, ip }) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td className="mono">{ip}</td>
              <td className="mono muted">{seen[ip] ? time(seen[ip]) : '—'}</td>
              <td>
                {up[ip] === true ? (
                  <span className="badge badge-ok">Online</span>
                ) : up[ip] === false ? (
                  <span className="badge badge-open">Missing</span>
                ) : (
                  <span className="badge">Not checked yet</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn btn-small" onClick={() => setOpenId(d.id)}>
                  Config…
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {openDevice && (
        <DeviceModal
          device={openDevice}
          subnets={subnets}
          categories={categories}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onCreated={setOpenId}
        />
      )}
    </div>
  )
}

export default ShowStatusPage
