import { useEffect, useState } from 'react'
import type {
  CrewAssignment,
  CrewDay,
  CrewMember,
  CrewRates,
  ScheduleMeta
} from '../../../shared/types'
import { crewTotals, dateRange } from '../../../shared/crew-cost'
import CrewDirectoryModal from '../components/CrewDirectoryModal'
import RatesFields from '../components/RatesFields'

const PHASES = ['Load-in', 'Tech', 'Rehearsal', 'Preview', 'Show', 'Strike', 'Dark', 'Travel']
const money = (n: number): string =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const dayLabel = (d: string): [string, string] => {
  const dt = new Date(d + 'T12:00:00')
  return [
    dt.toLocaleDateString(undefined, { weekday: 'short' }),
    `${dt.getMonth() + 1}/${dt.getDate()}`
  ]
}
const rateSummary = (r: CrewRates): string =>
  r.rateType === 'day'
    ? `${money(r.dayRate)}/day`
    : `${money(r.hourlyRate)}/h, OT after ${r.otAfterHours}h`

/** Schedule › Crew: who's booked on this show, their days (work/off + call times), phases and cost. */
function CrewPage(): React.JSX.Element {
  const [directory, setDirectory] = useState<CrewMember[]>([])
  const [rows, setRows] = useState<CrewAssignment[]>([])
  const [meta, setMeta] = useState<ScheduleMeta>({ start: '', end: '', phases: {} })
  const [sel, setSel] = useState<{ id: number; date: string | null } | null>(null)
  const [showDirectory, setShowDirectory] = useState(false)

  const loadDirectory = (): void => void window.api.crew.directory().then(setDirectory)
  useEffect(() => {
    loadDirectory()
    window.api.crew.assignments().then(setRows)
    window.api.crew.getSchedule().then(setMeta)
  }, [])

  const dates = dateRange(meta.start, meta.end)
  const person = (a: CrewAssignment): CrewMember | undefined =>
    directory.find((m) => m.id === a.crewId)
  const unbooked = directory.filter((m) => !rows.some((a) => a.crewId === m.id))

  function saveMeta(next: ScheduleMeta): void {
    setMeta(next)
    window.api.crew.setSchedule(next)
  }

  async function saveRow(next: CrewAssignment): Promise<void> {
    setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)))
    const { id, ...input } = next
    await window.api.crew.updateAssignment(id, input)
  }

  async function book(crewId: string): Promise<void> {
    const m = directory.find((x) => x.id === Number(crewId))
    if (!m) return
    const a = await window.api.crew.assign({
      crewId: m.id,
      role: m.role,
      rateType: m.rateType,
      dayRate: m.dayRate,
      hourlyRate: m.hourlyRate,
      otAfterHours: m.otAfterHours,
      otMultiplier: m.otMultiplier,
      days: {},
      notes: ''
    })
    setRows((rs) => [...rs, a])
    setSel({ id: a.id, date: null })
  }

  async function unbook(a: CrewAssignment): Promise<void> {
    if (!window.confirm(`Remove ${person(a)?.name ?? 'this person'} from this show's schedule?`))
      return
    await window.api.crew.unassign(a.id)
    setRows((rs) => rs.filter((r) => r.id !== a.id))
    setSel(null)
  }

  function setDay(a: CrewAssignment, date: string, day: CrewDay | null): void {
    const days = { ...a.days }
    if (day) days[date] = day
    else delete days[date]
    saveRow({ ...a, days })
  }

  const totals = rows.map((a) => crewTotals(a, Object.values(a.days)))
  const grand = totals.reduce(
    (s, t) => ({ days: s.days + t.workDays, hours: s.hours + t.hours, cost: s.cost + t.cost }),
    { days: 0, hours: 0, cost: 0 }
  )
  const selRow = sel ? rows.find((r) => r.id === sel.id) : undefined
  const selDay = selRow && sel?.date ? selRow.days[sel.date] : undefined

  return (
    <div className="page">
      <div className="page-header">
        <h2>Crew</h2>
        <div className="page-header-actions">
          <button className="btn" onClick={() => setShowDirectory(true)}>
            Crew directory…
          </button>
        </div>
      </div>

      <div className="sched-toolbar">
        <label>
          From{' '}
          <input
            type="date"
            value={meta.start}
            onChange={(e) => saveMeta({ ...meta, start: e.target.value })}
          />
        </label>
        <label>
          To{' '}
          <input
            type="date"
            value={meta.end}
            onChange={(e) => saveMeta({ ...meta, end: e.target.value })}
          />
        </label>
        <select value="" onChange={(e) => book(e.target.value)} disabled={!unbooked.length}>
          <option value="">
            {directory.length ? '+ Book crew…' : 'Add people in the Crew directory first'}
          </option>
          {unbooked.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.role ? ` — ${m.role}` : ''}
            </option>
          ))}
        </select>
      </div>

      {!dates.length ? (
        <p className="muted">Set the show&rsquo;s From / To dates to see the schedule grid.</p>
      ) : (
        <div className="sched-wrap">
          <table className="sched-grid">
            <thead>
              <tr>
                <th className="sched-name">Crew</th>
                {dates.map((d) => {
                  const [w, md] = dayLabel(d)
                  return (
                    <th key={d}>
                      {w}
                      <br />
                      {md}
                    </th>
                  )
                })}
                <th>Days</th>
                <th>Hours</th>
                <th>Cost</th>
              </tr>
              <tr className="sched-phase">
                <th className="sched-name">Phase</th>
                {dates.map((d) => (
                  <td key={d}>
                    <input
                      list="sched-phases"
                      value={meta.phases[d] ?? ''}
                      onChange={(e) => {
                        const phases = { ...meta.phases, [d]: e.target.value }
                        if (!e.target.value) delete phases[d]
                        setMeta({ ...meta, phases })
                      }}
                      onBlur={() => saveMeta(meta)}
                    />
                  </td>
                ))}
                <td colSpan={3} />
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => {
                const t = totals[i]
                return (
                  <tr key={a.id}>
                    <th
                      className={`sched-name clickable${sel?.id === a.id && !sel.date ? ' sel' : ''}`}
                      onClick={() => setSel({ id: a.id, date: null })}
                    >
                      {person(a)?.name ?? '(removed from directory)'}
                      <small className="muted">
                        {a.role ? `${a.role} · ` : ''}
                        {rateSummary(a)}
                      </small>
                    </th>
                    {dates.map((d) => {
                      const day = a.days[d]
                      return (
                        <td
                          key={d}
                          className={`sched-cell ${day?.status ?? ''}${sel?.id === a.id && sel.date === d ? ' sel' : ''}`}
                          onClick={() => setSel({ id: a.id, date: d })}
                        >
                          {day?.status === 'work'
                            ? day.call
                              ? `${day.call}–${day.end}`
                              : 'Work'
                            : day
                              ? 'Off'
                              : ''}
                        </td>
                      )
                    })}
                    <td>{t.workDays}</td>
                    <td
                      title={t.untimedDays ? `${t.untimedDays} work day(s) without call times` : ''}
                    >
                      {t.hours ? t.hours.toFixed(1) : '—'}
                      {t.otHours > 0 && (
                        <small className="muted"> ({t.otHours.toFixed(1)} OT)</small>
                      )}
                      {t.untimedDays > 0 && ' ⚠'}
                    </td>
                    <td>{money(t.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className="sched-name">Total</th>
                <td colSpan={dates.length} />
                <td>{grand.days}</td>
                <td>{grand.hours ? grand.hours.toFixed(1) : '—'}</td>
                <td>{money(grand.cost)}</td>
              </tr>
            </tfoot>
          </table>
          <datalist id="sched-phases">
            {PHASES.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
      )}

      {selRow && sel?.date && (
        <div className="sched-editor">
          <strong>
            {person(selRow)?.name} · {dayLabel(sel.date).join(' ')}
          </strong>
          <div className="sched-editor-row">
            {(['work', 'off'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`tab${selDay?.status === s ? ' active' : ''}`}
                onClick={() =>
                  setDay(selRow, sel.date!, { call: '', end: '', ...selDay, status: s })
                }
              >
                {s === 'work' ? 'Working' : 'Off'}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setDay(selRow, sel.date!, null)}
            >
              Clear
            </button>
            {selDay?.status === 'work' && (
              <>
                <label>
                  Call{' '}
                  <input
                    type="time"
                    value={selDay.call}
                    onChange={(e) => setDay(selRow, sel.date!, { ...selDay, call: e.target.value })}
                  />
                </label>
                <label>
                  End{' '}
                  <input
                    type="time"
                    value={selDay.end}
                    onChange={(e) => setDay(selRow, sel.date!, { ...selDay, end: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-small"
                  title="Use these call/end times on every day this person is working"
                  onClick={() => {
                    const days = Object.fromEntries(
                      Object.entries(selRow.days).map(([d, v]) => [
                        d,
                        v.status === 'work' ? { ...v, call: selDay.call, end: selDay.end } : v
                      ])
                    )
                    saveRow({ ...selRow, days })
                  }}
                >
                  Copy times to all their work days
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {selRow && !sel?.date && (
        <div className="sched-editor">
          <strong>{person(selRow)?.name} — rates for this show</strong>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label>
              Role
              <input
                value={selRow.role}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r) => (r.id === selRow.id ? { ...r, role: e.target.value } : r))
                  )
                }
                onBlur={() => saveRow(selRow)}
              />
            </label>
            <RatesFields
              value={selRow}
              onChange={(r) => {
                const next = { ...selRow, ...r }
                // the rate-type select has no blur-save, so save that change right away
                if (r.rateType !== selRow.rateType) saveRow(next)
                else setRows((rs) => rs.map((x) => (x.id === selRow.id ? next : x)))
              }}
              onBlur={() => saveRow(selRow)}
            />
          </div>
          <button
            type="button"
            className="btn btn-small btn-danger"
            style={{ marginTop: 10 }}
            onClick={() => unbook(selRow)}
          >
            Remove from this show
          </button>
        </div>
      )}

      {showDirectory && (
        <CrewDirectoryModal onClose={() => setShowDirectory(false)} onChanged={loadDirectory} />
      )}
    </div>
  )
}

export default CrewPage
