import { useEffect, useRef, useState } from 'react'
import type {
  OrderColumn,
  OrderColumnKey,
  OrderExportFormat,
  OrderExportFormatInput,
  OrderItem
} from '../../../shared/types'
import { ORDER_COLUMN_META, defaultOrderColumns } from '../../../shared/types'
import { DEFAULT_TABLE_STYLE, tableStyleCss } from '../../../shared/table-style'
import Modal from './Modal'

/** Shown in the preview when the order has no items yet. */
const SAMPLE_ITEMS: OrderItem[] = [
  {
    name: 'Projector',
    manufacturer: 'Panasonic',
    modelNumber: 'PT-RZ120',
    category: 'Video',
    quantity: 2,
    received: 1,
    notes: ''
  },
  {
    name: 'Media server',
    manufacturer: 'Disguise',
    modelNumber: 'vx 2',
    category: 'Video',
    quantity: 1,
    received: 1,
    notes: 'Spare PSU'
  },
  {
    name: 'Switch',
    manufacturer: 'NETGEAR',
    modelNumber: 'M4350-24X4V',
    category: 'Network',
    quantity: 3,
    received: 0,
    notes: ''
  }
]

const cellText = (k: OrderColumnKey, it: OrderItem): string => {
  const q = Number(it.quantity) || 0
  const r = Number(it.received) || 0
  const v = {
    category: it.category,
    item: it.name,
    manufacturer: it.manufacturer,
    model: it.modelNumber,
    requested: String(q),
    // the real export shows the quantity at the last export; the preview has no history
    previous: String(q),
    received: String(r),
    outstanding: String(Math.max(0, q - r)),
    notes: it.notes
  }[k]
  return v || ''
}

/** A ready-made format in the equipment-list look (shop paperwork style). */
const EQUIPMENT_LIST: OrderExportFormatInput = {
  name: 'Equipment list',
  columns: (
    [
      ['requested', 'New Qty', 8],
      ['previous', 'Old Qty', 8],
      ['item', 'Item', 40],
      ['model', 'Mfr. P/N', 15],
      ['manufacturer', 'Manufacturer', 14],
      ['received', 'Filled', 7],
      ['outstanding', 'Balance', 8],
      ['category', '', 16],
      ['notes', '', 24]
    ] as const
  ).map(([key, label, width]) => ({ key, label, width, show: label !== '' })),
  groupByCategory: true,
  sort: 'category',
  orientation: 'portrait',
  fontSize: 11,
  layout: 'equipmentList'
}

interface Props {
  /** the open order's items, for the preview */
  items: OrderItem[]
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
  fontSize: number
  layout: OrderExportFormat['layout']
}

function draftFrom(f: OrderExportFormat | null): Draft {
  if (!f)
    return {
      name: '',
      columns: defaultOrderColumns(),
      groupByCategory: true,
      sort: 'category',
      orientation: 'portrait',
      fontSize: 12,
      layout: 'standard'
    }
  // Merge any missing keys (a stored format may predate a column).
  const have = new Map(f.columns.map((c) => [c.key, c]))
  const columns = [
    ...f.columns.filter((c) => ORDER_COLUMN_META[c.key]),
    ...defaultOrderColumns()
      .filter((c) => !have.has(c.key))
      .map((c) => ({ ...c, show: false }))
  ]
  return {
    name: f.name,
    columns,
    groupByCategory: f.groupByCategory,
    sort: f.sort,
    orientation: f.orientation,
    fontSize: f.fontSize,
    layout: f.layout
  }
}

function OrderFormatModal({ items, onClose, onChanged }: Props): React.JSX.Element {
  const [formats, setFormats] = useState<OrderExportFormat[]>([])
  const [activeId, setActiveId] = useState<number | 'new'>('new')
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null))
  const [error, setError] = useState('')
  const [tableStyle, setTableStyle] = useState(DEFAULT_TABLE_STYLE)
  const [edge, setEdge] = useState<number | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    window.api.tableStyle.get().then(setTableStyle)
  }, [])

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
    setDraft((d) => ({
      ...d,
      columns: d.columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    }))
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

  // Preview: the shown columns as the PDF prints them (grouped: no Category column).
  const shown = draft.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.show && !(draft.groupByCategory && c.key === 'category'))
  const sample = items.length ? items : SAMPLE_ITEMS
  const groups = draft.groupByCategory
    ? [...new Set(sample.map((it) => it.category?.trim() || 'Uncategorized'))].map((cat) => ({
        cat,
        rows: sample.filter((it) => (it.category?.trim() || 'Uncategorized') === cat)
      }))
    : [{ cat: '', rows: sample }]

  // Widths are weights the PDF spreads across the page; the preview does the same.
  const total = shown.reduce((a, s) => a + s.c.width, 0) || 1

  /** Which shown column's right edge (not the last) the pointer is on (within 5px). */
  function edgeAt(e: React.MouseEvent<HTMLTableElement>): number | null {
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left
    let right = 0
    for (let k = 0; k < shown.length - 1; k++) {
      right += (shown[k].c.width / total) * box.width
      if (Math.abs(x - right) <= 5) return k
    }
    return null
  }

  function startResize(e: React.MouseEvent<HTMLTableElement>, k: number): void {
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    const { i } = shown[k]
    const before = shown.slice(0, k).reduce((a, s) => a + s.c.width, 0)
    const after = shown.slice(k + 1).reduce((a, s) => a + s.c.width, 0)
    dragging.current = true
    setEdge(k)
    document.body.classList.add('col-resizing')
    // the weight that puts this edge under the pointer: (before + w) / (before + w + after) = x / W
    const move = (ev: MouseEvent): void => {
      const x = Math.min(box.width - 10, Math.max(10, ev.clientX - box.left))
      const w = (x * after) / (box.width - x) - before
      setCol(i, { width: Math.min(80, Math.max(3, Math.round(w))) })
    }
    const up = (): void => {
      dragging.current = false
      setEdge(null)
      document.body.classList.remove('col-resizing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
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
      fontSize: draft.fontSize,
      layout: draft.layout
    }
    const saved =
      activeId === 'new'
        ? await window.api.orderFormats.create(input)
        : await window.api.orderFormats.update(activeId, input)
    await refresh(saved.id)
    onChanged()
  }

  async function addEquipmentList(): Promise<void> {
    const saved = await window.api.orderFormats.create(EQUIPMENT_LIST)
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
      <button
        className="btn btn-primary"
        type="submit"
        form="fmt-form"
        disabled={!draft.name.trim()}
      >
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
        <button type="button" className="fmt-tab fmt-new" onClick={addEquipmentList}>
          + Equipment list
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
              Show, header text, width and order (↑↓)
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
                  <td>
                    <input
                      className="fmt-label"
                      value={c.label ?? ''}
                      placeholder={ORDER_COLUMN_META[c.key].short}
                      onChange={(e) => setCol(i, { label: e.target.value })}
                      disabled={!c.show}
                      aria-label={`Header for ${ORDER_COLUMN_META[c.key].label}`}
                    />
                  </td>
                  <td style={{ width: 86 }}>
                    <input
                      className="fmt-width"
                      type="number"
                      min={3}
                      max={80}
                      value={c.width}
                      onChange={(e) =>
                        setCol(i, { width: Math.max(3, Number(e.target.value) || 3) })
                      }
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
            Width is a relative weight in the PDF and the character width in Excel. You can also
            drag column edges in the preview below. Leave at least one column on.
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
          Layout
          <select
            value={draft.layout}
            onChange={(e) => setDraft((d) => ({ ...d, layout: e.target.value as Draft['layout'] }))}
          >
            <option value="standard">Standard table</option>
            <option value="equipmentList">Equipment list (bands, Balance pill)</option>
          </select>
        </label>

        <label>
          Text size
          <input
            type="number"
            min={7}
            max={20}
            step={0.5}
            value={draft.fontSize}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                fontSize: Math.min(20, Math.max(7, Number(e.target.value) || 12))
              }))
            }
          />
        </label>

        <div className="span-2">
          <div className="field-row-head">
            <span>Preview</span>
            <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>
              {items.length ? 'This order' : 'Sample items'} · drag a column edge to resize · font,
              colors and padding come from Settings → Table style
            </span>
          </div>
          <div
            className={`lxr-preview fmt-preview${draft.layout === 'equipmentList' ? ' eq' : ''}`}
            style={{ fontSize: draft.fontSize }}
          >
            <style>{tableStyleCss(tableStyle, '.fmt-preview table')}</style>
            {groups.map((g) => (
              <div key={g.cat || 'all'}>
                {g.cat && (
                  <h3>
                    {g.cat} <span className="lxr-count">({g.rows.length})</span>
                  </h3>
                )}
                <table
                  className="lxr-table"
                  style={{
                    width: '100%',
                    cursor: edge != null ? 'col-resize' : undefined
                  }}
                  onMouseMove={(e) => !dragging.current && setEdge(edgeAt(e))}
                  onMouseLeave={() => !dragging.current && setEdge(null)}
                  onMouseDown={(e) => {
                    const k = edgeAt(e)
                    if (k != null) startResize(e, k)
                  }}
                >
                  <colgroup>
                    {shown.map(({ c }, k) => (
                      <col
                        key={c.key}
                        className={k === edge ? 'lxr-col-edge' : ''}
                        style={{ width: `${(c.width / total) * 100}%` }}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {shown.map(({ c }) => (
                        <th
                          key={c.key}
                          style={ORDER_COLUMN_META[c.key].num ? { textAlign: 'center' } : undefined}
                        >
                          {c.label?.trim() || ORDER_COLUMN_META[c.key].short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((it, ri) => (
                      <tr key={ri}>
                        {shown.map(({ c }) => (
                          <td
                            key={c.key}
                            style={
                              ORDER_COLUMN_META[c.key].num ? { textAlign: 'center' } : undefined
                            }
                          >
                            {draft.layout === 'equipmentList' && c.key === 'outstanding' ? (
                              <span
                                className={`bal${Number(cellText(c.key, it)) > 0 ? ' due' : ''}`}
                              >
                                {cellText(c.key, it)}
                              </span>
                            ) : (
                              cellText(c.key, it)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  )
}

export default OrderFormatModal
