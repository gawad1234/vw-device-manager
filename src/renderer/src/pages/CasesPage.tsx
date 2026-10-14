import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LabelTemplate, PackCase } from '../../../shared/types'
import CaseModal from '../components/CaseModal'

/** Tokens the templates fill in automatically — not user-defined case fields. */
const RESERVED_TOKENS = new Set(['case', 'contents', 'show'])

/**
 * Collect every `{Field name}` token used across the label templates (in text
 * elements, titles, and legacy field values), minus the reserved ones. The
 * result seeds the case editor so you only have to type values.
 */
function collectTemplateTokens(templates: LabelTemplate[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const scan = (text: string | null | undefined): void => {
    if (!text) return
    for (const m of text.matchAll(/\{([^}]+)\}/g)) {
      const name = m[1].trim()
      const key = name.toLowerCase()
      if (!name || RESERVED_TOKENS.has(key) || seen.has(key)) continue
      seen.add(key)
      out.push(name)
    }
  }
  for (const t of templates) {
    scan(t.title)
    for (const el of t.elements) if (el.type === 'text') scan(el.text)
    for (const f of t.fields) scan(f.value)
  }
  return out
}

function CasesPage(): React.JSX.Element {
  const [cases, setCases] = useState<PackCase[]>([])
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [openId, setOpenId] = useState<number | 'new' | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [copies, setCopies] = useState<Record<number, number>>({})
  const [templateId, setTemplateId] = useState<number | ''>('')
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)

  const copiesFor = (id: number): number => copies[id] ?? 1
  function setCopiesFor(id: number, n: number): void {
    setCopies((prev) => ({ ...prev, [id]: Math.max(1, Math.min(99, Math.trunc(n) || 1)) }))
  }

  const refresh = useCallback(async () => {
    const [cs, ts] = await Promise.all([window.api.cases.list(), window.api.labels.list()])
    setCases(cs)
    setTemplates(ts)
    setTemplateId((prev) => (prev !== '' && ts.some((t) => t.id === prev) ? prev : (ts[0]?.id ?? '')))
    setSelected((prev) => new Set([...prev].filter((id) => cs.some((c) => c.id === id))))
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const openCase = openId === 'new' || openId == null ? null : (cases.find((c) => c.id === openId) ?? null)
  const templateTokens = useMemo(() => collectTemplateTokens(templates), [templates])

  function toggle(id: number): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll(): void {
    setSelected((prev) => (prev.size === cases.length ? new Set() : new Set(cases.map((c) => c.id))))
  }

  // Total labels = each selected case repeated by its copy count.
  const totalLabels = cases
    .filter((c) => selected.has(c.id))
    .reduce((sum, c) => sum + copiesFor(c.id), 0)

  async function printLabels(): Promise<void> {
    if (templateId === '' || selected.size === 0) return
    // keep the on-screen order; repeat each case's id by its copy count.
    // listCasesByIds preserves duplicate ids, so repeats print as separate labels.
    const ids = cases
      .filter((c) => selected.has(c.id))
      .flatMap((c) => Array<number>(copiesFor(c.id)).fill(c.id))
    setPrinting(true)
    try {
      await window.api.labels.printCases(templateId, ids)
    } finally {
      setPrinting(false)
    }
  }

  const allChecked = cases.length > 0 && selected.size === cases.length

  return (
    <div className="page">
      <div className="page-header">
        <h2>Cases</h2>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setOpenId('new')}>
            + New case
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 14, maxWidth: 720 }}>
        Track what&apos;s packed in each road case, then print labels for them from any template on
        the <strong>Labels</strong> tab. Templates fill in each case with <code>{'{Case}'}</code>,{' '}
        <code>{'{Contents}'}</code>, <code>{'{Show}'}</code>, and any <code>{'{Field name}'}</code>{' '}
        you add to the case.
      </p>

      {templates.length > 0 && (
        <div className="print-bar">
          <label>
            Template
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            onClick={printLabels}
            disabled={printing || templateId === '' || selected.size === 0}
          >
            {printing ? 'Printing…' : `Print labels (${totalLabels})…`}
          </button>
          {selected.size === 0 && <span className="muted">Select cases to print.</span>}
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
            </th>
            <th>Case</th>
            <th>Fields</th>
            <th>Contents</th>
            <th style={{ width: 90 }}>Copies</th>
          </tr>
        </thead>
        <tbody>
          {!loading && cases.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-cell">
                No cases yet — add one with “+ New case”.
              </td>
            </tr>
          )}
          {cases.map((c) => {
            const items = c.contents.split('\n').map((l) => l.trim()).filter(Boolean)
            return (
              <tr key={c.id} className="clickable">
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`Select ${c.name}`}
                  />
                </td>
                <td onClick={() => setOpenId(c.id)}>{c.name}</td>
                <td className="muted" onClick={() => setOpenId(c.id)}>
                  {c.fields.length}
                </td>
                <td className="muted" onClick={() => setOpenId(c.id)}>
                  {items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : '—'}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    className="case-copies"
                    type="number"
                    min={1}
                    max={99}
                    value={copiesFor(c.id)}
                    onChange={(e) => setCopiesFor(c.id, Number(e.target.value))}
                    aria-label={`Copies of ${c.name}`}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {templates.length === 0 && !loading && (
        <p className="muted" style={{ marginTop: 14 }}>
          Create a label template on the <strong>Labels</strong> tab to print case labels.
        </p>
      )}

      {openId != null && (
        <CaseModal
          pcase={openCase}
          suggestedFields={templateTokens}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}

export default CasesPage
