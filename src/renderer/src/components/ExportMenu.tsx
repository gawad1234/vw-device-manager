import { useEffect, useRef, useState } from 'react'
import type { ExportOptions } from '../../../shared/types'

interface Props {
  scope: 'bundle' | 'all'
  bundleId?: number
  label?: string
  /** open the dropdown upward (for use in a modal footer near the bottom) */
  dropUp?: boolean
}

interface Item {
  label: string
  doc: ExportOptions['doc']
  format: ExportOptions['format']
  labelStyle?: ExportOptions['labelStyle']
}

// Sensible document → format offerings (labels are PDF-only, in two styles).
const SECTIONS: { label: string; items: Item[] }[] = [
  {
    label: 'Pull sheet',
    items: [
      { label: 'PDF', doc: 'pullsheet', format: 'pdf' },
      { label: 'Excel', doc: 'pullsheet', format: 'xlsx' },
      { label: 'CSV', doc: 'pullsheet', format: 'csv' }
    ]
  },
  {
    label: 'Cable schedule',
    items: [
      { label: 'Excel', doc: 'schedule', format: 'xlsx' },
      { label: 'CSV', doc: 'schedule', format: 'csv' },
      { label: 'PDF', doc: 'schedule', format: 'pdf' }
    ]
  },
  {
    label: 'Cable labels',
    items: [
      { label: 'Cards (PDF)', doc: 'labels', format: 'pdf', labelStyle: 'cards' },
      { label: 'Wrap flags (PDF)', doc: 'labels', format: 'pdf', labelStyle: 'flag' }
    ]
  }
]

function ExportMenu({ scope, bundleId, label = 'Export', dropUp }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function run(item: Item): Promise<void> {
    setBusy(true)
    try {
      await window.api.exports.run({
        scope,
        bundleId,
        doc: item.doc,
        format: item.format,
        labelStyle: item.labelStyle
      })
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div className="project-menu" ref={ref}>
      <button className="btn btn-small" onClick={() => setOpen((v) => !v)} disabled={busy}>
        {busy ? 'Exporting…' : label} <span className="caret">▾</span>
      </button>
      {open && (
        <div className={`project-dropdown export-dropdown${dropUp ? ' drop-up' : ''}`}>
          {SECTIONS.map((s, i) => (
            <div key={s.label}>
              {i > 0 && <div className="menu-sep" />}
              <div className="menu-label">{s.label}</div>
              {s.items.map((it) => (
                <button key={it.label} className="menu-item" onClick={() => run(it)}>
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ExportMenu
