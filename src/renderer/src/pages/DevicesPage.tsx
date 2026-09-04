import { useEffect, useMemo, useState } from 'react'
import type { Device, Subnet } from '../../../shared/types'
import DeviceModal from '../components/DeviceModal'
import ExportMenu, { type ExportSection } from '../components/ExportMenu'

const EXPORT_SECTIONS: ExportSection[] = [
  {
    label: 'Device list (name · location · VLAN · IP)',
    items: [
      { label: 'PDF', doc: 'devicelist', format: 'pdf' },
      { label: 'Excel', doc: 'devicelist', format: 'xlsx' },
      { label: 'CSV', doc: 'devicelist', format: 'csv' }
    ]
  },
  {
    label: 'IP schedule (every port)',
    items: [
      { label: 'PDF', doc: 'ipschedule', format: 'pdf' },
      { label: 'Excel', doc: 'ipschedule', format: 'xlsx' },
      { label: 'CSV', doc: 'ipschedule', format: 'csv' }
    ]
  }
]

const UNCATEGORIZED = 'Uncategorized'

interface Props {
  devices: Device[]
  subnets: Subnet[]
  categories: string[]
  onChanged: () => void
}

function DevicesPage({ devices, subnets, categories, onChanged }: Props): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | 'new' | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const catOf = (d: Device): string => d.category?.trim() || UNCATEGORIZED

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return devices
    return devices.filter((d) => {
      const portText = d.ports.flatMap((p) => [p.label, p.ipAddress])
      return [d.name, d.deviceType, d.macAddress, d.location, d.notes, d.category, ...portText]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    })
  }, [devices, search])

  const visible = useMemo(
    () =>
      filterCategory === 'all' ? searched : searched.filter((d) => catOf(d) === filterCategory),
    [searched, filterCategory]
  )

  // Ordered groups: managed categories first (in list order), then any ad-hoc
  // categories, then Uncategorized last.
  const groups = useMemo(() => {
    const map = new Map<string, Device[]>()
    for (const d of visible) {
      const key = catOf(d)
      const arr = map.get(key)
      if (arr) arr.push(d)
      else map.set(key, [d])
    }
    const present = [...map.keys()]
    const managed = categories.filter((c) => map.has(c))
    const extras = present
      .filter((k) => k !== UNCATEGORIZED && !categories.includes(k))
      .sort((a, b) => a.localeCompare(b))
    const order = [...managed, ...extras, ...(map.has(UNCATEGORIZED) ? [UNCATEGORIZED] : [])]
    return order.map((key) => [key, map.get(key) as Device[]] as const)
  }, [visible, categories])

  // Only show section headers once categories are actually in use — otherwise
  // it's the same flat list as before.
  const showHeaders = !(groups.length <= 1 && groups[0]?.[0] === UNCATEGORIZED)

  // If the open device was deleted, close the modal.
  useEffect(() => {
    if (typeof openId === 'number' && !devices.some((d) => d.id === openId)) setOpenId(null)
  }, [devices, openId])

  const openDevice =
    openId === 'new' ? null : typeof openId === 'number' ? devices.find((d) => d.id === openId) ?? null : null

  function toggle(cat: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const showFilter = categories.length > 0 || devices.some((d) => d.category)

  return (
    <div className="page">
      <div className="page-header">
        <h2>Devices</h2>
        <div className="page-header-actions">
          <input
            className="search"
            placeholder="Search devices…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {showFilter && (
            <select
              className="cat-filter"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>
            </select>
          )}
          {devices.length > 0 && (
            <ExportMenu scope="all" label="Export" sections={EXPORT_SECTIONS} />
          )}
          <button className="btn btn-primary" onClick={() => setOpenId('new')}>
            + Add device
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>MAC</th>
            <th>Location</th>
            <th>Ports</th>
          </tr>
        </thead>
        {groups.length === 0 && (
          <tbody>
            <tr>
              <td colSpan={5} className="empty-cell">
                {devices.length === 0 ? 'No devices yet.' : 'No devices match your search.'}
              </td>
            </tr>
          </tbody>
        )}
        {groups.map(([cat, list]) => {
          const isCollapsed = showHeaders && collapsed.has(cat)
          return (
            <tbody key={cat}>
              {showHeaders && (
                <tr className="cat-header" onClick={() => toggle(cat)}>
                  <td colSpan={5}>
                    <span className="caret">{isCollapsed ? '▸' : '▾'}</span>
                    {cat}
                    <span className="cat-count">{list.length}</span>
                  </td>
                </tr>
              )}
              {!isCollapsed &&
                list.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => setOpenId(d.id)}>
                    <td>
                      {d.name}
                      {d.isSwitch && <span className="badge">switch</span>}
                    </td>
                    <td className="muted">{d.deviceType ?? '—'}</td>
                    <td className="muted">{d.macAddress ?? '—'}</td>
                    <td className="muted">{d.location ?? '—'}</td>
                    <td className="muted">{d.ports.length}</td>
                  </tr>
                ))}
            </tbody>
          )
        })}
      </table>

      {openId != null && (
        <DeviceModal
          device={openDevice}
          subnets={subnets}
          categories={categories}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}

export default DevicesPage
