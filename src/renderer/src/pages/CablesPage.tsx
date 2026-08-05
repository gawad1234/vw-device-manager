import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Bundle, BundleInput, CableType, Device } from '../../../shared/types'
import BundleCables from '../components/BundleCables'

const EMPTY_FORM: BundleInput = {
  name: '',
  color: null,
  fromLocation: null,
  toLocation: null,
  length: null,
  notes: null
}

// Preset palette for color-coding bundles (readable on the dark theme).
const BUNDLE_COLORS = [
  '#e0685f', // red
  '#e0954f', // orange
  '#e0c24f', // amber
  '#6fd06f', // green
  '#4fc0c0', // teal
  '#3b6fe0', // blue
  '#9b6fe0', // purple
  '#e06fb0' // pink
]

interface Props {
  bundles: Bundle[]
  devices: Device[]
  cableTypes: CableType[]
  onChanged: () => void
}

function CablesPage({ bundles, devices, cableTypes, onChanged }: Props): React.JSX.Element {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<BundleInput>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    if (!showForm) {
      setEditingId(null)
      setForm(EMPTY_FORM)
      setError(null)
    }
  }, [showForm])

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

  function startEdit(bundle: Bundle): void {
    setEditingId(bundle.id)
    setForm({
      name: bundle.name,
      color: bundle.color,
      fromLocation: bundle.fromLocation,
      toLocation: bundle.toLocation,
      length: bundle.length,
      notes: bundle.notes
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Bundle name is required.')
      return
    }
    if (editingId != null) {
      await window.api.bundles.update(editingId, form)
    } else {
      await window.api.bundles.create(form)
    }
    setError(null)
    onChanged()
    setShowForm(false)
  }

  async function handleDelete(bundle: Bundle): Promise<void> {
    if (!window.confirm(`Delete bundle "${bundle.name}" and its ${bundle.cables.length} cable(s)?`))
      return
    await window.api.bundles.remove(bundle.id)
    onChanged()
  }

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
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add bundle'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="panel form-grid" onSubmit={handleSubmit}>
          {error && <div className="banner banner-error">{error}</div>}
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Stage → Rack A conduit"
              autoFocus
            />
          </label>
          <label>
            Color
            <div className="swatch-picker">
              <button
                type="button"
                className={`swatch-option none ${form.color == null ? 'selected' : ''}`}
                onClick={() => setForm({ ...form, color: null })}
                title="No color"
              />
              {BUNDLE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch-option ${form.color === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setForm({ ...form, color: c })}
                  title={c}
                />
              ))}
            </div>
          </label>
          <label>
            From (location)
            <input
              value={form.fromLocation ?? ''}
              onChange={(e) => setForm({ ...form, fromLocation: e.target.value || null })}
              placeholder="Stage left"
            />
          </label>
          <label>
            To (location)
            <input
              value={form.toLocation ?? ''}
              onChange={(e) => setForm({ ...form, toLocation: e.target.value || null })}
              placeholder="Rack A, FOH"
            />
          </label>
          <label>
            Length
            <input
              value={form.length ?? ''}
              onChange={(e) => setForm({ ...form, length: e.target.value || null })}
              placeholder="50'"
            />
            <small className="muted">Applies to every cable in the bundle.</small>
          </label>
          <label className="span-2">
            Notes
            <textarea
              value={form.notes ?? ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
              rows={2}
            />
          </label>
          <div className="form-actions span-2">
            <button type="submit" className="btn btn-primary">
              {editingId != null ? 'Save changes' : 'Create bundle'}
            </button>
          </div>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>From</th>
            <th>To</th>
            <th>Length</th>
            <th>Cables</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-cell">
                {bundles.length === 0 ? 'No bundles yet.' : 'No bundles match your search.'}
              </td>
            </tr>
          )}
          {filtered.map((b) => (
            <Fragment key={b.id}>
              <tr>
                <td>
                  {b.color && (
                    <span className="bundle-dot" style={{ background: b.color }} aria-hidden />
                  )}
                  {b.name}
                </td>
                <td className="muted">{b.fromLocation ?? '—'}</td>
                <td className="muted">{b.toLocation ?? '—'}</td>
                <td className="muted">{b.length ?? '—'}</td>
                <td>
                  <button
                    className="btn btn-small"
                    onClick={() => setExpandedId((cur) => (cur === b.id ? null : b.id))}
                  >
                    {expandedId === b.id ? '▾' : '▸'} {b.cables.length}
                  </button>
                </td>
                <td className="row-actions">
                  <button className="btn btn-small" onClick={() => startEdit(b)}>
                    Edit
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => handleDelete(b)}>
                    Delete
                  </button>
                </td>
              </tr>
              {expandedId === b.id && (
                <tr className="ports-row">
                  <td
                    colSpan={6}
                    style={b.color ? { borderLeft: `3px solid ${b.color}` } : undefined}
                  >
                    <BundleCables
                      bundle={b}
                      devices={devices}
                      cableTypes={cableTypes}
                      onChanged={onChanged}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default CablesPage
