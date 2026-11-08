import { useMemo, useState } from 'react'
import type { Circuit } from '../../../shared/types'
import Modal from './Modal'
import { openPaperwork } from '../lib/paperwork'

interface Props {
  circuits: Circuit[]
  onClose: () => void
}

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Patching › Patch sheets: pick devices, print one page each (what plugs into it, where it goes). */
function PatchSheetModal({ circuits, onClose }: Props): React.JSX.Element {
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of circuits)
      for (const name of new Set([c.srcName, c.dstName].filter(Boolean)))
        m.set(name, (m.get(name) ?? 0) + 1)
    return m
  }, [circuits])
  const devices = useMemo(() => [...counts.keys()].sort(byName), [counts])
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
        doc: 'patchsheet',
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
      <button className="btn" type="button" onClick={() => openPaperwork('patchsheet')}>
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
    <Modal title="Patch sheets" onClose={onClose} footer={footer}>
      <p className="muted" style={{ marginTop: 0 }}>
        One page per device: its inputs and outputs, with where each one comes from and goes to.
        Hand them to anyone patching without the app.
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
              <span className="muted">{counts.get(d)}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">No device matches.</li>}
      </ul>
    </Modal>
  )
}

export default PatchSheetModal
