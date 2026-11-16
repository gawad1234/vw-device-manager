import { useRef, useState } from 'react'
import type { CaseField, PackCase, PackCaseInput } from '../../../shared/types'
import Modal, { ModalDismiss, type ModalControl } from './Modal'
import Field from './Field'

interface Props {
  /** null = creating a new case */
  pcase: PackCase | null
  /** field names (tokens) used across the label templates, to pre-fill the editor */
  suggestedFields: string[]
  onClose: () => void
  onChanged: () => void
  onCreated: (id: number) => void
}

/** Merge the case's own fields with any template token it doesn't have yet. */
function seedFields(pcase: PackCase | null, suggested: string[]): CaseField[] {
  const existing = pcase?.fields ?? []
  const have = new Set(existing.map((f) => (f.label || '').trim().toLowerCase()))
  const extra = suggested
    .filter((t) => {
      const key = t.trim().toLowerCase()
      if (!key || have.has(key)) return false
      have.add(key)
      return true
    })
    .map((t) => ({ label: t, value: '' }))
  return [...existing, ...extra]
}

function CaseModal({
  pcase,
  suggestedFields,
  onClose,
  onChanged,
  onCreated
}: Props): React.JSX.Element {
  const [name, setName] = useState(pcase?.name ?? '')
  const [fields, setFields] = useState<CaseField[]>(() => seedFields(pcase, suggestedFields))
  const [contents, setContents] = useState(pcase?.contents ?? '')
  const [notes, setNotes] = useState(pcase?.notes ?? '')
  /** save failed (not about one field) */
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const [saving, setSaving] = useState(false)
  const modal = useRef<ModalControl>(null)

  function setField(i: number, patch: Partial<CaseField>): void {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  function addField(): void {
    setFields((prev) => [...prev, { label: '', value: '' }])
    modal.current?.markDirty()
  }
  function removeField(i: number): void {
    setFields((prev) => prev.filter((_, idx) => idx !== i))
    modal.current?.markDirty()
  }

  async function persist(): Promise<PackCase | null> {
    if (!name.trim()) {
      setNameError('Give the case a name, e.g. Case 1 — FOH.')
      return null
    }
    const input: PackCaseInput = {
      name: name.trim(),
      fields: fields.filter((f) => (f.label || '').trim() || (f.value || '').trim()),
      contents,
      notes: notes.trim() ? notes.trim() : null
    }
    return pcase ? window.api.cases.update(pcase.id, input) : window.api.cases.create(input)
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setSaving(true)
    let saved: PackCase | null
    try {
      saved = await persist()
    } catch (err) {
      setError(`Couldn’t save the case: ${(err as Error).message}`)
      return
    } finally {
      setSaving(false)
    }
    if (!saved) return
    modal.current?.markClean()
    onChanged()
    if (!pcase) onCreated(saved.id)
    else onClose()
  }

  async function handleDelete(): Promise<void> {
    if (!pcase) return
    if (!window.confirm(`Delete case "${pcase.name}"?`)) return
    await window.api.cases.remove(pcase.id)
    onChanged()
    onClose()
  }

  const footer = (
    <>
      {pcase && (
        <button type="button" className="btn btn-danger" onClick={handleDelete}>
          Delete…
        </button>
      )}
      <span className="footer-spacer" />
      <ModalDismiss />
      <button className="btn btn-primary" type="submit" form="case-form" disabled={saving}>
        {saving ? 'Saving…' : pcase ? 'Save case' : 'Create case'}
      </button>
    </>
  )

  return (
    <Modal
      title={pcase ? pcase.name : 'New case'}
      onClose={onClose}
      footer={footer}
      controlRef={modal}
    >
      <form id="case-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error span-2">{error}</div>}
        <Field label="Case name" className="span-2" error={nameError}>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError('')
            }}
            placeholder="e.g. Case 1 — FOH"
            autoFocus
          />
        </Field>

        <div className="span-2">
          <div className="field-row-head">
            <span>Fields</span>
            <button type="button" className="btn btn-small" onClick={addField}>
              + Field
            </button>
          </div>
          <p className="muted" style={{ margin: '2px 0 8px' }}>
            Values for this case. The rows below are pre-filled from the <code>{'{tokens}'}</code>{' '}
            your label templates use — just fill in the values. Add your own with{' '}
            <strong>+ Field</strong>; a template pulls any field by a matching{' '}
            <code>{'{Field name}'}</code> token.
          </p>
          {fields.length === 0 ? (
            <p className="muted">No fields yet.</p>
          ) : (
            <div className="case-field-head" aria-hidden="true">
              <span>Field name</span>
              <span>Value</span>
            </div>
          )}
          {fields.map((f, i) => (
            <div className="case-field-row" key={i}>
              <input
                className="case-field-label"
                aria-label={`Field ${i + 1} name`}
                value={f.label}
                onChange={(e) => setField(i, { label: e.target.value })}
                placeholder="Label (e.g. Truck Number)"
              />
              <input
                className="case-field-value"
                aria-label={f.label.trim() ? `${f.label.trim()} value` : `Field ${i + 1} value`}
                value={f.value}
                onChange={(e) => setField(i, { value: e.target.value })}
                placeholder="Value"
              />
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => removeField(i)}
                aria-label={
                  f.label.trim() ? `Remove field ${f.label.trim()}` : `Remove field ${i + 1}`
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <label className="span-2">
          Contents
          <textarea
            value={contents}
            onChange={(e) => setContents(e.target.value)}
            rows={6}
            placeholder={'One item per line, e.g.\nMac Pro\n2× SDI cable\nPDU'}
          />
          <small className="muted">
            Printed wherever a template has a <code>{'{Contents}'}</code> token.
          </small>
        </label>

        <label className="span-2">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Internal notes (not printed)"
          />
        </label>
      </form>
    </Modal>
  )
}

export default CaseModal
