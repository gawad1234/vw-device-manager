import { useEffect, useState } from 'react'
import type {
  OrderColumn,
  OrderExportFormat,
  OrderExportFormatInput
} from '../../../shared/types'
import { ORDER_COLUMN_META, defaultOrderColumns } from '../../../shared/types'
import Modal from './Modal'

interface Props {
  onClose: () => void
  /** called after any create/update/delete so the order editor can refresh */
  onChanged: () => void
}

type Draft = {
  name: string
  columns: OrderColumn[]
  groupByCategory: boolean
  sort: OrderExportFormat['sort']
  orientation: OrderExportFormat['orientation']
  density: OrderExportFormat['density']
}

function draftFrom(f: OrderExportFormat | null): Draft {
  if (!f)
    return {
      name: '',
      columns: defaultOrderColumns(),
      groupByCategory: true,
      sort: 'category',
      orientation: 'portrait',
      density: 'normal'
    }
  // Merge any missing keys (a stored format may predate a column).
  const have = new Map(f.columns.map((c) => [c.key, c]))
  const columns = [
    ...f.columns.filter((c) => ORDER_COLUMN_META[c.key]),
    ...defaultOrderColumns().filter((c) => !have.has(c.key)).map((c) => ({ ...c, show: false }))
  ]
  return {
    name: f.name,
    columns,
    groupByCategory: f.groupByCategory,
    sort: f.sort,
    orientation: f.orientation,
    density: f.density
  }
}

function OrderFormatModal({ onClose, onChanged }: Props): React.JSX.Element {
  const [formats, setFormats] = useState<OrderExportFormat[]>([])
  const [activeId, setActiveId] = useState<number | 'new'>('new')
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null))
  const [error, setError] = useState('')

  async function refresh(select?: number | 'new'): Promise<void> {
    const list = await window.api.orderFormats.list()
    setFormats(list)
    if (select !== undefined) setActiveId(select)
  }

  useEffect(() => {
    refresh()
  }, [])

  // Load the active format into the draft whenever the selection changes.
  useEffect(() => {
    if (activeId === 'new') setDraft(draftFrom(null))
    else {
      const f = formats.find((x) => x.id === activeId)
      if (f) setDraft(draftFrom(f))
    }
    setError('')
  }, [activeId, formats])

  function setCol(i: number, patch: Partial<OrderColumn>): void {
    setDraft((d) => ({ ...d, columns: d.columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }))
  }
  function moveCol(i: number, dir: -1 | 1): void {
    setDraft((d) => {
      const j = i + dir
      if (j < 0 || j >= d.columns.length) return d
      const cols = [...d.columns]
      ;[cols[i], cols[j]] = [cols[j], cols[i]]
      return { ...d, columns: cols }
    })
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!draft.name.trim()) {
      setError('Give the format a name.')
      return
    }
    const input: OrderExportFormatInput = {
      name: draft.name.trim(),
      columns: draft.columns,
      groupByCategory: draft.groupByCategory,
      sort: draft.sort,
      orientation: draft.orientation,
      density: draft.density
    }
    const saved =
      activeId === 'new'
        ? await window.api.orderFormats.create(input)
        : await window.api.orderFormats.update(activeId, input)
    await refresh(saved.id)
    onChanged()
  }

  async function handleDelete(): Promise<void> {
    if (activeId === 'new') return
    const f = formats.find((x) => x.id === activeId)
    if (!f || !window.confirm(`Delete format "${f.name}"?`)) return
    await window.api.orderFormats.remove(activeId)
    await refresh('new')
    onChanged()
  }

  const footer = (
    <>
      {activeId !== 'new' && (
        <button className="btn btn-danger" onClick={handleDelete}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <button className="btn" type="button" onClick={onClose}>
        Close
      </button>
      <button className="btn btn-primary" type="submit" form="fmt-form" disabled={!draft.name.trim()}>
        {activeId === 'new' ? 'Create format' : 'Save changes'}
      </button>
    </>
  )

  return (
    <Modal title="Export formats" onClose={onClose} footer={footer} wide>
      <div className="fmt-tabs">
        {formats.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`fmt-tab${activeId === f.id ? ' active' : ''}`}
            onClick={() => setActiveId(f.id)}
          >
            {f.name}
          </button>
        ))}
        <button
          type="button"
          className={`fmt-tab fmt-new${activeId === 'new' ? ' active' : ''}`}
          onClick={() => setActiveId('new')}
        >
          + New
        </button>
      </div>

      <form id="fmt-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error span-2">{error}</div>}
        <label className="span-2">
          Format name
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="e.g. Pull order — compact"
            autoFocus
          />
        </label>

        <div className="span-2">
          <div className="field-row-head">
            <span>Columns</span>
            <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>
              Show, order (↑↓), and width
            </span>
          </div>
          <table className="fmt-cols">
            <tbody>
              {draft.columns.map((c, i) => (
                <tr key={c.key}>
                  <td style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={c.show}
                      onChange={(e) => setCol(i, { show: e.target.checked })}
                      aria-label={`Show ${ORDER_COLUMN_META[c.key].label}`}
                    />
                  </td>
                  <td>{ORDER_COLUMN_META[c.key].label}</td>
                  <td style={{ width: 86 }}>
                    <input
                      className="fmt-width"
                      type="number"
                      min={3}
                      max={80}
                      value={c.width}
                      onChange={(e) => setCol(i, { width: Math.max(3, Number(e.target.value) || 3) })}
                      disabled={!c.show}
                      aria-label={`Width of ${ORDER_COLUMN_META[c.key].label}`}
                    />
                  </td>
                  <td style={{ width: 66 }}>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => moveCol(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => moveCol(i, 1)}
                      disabled={i === draft.columns.length - 1}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 6 }}>
            Width is a relative weight in the PDF and the character width in Excel. “Item” can’t be
            hidden in practice — leave at least one column on.
          </p>
        </div>

        <label className="checkbox-field span-2">
          <input
            type="checkbox"
            checked={draft.groupByCategory}
            onChange={(e) => setDraft((d) => ({ ...d, groupByCategory: e.target.checked }))}
          />
          Group by category (PDF: a section per category; Excel/CSV: a Category column + category
          sort)
        </label>

        <label>
          Sort rows by
          <select
            value={draft.sort}
            onChange={(e) => setDraft((d) => ({ ...d, sort: e.target.value as Draft['sort'] }))}
            disabled={draft.groupByCategory}
          >
            <option value="category">Category, then name</option>
            <option value="name">Name</option>
            <option value="outstanding">Most outstanding first</option>
          </select>
        </label>

        <label>
          Page orientation
          <select
            value={draft.orientation}
            onChange={(e) =>
              setDraft((d) => ({ ...d, orientation: e.target.value as Draft['orientation'] }))
            }
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>

        <label>
          Row density (PDF)
          <select
            value={draft.density}
            onChange={(e) => setDraft((d) => ({ ...d, density: e.target.value as Draft['density'] }))}
          >
            <option value="compact">Compact</option>
            <option value="normal">Normal</option>
            <option value="large">Large</option>
          </select>
        </label>
      </form>
    </Modal>
  )
}

export default OrderFormatModal
