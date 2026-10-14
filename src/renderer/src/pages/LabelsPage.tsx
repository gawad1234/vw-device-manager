import { useCallback, useEffect, useRef, useState } from 'react'
import type { LabelElement, LabelTemplate } from '../../../shared/types'
import LabelModal from '../components/LabelModal'
import { LABEL_PRESETS } from '../lib/labelPresets'

function LabelsPage(): React.JSX.Element {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [openId, setOpenId] = useState<number | 'new' | null>(null)
  const [pending, setPending] = useState<{ name: string; elements: LabelElement[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    setTemplates(await window.api.labels.list())
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (typeof openId === 'number' && !templates.some((t) => t.id === openId)) setOpenId(null)
  }, [templates, openId])

  const openTemplate =
    openId === 'new'
      ? null
      : typeof openId === 'number'
        ? (templates.find((t) => t.id === openId) ?? null)
        : null

  function startNew(name: string, elements: LabelElement[]): void {
    setPending({ name, elements })
    setOpenId('new')
    setMenuOpen(false)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Case labels</h2>
        <div className="page-header-actions">
          <div className="project-menu" ref={menuRef}>
            <button className="btn btn-primary" onClick={() => setMenuOpen((v) => !v)}>
              + New label <span className="caret">▾</span>
            </button>
            {menuOpen && (
              <div className="project-dropdown export-dropdown">
                <div className="menu-label">Start from</div>
                <button className="menu-item" onClick={() => startNew('', [])}>
                  Blank
                </button>
                <div className="menu-sep" />
                <div className="menu-label">Templates</div>
                {LABEL_PRESETS.map((p) => (
                  <button key={p.key} className="menu-item" onClick={() => startNew(p.suggested, p.build())}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 18, maxWidth: 720 }}>
        Design reusable case-label templates on a freeform canvas (text, boxes, lines, your show
        name &amp; logo), then print them on <strong>Uline S-19323</strong> sheets (8.5&quot; ×
        5.5&quot;, two per page).
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Template</th>
            <th>Elements</th>
          </tr>
        </thead>
        <tbody>
          {!loading && templates.length === 0 && (
            <tr>
              <td colSpan={2} className="empty-cell">
                No label templates yet — start from Blank or a template above.
              </td>
            </tr>
          )}
          {templates.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => setOpenId(t.id)}>
              <td>{t.name}</td>
              <td className="muted">{t.elements.length || t.fields.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {openId != null && (
        <LabelModal
          template={openTemplate}
          initialName={openId === 'new' ? (pending?.name ?? '') : undefined}
          initialElements={openId === 'new' ? (pending?.elements ?? []) : undefined}
          onClose={() => {
            setOpenId(null)
            setPending(null)
          }}
          onChanged={refresh}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}

export default LabelsPage
