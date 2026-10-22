import type { StickerRect } from './types'

// Reads a sticker manufacturer's label template (OnlineLabels / Avery style)
// into label boxes, in inches from the page's top-left corner. Pure — no DOM,
// no zip — so Node's test runner can load it; the caller unzips the .docx.

export interface ParsedSheet {
  pageW: number
  pageH: number
  labels: StickerRect[]
  rounded: boolean
}

const EMU = 914400 // per inch (DrawingML)
const TWIP = 1440 // per inch (WordprocessingML)
const r3 = (v: number): number => Math.round(v * 1000) / 1000

const attr = (tag: string, name: string): number | null => {
  const m = new RegExp(`${name}="(-?\\d+)"`).exec(tag)
  return m ? Number(m[1]) : null
}

/** Keep the most common label size (drops logos, borders, page frames), remove
 *  duplicates (fill + outline of the same shape) and sort row by row. */
export function tidyLabels(rects: StickerRect[], pageW: number, pageH: number): StickerRect[] {
  const plausible = rects.filter(
    (r) => r.w >= 0.2 && r.h >= 0.15 && r.w <= pageW * 0.98 && r.h <= pageH * 0.98
  )
  const sizeKey = (r: StickerRect): string => `${r.w.toFixed(2)}x${r.h.toFixed(2)}`
  const counts = new Map<string, number>()
  for (const r of plausible) counts.set(sizeKey(r), (counts.get(sizeKey(r)) ?? 0) + 1)
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const seen = new Set<string>()
  const out: StickerRect[] = []
  for (const r of plausible) {
    if (sizeKey(r) !== best) continue
    const pos = `${r.x.toFixed(2)},${r.y.toFixed(2)}`
    if (seen.has(pos)) continue
    seen.add(pos)
    out.push({ x: r3(r.x), y: r3(r.y), w: r3(r.w), h: r3(r.h) })
  }
  // Row by row: labels whose tops are within 0.05" share a row.
  return out.sort((a, b) => (Math.abs(a.y - b.y) < 0.05 ? a.x - b.x : a.y - b.y))
}

/** Parse word/document.xml from a label template .docx. Handles the two common
 *  layouts: label outlines drawn as positioned shapes (OnlineLabels), and a plain
 *  table whose cells are the labels with narrow spacer columns (Avery). */
export function parseDocxLabelSheet(xml: string): ParsedSheet | null {
  const pgSz = /<w:pgSz\b[^>]*>/.exec(xml)?.[0] ?? ''
  const pageW = (attr(pgSz, 'w:w') ?? 12240) / TWIP
  const pageH = (attr(pgSz, 'w:h') ?? 15840) / TWIP
  const pgMar = /<w:pgMar\b[^>]*>/.exec(xml)?.[0] ?? ''
  const marTop = (attr(pgMar, 'w:top') ?? 0) / TWIP
  const marLeft = (attr(pgMar, 'w:left') ?? 0) / TWIP

  // 1) Positioned shapes (<wp:anchor> with page/margin-relative offsets).
  const shapes: StickerRect[] = []
  let rounded = false
  for (const a of xml.match(/<wp:anchor\b[\s\S]*?<\/wp:anchor>/g) ?? []) {
    const h = /<wp:positionH relativeFrom="(\w+)">\s*<wp:posOffset>(-?\d+)/.exec(a)
    const v = /<wp:positionV relativeFrom="(\w+)">\s*<wp:posOffset>(-?\d+)/.exec(a)
    const ext = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(a)
    if (!h || !v || !ext) continue
    const x = Number(h[2]) / EMU + (h[1] === 'page' ? 0 : marLeft)
    const y = Number(v[2]) / EMU + (v[1] === 'page' ? 0 : marTop)
    shapes.push({ x, y, w: Number(ext[1]) / EMU, h: Number(ext[2]) / EMU })
    if (/prst="(roundRect|ellipse)"/.test(a)) rounded = true
  }
  const fromShapes = tidyLabels(shapes, pageW, pageH)
  if (fromShapes.length >= 2) return { pageW, pageH, labels: fromShapes, rounded }

  // 2) An in-flow table: rows × columns from the page margin; narrow columns
  //    and short rows are the gaps between labels.
  const tbl = /<w:tbl>[\s\S]*?<\/w:tbl>/.exec(xml)?.[0]
  if (!tbl || /<w:tblpPr\b/.test(tbl)) return null
  const cols = [...tbl.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]) / TWIP)
  const rows = [...tbl.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((m) => {
    const ht = /<w:trHeight\b[^>]*>/.exec(m[0])?.[0] ?? ''
    return (attr(ht, 'w:val') ?? 0) / TWIP
  })
  const indent = (attr(/<w:tblInd\b[^>]*>/.exec(tbl)?.[0] ?? '', 'w:w') ?? 0) / TWIP
  const cells: StickerRect[] = []
  let y = marTop
  for (const rh of rows) {
    let x = marLeft + indent
    for (const cw of cols) {
      if (cw >= 0.3 && rh >= 0.2) cells.push({ x, y, w: cw, h: rh })
      x += cw
    }
    y += rh
  }
  const fromTable = tidyLabels(cells, pageW, pageH)
  return fromTable.length >= 2 ? { pageW, pageH, labels: fromTable, rounded: false } : null
}

/** Labels for printing: sheet order from `startAt`, filling as many sheets as needed. */
export function stickerSlots(
  perSheet: number,
  count: number,
  startAt: number
): { page: number; index: number }[] {
  const start = Math.max(0, Math.min(perSheet - 1, Math.trunc(startAt) || 0))
  return Array.from({ length: count }, (_, i) => {
    const n = start + i
    return { page: Math.floor(n / perSheet), index: n % perSheet }
  })
}

/** Stand-in color value: a sticker element drawn in this "color" takes the cable's bundle color. */
export const BUNDLE_COLOR = 'bundle'
