import { useCallback, useEffect, useState } from 'react'
import type { LabelTemplate } from '../../../shared/types'
import LabelModal from '../components/LabelModal'

function LabelsPage(): React.JSX.Element {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [openId, setOpenId] = useState<number | 'new' | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setTemplates(await window.api.labels.list())
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    if (typeof openId === 'number' && !templates.some((t) => t.id === openId)) setOpenId(null)
  }, [templates, openId])

  const openTemplate =
    openId === 'new'
      ? null
      : typeof openId === 'number'
        ? (templates.find((t) => t.id === openId) ?? null)
        : null

  return (
    <div className="page">
      <div className="page-header">
        <h2>Case labels</h2>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setOpenId('new')}>
            + New label
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 18, maxWidth: 720 }}>
        Build reusable case-label templates with your own fields, then print them on{' '}
        <strong>Uline S-19323</strong> sheets (8.5&quot; × 5.5&quot;, two labels per page).
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Template</th>
            <th>Title</th>
            <th>Fields</th>
          </tr>
        </thead>
        <tbody>
          {!loading && templates.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-cell">
                No label templates yet — create one to design and print case labels.
              </td>
            </tr>
          )}
          {templates.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => setOpenId(t.id)}>
              <td>
                {t.color && (
                  <span className="bundle-dot" style={{ background: t.color }} aria-hidden />
                )}
                {t.name}
              </td>
              <td className="muted">{t.title || '—'}</td>
              <td className="muted">{t.fields.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {openId != null && (
        <LabelModal
          template={openTemplate}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}

export default LabelsPage
