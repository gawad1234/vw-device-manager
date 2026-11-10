// The header printed at the top of every PDF: which pieces show (logos, names,
// the document title, the date, a line of your own) and where (left, center,
// right). One layout shared by all paperwork and all shows, like the Table
// style. Pure, so the Settings preview and the PDFs draw the same HTML.

export type HeaderItem =
  'companyLogo' | 'companyName' | 'showName' | 'docTitle' | 'text' | 'date' | 'showLogo'

export type HeaderSlot = 'left' | 'center' | 'right' | 'hidden'

export interface PaperworkHeader {
  /** where each piece goes; within a slot they stack in HEADER_ITEMS order */
  slots: Record<HeaderItem, HeaderSlot>
  /** the show logo's max height, px (the company logo is a little smaller) */
  logoHeight: number
  /** a line under the header */
  rule: boolean
  /** your own line, e.g. "Production office 555-0100" */
  text: string
  /** the company logo faintly behind the content of every page */
  watermark: boolean
}

export const HEADER_ITEMS: { key: HeaderItem; label: string }[] = [
  { key: 'companyLogo', label: 'Company logo' },
  { key: 'companyName', label: 'Company name' },
  { key: 'showName', label: 'Show name' },
  { key: 'docTitle', label: 'Document title' },
  { key: 'text', label: 'Your own line' },
  { key: 'date', label: 'Date printed' },
  { key: 'showLogo', label: 'Show logo' }
]

/** Today's look: company and show name on the left, show logo on the right. */
export const DEFAULT_HEADER: PaperworkHeader = {
  slots: {
    companyLogo: 'left',
    companyName: 'left',
    showName: 'left',
    docTitle: 'left',
    text: 'hidden',
    date: 'hidden',
    showLogo: 'right'
  },
  logoHeight: 62,
  rule: true,
  text: '',
  watermark: false
}

const SLOTS: HeaderSlot[] = ['left', 'center', 'right', 'hidden']

/** Fill in anything missing or invalid (an older or hand-edited library). */
export function normalizeHeader(h: Partial<PaperworkHeader> | null | undefined): PaperworkHeader {
  const slots = { ...DEFAULT_HEADER.slots }
  for (const { key } of HEADER_ITEMS) {
    const v = h?.slots?.[key]
    if (v && SLOTS.includes(v)) slots[key] = v
  }
  const height = Number(h?.logoHeight)
  return {
    slots,
    logoHeight: Number.isFinite(height) ? Math.min(140, Math.max(20, Math.round(height))) : 62,
    rule: h?.rule ?? true,
    text: typeof h?.text === 'string' ? h.text : '',
    watermark: h?.watermark === true
  }
}

export interface HeaderData {
  title: string
  showName: string | null
  showLogo: string | null
  companyName: string | null
  companyLogo: string | null
  /** shown when Date printed is placed */
  date: string
}

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  )
}

/** The header's HTML; style it with HEADER_CSS. */
export function headerHtml(h: PaperworkHeader, d: HeaderData): string {
  // with no show name the document title takes its place as the big line
  const piece: Record<HeaderItem, string> = {
    companyLogo: d.companyLogo ? `<img class="clogo" src="${esc(d.companyLogo)}" alt="">` : '',
    companyName: d.companyName ? `<span class="cname">${esc(d.companyName)}</span>` : '',
    showName: d.showName ? `<div class="show">${esc(d.showName)}</div>` : '',
    docTitle: d.title
      ? `<div class="${d.showName && h.slots.showName !== 'hidden' ? 'doctitle' : 'show'}">${esc(d.title)}</div>`
      : '',
    text: h.text.trim() ? `<div class="htext">${esc(h.text)}</div>` : '',
    date: d.date ? `<div class="hdate">${esc(d.date)}</div>` : '',
    showLogo: d.showLogo ? `<img class="logo" src="${esc(d.showLogo)}" alt="">` : ''
  }
  const slot = (where: HeaderSlot): string => {
    const items = HEADER_ITEMS.filter((i) => h.slots[i.key] === where && piece[i.key])
    let html = ''
    for (let i = 0; i < items.length; i++) {
      // company logo + name share a row, as on letterhead
      if (items[i].key === 'companyLogo' && items[i + 1]?.key === 'companyName') {
        html += `<div class="company">${piece.companyLogo}${piece.companyName}</div>`
        i++
      } else if (items[i].key === 'companyLogo' || items[i].key === 'companyName')
        html += `<div class="company">${piece[items[i].key]}</div>`
      else html += piece[items[i].key]
    }
    return `<div class="ph-${where}">${html}</div>`
  }
  return `<header class="ph${h.rule ? ' ph-rule' : ''}" style="--logo-h:${h.logoHeight}px">${slot('left')}${slot('center')}${slot('right')}</header>`
}

/** The watermark's HTML (empty when off or there's no company logo); style it with HEADER_CSS. */
export function watermarkHtml(h: PaperworkHeader, companyLogo: string | null): string {
  return h.watermark && companyLogo ? `<img class="wm" src="${esc(companyLogo)}" alt="">` : ''
}

export const HEADER_CSS = `
  .ph { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px;
        padding-bottom: 10px; margin-bottom: 16px; }
  .ph.ph-rule { border-bottom: 2px solid #dddddd; }
  .ph-left, .ph-center, .ph-right { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ph-left { align-items: flex-start; }
  .ph-center { align-items: center; text-align: center; }
  .ph-right { align-items: flex-end; text-align: right; }
  .ph .company { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .ph .clogo { max-height: calc(var(--logo-h) * 0.55); max-width: 170px; object-fit: contain; }
  .ph .cname { font-size: 13px; font-weight: 700; color: #333; }
  .ph .show { font-size: 18px; font-weight: 700; color: #1b1b1f; }
  .ph .doctitle { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  .ph .htext, .ph .hdate { font-size: 11px; color: #444; }
  .ph .logo { max-height: var(--logo-h); max-width: 260px; object-fit: contain; }
  /* position: fixed repeats it on every printed page */
  .wm { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 60%; max-height: 60%; object-fit: contain; opacity: 0.08;
        z-index: -1; pointer-events: none; }`
