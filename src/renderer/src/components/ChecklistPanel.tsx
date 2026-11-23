import { useEffect, useRef, useState } from 'react'
import {
  BASE_FIELDS,
  PHASES,
  SIGNOFFS,
  TRIGGERS,
  type ChecklistStep,
  type ChecklistTrigger,
  type Signoff
} from '../../../shared/checklist'
import { openPaperwork } from '../lib/paperwork'
import Field from './Field'

/** Settings › Provisioning checklist: the step library every device's checklist is built from,
 *  grouped by phase the way the printed sheet is. */
function ChecklistPanel(): React.JSX.Element {
  const [steps, setSteps] = useState<ChecklistStep[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.api.checklistSteps.get().then(setSteps)
  }, [])

  // typing fires on every key: save once it settles
  function save(next: ChecklistStep[]): void {
    setSteps(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => window.api.checklistSteps.set(next), 400)
  }
  const change = (i: number, patch: Partial<ChecklistStep>): void =>
    save(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  /** Swap with the next step up/down in the same phase (the sheet's order within a phase). */
  function move(i: number, by: -1 | 1): void {
    let j = i + by
    while (j >= 0 && j < steps.length && steps[j].phase !== steps[i].phase) j += by
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }
  function add(phase: number, id: string): void {
    const step: ChecklistStep = {
      id,
      phase,
      title: '',
      trigger: 'always',
      detail: '',
      signoff: 'check',
      categories: []
    }
    // after the phase's last step, so it lands at the bottom of its group
    const last = steps.map((s) => s.phase).lastIndexOf(phase)
    save(
      last < 0 ? [...steps, step] : [...steps.slice(0, last + 1), step, ...steps.slice(last + 1)]
    )
  }
  async function reset(): Promise<void> {
    if (!confirm('Replace every step with the built-in defaults?')) return
    if (timer.current) clearTimeout(timer.current)
    setSteps(await window.api.checklistSteps.set(null))
  }

  return (
    <div className="panel">
      <div className="ck-head">
        <h3>Provisioning checklist</h3>
        <button className="btn btn-small" onClick={() => openPaperwork('checklist')}>
          Edit layout…
        </button>
        <button className="btn btn-small" onClick={() => void reset()}>
          Reset to defaults
        </button>
      </div>
      <p className="muted">
        The steps on each device’s checklist (Devices › ⋯ › Provisioning checklists). A step only
        prints when the device has what <em>Appears when</em> needs, one line per port, connection
        or install where that applies. In <em>Detail</em>, <code>{'{field}'}</code> is filled in and
        a <code>[bracketed part]</code> drops out when its fields are empty. Blank{' '}
        <em>Categories</em> (comma-separated) = every device. Shared across all projects.
      </p>

      {PHASES.map((name, p) => {
        const phase = p + 1
        const rows = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.phase === phase)
        return (
          <section key={name} className="ck-phase">
            <div className="ck-phase-head">
              <span>
                {phase}. {name}
              </span>
              <button className="btn btn-small" onClick={() => add(phase, `step-${Date.now()}`)}>
                + Add step
              </button>
            </div>
            {rows.length === 0 && (
              <div className="muted ck-empty">No steps: left off every sheet.</div>
            )}
            {rows.map(({ s, i }, k) => (
              <div key={s.id} className="ck-step">
                <Field label="Step" className="ck-title">
                  <input
                    value={s.title}
                    placeholder="e.g. Lock GUI output to 1920×1080"
                    onChange={(e) => change(i, { title: e.target.value })}
                  />
                </Field>
                <Field label="Appears when" className="ck-trigger">
                  <select
                    value={s.trigger}
                    onChange={(e) => change(i, { trigger: e.target.value as ChecklistTrigger })}
                  >
                    {Object.entries(TRIGGERS).map(([key, t]) => (
                      <option key={key} value={key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Phase" className="ck-phase-sel">
                  <select
                    value={s.phase}
                    onChange={(e) => change(i, { phase: Number(e.target.value) })}
                  >
                    {PHASES.map((ph, n) => (
                      <option key={ph} value={n + 1}>
                        {n + 1}. {ph}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sign-off" className="ck-signoff">
                  <select
                    value={s.signoff}
                    onChange={(e) => change(i, { signoff: e.target.value as Signoff })}
                  >
                    {Object.entries(SIGNOFFS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="ck-actions">
                  <button
                    className="btn btn-small"
                    aria-label={`Move ${s.title || 'step'} up`}
                    disabled={k === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn-small"
                    aria-label={`Move ${s.title || 'step'} down`}
                    disabled={k === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="btn btn-small btn-danger"
                    aria-label={`Remove ${s.title || 'step'}`}
                    onClick={() => save(steps.filter((_, n) => n !== i))}
                  >
                    Remove
                  </button>
                </div>
                <Field
                  label="Detail (optional)"
                  className="ck-detail"
                  hint={[...TRIGGERS[s.trigger].fields, ...BASE_FIELDS]
                    .map((f) => `{${f}}`)
                    .join('  ')}
                >
                  <input
                    className="mono"
                    value={s.detail}
                    onChange={(e) => change(i, { detail: e.target.value })}
                  />
                </Field>
                <Field label="Categories" className="ck-cats">
                  <input
                    key={s.categories.join(',')} // a reset or reorder shows the new value
                    placeholder="All devices"
                    // shortcut: free text split on commas; a category picker if typos become a problem
                    defaultValue={s.categories.join(', ')}
                    onBlur={(e) =>
                      change(i, {
                        categories: e.target.value
                          .split(',')
                          .map((c) => c.trim())
                          .filter(Boolean)
                      })
                    }
                  />
                </Field>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export default ChecklistPanel
