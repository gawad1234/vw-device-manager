import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_HEADER,
  HEADER_CSS,
  HEADER_ITEMS,
  headerHtml,
  type HeaderSlot,
  type PaperworkHeader
} from '../../../shared/paperwork-header'

const PLACES: { value: HeaderSlot; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'hidden', label: 'Hidden' }
]

/** Settings › Paperwork header: what sits at the top of every PDF, and where. */
function HeaderPanel(): React.JSX.Element {
  const [h, setH] = useState<PaperworkHeader>(DEFAULT_HEADER)
  const [brand, setBrand] = useState({
    showName: null as string | null,
    showLogo: null as string | null,
    companyName: null as string | null,
    companyLogo: null as string | null
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.api.paperworkHeader.get().then(setH)
    // the preview uses this show's real names and logos (re-read when the window regains focus)
    const load = (): void =>
      void Promise.all([
        window.api.showName.get(),
        window.api.showLogo.get(),
        window.api.companyName.get(),
        window.api.companyLogo.get()
      ]).then(([showName, showLogo, companyName, companyLogo]) =>
        setBrand({ showName, showLogo, companyName, companyLogo })
      )
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [])

  // typing in the text box fires on every key: save once it settles
  function change(patch: Partial<PaperworkHeader>): void {
    const next = { ...h, ...patch }
    setH(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => window.api.paperworkHeader.set(next), 400)
  }

  const preview = headerHtml(h, {
    title: 'Pull Sheet',
    showName: brand.showName || 'Show name',
    showLogo: brand.showLogo,
    companyName: brand.companyName,
    companyLogo: brand.companyLogo,
    date: new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  })

  return (
    <div className="panel">
      <h3>Paperwork header</h3>
      <p className="muted">
        What prints at the top of every PDF (pull sheets, patch sheets, schedules, orders, load
        sheets) and where. Logos and names come from Show branding and Company branding above.
        Shared across all projects.
      </p>
      <div className="hdr-grid">
        {HEADER_ITEMS.map(({ key, label }) => (
          <label key={key}>
            {label}
            <select
              value={h.slots[key]}
              onChange={(e) =>
                change({ slots: { ...h.slots, [key]: e.target.value as HeaderSlot } })
              }
            >
              {PLACES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="hdr-row">
        <label className="hdr-text">
          Your own line
          <input
            value={h.text}
            placeholder="e.g. Production office 555-0100"
            onChange={(e) => change({ text: e.target.value })}
          />
        </label>
        <label>
          Logo height
          <input
            type="number"
            min={20}
            max={140}
            value={h.logoHeight}
            onChange={(e) => change({ logoHeight: Number(e.target.value) || 62 })}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={h.rule}
            onChange={(e) => change({ rule: e.target.checked })}
          />
          Line under the header
        </label>
        <button className="btn btn-small" onClick={() => change(DEFAULT_HEADER)}>
          Reset
        </button>
      </div>
      <div className="hdr-preview">
        <style>{HEADER_CSS}</style>
        {/* headerHtml escapes every value */}
        <div dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
    </div>
  )
}

export default HeaderPanel
