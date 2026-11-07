import { useEffect, useRef, useState } from 'react'
import {
  buildReport,
  fieldLabel,
  fieldsFor,
  PRESETS,
  SOURCES,
  usedBy,
  type PaperworkSource,
  type PaperworkTemplate,
  type ReportColumn
} from '../../../shared/paperwork'
import { DEFAULT_TABLE_STYLE, tableStyleCss } from '../../../shared/table-style'
import type { OrderExportFormat, OrderItem } from '../../../shared/types'
import OrderFormatEditor from '../components/OrderFormatEditor'
import {
  EQUIPMENT_LIST,
  NEW_FORMAT,
  orderFormatSelection,
  parseOrderFormat
} from '../lib/paperwork'

const AREAS = ['Cables', 'Devices & network', 'Trucking', 'Lighting']

const blankTemplate = (source: PaperworkSource): PaperworkTemplate => ({
  id: crypto.randomUUID(),
  name: `New ${SOURCES[source].label.toLowerCase()} report`,
  source,
  kind: 'list',
  columns: SOURCES[source].fields
    .slice(0, 3)
    .map((f) => ({ field: f.key, label: f.label, width: 140 })),
  groupBy: '',
  sortBy: [SOURCES[source].fields[0].key],
  mergeRepeats: 0,
  orientation: 'portrait',
  fontSize: 11
})

/** Paperwork: every templated export's layout (pull sheet, IP schedule, load sheet,
 *  lighting…) plus your own — your columns, drag to size, export. */
function PaperworkPage({ focusId }: { focusId?: string | null }): React.JSX.Element {
  const [templates, setTemplates] = useState<PaperworkTemplate[]>([])
  // App remounts the page (key) when an export's "Edit layout…" picks a template
  const [selId, setSelId] = useState(focusId ?? '')
  const [colIdx, setColIdx] = useState<number | null>(null)
  const [records, setRecords] = useState<Partial<Record<PaperworkSource, object[]>>>({})
  const [busy, setBusy] = useState('')
  const [tableStyle, setTableStyle] = useState(DEFAULT_TABLE_STYLE)
  // the column whose right edge is under the pointer (or being dragged)
  const [edge, setEdge] = useState<number | null>(null)
  const dragging = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const r = templates.find((x) => x.id === selId)
  const source = r?.source

  // Order export formats sit in the same list, with their own editor.
  const [formats, setFormats] = useState<OrderExportFormat[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const picked = parseOrderFormat(selId)
  // an order set to Default names no format, so show the first
  const format = picked ? (formats.find((f) => f.id === picked.formatId) ?? formats[0]) : undefined
  const refreshFormats = (): Promise<void> => window.api.orderFormats.list().then(setFormats)
  const addFormat = async (input: typeof NEW_FORMAT): Promise<void> => {
    const created = await window.api.orderFormats.create(input)
    await refreshFormats()
    setSelId(orderFormatSelection(created.id))
  }

  // The preview shows real lines: the order you came from, else the first with any.
  useEffect(() => {
    const from = parseOrderFormat(focusId ?? '')?.orderId
    void refreshFormats()
    window.api.orders.list().then((orders) => {
      const order = orders.find((o) => o.id === from) ?? orders.find((o) => o.items.length)
      setOrderItems(order?.items ?? [])
    })
  }, [focusId])

  useEffect(() => {
    window.api.tableStyle.get().then(setTableStyle)
    window.api.paperwork.list().then((l) => {
      setTemplates(l)
      setSelId((cur) => cur || l[0]?.id || '')
    })
  }, [])

  // the preview's rows: the selected template's source, refreshed when the show changes
  useEffect(() => {
    if (!source) return
    const load = (): void => {
      window.api.paperwork
        .records(source)
        .then((list) => setRecords((prev) => ({ ...prev, [source]: list })))
    }
    load()
    return window.api.onDataChanged(load)
  }, [source])

  // every edit saves a moment later (a column drag is many edits)
  const commit = (next: PaperworkTemplate[]): void => {
    setTemplates(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.api.paperwork.saveAll(next), 600)
  }
  const update = (patch: Partial<PaperworkTemplate>): void => {
    if (r) commit(templates.map((x) => (x.id === r.id ? { ...r, ...patch } : x)))
  }
  const setCol = (i: number, patch: Partial<ReportColumn>): void => {
    if (r) update({ columns: r.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  }
  const moveCol = (i: number, d: -1 | 1): void => {
    if (!r || i + d < 0 || i + d >= r.columns.length) return
    const columns = [...r.columns]
    ;[columns[i], columns[i + d]] = [columns[i + d], columns[i]]
    update({ columns })
    setColIdx(i + d)
  }

  /** Which column's right edge the pointer is on (within 5px), anywhere down the table. */
  function edgeAt(e: React.MouseEvent<HTMLTableElement>): number | null {
    if (!r) return null
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    let right = 0
    for (let i = 0; i < r.columns.length; i++) {
      right += r.columns[i].width
      if (Math.abs(x - right) <= 5) return i
    }
    return null
  }

  function startResize(e: React.MouseEvent, i: number): void {
    e.preventDefault()
    if (!r) return
    const x0 = e.clientX
    const w0 = r.columns[i].width
    dragging.current = true
    setEdge(i)
    document.body.classList.add('col-resizing')
    const move = (ev: MouseEvent): void =>
      setCol(i, { width: Math.max(30, Math.round(w0 + ev.clientX - x0)) })
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

  function add(t: PaperworkTemplate): void {
    commit([...templates, t])
    setSelId(t.id)
    setColIdx(null)
  }

  function remove(): void {
    if (!r || !confirm(`Delete the "${r.name}" template?`)) return
    const next = templates.filter((x) => x.id !== r.id)
    commit(next)
    setSelId(next[0]?.id ?? '')
    setColIdx(null)
  }

  function reset(): void {
    const original = PRESETS.find((p) => p.id === r?.id)
    if (!r || !original || !confirm(`Put "${r.name}" back the way it came?`)) return
    commit(templates.map((x) => (x.id === r.id ? original : x)))
    setColIdx(null)
  }

  async function exportAs(format: 'pdf' | 'xlsx' | 'csv'): Promise<void> {
    if (!r) return
    setBusy(format)
    try {
      await window.api.paperwork.export(r, format)
    } finally {
      setBusy('')
    }
  }

  const rows = (source && records[source]) || []
  const built = r ? buildReport(r, rows) : null
  const col = r && colIdx != null ? r.columns[colIdx] : undefined
  const fieldOptions = (r ? fieldsFor(r.source, rows) : []).map((f) => (
    <option key={f.key} value={f.key}>
      {f.label}
    </option>
  ))
  const bound = r ? usedBy(r.id) : null
  const isPreset = !!r && PRESETS.some((p) => p.id === r.id)

  return (
    <div className="page lxr-page">
      <div className="page-header">
        <h2>Paperwork</h2>
        {r && (
          <div className="lxr-export">
            {(['pdf', 'xlsx', 'csv'] as const).map((f) => (
              <button
                key={f}
                className={`btn${f === 'pdf' ? ' btn-primary' : ''}`}
                disabled={!!busy}
                onClick={() => exportAs(f)}
              >
                {busy === f ? 'Exporting…' : f === 'xlsx' ? 'Excel' : f.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lxr-layout">
        <aside className="lxr-list">
          {AREAS.map((area) => {
            const list = templates.filter((x) => SOURCES[x.source]?.area === area)
            if (!list.length) return null
            return (
              <div key={area} className="lxr-area">
                <div className="lxr-area-head">{area}</div>
                {list.map((x) => (
                  <button
                    key={x.id}
                    className={`side-item ${x.id === selId ? 'active' : ''}`}
                    onClick={() => {
                      setSelId(x.id)
                      setColIdx(null)
                    }}
                  >
                    {x.name || 'Untitled'}
                  </button>
                ))}
              </div>
            )
          })}
          <div className="lxr-area">
            <div className="lxr-area-head">Orders</div>
            {formats.map((f) => (
              <button
                key={f.id}
                className={`side-item ${f.id === format?.id ? 'active' : ''}`}
                onClick={() => setSelId(orderFormatSelection(f.id))}
              >
                {f.name || 'Untitled'}
              </button>
            ))}
            <button className="side-item" onClick={() => addFormat(NEW_FORMAT)}>
              + New order format
            </button>
            <button className="side-item" onClick={() => addFormat(EQUIPMENT_LIST)}>
              + Equipment list
            </button>
          </div>
          <label className="lxr-new">
            <select
              value=""
              onChange={(e) =>
                e.target.value && add(blankTemplate(e.target.value as PaperworkSource))
              }
            >
              <option value="">+ New template for…</option>
              {(Object.keys(SOURCES) as PaperworkSource[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCES[s].label}
                </option>
              ))}
            </select>
          </label>
          {r && (
            <>
              <button
                className="btn"
                onClick={() => add({ ...r, id: crypto.randomUUID(), name: `${r.name} copy` })}
              >
                Duplicate
              </button>
              {isPreset && (
                <button className="btn" onClick={reset}>
                  Reset to default
                </button>
              )}
              {!bound && (
                <button className="btn btn-danger" onClick={remove}>
                  Delete
                </button>
              )}
            </>
          )}
          <p className="muted lxr-hint">Templates are shared by every show.</p>
        </aside>

        {format ? (
          <OrderFormatEditor
            key={format.id}
            format={format}
            items={orderItems}
            onChanged={refreshFormats}
            onDeleted={() => {
              void refreshFormats()
              setSelId(templates[0]?.id ?? '')
            }}
          />
        ) : r && built ? (
          <div className="lxr-main">
            {bound && (
              <p className="muted lxr-bound">
                Used by <b>{bound}</b> — changes here change that export.
              </p>
            )}
            <div className="lxr-settings">
              <label>
                Name
                <input value={r.name} onChange={(e) => update({ name: e.target.value })} />
              </label>
              <label>
                Rows
                <select
                  value={r.kind}
                  onChange={(e) => update({ kind: e.target.value as PaperworkTemplate['kind'] })}
                >
                  <option value="list">One per row</option>
                  <option value="count">Count (e.g. color schedule)</option>
                </select>
              </label>
              <label>
                Section by
                <select value={r.groupBy} onChange={(e) => update({ groupBy: e.target.value })}>
                  <option value="">— none —</option>
                  {fieldOptions}
                </select>
              </label>
              {[0, 1, 2].map((i) => (
                <label key={i}>
                  {i ? 'Then by' : 'Sort by'}
                  <select
                    value={r.sortBy[i] ?? ''}
                    onChange={(e) => {
                      const sortBy = [...r.sortBy]
                      sortBy[i] = e.target.value
                      update({ sortBy: sortBy.filter(Boolean) })
                    }}
                  >
                    <option value="">— none —</option>
                    {fieldOptions}
                  </select>
                </label>
              ))}
              <label title="Merge repeated values down the first N columns into one cell (e.g. a device and its ports)">
                Merge repeats
                <input
                  type="number"
                  min={0}
                  max={r.columns.length}
                  value={r.mergeRepeats}
                  disabled={r.kind === 'count'}
                  onChange={(e) =>
                    update({
                      mergeRepeats: Math.min(
                        r.columns.length,
                        Math.max(0, Number(e.target.value) || 0)
                      )
                    })
                  }
                />
              </label>
              <label>
                Page
                <select
                  value={r.orientation}
                  onChange={(e) =>
                    update({ orientation: e.target.value as PaperworkTemplate['orientation'] })
                  }
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label>
                Text size
                <input
                  type="number"
                  min={7}
                  max={20}
                  value={r.fontSize}
                  onChange={(e) =>
                    update({ fontSize: Math.min(20, Math.max(7, Number(e.target.value) || 11)) })
                  }
                />
              </label>
            </div>

            <div className="lxr-colbar">
              <button
                className="btn"
                onClick={() => {
                  update({
                    columns: [...r.columns, { field: 'blank', label: 'Notes', width: 120 }]
                  })
                  setColIdx(r.columns.length)
                }}
              >
                + Column
              </button>
              {col && colIdx != null ? (
                <>
                  <label>
                    Shows
                    <select
                      value={col.field}
                      onChange={(e) =>
                        setCol(colIdx, {
                          field: e.target.value,
                          // keep a custom heading, follow the field otherwise
                          label:
                            col.label === fieldLabel(r.source, col.field)
                              ? fieldLabel(r.source, e.target.value)
                              : col.label
                        })
                      }
                    >
                      {fieldOptions}
                    </select>
                  </label>
                  <label>
                    Heading
                    <input
                      value={col.label}
                      onChange={(e) => setCol(colIdx, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    Width
                    <input
                      type="number"
                      min={30}
                      value={col.width}
                      onChange={(e) =>
                        setCol(colIdx, { width: Math.max(30, Number(e.target.value) || 30) })
                      }
                    />
                  </label>
                  <button className="btn" onClick={() => moveCol(colIdx, -1)} title="Move left">
                    ←
                  </button>
                  <button className="btn" onClick={() => moveCol(colIdx, 1)} title="Move right">
                    →
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      update({ columns: r.columns.filter((_, j) => j !== colIdx) })
                      setColIdx(null)
                    }}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="muted">
                  Click a heading to change it · drag any column edge to resize
                </span>
              )}
            </div>

            <div className="lxr-preview" style={{ fontSize: r.fontSize }}>
              <style>{tableStyleCss(tableStyle, '.lxr-table')}</style>
              {built.sections.length === 0 && (
                <p className="lxr-empty">
                  {rows.length === 0
                    ? `No ${SOURCES[r.source].label.toLowerCase()} in this show yet.`
                    : r.kind === 'count'
                      ? `Nothing has a ${r.columns[0]?.label || 'value'} yet.`
                      : 'Nothing to list.'}
                </p>
              )}
              {built.sections.map((s, si) => (
                <div key={si}>
                  {s.title && (
                    <h3>
                      {s.color && <span className="lxr-sw" style={{ background: s.color }} />}
                      {s.title} <span className="lxr-count">({s.count})</span>
                    </h3>
                  )}
                  {s.note && <div className="lxr-note">{s.note}</div>}
                  <table
                    className="lxr-table"
                    style={{
                      width: built.widths.reduce((a, b) => a + b, 0),
                      cursor: edge != null ? 'col-resize' : undefined
                    }}
                    onMouseMove={(e) => !dragging.current && setEdge(edgeAt(e))}
                    onMouseLeave={() => !dragging.current && setEdge(null)}
                    onMouseDown={(e) => {
                      const i = edgeAt(e)
                      if (i != null) startResize(e, i)
                    }}
                  >
                    <colgroup>
                      {built.widths.map((w, i) => (
                        <col
                          key={i}
                          className={i === edge ? 'lxr-col-edge' : ''}
                          style={{ width: w }}
                        />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {built.headers.map((h, i) => (
                          <th
                            key={i}
                            className={i === colIdx ? 'lxr-th-sel' : ''}
                            style={built.center[i] ? { textAlign: 'center' } : undefined}
                            onClick={() => i < r.columns.length && setColIdx(i)}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((row, ri) => (
                        <tr key={ri} className={s.bands ? `g${s.bands[ri]}` : undefined}>
                          {row.map((c, ci) => {
                            const span = s.spans?.[ri][ci] ?? 1
                            if (!span) return null
                            return (
                              <td
                                key={ci}
                                rowSpan={span > 1 ? span : undefined}
                                className={r.mergeRepeats > 0 && ci === 0 ? 'lxr-dcell' : undefined}
                                style={built.center[ci] ? { textAlign: 'center' } : undefined}
                              >
                                {c}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted">Make a template to start.</p>
        )}
      </div>
    </div>
  )
}

export default PaperworkPage
