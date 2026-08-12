import { useEffect, useMemo, useState } from 'react'
import type { Bundle, CableType, Device } from '../../../shared/types'
import BundleModal from '../components/BundleModal'
import ExportMenu from '../components/ExportMenu'

interface Props {
  bundles: Bundle[]
  devices: Device[]
  cableTypes: CableType[]
  onChanged: () => void
}

function CablesPage({ bundles, devices, cableTypes, onChanged }: Props): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | 'new' | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bundles
    return bundles.filter((b) => {
      const cableText = b.cables.flatMap((c) => [c.name, c.source.text, c.destination.text])
      return [b.name, b.fromLocation, b.toLocation, b.notes, ...cableText]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    })
  }, [bundles, search])

  useEffect(() => {
    if (typeof openId === 'number' && !bundles.some((b) => b.id === openId)) setOpenId(null)
  }, [bundles, openId])

  const openBundle =
    openId === 'new' ? null : typeof openId === 'number' ? bundles.find((b) => b.id === openId) ?? null : null

  return (
    <div className="page">
      <div className="page-header">
        <h2>Cable bundles</h2>
        <div className="page-header-actions">
          <input
            className="search"
            placeholder="Search bundles & cables…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {bundles.length > 0 && <ExportMenu scope="all" label="Export all" />}
          <button className="btn btn-primary" onClick={() => setOpenId('new')}>
            + Add bundle
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>From</th>
            <th>To</th>
            <th>Length</th>
            <th>Cables</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-cell">
                {bundles.length === 0 ? 'No bundles yet.' : 'No bundles match your search.'}
              </td>
            </tr>
          )}
          {filtered.map((b) => (
            <tr key={b.id} className="clickable" onClick={() => setOpenId(b.id)}>
              <td>
                {b.color && (
                  <span className="bundle-dot" style={{ background: b.color }} aria-hidden />
                )}
                {b.name}
              </td>
              <td className="muted">{b.fromLocation ?? '—'}</td>
              <td className="muted">{b.toLocation ?? '—'}</td>
              <td className="muted">{b.length ?? '—'}</td>
              <td className="muted">{b.cables.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {openId != null && (
        <BundleModal
          bundle={openBundle}
          devices={devices}
          cableTypes={cableTypes}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}

export default CablesPage
