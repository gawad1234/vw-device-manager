import { useEffect, useState } from 'react'
import type { LabelField, LabelTemplate, LabelTemplateInput } from '../../../shared/types'
import Modal from './Modal'

const LABEL_COLORS = [
  '#e0685f',
  '#e0954f',
  '#e0c24f',
  '#6fd06f',
  '#4fc0c0',
  '#3b6fe0',
  '#9b6fe0',
  '#e06fb0',
  '#222222'
]

interface Props {
  template: LabelTemplate | null
  onClose: () => void
  onChanged: () => void
  onCreated: (id: number) => void
}

function LabelModal({ template, onClose, onChanged, onCreated }: Props): React.JSX.Element {
  const [name, setName] = useState(template?.name ?? '')
  const [title, setTitle] = useState(template?.title ?? '')
  const [color, setColor] = useState<string | null>(template?.color ?? null)
  const [showName, setShowName] = useState(template?.showName ?? true)
  const [fields, setFields] = useState<LabelField[]>(template?.fields ?? [])
  const [error, setError] = useState<string | null>(null)
  const [copies, setCopies] = useState(2)
  const [projectShow, setProjectShow] = useState('')
  const [logo, setLogo] = useState<string | null>(null)

  useEffect(() => {
    window.api.showName.get().then((n) => setProjectShow(n ?? ''))
    window.api.showLogo.get().then(setLogo)
  }, [])

  useEffect(() => {
    setName(template?.name ?? '')
    setTitle(template?.title ?? '')
    setColor(template?.color ?? null)
    setShowName(template?.showName ?? true)
    setFields(template?.fields ?? [])
    setError(null)
  }, [template?.id])

  function patchField(i: number, patch: Partial<LabelField>): void {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  function removeField(i: number): void {
    setFields((prev) => prev.filter((_, idx) => idx !== i))
  }
  function addField(): void {
    setFields((prev) => [...prev, { label: '', value: '' }])
  }

  function currentInput(): LabelTemplateInput {
    return { name: name.trim(), title: title.trim(), color, showName, fields }
  }

  async function persist(): Promise<LabelTemplate | null> {
    if (!name.trim()) {
      setError('Template name is required.')
      return null
    }
    setError(null)
    return template
      ? window.api.labels.update(template.id, currentInput())
      : window.api.labels.create(currentInput())
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const saved = await persist()
    if (!saved) return
    onChanged()
    if (!template) onCreated(saved.id)
    else onClose()
  }

  async function print(): Promise<void> {
    const saved = await persist()
    if (!saved) return
    onChanged()
    if (!template) onCreated(saved.id)
    await window.api.labels.print(saved.id, copies)
  }

  async function handleDelete(): Promise<void> {
    if (!template) return
    if (!window.confirm(`Delete label template "${template.name}"?`)) return
    await window.api.labels.remove(template.id)
    onChanged()
    onClose()
  }

  const shownFields = fields.filter((f) => (f.label || '').trim() || (f.value || '').trim())

  const footer = (
    <>
      {template && (
        <button className="btn btn-danger" onClick={handleDelete}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <label className="copies-field">
        Copies
        <input
          type="number"
          min={1}
          max={200}
          value={copies}
          onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
      <button className="btn" type="button" onClick={print} disabled={!name.trim()}>
        Print PDF…
      </button>
      <button className="btn" type="button" onClick={onClose}>
        Close
      </button>
      <button className="btn btn-primary" type="submit" form="label-form">
        {template ? 'Save changes' : 'Create template'}
      </button>
    </>
  )

  return (
    <Modal title={template ? template.name : 'New label template'} onClose={onClose} footer={footer} wide>
      <div className="label-editor">
        <form id="label-form" className="label-fields-col" onSubmit={save}>
          {error && <div className="banner banner-error">{error}</div>}
          <label>
            Template name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Road case" autoFocus />
          </label>
          <label>
            Title (big line)
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. VIDEO WORLD" />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            Show the project show name on the label
          </label>
          <label>
            Accent color
            <div className="swatch-picker">
              <button
                type="button"
                className={`swatch-option none ${color == null ? 'selected' : ''}`}
                onClick={() => setColor(null)}
                title="No color"
              />
              {LABEL_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch-option ${color === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </label>

          <div className="label-field-rows">
            <div className="muted" style={{ fontSize: 12.5 }}>
              Fields (define your own — caption + value)
            </div>
            {fields.map((f, i) => (
              <div className="label-field-row" key={i}>
                <input
                  value={f.label}
                  placeholder="Caption (e.g. Contents)"
                  onChange={(e) => patchField(i, { label: e.target.value })}
                />
                <input
                  value={f.value}
                  placeholder="Value"
                  onChange={(e) => patchField(i, { value: e.target.value })}
                />
                <button type="button" className="btn btn-small btn-danger" onClick={() => removeField(i)}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-small" onClick={addField}>
              + Add field
            </button>
          </div>
        </form>

        <div className="label-preview-col">
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
            Preview · 8.5&quot; × 5.5&quot;
          </div>
          <div className="label-preview-wrap">
            <div className="label-preview">
              {color && <div className="lp-band" style={{ background: color }} />}
              <div className="lp-body">
                {(showName && projectShow) || logo ? (
                  <div className="lp-top">
                    <span className="lp-show">{showName ? projectShow : ''}</span>
                    {logo && <img className="lp-logo" src={logo} alt="" />}
                  </div>
                ) : null}
                <div className="lp-title">{title || 'TITLE'}</div>
                <div className="lp-fields">
                  {shownFields.map((f, i) => (
                    <div className="lp-f" key={i}>
                      <span className="lp-k">{f.label}</span>
                      <span>{f.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default LabelModal
