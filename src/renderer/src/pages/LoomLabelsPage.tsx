import { useEffect, useRef, useState } from 'react'
import type { Bundle, LabelElement, StickerDesign, StickerSheet } from '../../../shared/types'
import { BUNDLE_COLOR } from '../../../shared/sticker-sheet'
import { importStickerTemplate } from '../lib/stickerImport'
import LabelModal from '../components/LabelModal'

interface Props {
  bundles: Bundle[]
  onChanged: () => void
}

const uid = (): string => Math.random().toString(36).slice(2, 10)
const inch = (n: number): string => `${Math.round(n * 1000) / 1000}″`

/** A starting design for a new sheet type: bundle-color bar, cable name, then "this end → other end". */
function defaultDesign(w: number, h: number): LabelElement[] {
  const bar = Math.min(0.12, w * 0.08)
  const textW = w - bar - 0.08
  return [
    {
      id: uid(),
      type: 'rect',
      x: 0,
      y: 0,
      w: bar,
      h,
      fill: BUNDLE_COLOR,
      color: BUNDLE_COLOR,
      borderWidth: 0
    },
    {
      id: uid(),
      type: 'text',
      x: bar + 0.04,
      y: 0.02,
      w: textW,
      h: h * 0.52,
      text: '{Cable}',
      fontSize: 11,
      bold: true,
      align: 'left',
      valign: 'middle',
      color: '#111111',
      autoSize: true,
      wrap: false
    },
    {
      id: uid(),
      type: 'text',
      x: bar + 0.04,
      y: h * 0.52,
      w: textW,
      h: h * 0.46,
      text: '{This end} → {Other end}',
      fontSize: 7,
      bold: false,
      align: 'left',
      valign: 'middle',
      color: '#333333',
      autoSize: true,
      wrap: false
    }
  ]
}

/** Cables › Loom labels: sticker sheet types (imported from manufacturer templates),
 *  sticker designs per sheet, and printing every cable in chosen looms. */
function LoomLabelsPage({ bundles, onChanged }: Props): React.JSX.Element {
  const [sheets, setSheets] = useState<StickerSheet[]>([])
  const [designs, setDesigns] = useState<StickerDesign[]>([])
  const [sheetId, setSheetId] = useState<number | null>(null)
  const [designId, setDesignId] = useState<number | null>(null)
  const [editing, setEditing] = useState<StickerDesign | 'new' | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [perCable, setPerCable] = useState(2)
  const [startAt, setStartAt] = useState(0)
  const [markLabeled, setMarkLabeled] = useState(true)
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    setSheets(await window.api.stickers.sheets())
    setDesigns(await window.api.stickers.designs())
  }
  useEffect(() => {
    window.api.stickers.sheets().then(setSheets)
    window.api.stickers.designs().then(setDesigns)
  }, [])

  const sheet = sheets.find((s) => s.id === sheetId) ?? sheets[0]
  const sheetDesigns = designs.filter((d) => d.sheetId === sheet?.id)
  const design = sheetDesigns.find((d) => d.id === designId) ?? sheetDesigns[0]
  const cableCount = bundles
    .filter((b) => picked.includes(b.id))
    .reduce((n, b) => n + b.cables.length, 0)
  const stickerCount = cableCount * perCable
  const perSheet = sheet?.labels.length ?? 0
  const sheetCount = perSheet ? Math.ceil((startAt + stickerCount) / perSheet) : 0

  async function importFile(file: File): Promise<void> {
    setNote(null)
    try {
      const parsed = await importStickerTemplate(file)
      const saved = await window.api.stickers.saveSheet(null, {
        ...parsed,
        name: file.name.replace(/\.(docx|pdf)$/i, ''),
        offsetX: 0,
        offsetY: 0,
        source: file.name
      })
      const l = parsed.labels[0]
      await window.api.stickers.saveDesign(null, {
        name: 'Cable + ends',
        sheetId: saved.id,
        elements: defaultDesign(l.w, l.h)
      })
      await load()
      setSheetId(saved.id)
      setStartAt(0)
      setNote({
        text: `Imported ${saved.name}: ${parsed.labels.length} labels, ${inch(l.w)} × ${inch(l.h)}.`
      })
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), error: true })
    }
  }

  async function saveSheet(patch: Partial<StickerSheet>): Promise<void> {
    if (!sheet) return
    const { id, ...rest } = { ...sheet, ...patch }
    setSheets((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    await window.api.stickers.saveSheet(id, rest)
  }

  async function removeSheet(): Promise<void> {
    if (!sheet || !window.confirm(`Delete sheet type "${sheet.name}" and its designs?`)) return
    await window.api.stickers.removeSheet(sheet.id)
    setSheetId(null)
    await load()
  }

  async function print(): Promise<void> {
    if (!design) return
    setNote(null)
    const path = await window.api.stickers.print({
      designId: design.id,
      bundleIds: picked,
      startAt,
      perCable,
      markLabeled
    })
    if (path) {
      setNote({ text: `Saved ${path}` })
      if (markLabeled) onChanged()
    }
  }

  // Preview: the page at a fixed width, each label clickable to set where printing starts.
  const previewW = 300
  const k = sheet ? previewW / sheet.pageW : 1
  const willPrint = (i: number): boolean => i >= startAt && i < startAt + stickerCount

  return (
    <div className="page">
      <div className="page-header">
        <h2>Loom labels</h2>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
            Import sticker template…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) importFile(f)
            }}
          />
        </div>
      </div>
      <p className="muted">
        Import a sticker sheet template from the manufacturer (Word .docx or PDF — e.g.
        OnlineLabels, Avery), design what goes on each sticker, then print every cable in the looms
        you pick — one sticker for each end.
      </p>
      {note && <p className={note.error ? 'banner banner-error' : 'muted'}>{note.text}</p>}

      {!sheet ? (
        <p className="muted">No sticker sheets yet — import a template to start.</p>
      ) : (
        <div className="kit-layout">
          <div className="kit-list">
            {sheets.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`kit-list-row${s.id === sheet.id ? ' active' : ''}`}
                onClick={() => {
                  setSheetId(s.id)
                  setStartAt(0)
                }}
              >
                <span className="kit-trigger">{s.name}</span>
                <span className="muted kit-summary">
                  {s.labels.length} × {inch(s.labels[0]?.w ?? 0)} × {inch(s.labels[0]?.h ?? 0)}
                </span>
              </button>
            ))}
          </div>

          <div className="kit-form loom-main">
            <div className="loom-sheet">
              <div>
                <div
                  className="loom-preview"
                  style={{ width: previewW, height: sheet.pageH * k }}
                  title="Click a sticker to start printing there"
                >
                  {sheet.labels.map((r, i) => (
                    <div
                      key={i}
                      className={`loom-label${willPrint(i) ? ' print' : ''}${i < startAt ? ' used' : ''}`}
                      style={{
                        left: (r.x + sheet.offsetX) * k,
                        top: (r.y + sheet.offsetY) * k,
                        width: r.w * k,
                        height: r.h * k,
                        borderRadius: sheet.rounded ? 3 : 0
                      }}
                      onClick={() => setStartAt(i)}
                    />
                  ))}
                </div>
                <small className="muted">
                  {inch(sheet.pageW)} × {inch(sheet.pageH)} page · start at sticker {startAt + 1}
                  {startAt > 0 && (
                    <>
                      {' '}
                      <button type="button" className="link-btn" onClick={() => setStartAt(0)}>
                        (reset)
                      </button>
                    </>
                  )}
                </small>
              </div>

              <div className="loom-settings">
                <label>
                  Sheet name
                  <input
                    value={sheet.name}
                    onChange={(e) =>
                      setSheets((ss) =>
                        ss.map((s) => (s.id === sheet.id ? { ...s, name: e.target.value } : s))
                      )
                    }
                    onBlur={() => saveSheet({ name: sheet.name })}
                  />
                </label>
                <div className="lc-prop-row">
                  <label>
                    Nudge right (in)
                    <input
                      type="number"
                      step={0.01}
                      value={sheet.offsetX}
                      onChange={(e) => saveSheet({ offsetX: Number(e.target.value) || 0 })}
                    />
                  </label>
                  <label>
                    Nudge down (in)
                    <input
                      type="number"
                      step={0.01}
                      value={sheet.offsetY}
                      onChange={(e) => saveSheet({ offsetY: Number(e.target.value) || 0 })}
                    />
                  </label>
                </div>
                <small className="muted">
                  Print a test page on plain paper, hold it over a sticker sheet against the light,
                  and nudge until the outlines line up. Saved for this sheet type.
                </small>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={sheet.rounded}
                    onChange={(e) => saveSheet({ rounded: e.target.checked })}
                  />
                  Rounded corners
                </label>
                <div className="signal-add">
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => window.api.stickers.printTest(sheet.id)}
                  >
                    Print test page…
                  </button>
                  <button type="button" className="btn btn-small btn-danger" onClick={removeSheet}>
                    Delete sheet type
                  </button>
                </div>
              </div>
            </div>

            <h3>Designs</h3>
            <div className="signal-add">
              {sheetDesigns.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`fmt-tab${d.id === design?.id ? ' active' : ''}`}
                  onClick={() => setDesignId(d.id)}
                  onDoubleClick={() => setEditing(d)}
                >
                  {d.name}
                </button>
              ))}
              {design && (
                <button type="button" className="btn btn-small" onClick={() => setEditing(design)}>
                  Edit design…
                </button>
              )}
              <button type="button" className="btn btn-small" onClick={() => setEditing('new')}>
                + New design
              </button>
            </div>

            <h3>Print</h3>
            {bundles.length ? (
              <div className="loom-bundles">
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={picked.length === bundles.length}
                    onChange={(e) => setPicked(e.target.checked ? bundles.map((b) => b.id) : [])}
                  />
                  <strong>All looms</strong>
                </label>
                {bundles.map((b) => (
                  <label key={b.id} className="chk">
                    <input
                      type="checkbox"
                      checked={picked.includes(b.id)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)
                        )
                      }
                    />
                    <span className="sw" style={{ background: b.color || '#888' }} />
                    {b.name} <span className="muted">({b.cables.length})</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted">No looms yet — add bundles on the Cables page.</p>
            )}
            <div className="sched-toolbar" style={{ marginTop: 10 }}>
              <label>
                Stickers per cable{' '}
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={perCable}
                  style={{ width: 60 }}
                  onChange={(e) =>
                    setPerCable(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                  }
                />
              </label>
              <label className="chk">
                <input
                  type="checkbox"
                  checked={markLabeled}
                  onChange={(e) => setMarkLabeled(e.target.checked)}
                />
                Mark these cables Labeled
              </label>
            </div>
            <div className="signal-add" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!design || !stickerCount}
                onClick={print}
              >
                Print stickers…
              </button>
              <span className="muted">
                {stickerCount
                  ? `${cableCount} cable${cableCount === 1 ? '' : 's'} → ${stickerCount} sticker${stickerCount === 1 ? '' : 's'} on ${sheetCount} sheet${sheetCount === 1 ? '' : 's'}`
                  : 'Pick the looms to print.'}
              </span>
            </div>
          </div>
        </div>
      )}

      {editing && sheet && (
        <LabelModal
          template={null}
          sticker={{
            name: editing === 'new' ? '' : editing.name,
            elements:
              editing === 'new'
                ? defaultDesign(sheet.labels[0].w, sheet.labels[0].h)
                : editing.elements,
            size: { w: sheet.labels[0].w, h: sheet.labels[0].h },
            subtitle: `${sheet.name} · ${inch(sheet.labels[0].w)} × ${inch(sheet.labels[0].h)} sticker`,
            onSave: async (name, elements) => {
              const saved = await window.api.stickers.saveDesign(
                editing === 'new' ? null : editing.id,
                {
                  name,
                  sheetId: sheet.id,
                  elements
                }
              )
              await load()
              setDesignId(saved.id)
              return true
            },
            onDelete:
              editing === 'new'
                ? undefined
                : async () => {
                    if (!window.confirm(`Delete design "${editing.name}"?`)) return false
                    await window.api.stickers.removeDesign(editing.id)
                    setDesignId(null)
                    await load()
                    return true
                  }
          }}
          onClose={() => setEditing(null)}
          onChanged={() => undefined}
          onCreated={() => undefined}
        />
      )}
    </div>
  )
}

export default LoomLabelsPage
