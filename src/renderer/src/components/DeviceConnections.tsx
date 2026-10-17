import { useEffect, useState } from 'react'
import type { Circuit } from '../../../shared/types'

/**
 * Read-only-ish list of the circuits that land on one device (imported on the
 * Patching tab). Each row shows this device's socket, what it connects to, and
 * patched/tested checkboxes + a note — the same status the Patching tab edits.
 */
function DeviceConnections({ deviceName }: { deviceName: string }): React.JSX.Element {
  const [circuits, setCircuits] = useState<Circuit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.circuits
      .list()
      .then((all) =>
        setCircuits(all.filter((c) => c.srcName === deviceName || c.dstName === deviceName))
      )
      .finally(() => setLoading(false))
  }, [deviceName])

  async function patch(c: Circuit, changes: Partial<Pick<Circuit, 'srcPatched' | 'dstPatched' | 'tested' | 'notes'>>): Promise<void> {
    const forceBoth = changes.tested === true // testing implies both ends patched
    const updated = await window.api.circuits.setStatus(c.id, {
      srcPatched: forceBoth ? true : (changes.srcPatched ?? c.srcPatched),
      dstPatched: forceBoth ? true : (changes.dstPatched ?? c.dstPatched),
      tested: changes.tested ?? c.tested,
      notes: changes.notes !== undefined ? changes.notes : c.notes
    })
    setCircuits((prev) => prev.map((x) => (x.id === c.id ? updated : x)))
  }

  if (loading) return <p className="muted">Loading…</p>
  if (circuits.length === 0)
    return (
      <p className="muted">
        No circuits for this device. Import a ConnectCAD circuit report on the <strong>Patching</strong> tab.
      </p>
    )

  const thisEndPatched = circuits.filter((c) => (c.srcName === deviceName ? c.srcPatched : c.dstPatched)).length
  return (
    <>
      <p className="muted" style={{ marginTop: -4, marginBottom: 8 }}>
        {thisEndPatched}/{circuits.length} patched at this device
      </p>
      <table className="table patch-table">
        <thead>
          <tr>
            <th>This socket</th>
            <th className="chk">Patched</th>
            <th>Connects to</th>
            <th className="chk">Far end</th>
            <th>Signal</th>
            <th className="chk">Tested</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {circuits.map((c) => {
            const isSrc = c.srcName === deviceName
            const mySocket = isSrc ? c.srcSocket : c.dstSocket
            const otherName = isSrc ? c.dstName : c.srcName
            const otherSocket = isSrc ? c.dstSocket : c.srcSocket
            const myPatched = isSrc ? c.srcPatched : c.dstPatched
            const farPatched = isSrc ? c.dstPatched : c.srcPatched
            const setMine = (v: boolean): Promise<void> =>
              patch(c, isSrc ? { srcPatched: v } : { dstPatched: v })
            return (
              <tr key={c.id} className={myPatched && farPatched ? 'is-patched' : myPatched || farPatched ? 'is-partial' : ''}>
                <td>
                  <span className="name">{mySocket || '—'}</span>
                  {c.cableNumber && <span className="sub2 mono">{c.cableNumber}</span>}
                </td>
                <td className="chk">
                  <input type="checkbox" checked={myPatched} onChange={(e) => setMine(e.target.checked)} />
                </td>
                <td>
                  <span className="name">{otherName || '—'}</span>
                  <span className="sub2">{otherSocket}</span>
                </td>
                <td className="chk" title={farPatched ? 'Far end patched' : 'Far end not patched'}>
                  {farPatched ? '✓' : '—'}
                </td>
                <td>{c.signal}</td>
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
    </>
  )
}

export default DeviceConnections
