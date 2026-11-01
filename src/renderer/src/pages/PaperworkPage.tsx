import { useEffect, useRef, useState } from 'react'
import type { Fixture } from '../../../shared/types'
import {
  buildReport,
  fieldLabel,
  REPORT_FIELDS,
  type LightingReport,
  type ReportColumn
} from '../../../shared/lighting-reports'
import { DEFAULT_TABLE_STYLE, tableStyleCss } from '../../../shared/table-style'

const blankReport = (): LightingReport => ({
  id: crypto.randomUUID(),
  name: 'New report',
  kind: 'list',
  columns: [
    { field: 'channel', label: 'Chan', width: 60 },
    { field: 'position', label: 'Position', width: 140 },
    { field: 'unit', label: 'Unit', width: 50 }
  ],
  groupBy: '',
  sortBy: ['channel'],
  orientation: 'portrait',
  fontSize: 11
})

/** Lighting › Paperwork: build report templates (your own columns, drag to size) and export them. */
function PaperworkPage(): React.JSX.Element {
  const [reports, setReports] = useState<LightingReport[]>([])
  const [selId, setSelId] = useState('')
  const [colIdx, setColIdx] = useState<number | null>(null)
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [busy, setBusy] = useState('')
  const [tableStyle, setTableStyle] = useState(DEFAULT_TABLE_STYLE)
  // the column whose right edge is under the pointer (or being dragged)
  const [edge, setEdge] = useState<number | null>(null)
  const dragging = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.api.tableStyle.get().then(setTableStyle)
    window.api.lightingReports.list().then((l) => {
      setReports(l)
      setSelId(l[0]?.id ?? '')
    })
    const loadFixtures = (): void => {
      window.api.fixtures.list().then(setFixtures)
    }
    loadFixtures()
    return window.api.onDataChanged(loadFixtures)
  }, [])

  // every edit saves a moment later (a column drag is many edits)
  const commit = (next: LightingReport[]): void => {
    setReports(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.api.lightingReports.saveAll(next), 600)
  }
  const r = reports.find((x) => x.id === selId)
  const update = (patch: Partial<LightingReport>): void => {
    if (r) commit(reports.map((x) => (x.id === r.id ? { ...r, ...patch } : x)))
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

  function add(copyOf?: LightingReport): void {
    const n = copyOf
      ? { ...copyOf, id: crypto.randomUUID(), name: `${copyOf.name} copy` }
      : blankReport()
    commit([...reports, n])
    setSelId(n.id)
    setColIdx(null)
  }

  function remove(): void {
    if (!r || !confirm(`Delete the "${r.name}" template?`)) return
    const next = reports.filter((x) => x.id !== r.id)
    commit(next)
    setSelId(next[0]?.id ?? '')
    setColIdx(null)
  }

  async function exportAs(format: 'pdf' | 'xlsx' | 'csv'): Promise<void> {
    if (!r) return
    setBusy(format)
    try {
      await window.api.lightingReports.export(r, format)
    } finally {
      setBusy('')
    }
  }

  const built = r ? buildReport(r, fixtures) : null
  const col = r && colIdx != null ? r.columns[colIdx] : undefined
  const fieldOptions = REPORT_FIELDS.map((f) => (
    <option key={f.key} value={f.key}>
      {f.label}
    </option>
  ))

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
          {reports.map((x) => (
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
          <button className="btn" onClick={() => add()}>
            + New template
          </button>
          {r && (
            <>
              <button className="btn" onClick={() => add(r)}>
                Duplicate
              </button>
              <button className="btn btn-danger" onClick={remove}>
                Delete
              </button>
            </>
          )}
          <p className="muted lxr-hint">Templates are shared by every show.</p>
        </aside>

        {r && built ? (
          <div className="lxr-main">
            <div className="lxr-settings">
              <label>
                Name
                <input value={r.name} onChange={(e) => update({ name: e.target.value })} />
              </label>
              <label>
                Rows
                <select
                  value={r.kind}
                  onChange={(e) => update({ kind: e.target.value as LightingReport['kind'] })}
                >
                  <option value="list">One per fixture</option>
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
              {[0, 1].map((i) => (
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
              <label>
                Page
                <select
                  value={r.orientation}
                  onChange={(e) =>
                    update({ orientation: e.target.value as LightingReport['orientation'] })
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
                    columns: [...r.columns, { field: 'notes', label: 'Notes', width: 120 }]
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
                            col.label === fieldLabel(col.field)
                              ? fieldLabel(e.target.value)
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
                  {fixtures.length === 0
                    ? 'No fixtures in this show yet.'
                    : r.kind === 'count'
                      ? `No fixture has a ${r.columns[0]?.label || 'value'} yet.`
                      : 'Nothing to list.'}
                </p>
              )}
              {built.sections.map((s, si) => (
                <div key={si}>
                  {s.title && <h3>{s.title}</h3>}
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
                            onClick={() => i < r.columns.length && setColIdx(i)}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((c, ci) => (
                            <td key={ci}>{c}</td>
                          ))}
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
