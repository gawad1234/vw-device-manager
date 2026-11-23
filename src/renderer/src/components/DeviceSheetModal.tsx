import { useMemo, useState } from 'react'
import Modal from './Modal'
import { openPaperwork } from '../lib/paperwork'

interface Props {
  doc: 'patchsheet' | 'checklist'
  title: string
  intro: string
  /** device name → a short note shown beside it (connection count, category) */
  notes: Map<string, string>
  onClose: () => void
}

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Pick devices, print one page each (patch sheets, provisioning checklists). */
function DeviceSheetModal({ doc, title, intro, notes, onClose }: Props): React.JSX.Element {
  const devices = useMemo(() => [...notes.keys()].sort(byName), [notes])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shown = devices.filter((d) => d.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = (d: string): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

  async function run(format: 'pdf' | 'xlsx' | 'csv'): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.api.exports.run({
        scope: 'all',
        doc,
        format,
        // print in list order, not click order
        devices: devices.filter((d) => picked.has(d))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <>
      <button className="btn" type="button" onClick={() => openPaperwork(doc)}>
        Edit layout…
      </button>
      <span className="footer-spacer" />
      {(['pdf', 'xlsx', 'csv'] as const).map((f) => (
        <button
          key={f}
          className={`btn${f === 'pdf' ? ' btn-primary' : ''}`}
          disabled={busy || picked.size === 0}
          onClick={() => run(f)}
        >
          {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
        </button>
      ))}
    </>
  )

  return (
    <Modal title={title} onClose={onClose} footer={footer}>
      <p className="muted" style={{ marginTop: 0 }}>
        {intro}
      </p>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="ps-pick-bar">
        <input
          className="search"
          placeholder="Find a device…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button
          className="btn btn-small"
          onClick={() => setPicked((prev) => new Set([...prev, ...shown]))}
        >
          Select {q ? 'shown' : 'all'}
        </button>
        <button className="btn btn-small" onClick={() => setPicked(new Set())}>
          Clear
        </button>
        <span className="muted">{picked.size} selected</span>
      </div>
      <ul className="ps-pick">
        {shown.map((d) => (
          <li key={d}>
            <label>
              <input type="checkbox" checked={picked.has(d)} onChange={() => toggle(d)} />
              <span>{d}</span>
              <span className="muted">{notes.get(d)}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">No device matches.</li>}
      </ul>
    </Modal>
  )
}

export default DeviceSheetModal
