import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Circuit } from '../../../shared/types'

type GroupBy = 'none' | 'device' | 'rack' | 'signal'
type StatusFilter = 'all' | 'unpatched' | 'patched' | 'untested'

function loc(rack: string, u: string, slot: string): string {
  return [rack, u && `U${u}`, slot && `slot ${slot}`].filter(Boolean).join(' · ')
}

function PatchingPage(): React.JSX.Element {
  const [circuits, setCircuits] = useState<Circuit[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [signal, setSignal] = useState('')
  const [rack, setRack] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('rack')

  const refresh = useCallback(async () => {
    setCircuits(await window.api.circuits.list())
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const signals = useMemo(
    () => Array.from(new Set(circuits.map((c) => c.signal).filter(Boolean))).sort(),
    [circuits]
  )
  const racks = useMemo(
    () =>
      Array.from(new Set(circuits.flatMap((c) => [c.srcRack, c.dstRack]).filter(Boolean))).sort(),
    [circuits]
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return circuits.filter((c) => {
      const full = c.srcPatched && c.dstPatched
      if (signal && c.signal !== signal) return false
      if (rack && c.srcRack !== rack && c.dstRack !== rack) return false
      if (status === 'patched' && !full) return false
      if (status === 'unpatched' && full) return false
      if (status === 'untested' && c.tested) return false
      if (needle) {
        const hay = `${c.cableNumber} ${c.signal} ${c.srcName} ${c.srcSocket} ${c.dstName} ${c.dstSocket}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [circuits, q, signal, rack, status])

  const fullyPatched = circuits.filter((c) => c.srcPatched && c.dstPatched).length
  const partlyPatched = circuits.filter((c) => (c.srcPatched || c.dstPatched) && !(c.srcPatched && c.dstPatched)).length
  const testedCount = circuits.filter((c) => c.tested).length

  async function patch(
    c: Circuit,
    changes: Partial<Pick<Circuit, 'srcPatched' | 'dstPatched' | 'tested' | 'notes'>>
  ): Promise<void> {
    // Turning tested ON implies both ends are patched.
    const forceBoth = changes.tested === true
    const updated = await window.api.circuits.setStatus(c.id, {
      srcPatched: forceBoth ? true : (changes.srcPatched ?? c.srcPatched),
      dstPatched: forceBoth ? true : (changes.dstPatched ?? c.dstPatched),
      tested: changes.tested ?? c.tested,
      notes: changes.notes !== undefined ? changes.notes : c.notes
    })
    setCircuits((prev) => prev.map((x) => (x.id === c.id ? updated : x)))
  }

  async function doImport(): Promise<void> {
    setBusy(true)
    try {
      const res = await window.api.circuits.import()
      if (res) {
        await refresh()
        setNote(
          res.added === 0 && res.updated === 0
            ? 'No circuits were recognized in that file — nothing changed. Check it is a ConnectCAD circuit report CSV.'
            : `Imported: ${res.added} added, ${res.updated} updated, ${res.removed} removed — ${res.total} circuits total.`
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function doClear(): Promise<void> {
    if (!window.confirm('Remove all imported circuits and their patch status?')) return
    await window.api.circuits.clear()
    await refresh()
    setNote(null)
  }

  // Build groups for rendering.
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: '', items: filtered }]
    const map = new Map<string, Circuit[]>()
    for (const c of filtered) {
      let keys: string[]
      if (groupBy === 'device') keys = Array.from(new Set([c.srcName, c.dstName].filter(Boolean)))
      else if (groupBy === 'rack') {
        keys = Array.from(new Set([c.srcRack, c.dstRack].filter(Boolean)))
        if (keys.length === 0) keys = ['—']
      } else keys = [c.signal || '—']
      for (const k of keys) {
        if (!map.has(k)) map.set(k, [])
        map.get(k)!.push(c)
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, items]) => ({ key, items }))
  }, [filtered, groupBy])

  return (
    <div className="page">
      <div className="page-header">
        <h2>Patching</h2>
        <div className="page-header-actions">
          {circuits.length > 0 && (
            <button className="btn" onClick={doClear} disabled={busy}>
              Clear
            </button>
          )}
          <button className="btn btn-primary" onClick={doImport} disabled={busy}>
            {busy ? 'Importing…' : circuits.length ? 'Re-import report…' : 'Import circuit report…'}
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 12, maxWidth: 760 }}>
        Import a ConnectCAD <strong>Circuit Report</strong> (CSV) from Vectorworks, then check off
        each connection as you <strong>patch</strong> and <strong>test</strong> it. Re-importing
        updates the list from the drawing and keeps your checkmarks.
      </p>

      {note && <div className="banner banner-info">{note}</div>}

      {!loading && circuits.length === 0 ? (
        <div className="empty-cell" style={{ padding: 24 }}>
          No circuits yet. In Vectorworks, export an <em>All Layers Circuit Report</em> to CSV, then
          <strong> Import circuit report…</strong>
        </div>
      ) : (
        <>
          <div className="patch-stats">
            <span className="pill ok">{fullyPatched}/{circuits.length} fully patched</span>
            {partlyPatched > 0 && <span className="pill warn">{partlyPatched} one end only</span>}
            <span className="pill">{testedCount}/{circuits.length} tested</span>
            <span className="muted">{filtered.length} shown</span>
          </div>

          <div className="patch-filters">
            <input
              type="text"
              placeholder="Filter device / socket / cable #…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select value={signal} onChange={(e) => setSignal(e.target.value)}>
              <option value="">All signals</option>
              {signals.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select value={rack} onChange={(e) => setRack(e.target.value)}>
              <option value="">All racks</option>
              {racks.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">All</option>
              <option value="unpatched">Not patched</option>
              <option value="patched">Patched</option>
              <option value="untested">Not tested</option>
            </select>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="rack">Group by rack</option>
              <option value="device">Group by device</option>
              <option value="signal">Group by signal</option>
              <option value="none">No grouping</option>
            </select>
          </div>

          {groups.map((g) => (
            <div key={g.key || 'all'} className="patch-group">
              {groupBy !== 'none' && (
                <h3 className="patch-group-head">
                  {g.key || '—'} <span className="muted">({g.items.length})</span>
                </h3>
              )}
              <table className="table patch-table">
                <thead>
                  <tr>
                    <th>Cable</th>
                    <th>Signal</th>
                    <th className="chk">From&nbsp;✓</th>
                    <th>From</th>
                    <th>To</th>
                    <th className="chk">To&nbsp;✓</th>
                    <th className="chk">Tested</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((c) => {
                    const full = c.srcPatched && c.dstPatched
                    const partial = (c.srcPatched || c.dstPatched) && !full
                    return (
                      <tr key={c.id} className={full ? 'is-patched' : partial ? 'is-partial' : ''}>
                        <td className="muted mono">{c.cableNumber || '—'}</td>
                        <td className="mono">{c.signal}</td>
                        <td className="chk">
                          <input
                            type="checkbox"
                            checked={c.srcPatched}
                            title="Source end patched"
                            onChange={(e) => patch(c, { srcPatched: e.target.checked })}
                          />
                        </td>
                        <td>
                          <span className="name">{c.srcName}</span>
                          <span className="sub2">{c.srcSocket}{c.srcConnector ? ` (${c.srcConnector})` : ''}</span>
                          {c.srcRack && <span className="sub2">{loc(c.srcRack, c.srcRackU, c.srcSlot)}</span>}
                        </td>
                        <td>
                          <span className="name">{c.dstName}</span>
                          <span className="sub2">{c.dstSocket}{c.dstConnector ? ` (${c.dstConnector})` : ''}</span>
                          {c.dstRack && <span className="sub2">{loc(c.dstRack, c.dstRackU, c.dstSlot)}</span>}
                        </td>
                        <td className="chk">
                          <input
                            type="checkbox"
                            checked={c.dstPatched}
                            title="Destination end patched"
                            onChange={(e) => patch(c, { dstPatched: e.target.checked })}
                          />
                        </td>
                        <td className="chk">
                          <input
                            type="checkbox"
                            checked={c.tested}
                            title="Tested end-to-end (marks both ends patched)"
                            onChange={(e) => patch(c, { tested: e.target.checked })}
                          />
                        </td>
                        <td>
                          <input
                            className="patch-note"
                            type="text"
                            defaultValue={c.notes ?? ''}
                            placeholder="—"
                            onBlur={(e) => {
                              const v = e.target.value.trim() || null
                              if (v !== (c.notes ?? null)) patch(c, { notes: v })
                            }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default PatchingPage
