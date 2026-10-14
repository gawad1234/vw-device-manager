import { useEffect, useState } from 'react'
import type { LabelElement, LabelTemplate, LabelTemplateInput } from '../../../shared/types'
import Modal from './Modal'

const LABEL_W = 8.5
const LABEL_H = 5.5
const SCALE = 68 // px per inch in the editor canvas

const uid = (): string => Math.random().toString(36).slice(2, 10)
const round2 = (v: number): number => Math.round(v * 100) / 100
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function defaultElement(type: LabelElement['type']): LabelElement {
  const base = { id: uid(), x: 0.5, y: 0.5 }
  if (type === 'text')
    return { ...base, type, w: 4, h: 0.8, text: 'Text', fontSize: 28, bold: true, align: 'left', color: '#111111' }
  if (type === 'showname')
    return { ...base, type, w: 5, h: 0.6, fontSize: 26, bold: true, align: 'left', color: '#111111' }
  if (type === 'logo') return { ...base, type, w: 2.6, h: 1.2 }
  if (type === 'line') return { ...base, type, w: 4, h: 0.04, color: '#111111' }
  return { ...base, type: 'rect', w: 3, h: 1.5, fill: null, color: '#111111', borderWidth: 2 }
}

/** Turn an older fixed-layout template into editable elements so nothing is lost. */
function legacyToElements(t: LabelTemplate, showText: string): LabelElement[] {
  const els: LabelElement[] = []
  if (t.color) els.push({ id: uid(), type: 'rect', x: 0, y: 0, w: 0.28, h: LABEL_H, fill: t.color, color: t.color, borderWidth: 0 })
  let y = 0.4
  if (t.showName && showText) {
    els.push({ id: uid(), type: 'text', x: 0.5, y, w: 7.5, h: 0.3, text: showText, fontSize: 14, bold: false, align: 'left', color: '#555555' })
    y += 0.4
  }
  if (t.title) {
    els.push({ id: uid(), type: 'text', x: 0.5, y, w: 7.6, h: 0.9, text: t.title, fontSize: 42, bold: true, align: 'left', color: '#111111' })
    y += 1.0
  }
  for (const f of t.fields) {
    if ((f.label || '').trim() || (f.value || '').trim()) {
      els.push({ id: uid(), type: 'text', x: 0.5, y, w: 7.6, h: 0.35, text: `${f.label}: ${f.value}`, fontSize: 16, bold: false, align: 'left', color: '#222222' })
      y += 0.42
    }
  }
  return els
}

interface Props {
  template: LabelTemplate | null
  /** for a new template seeded from a preset */
  initialName?: string
  initialElements?: LabelElement[]
  onClose: () => void
  onChanged: () => void
  onCreated: (id: number) => void
}

function LabelModal({
  template,
  initialName,
  initialElements,
  onClose,
  onChanged,
  onCreated
}: Props): React.JSX.Element {
  const [name, setName] = useState(template?.name ?? '')
  const [elements, setElements] = useState<LabelElement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copies, setCopies] = useState(2)
  const [projectShow, setProjectShow] = useState('')
  const [logo, setLogo] = useState<string | null>(null)

  // Project show name + logo, for rendering the bound showname/logo elements.
  useEffect(() => {
    window.api.showName.get().then((n) => setProjectShow(n ?? ''))
    window.api.showLogo.get().then(setLogo)
  }, [])

  // Seed the canvas: existing elements, a preset, a legacy conversion, or a title.
  useEffect(() => {
    let cancelled = false
    async function seed(): Promise<void> {
      if (template?.elements && template.elements.length) {
        if (!cancelled) setElements(template.elements)
      } else if (template) {
        const showText = (await window.api.showName.get()) ?? ''
        const els = legacyToElements(template, showText)
        if (!cancelled) setElements(els)
      } else if (initialElements && initialElements.length) {
        if (!cancelled) setElements(initialElements)
      } else {
        if (!cancelled)
          setElements([
            { id: uid(), type: 'text', x: 0.5, y: 0.45, w: 7.5, h: 1, text: 'TITLE', fontSize: 44, bold: true, align: 'left', color: '#111111' }
          ])
      }
    }
    setName(template?.name ?? initialName ?? '')
    setSelectedId(null)
    setError(null)
    seed()
    return () => {
      cancelled = true
    }
  }, [template?.id])

  const selected = elements.find((e) => e.id === selectedId) ?? null

  function patchEl(id: string, patch: Partial<LabelElement>): void {
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  function addEl(type: LabelElement['type']): void {
    const el = defaultElement(type)
    setElements((prev) => [...prev, el])
    setSelectedId(el.id)
  }
  function removeEl(id: string): void {
    setElements((prev) => prev.filter((e) => e.id !== id))
    setSelectedId(null)
  }
  function duplicateEl(id: string): void {
    const el = elements.find((e) => e.id === id)
    if (!el) return
    const copy = { ...el, id: uid(), x: round2(clamp(el.x + 0.2, 0, LABEL_W - el.w)), y: round2(clamp(el.y + 0.2, 0, LABEL_H - el.h)) }
    setElements((prev) => [...prev, copy])
    setSelectedId(copy.id)
  }

  function startDrag(e: React.MouseEvent, id: string, mode: 'move' | 'resize'): void {
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(id)
    const el = elements.find((x) => x.id === id)
    if (!el) return
    const start = { mx: e.clientX, my: e.clientY, x: el.x, y: el.y, w: el.w, h: el.h }
    const onMove = (ev: MouseEvent): void => {
      const dx = (ev.clientX - start.mx) / SCALE
      const dy = (ev.clientY - start.my) / SCALE
      setElements((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p
          if (mode === 'move')
            return { ...p, x: round2(clamp(start.x + dx, 0, LABEL_W - p.w)), y: round2(clamp(start.y + dy, 0, LABEL_H - p.h)) }
          return { ...p, w: round2(clamp(start.w + dx, 0.1, LABEL_W - p.x)), h: round2(clamp(start.h + dy, 0.04, LABEL_H - p.y)) }
        })
      )
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function currentInput(): LabelTemplateInput {
    // Freeform templates store everything in elements; legacy fields are cleared.
    return { name: name.trim(), title: '', color: null, showName: false, fields: [], elements }
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
        <input type="number" min={1} max={200} value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))} />
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
      <form id="label-form" onSubmit={save} style={{ marginBottom: 14, maxWidth: 360 }}>
        {error && <div className="banner banner-error">{error}</div>}
        <label className="label-name-field">
          Template name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Road case" autoFocus />
        </label>
      </form>

      <div className="lc-toolbar">
        <button type="button" className="btn btn-small" onClick={() => addEl('text')}>
          + Text
        </button>
        <button type="button" className="btn btn-small" onClick={() => addEl('rect')}>
          + Box
        </button>
        <button type="button" className="btn btn-small" onClick={() => addEl('line')}>
          + Line
        </button>
        <button type="button" className="btn btn-small" onClick={() => addEl('showname')} title="Bound to the project's show name">
          + Show name
        </button>
        <button type="button" className="btn btn-small" onClick={() => addEl('logo')} title="Bound to the project's show logo">
          + Show logo
        </button>
        <span className="footer-spacer" />
        {selected && (
          <>
            <button type="button" className="btn btn-small" onClick={() => duplicateEl(selected.id)}>
              Duplicate
            </button>
            <button type="button" className="btn btn-small btn-danger" onClick={() => removeEl(selected.id)}>
              Delete element
            </button>
          </>
        )}
      </div>

      <div className="label-editor">
        <div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
            Canvas · 8.5&quot; × 5.5&quot; — drag to move, drag the corner to resize
          </div>
          <div className="label-preview-wrap">
            <div
              className="lc-canvas"
              style={{ width: LABEL_W * SCALE, height: LABEL_H * SCALE }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setSelectedId(null)
              }}
            >
              {elements.map((el) => {
                const style: React.CSSProperties = {
                  left: el.x * SCALE,
                  top: el.y * SCALE,
                  width: el.w * SCALE,
                  height: el.h * SCALE
                }
                const isText = el.type === 'text' || el.type === 'showname'
                if (isText) {
                  style.fontSize = (el.fontSize || 18) * (SCALE / 72)
                  style.fontWeight = el.bold ? 800 : 400
                  style.textAlign = el.align || 'left'
                  style.color = el.color || '#111'
                  style.lineHeight = 1.05
                } else if (el.type === 'line') {
                  style.background = el.color || '#111'
                } else if (el.type === 'rect') {
                  if (el.fill) style.background = el.fill
                  if (el.borderWidth) style.border = `${(el.borderWidth || 0) * (SCALE / 72)}px solid ${el.color || '#111'}`
                }
                const content =
                  el.type === 'showname' ? (
                    projectShow || '{Show name}'
                  ) : el.type === 'text' ? (
                    el.text
                  ) : el.type === 'logo' ? (
                    logo ? (
                      <img src={logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'left center' }} />
                    ) : (
                      <span className="lc-logo-ph">Show logo</span>
                    )
                  ) : null
                return (
                  <div
                    key={el.id}
                    className={`lc-el lc-${el.type}${selectedId === el.id ? ' selected' : ''}`}
                    style={style}
                    onMouseDown={(e) => startDrag(e, el.id, 'move')}
                  >
                    {content}
                    {selectedId === el.id && (
                      <span className="lc-handle" onMouseDown={(e) => startDrag(e, el.id, 'resize')} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="lc-props">
          {!selected && <p className="muted">Select an element to edit it, or add one above.</p>}
          {selected && (
            <>
              <div className="lc-prop-title">
                {selected.type === 'text'
                  ? 'Text'
                  : selected.type === 'showname'
                    ? 'Show name'
                    : selected.type === 'logo'
                      ? 'Show logo'
                      : selected.type === 'line'
                        ? 'Line'
                        : 'Box'}
              </div>
              {selected.type === 'showname' && (
                <>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Prints the project&rsquo;s show name (set it in Settings → Show branding).
                  </p>
                  <div className="lc-prop-row">
                    <label>
                      Size (pt)
                      <input type="number" min={6} max={200} value={selected.fontSize ?? 18} onChange={(e) => patchEl(selected.id, { fontSize: Number(e.target.value) })} />
                    </label>
                    <label>
                      Align
                      <select value={selected.align ?? 'left'} onChange={(e) => patchEl(selected.id, { align: e.target.value as LabelElement['align'] })}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  </div>
                  <div className="lc-prop-row">
                    <label className="checkbox-field">
                      <input type="checkbox" checked={!!selected.bold} onChange={(e) => patchEl(selected.id, { bold: e.target.checked })} />
                      Bold
                    </label>
                    <label>
                      Color
                      <input type="color" value={selected.color ?? '#111111'} onChange={(e) => patchEl(selected.id, { color: e.target.value })} />
                    </label>
                  </div>
                </>
              )}
              {selected.type === 'logo' && (
                <p className="muted" style={{ fontSize: 12 }}>
                  Prints the project&rsquo;s show logo (set it in Settings → Show branding). Position
                  and size it below.
                </p>
              )}
              {selected.type === 'text' && (
                <>
                  <label>
                    Text
                    <textarea
                      rows={2}
                      value={selected.text ?? ''}
                      onChange={(e) => patchEl(selected.id, { text: e.target.value })}
                    />
                  </label>
                  <div className="lc-prop-row">
                    <label>
                      Size (pt)
                      <input type="number" min={6} max={200} value={selected.fontSize ?? 18} onChange={(e) => patchEl(selected.id, { fontSize: Number(e.target.value) })} />
                    </label>
                    <label>
                      Align
                      <select value={selected.align ?? 'left'} onChange={(e) => patchEl(selected.id, { align: e.target.value as LabelElement['align'] })}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  </div>
                  <div className="lc-prop-row">
                    <label className="checkbox-field">
                      <input type="checkbox" checked={!!selected.bold} onChange={(e) => patchEl(selected.id, { bold: e.target.checked })} />
                      Bold
                    </label>
                    <label>
                      Color
                      <input type="color" value={selected.color ?? '#111111'} onChange={(e) => patchEl(selected.id, { color: e.target.value })} />
                    </label>
                  </div>
                </>
              )}
              {selected.type === 'line' && (
                <div className="lc-prop-row">
                  <label>
                    Color
                    <input type="color" value={selected.color ?? '#111111'} onChange={(e) => patchEl(selected.id, { color: e.target.value })} />
                  </label>
                  <label>
                    Thickness (pt)
                    <input type="number" min={1} max={72} value={round2((selected.h || 0) * 72)} onChange={(e) => patchEl(selected.id, { h: round2((Number(e.target.value) || 1) / 72) })} />
                  </label>
                </div>
              )}
              {selected.type === 'rect' && (
                <>
                  <div className="lc-prop-row">
                    <label className="checkbox-field">
                      <input type="checkbox" checked={!!selected.fill} onChange={(e) => patchEl(selected.id, { fill: e.target.checked ? selected.color || '#cccccc' : null })} />
                      Filled
                    </label>
                    {selected.fill && (
                      <label>
                        Fill
                        <input type="color" value={selected.fill ?? '#cccccc'} onChange={(e) => patchEl(selected.id, { fill: e.target.value })} />
                      </label>
                    )}
                  </div>
                  <div className="lc-prop-row">
                    <label>
                      Border color
                      <input type="color" value={selected.color ?? '#111111'} onChange={(e) => patchEl(selected.id, { color: e.target.value })} />
                    </label>
                    <label>
                      Border (pt)
                      <input type="number" min={0} max={20} value={selected.borderWidth ?? 0} onChange={(e) => patchEl(selected.id, { borderWidth: Number(e.target.value) })} />
                    </label>
                  </div>
                </>
              )}
              <div className="lc-prop-row">
                <label>
                  X (in)
                  <input type="number" step={0.1} value={selected.x} onChange={(e) => patchEl(selected.id, { x: round2(clamp(Number(e.target.value) || 0, 0, LABEL_W)) })} />
                </label>
                <label>
                  Y (in)
                  <input type="number" step={0.1} value={selected.y} onChange={(e) => patchEl(selected.id, { y: round2(clamp(Number(e.target.value) || 0, 0, LABEL_H)) })} />
                </label>
              </div>
              <div className="lc-prop-row">
                <label>
                  W (in)
                  <input type="number" step={0.1} value={selected.w} onChange={(e) => patchEl(selected.id, { w: round2(clamp(Number(e.target.value) || 0.1, 0.1, LABEL_W)) })} />
                </label>
                <label>
                  H (in)
                  <input type="number" step={0.1} value={selected.h} onChange={(e) => patchEl(selected.id, { h: round2(clamp(Number(e.target.value) || 0.04, 0.04, LABEL_H)) })} />
                </label>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default LabelModal
