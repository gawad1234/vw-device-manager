import { BrowserWindow, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import { AUTOFIT_SCRIPT, elementsHtml } from './caselabels'
import { buildDeviceIndex, bundleToRows } from './exports'
import { getProjectMeta, listBundles, updateCable } from './repository'
import { listStickerDesigns, listStickerSheets } from './library'
import { BUNDLE_COLOR, stickerSlots } from '../shared/sticker-sheet'
import type { PrintStickersOptions, StickerSheet } from '../shared/types'

// Cable loom stickers: every cable in the chosen looms, `perCable` stickers each
// (2 = one for each end), placed on the sheet's exact label positions, starting
// at the first unused sticker and nudged by the sheet's printer offset.

/** Values for a sticker's {tokens}. */
type StickerData = Record<string, string>

/** Sticker tokens for one cable. The first sticker is for the cable's From end,
 *  the second for its To end — {This end} / {Other end} swap between them. */
function cableStickers(
  perCable: number,
  bundleIds: number[]
): { data: StickerData; color: string; cableId: number }[] {
  const idx = buildDeviceIndex()
  const out: { data: StickerData; color: string; cableId: number }[] = []
  for (const b of listBundles().filter((x) => bundleIds.includes(x.id))) {
    const rows = bundleToRows(b, idx)
    b.cables.forEach((c, i) => {
      const r = rows[i]
      for (let n = 0; n < perCable; n++) {
        const atFrom = n % 2 === 0
        out.push({
          cableId: c.id,
          color: b.color || '#888888',
          data: {
            cable: r.cable,
            type: r.type,
            bundle: r.bundle,
            length: r.length,
            from: r.from,
            to: r.to,
            'this end': atFrom ? r.from : r.to,
            'other end': atFrom ? r.to : r.from,
            end: atFrom ? 'A' : 'B',
            notes: r.notes
          }
        })
      }
    })
  }
  return out
}

/** Absolutely-positioned pages at the sheet's size; `labels[page][index]` is HTML. */
function sheetPagesHtml(
  sheet: StickerSheet,
  pages: Map<number, Map<number, string>>,
  outline: boolean
): string {
  const radius = sheet.rounded ? 'border-radius:0.06in;' : ''
  const body = [...pages.keys()]
    .sort((a, b) => a - b)
    .map((p) => {
      const labels = sheet.labels
        .map((r, i) => {
          const inner = pages.get(p)?.get(i)
          if (inner == null && !outline) return ''
          const box = `left:${r.x + sheet.offsetX}in;top:${r.y + sheet.offsetY}in;width:${r.w}in;height:${r.h}in;`
          const line = outline ? `outline:0.5pt solid #888;outline-offset:-0.25pt;${radius}` : ''
          return `<div class="st" style="${box}${line}">${inner ?? ''}</div>`
        })
        .join('')
      return `<div class="sheet">${labels}</div>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${sheet.pageW}in ${sheet.pageH}in; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; }
    .sheet { position: relative; width: ${sheet.pageW}in; height: ${sheet.pageH}in; overflow: hidden;
             page-break-after: always; }
    .st { position: absolute; overflow: hidden; }
  </style></head><body>${body}${AUTOFIT_SCRIPT}</body></html>`
}

async function savePdf(
  html: string,
  sheet: StickerSheet,
  defaultName: string
): Promise<string | null> {
  const res = await dialog.showSaveDialog({
    defaultPath: `${defaultName.replace(/[/\\:*?"<>|]/g, '-')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (res.canceled || !res.filePath) return null
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  try {
    await win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // Exact page size, no margins, no headers: label positions must land where the sheet says.
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: { width: sheet.pageW, height: sheet.pageH },
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    writeFileSync(res.filePath, pdf)
  } finally {
    win.destroy()
  }
  shell.openPath(res.filePath)
  return res.filePath
}

/** The stickers HTML (exported for tests / previews). */
export function stickersHtml(
  opts: PrintStickersOptions
): { html: string; sheet: StickerSheet; cableIds: number[] } | null {
  const design = listStickerDesigns().find((d) => d.id === opts.designId)
  const sheet = design && listStickerSheets().find((s) => s.id === design.sheetId)
  if (!design || !sheet || !sheet.labels.length) return null
  const perCable = Math.max(1, Math.min(10, Math.trunc(opts.perCable) || 2))
  const items = cableStickers(perCable, opts.bundleIds)
  if (!items.length) return null
  const showName = getProjectMeta('showName') ?? ''
  const logo = getProjectMeta('logo')
  const pages = new Map<number, Map<number, string>>()
  stickerSlots(sheet.labels.length, items.length, opts.startAt).forEach(({ page, index }, i) => {
    const { data, color } = items[i]
    const resolve = (text: string): string =>
      text.replace(/\{([^}]+)\}/g, (_m, key: string) => {
        const k = key.trim().toLowerCase()
        return k === 'show' ? showName : (data[k] ?? '')
      })
    const html = elementsHtml(design.elements, resolve, showName, logo, (c) =>
      c === BUNDLE_COLOR ? color : c
    )
    if (!pages.has(page)) pages.set(page, new Map())
    pages.get(page)!.set(index, html)
  })
  return {
    html: sheetPagesHtml(sheet, pages, false),
    sheet,
    cableIds: [...new Set(items.map((x) => x.cableId))]
  }
}

export async function printStickers(opts: PrintStickersOptions): Promise<string | null> {
  const built = stickersHtml(opts)
  if (!built) return null
  const path = await savePdf(built.html, built.sheet, `${built.sheet.name} loom labels`)
  if (path && opts.markLabeled) {
    const cables = listBundles().flatMap((b) => b.cables)
    for (const id of built.cableIds) {
      const c = cables.find((x) => x.id === id)
      if (c && !c.labeled)
        updateCable(id, {
          name: c.name,
          cableType: c.cableType,
          source: c.source,
          destination: c.destination,
          pulled: c.pulled,
          labeled: true,
          notes: c.notes
        })
    }
  }
  return path
}

/** The sheet's label outlines (numbered) on plain paper, to check printer alignment. */
export async function printStickerTest(sheetId: number): Promise<string | null> {
  const sheet = listStickerSheets().find((s) => s.id === sheetId)
  if (!sheet) return null
  const numbers = new Map(
    sheet.labels.map((_, i) => [
      i,
      `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:7pt;color:#888">${i + 1}</div>`
    ])
  )
  const html = sheetPagesHtml(sheet, new Map([[0, numbers]]), true)
  return savePdf(html, sheet, `${sheet.name} alignment test`)
}
