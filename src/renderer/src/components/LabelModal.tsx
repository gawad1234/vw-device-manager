import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LabelElement, LabelTemplate, LabelTemplateInput } from '../../../shared/types'
import { BUNDLE_COLOR } from '../../../shared/sticker-sheet'
import Modal from './Modal'

// Case labels are 8.5" x 5.5"; sticker designs pass their own size.
const LABEL_W = 8.5
const LABEL_H = 5.5
const CASE_SCALE = 68 // px per inch in the editor canvas for case labels

/** The editor preview shows a sticker's "bundle color" as a neutral grey. */
const previewColor = (c: string | null | undefined): string | undefined =>
  c === BUNDLE_COLOR ? '#8a8a8a' : (c ?? undefined)

/** Text rendered inside its box, matching the print renderer: wrap, and a live
 *  shrink-to-fit when auto-size is on (so the preview tracks what prints). */
function CanvasText({
  el,
  text,
  scale
}: {
  el: LabelElement
  text: string
  scale: number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const baseFs = (el.fontSize || 18) * (scale / 72)
  const [fs, setFs] = useState(baseFs)

  useLayoutEffect(() => {
    const inner = ref.current
    if (!el.autoSize || !inner) {
      setFs(baseFs)
      return
    }
    const box = inner.parentElement
    if (!box) return
    let size = baseFs
    let guard = 0
    inner.style.fontSize = size + 'px'
    while (
      guard++ < 200 &&
      size > 4 &&
      (inner.scrollHeight > box.clientHeight + 1 || inner.scrollWidth > box.clientWidth + 1)
    ) {
      size = Math.max(4, size - Math.max(0.5, size * 0.05))
      inner.style.fontSize = size + 'px'
    }
    setFs(size)
  }, [el.autoSize, el.text, el.w, el.h, el.fontSize, el.bold, el.wrap, baseFs, text])

  return (
    <div
      ref={ref}
      style={{
        width: '100%',
        fontSize: fs,
        fontWeight: el.bold ? 800 : 400,
        textAlign: el.align || 'left',
        color: previewColor(el.color) || '#111',
        lineHeight: 1.1,
        wordBreak: 'break-word',
        whiteSpace: el.wrap === false ? 'pre' : 'pre-wrap'
      }}
    >
      {text}
    </div>
  )
}

const uid = (): string => Math.random().toString(36).slice(2, 10)
const round2 = (v: number): number => Math.round(v * 100) / 100
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function defaultElement(type: LabelElement['type'], w: number, h: number): LabelElement {
  // Small labels (stickers): fit the new element inside the label instead.
  if (w < 4) {
    const base = { id: uid(), x: 0.04, y: 0.04 }
    if (type === 'text' || type === 'showname')
      return { ...base, type, w: w - 0.08, h: Math.min(0.3, h - 0.08), text: type === 'text' ? '{Cable}' : undefined, fontSize: 10, bold: true, align: 'left', color: '#111111', autoSize: true }
    if (type === 'logo') return { ...base, type, w: Math.min(0.6, w / 3), h: h - 0.08 }
    if (type === 'line') return { ...base, type, w: w - 0.08, h: 0.02, color: '#111111' }
    return { ...base, type: 'rect', x: 0, y: 0, w, h, fill: null, color: '#111111', borderWidth: 1 }
  }
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

/** Sticker mode: design a cable-loom sticker of the given size instead of a case label. */
export interface StickerEditing {
  name: string
  elements: LabelElement[]
  size: { w: number; h: number }
  /** shown under the title, e.g. the sheet type */
  subtitle: string
  /** save; returns false to stay open (e.g. on error) */
  onSave: (name: string, elements: LabelElement[]) => Promise<boolean>
  /** delete; resolves true if it went ahead (the editor then closes) */
  onDelete?: () => Promise<boolean>
}

const STICKER_TOKENS = ['{Cable}', '{This end}', '{Other end}', '{From}', '{To}', '{Type}', '{Length}', '{Bundle}', '{End}', '{Notes}', '{Show}']

interface Props {
  template: LabelTemplate | null
  sticker?: StickerEditing
  /** for a new template seeded from a preset */
  initialName?: string
  initialElements?: LabelElement[]
  onClose: () => void
  onChanged: () => void
  onCreated: (id: number) => void
}

function LabelModal({
  template,
  sticker,
  initialName,
  initialElements,
  onClose,
  onChanged,
  onCreated
}: Props): React.JSX.Element {
  const W = sticker?.size.w ?? LABEL_W
  const H = sticker?.size.h ?? LABEL_H
  // fit a small sticker to a ~640 x 400 px canvas; case labels keep their usual zoom
  const SCALE = sticker ? Math.min(640 / W, 400 / H) : CASE_SCALE
  const [name, setName] = useState(sticker?.name ?? template?.name ?? '')
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
      if (sticker) {
        if (!cancelled) setElements(sticker.elements)
      } else if (template?.elements && template.elements.length) {
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
    setName(sticker?.name ?? template?.name ?? initialName ?? '')
    setSelectedId(null)
    setError(null)
    seed()
    return () => {
      cancelled = true
    }
  }, [template?.id])

  const selected = elements.find((e) => e.id === selectedId) ?? null

  /** A color picker for the selected element; stickers can also use the cable's bundle color. */
  const colorInput = (key: 'color' | 'fill', fallback: string): React.JSX.Element => {
    const v = selected?.[key]
    const isBundle = v === BUNDLE_COLOR
    return (
      <>
        <input
          type="color"
          value={v && !isBundle ? v : fallback}
          disabled={isBundle}
          onChange={(e) => selected && patchEl(selected.id, { [key]: e.target.value })}
        />
        {sticker && (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={isBundle}
              onChange={(e) =>
                selected && patchEl(selected.id, { [key]: e.target.checked ? BUNDLE_COLOR : fallback })
              }
            />
            Bundle color
          </label>
        )}
      </>
    )
  }

  function patchEl(id: string, patch: Partial<LabelElement>): void {
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  function addEl(type: LabelElement['type']): void {
    const el = defaultElement(type, W, H)
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
    const copy = { ...el, id: uid(), x: round2(clamp(el.x + 0.2, 0, W - el.w)), y: round2(clamp(el.y + 0.2, 0, H - el.h)) }
    setElements((prev) => [...prev, copy])
    setSelectedId(copy.id)
  }

  // Stacking order — the array order is the paint order (last = on top).
  function reorderEl(id: string, dir: 'front' | 'back' | 'forward' | 'backward'): void {
    setElements((prev) => {
      const i = prev.findIndex((e) => e.id === id)
      if (i < 0) return prev
      const arr = [...prev]
      const [it] = arr.splice(i, 1)
      if (dir === 'front') arr.push(it)
      else if (dir === 'back') arr.unshift(it)
      else if (dir === 'forward') arr.splice(Math.min(arr.length, i + 1), 0, it)
      else arr.splice(Math.max(0, i - 1), 0, it)
      return arr
    })
  }

  // Align the selected element to the label edges / center.
  function alignEl(where: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void {
    if (!selectedId) return
    setElements((prev) =>
      prev.map((p) => {
        if (p.id !== selectedId) return p
        if (where === 'left') return { ...p, x: 0 }
        if (where === 'hcenter') return { ...p, x: round2(clamp((W - p.w) / 2, 0, W)) }
        if (where === 'right') return { ...p, x: round2(clamp(W - p.w, 0, W)) }
        if (where === 'top') return { ...p, y: 0 }
        if (where === 'vcenter') return { ...p, y: round2(clamp((H - p.h) / 2, 0, H)) }
        return { ...p, y: round2(clamp(H - p.h, 0, H)) }
      })
    )
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
            return { ...p, x: round2(clamp(start.x + dx, 0, W - p.w)), y: round2(clamp(start.y + dy, 0, H - p.h)) }
          return { ...p, w: round2(clamp(start.w + dx, 0.1, W - p.x)), h: round2(clamp(start.h + dy, 0.04, H - p.y)) }
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
    if (sticker) {
      if (!name.trim()) return setError('Design name is required.')
      if (await sticker.onSave(name.trim(), elements)) onClose()
      return
    }
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

  const footer = sticker ? (
    <>
      {sticker.onDelete && (
        <button className="btn btn-danger" onClick={() => sticker.onDelete?.().then((ok) => ok && onClose())}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <button className="btn" type="button" onClick={onClose}>
        Close
      </button>
      <button className="btn btn-primary" type="submit" form="label-form">
        Save design
      </button>
    </>
  ) : (
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
    <Modal
      title={sticker ? sticker.name || 'New sticker design' : template ? template.name : 'New label template'}
      onClose={onClose}
      footer={footer}
      wide
    >
      <form id="label-form" onSubmit={save} style={{ marginBottom: 14, maxWidth: 360 }}>
        {error && <div className="banner banner-error">{error}</div>}
        <label className="label-name-field">
          {sticker ? 'Design name' : 'Template name'}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={sticker ? 'e.g. Loom — 2 line' : 'e.g. Road case'} autoFocus />
        </label>
        {sticker && <small className="muted">{sticker.subtitle}</small>}
      </form>
      {sticker && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
          Fields you can type into text: {STICKER_TOKENS.join(' ')} — {'{This end}'} is the end the
          sticker goes on (each cable prints one sticker per end).
        </p>
      )}

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

      {selected && (
        <div className="lc-toolbar lc-arrange">
          <span className="lc-tool-label">Order</span>
          <button type="button" className="btn btn-small" title="Bring to front" onClick={() => reorderEl(selected.id, 'front')}>
            Front
          </button>
          <button type="button" className="btn btn-small" title="Bring forward" onClick={() => reorderEl(selected.id, 'forward')}>
            ↑
          </button>
          <button type="button" className="btn btn-small" title="Send backward" onClick={() => reorderEl(selected.id, 'backward')}>
            ↓
          </button>
          <button type="button" className="btn btn-small" title="Send to back" onClick={() => reorderEl(selected.id, 'back')}>
            Back
          </button>
          <span className="lc-tool-sep" />
          <span className="lc-tool-label">Align</span>
          <button type="button" className="btn btn-small" title="Align left" onClick={() => alignEl('left')}>
            ⬅
          </button>
          <button type="button" className="btn btn-small" title="Center horizontally" onClick={() => alignEl('hcenter')}>
            ⬌
          </button>
          <button type="button" className="btn btn-small" title="Align right" onClick={() => alignEl('right')}>
            ➡
          </button>
          <button type="button" className="btn btn-small" title="Align top" onClick={() => alignEl('top')}>
            ⬆
          </button>
          <button type="button" className="btn btn-small" title="Center vertically" onClick={() => alignEl('vcenter')}>
            ⬍
          </button>
          <button type="button" className="btn btn-small" title="Align bottom" onClick={() => alignEl('bottom')}>
            ⬇
          </button>
        </div>
      )}

      <div className="label-editor">
        <div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
            Canvas · {W}&quot; × {H}&quot; — drag to move, drag the corner to resize
          </div>
          <div className="label-preview-wrap">
            <div
              className="lc-canvas"
              style={{ width: W * SCALE, height: H * SCALE }}
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
                  style.display = 'flex'
                  style.flexDirection = 'column'
                  style.justifyContent =
                    el.valign === 'middle' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start'
                  style.overflow = 'hidden'
                } else if (el.type === 'line') {
                  style.background = previewColor(el.color) || '#111'
                } else if (el.type === 'rect') {
                  if (el.fill) style.background = previewColor(el.fill)
                  if (el.borderWidth) style.border = `${(el.borderWidth || 0) * (SCALE / 72)}px solid ${previewColor(el.color) || '#111'}`
                }
                const content =
                  el.type === 'showname' ? (
                    <CanvasText el={el} text={projectShow || '{Show name}'} scale={SCALE} />
                  ) : el.type === 'text' ? (
                    <CanvasText el={el} text={el.text ?? ''} scale={SCALE} />
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
                      {colorInput('color', '#111111')}
                    </label>
                  </div>
                  <div className="lc-prop-row">
                    <label>
                      Vertical
                      <select value={selected.valign ?? 'top'} onChange={(e) => patchEl(selected.id, { valign: e.target.value as LabelElement['valign'] })}>
                        <option value="top">Top</option>
                        <option value="middle">Middle</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </label>
                    <label className="checkbox-field">
                      <input type="checkbox" checked={!!selected.autoSize} onChange={(e) => patchEl(selected.id, { autoSize: e.target.checked })} />
                      Auto-size
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
                      {colorInput('color', '#111111')}
                    </label>
                  </div>
                  <div className="lc-prop-row">
                    <label>
                      Vertical
                      <select value={selected.valign ?? 'top'} onChange={(e) => patchEl(selected.id, { valign: e.target.value as LabelElement['valign'] })}>
                        <option value="top">Top</option>
                        <option value="middle">Middle</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </label>
                    <label className="checkbox-field">
                      <input type="checkbox" checked={selected.wrap !== false} onChange={(e) => patchEl(selected.id, { wrap: e.target.checked })} />
                      Wrap text
                    </label>
                  </div>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={!!selected.autoSize} onChange={(e) => patchEl(selected.id, { autoSize: e.target.checked })} />
                    Auto-size to fit box
                  </label>
                </>
              )}
              {selected.type === 'line' && (
                <div className="lc-prop-row">
                  <label>
                    Color
                    {colorInput('color', '#111111')}
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
                        {colorInput('fill', '#cccccc')}
                      </label>
                    )}
                  </div>
                  <div className="lc-prop-row">
                    <label>
                      Border color
                      {colorInput('color', '#111111')}
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
                  <input type="number" step={0.1} value={selected.x} onChange={(e) => patchEl(selected.id, { x: round2(clamp(Number(e.target.value) || 0, 0, W)) })} />
                </label>
                <label>
                  Y (in)
                  <input type="number" step={0.1} value={selected.y} onChange={(e) => patchEl(selected.id, { y: round2(clamp(Number(e.target.value) || 0, 0, H)) })} />
                </label>
              </div>
              <div className="lc-prop-row">
                <label>
                  W (in)
                  <input type="number" step={0.1} value={selected.w} onChange={(e) => patchEl(selected.id, { w: round2(clamp(Number(e.target.value) || 0.1, 0.1, W)) })} />
                </label>
                <label>
                  H (in)
                  <input type="number" step={0.1} value={selected.h} onChange={(e) => patchEl(selected.id, { h: round2(clamp(Number(e.target.value) || 0.04, 0.04, H)) })} />
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
