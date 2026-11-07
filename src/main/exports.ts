import { dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import ExcelJS from 'exceljs'
import {
  buildReport,
  fieldLabel,
  type BuiltReport,
  type PaperworkTemplate
} from '../shared/paperwork'
import {
  buildDeviceIndex,
  caseRecords,
  recordsFor,
  resolveEndpoint,
  TRIP_KIND_LABEL,
  type DeviceIndex
} from './paperwork-data'
import {
  getProjectMeta,
  getOrderBaseline,
  getOrderExportFormatById,
  getShopOrderById,
  listBundles,
  listCasesByIds,
  listTruckTrips,
  listTrucks,
  listDevices,
  listSubnets,
  markOrderExported
} from './repository'
import { ipInCidr } from './ip-utils'
import { withPrintWindow } from './print-html'
import { maskFromCidr } from './switch-config'
import {
  PROJECTOR_GROUPS,
  PROJECTOR_SETTINGS,
  projectorValueLabel
} from '../shared/projector-settings'
import { getCompanyName, getCompanyLogo, getTableStyle, templatesForDoc } from './library'
import { argb, tableFont, tableStyleCss } from '../shared/table-style'
import type {
  Bundle,
  ExportOptions,
  OrderColumn,
  OrderColumnKey,
  OrderExportFormat,
  OrderItem,
  ShopOrder
} from '../shared/types'
import { ORDER_COLUMN_META } from '../shared/types'

// The show name for the export in progress — read once in exportDocument and
// used by the shared page() header and printToPDF footer (avoids threading it
// through every renderer).
let docShowName: string | null = null

// ---- Endpoint resolution -------------------------------------------------
// A cable endpoint is a device (+ optional port) or free text. Resolve it to a
// readable string using the current device list.
// ---- Row model (shared by every format) ----------------------------------
interface Row {
  bundle: string
  cable: string
  type: string
  from: string
  to: string
  length: string
  pulled: boolean
  labeled: boolean
  notes: string
}

export function bundleToRows(bundle: Bundle, idx: DeviceIndex): Row[] {
  return bundle.cables.map((c) => ({
    bundle: bundle.name,
    cable: c.name,
    type: c.cableType ?? '',
    from: resolveEndpoint(c.source, idx),
    to: resolveEndpoint(c.destination, idx),
    length: bundle.length ?? '',
    pulled: c.pulled,
    labeled: c.labeled,
    notes: c.notes ?? ''
  }))
}

function collectBundles(opts: ExportOptions): Bundle[] {
  const all = listBundles()
  if (opts.scope === 'bundle') {
    const b = all.find((x) => x.id === opts.bundleId)
    return b ? [b] : []
  }
  return all
}

// ---- CSV -----------------------------------------------------------------
function csvCell(v: string): string {
  // A leading = + - @ makes Excel run the cell as a formula. Plain numbers are fine.
  const safe = /^[=+\-@\t\r]/.test(v) && !/^[+-]?\d[\d.,]*$/.test(v) ? "'" + v : v
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}

/** The byte-order mark tells Excel on Windows this is UTF-8 (☐, →, accents). */
function writeCsv(path: string, text: string): void {
  writeFileSync(path, '\ufeff' + text, 'utf-8')
}

/** Text order that reads numbers as numbers: 25ft before 100ft, PJ2 before PJ10. */
const natural = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

// ---- XLSX (exceljs) ------------------------------------------------------
function parseImageDataUrl(
  dataUrl: string | null
): { base64: string; extension: 'png' | 'jpeg' | 'gif' } | null {
  if (!dataUrl) return null
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(dataUrl)
  if (!m) return null
  const kind = m[1].toLowerCase()
  return { base64: m[2], extension: kind === 'gif' ? 'gif' : kind === 'png' ? 'png' : 'jpeg' }
}

/** PDF text size (px) → the matching Excel point size (12px reads like Excel's 11pt). */
const excelPt = (px: number): number => Math.round(((px * 11) / 12) * 2) / 2

/** Paint a sheet's table in the shared table style: font, header colors, stripes, lines.
 *  `fontPx` is the template's text size, when it has one. */
function styleSheet(ws: ExcelJS.Worksheet, headerRowNum: number, cols: number, fontPx = 12): void {
  const st = getTableStyle()
  const name = tableFont(st).excel
  const size = excelPt(fontPx)
  const headSize = Math.round(size * (st.headerScale / 85) * 2) / 2
  const line = { style: 'thin' as const, color: { argb: argb(st.borderColor) } }
  const border: Partial<ExcelJS.Borders> =
    st.borders === 'grid'
      ? { top: line, bottom: line, left: line, right: line }
      : st.borders === 'rows'
        ? { bottom: line }
        : {}
  const fill = (hex: string): ExcelJS.Fill => ({
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: argb(hex) }
  })
  for (let r = headerRowNum; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const head = r === headerRowNum
    const striped = !head && st.stripes && (r - headerRowNum) % 2 === 0
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c)
      cell.border = border
      if (head) {
        cell.fill = fill(st.headerFill)
        cell.font = {
          name,
          size: headSize,
          bold: st.headerBold,
          color: { argb: argb(st.headerText) }
        }
        if (st.headerCaps && typeof cell.value === 'string') cell.value = cell.value.toUpperCase()
      } else {
        cell.font = { name, size }
        if (striped) cell.fill = fill(st.stripeColor)
      }
    }
  }
}

// ---- PDF (HTML -> Electron printToPDF, no dependency) --------------------
function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  )
}

/** The equipment-list layout: show name top left, a title band in the Table style header colors, light slate category bands, quiet
 *  italic column heads, row rules only, and an amber pill on anything outstanding.
 *  Palette: slate #24313f with a copper #c8742c accent. */
function eqCss(fill: string, text: string): string {
  return `
    .eq-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
    .eq-show { display: flex; align-items: center; gap: 12px; }
    .eq-show .logo { max-height: 54px; max-width: 180px; }
    .eq-name { font-size: 1.75em; text-transform: uppercase; line-height: 1.15; }
    .eq-sub { font-size: 1.35em; text-transform: uppercase; }
    .eq-title { background: ${fill}; color: ${text}; font-size: 1.75em; font-weight: 800; padding: 6px 10px; margin-bottom: 4px;
                border-left: 6px solid #c8742c; }
    .eq-notes { font-size: .95em; color: #444; margin: 6px 2px 10px; white-space: pre-wrap; }
    body.eq section { margin: 0 0 10px; page-break-inside: auto; }
    body.eq h2 { background: #e8edf2; color: #24313f; font-size: 1.3em; font-weight: 600; margin: 0 0 4px; padding: 5px 16px;
                 border-left: 6px solid #24313f; }
    body.eq h2 .meta { color: #6b7b8c; font-size: .75em; margin: 0; }
    body.eq table th, body.eq table td { border: none; border-bottom: 1px solid #e3e8ee; }
    body.eq table th { background: none; color: #6b7b8c; font-style: italic; font-weight: 400;
                       text-transform: none; letter-spacing: 0; font-size: .9em; padding-bottom: 2px; }
    body.eq table th.chk { white-space: nowrap; }
    body.eq table tbody tr:nth-child(even) { background: none; }
    body.eq td.chk { font-size: 1em; }
    body.eq td.prev { color: #9aa6b2; }
    .bal { display: inline-block; min-width: 2.2em; padding: 1px 6px; border-radius: 10px; color: #b8c1ca; }
    .bal.due { background: #ffcf7a; color: #5a3a00; font-weight: 700; }
    .eq-note { display: block; color: #a85a1c; font-style: italic; font-weight: 700; font-size: .9em; }`
}

function page(title: string, body: string, logo: string | null, fontSize = 12, eq = false): string {
  const st = getTableStyle()
  const titleBlock = docShowName
    ? `<div class="show">${esc(docShowName)}</div><div class="doctitle">${esc(title)}</div>`
    : `<div class="show">${esc(title)}</div>`
  // Company letterhead (shared across projects) sits above the show name.
  const companyName = getCompanyName()
  const companyLogo = getCompanyLogo()
  const companyBlock =
    companyName || companyLogo
      ? `<div class="company">${companyLogo ? `<img class="clogo" src="${esc(companyLogo)}" alt="">` : ''}${
          companyName ? `<span class="cname">${esc(companyName)}</span>` : ''
        }</div>`
      : ''
  const header = `<header class="ph"><div class="ph-l">${companyBlock}${titleBlock}</div>${
    logo ? `<img class="logo" src="${esc(logo)}" alt="logo">` : ''
  }</header>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
           color: #1b1b1f; margin: 0; padding: 22px; font-size: 12px; }
    .ph { display: flex; align-items: center; justify-content: space-between; gap: 16px;
          border-bottom: 2px solid #dddddd; padding-bottom: 10px; margin-bottom: 16px; }
    .ph-l { display: flex; flex-direction: column; gap: 2px; }
    .company { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .company .clogo { max-height: 34px; max-width: 170px; object-fit: contain; }
    .company .cname { font-size: 13px; font-weight: 700; color: #333; }
    .show { font-size: 18px; font-weight: 700; }
    .doctitle { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
    .logo { max-height: 62px; max-width: 260px; object-fit: contain; }
    h1 { font-size: 18px; margin: 0 0 14px; }
    .sec { margin: 20px 0 6px; }
    .dcell { font-weight: 600; vertical-align: middle; }
    table.grouped td { vertical-align: middle; }
    tr.g0 > td { background: #ffffff; }
    tr.g1 > td { background: #eef2f7; }
    section { margin-bottom: 20px; page-break-inside: avoid; }
    h2 { font-size: 14px; margin: 0 0 2px; display: flex; align-items: center; gap: 8px; }
    .sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; border: 1px solid #0003; }
    .meta { color: #666; font-size: 11px; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; }
    /* Order tables: honor the <colgroup> widths exactly so every category section
       lines its columns up identically (long text wraps instead of widening a cell). */
    table.fixed { table-layout: fixed; }
    table.fixed td, table.fixed th { overflow-wrap: anywhere; }
    th, td { border: 1px solid #cfcfcf; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
    td.chk, th.chk { text-align: center; width: 58px; }
    td.chk { font-size: 1.25em; }
    tbody tr:nth-child(even) { background: #fafafa; }
    tr.row-new > td { background: #e6f7ea; }
    tr.row-chg > td { background: #fff5d6; }
    .chg-tag { font-size: 8.5px; color: #7a5b00; background: #ffe8a3; padding: 1px 4px;
               border-radius: 3px; margin-left: 6px; white-space: nowrap; }
    .legend { font-size: 10px; color: #555; margin: 0 0 12px; display: flex; align-items: center; gap: 6px; }
    .sw-new, .sw-chg { display: inline-block; width: 11px; height: 11px; border-radius: 2px; border: 1px solid #0002; }
    .sw-new { background: #e6f7ea; } .sw-chg { background: #fff5d6; }
    .labels { display: flex; flex-wrap: wrap; gap: 8px; }
    .label { width: 2.6in; border: 1px solid #bbb; border-left-width: 6px; border-radius: 4px;
             padding: 7px 9px; page-break-inside: avoid; }
    .label .name { font-weight: 700; font-size: 13px; }
    .label .ends { font-size: 11px; margin-top: 2px; }
    .label .type { font-size: 10px; color: #666; margin-top: 2px; }
    /* wrap-around flag labels: [ end ][ striped wrap zone ][ end ] */
    .flags { display: flex; flex-wrap: wrap; gap: 8px; }
    .flag { display: flex; align-items: stretch; height: 0.5in; width: 3.4in;
            border: 1px solid #bbbbbb; border-radius: 3px; overflow: hidden; }
    .fend { flex: 0 0 1.2in; padding: 2px 7px; overflow: hidden; display: flex;
            flex-direction: column; justify-content: center; border-top: 3px solid var(--c, #888); }
    .fwrap { flex: 1; border-left: 1px dashed #999999; border-right: 1px dashed #999999;
             background: repeating-linear-gradient(45deg,#f4f4f4,#f4f4f4 3px,#fff 3px,#fff 6px); }
    .fname { font-weight: 700; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fends { font-size: 8px; color: #555555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${tableStyleCss(st)}
    body { font-family: ${tableFont(st).css}; font-size: ${fontSize}px; }
    ${eq ? eqCss(st.headerFill, st.headerText) : ''}
  </style></head><body${eq ? ' class="eq"' : ''}>${eq ? '' : header}${body}</body></html>`
}

function labelsHtml(bundles: Bundle[], idx: DeviceIndex, logo: string | null): string {
  const cards =
    bundles
      .flatMap((b) =>
        bundleToRows(b, idx).map(
          (r) =>
            `<div class="label" style="border-left-color:${b.color || '#888888'}"><div class="name">${esc(
              r.cable
            )}</div><div class="ends">${esc(r.from)} → ${esc(r.to)}</div><div class="type">${esc(
              b.name
            )}${r.type ? ' · ' + esc(r.type) : ''}${r.length ? ' · ' + esc(r.length) : ''}</div></div>`
        )
      )
      .join('') || '<p>No cables.</p>'
  return page('Cable Labels', `<div class="labels">${cards}</div>`, logo)
}

/**
 * Wrap-around flag labels. Each cable is a strip: [ end ][ wrap zone ][ end ].
 * Lay the cable across the striped wrap zone, wrap it once, and stick the two
 * ends together to form the flag. Both ends print the same way round: folding
 * only turns the right end to the back, where it reads normally.
 */
function flagLabelsHtml(bundles: Bundle[], idx: DeviceIndex, logo: string | null): string {
  const flags =
    bundles
      .flatMap((b) =>
        bundleToRows(b, idx).map((r) => {
          const end = `<div class="fname">${esc(r.cable)}</div><div class="fends">${esc(r.from)}</div><div class="fends">→ ${esc(r.to)}</div>`
          return `<div class="flag" style="--c:${esc(b.color || '#888888')}"><div class="fend">${end}</div><div class="fwrap"></div><div class="fend">${end}</div></div>`
        })
      )
      .join('') || '<p>No cables.</p>'
  return page('Cable Labels (wrap flags)', `<div class="flags">${flags}</div>`, logo)
}

// ---- IP schedule (device-side) + generic table renderers ----------------
interface Table {
  headers: string[]
  rows: string[][]
}

// ---- Projector setup sheet ----------------------------------------------
// One page per projector: model + name on top, then a banner + Setting/Value
// table per section (Network Settings first, always; other sections only when
// something in them is ticked). Layout follows the user's mock-up.
interface ProjectorSheetSection {
  title: string
  note?: string
  rows: [string, string][]
}
interface ProjectorSheetEntry {
  name: string
  model: string
  location: string
  sections: ProjectorSheetSection[]
}

function projectorSheetEntries(): ProjectorSheetEntry[] {
  const subnets = listSubnets()
  const byId = new Map(subnets.map((s) => [s.id, s]))
  return listDevices()
    .filter((d) => d.projector)
    .sort((a, b) => natural(a.name, b.name))
    .map((d) => {
      const cfg = d.projector!
      const usable = d.ports.filter((p) => !p.isUnused)
      const port = usable.find((p) => p.isPrimary) ?? usable.find((p) => p.ipAddress)
      const ip = port?.ipAddress ?? ''
      const sub =
        (port?.untaggedSubnetId != null ? byId.get(port.untaggedSubnetId) : undefined) ??
        (ip ? subnets.find((s) => s.cidr && ipInCidr(ip, s.cidr) === true) : undefined)
      const sections: ProjectorSheetSection[] = PROJECTOR_GROUPS.map((title) => ({
        title,
        rows: PROJECTOR_SETTINGS.filter(
          (s) => s.group === title && s.key !== 'projectorName' && cfg.values[s.key] !== undefined
        ).map((s): [string, string] => [s.label, projectorValueLabel(s, cfg.values[s.key])])
      }))
      // The network address is always hand-set (no command exists), so it always prints.
      sections[0] = {
        ...sections[0],
        note: 'Set at the projector menu or with Panasonic Network Setup Software (DHCP off).',
        rows: [
          ['IP Address', ip],
          ['Subnet', sub ? maskFromCidr(sub.cidr) : ''],
          ['Router', sub?.gateway ?? ''],
          ...sections[0].rows
        ]
      }
      return {
        name: cfg.values.projectorName?.trim() || d.name,
        model: cfg.model,
        location: d.location ?? '',
        sections: sections.filter((s) => s.rows.length)
      }
    })
}

/** Flat table (CSV): one row per projector setting. */
function projectorSheetTable(): Table {
  return {
    headers: ['Projector', 'Model', 'Location', 'Section', 'Setting', 'Value'],
    rows: projectorSheetEntries().flatMap((e) =>
      e.sections.flatMap((s) =>
        s.rows.map(([k, v]) => [e.name, e.model, e.location, s.title, k, v])
      )
    )
  }
}

/** Excel: one worksheet (= one printed page) per projector. */
async function projectorSheetXlsx(logo: string | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const entries = projectorSheetEntries()
  const img = parseImageDataUrl(logo)
  const imgId = img ? wb.addImage({ base64: img.base64, extension: img.extension }) : null
  const st = getTableStyle()
  const thin = { style: 'thin' as const, color: { argb: argb(st.borderColor) } }
  const box =
    st.borders === 'grid'
      ? { top: thin, bottom: thin, left: thin, right: thin }
      : st.borders === 'rows'
        ? { bottom: thin }
        : {}
  const used = new Set<string>()
  for (const e of entries.length ? entries : [null]) {
    // Sheet names: max 31 chars, no []:*?/\ and unique.
    let sheetName =
      (e?.name ?? 'Projectors').replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Projector'
    for (let n = 2; used.has(sheetName.toLowerCase()); n++)
      sheetName = `${sheetName.slice(0, 27)} (${n})`
    used.add(sheetName.toLowerCase())
    const ws = wb.addWorksheet(sheetName, {
      pageSetup: {
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true
      }
    })
    ws.columns = [{ width: 3 }, { width: 30 }, { width: 40 }, { width: 3 }]
    let r = 1
    if (imgId != null) {
      ws.addImage(imgId, { tl: { col: 1, row: 0 }, ext: { width: 170, height: 60 } })
      r = 5
    }
    if (docShowName) {
      ws.getCell(r, 2).value = docShowName
      ws.getCell(r, 2).font = { bold: true, size: 12, color: { argb: 'FF666666' } }
      r += 2
    }
    if (!e) {
      ws.getCell(r, 2).value = 'No devices are marked as projectors.'
      continue
    }
    const head = (label: string, value: string, size: number): void => {
      ws.getCell(r, 2).value = label
      ws.getCell(r, 2).font = { bold: true, size }
      ws.getCell(r, 2).alignment = { horizontal: 'right' }
      ws.getCell(r, 3).value = value
      ws.getCell(r, 3).font = { bold: true, size }
      ws.getRow(r).height = size + 8
      r++
    }
    head('Projector Model:', e.model, 14)
    head('Projector Name:', e.name, 14)
    if (e.location) head('Location:', e.location, 11)
    for (const s of e.sections) {
      r++
      ws.mergeCells(r, 2, r, 3)
      const banner = ws.getCell(r, 2)
      banner.value = s.title
      banner.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } }
      banner.alignment = { horizontal: 'center', vertical: 'middle' }
      banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A37' } }
      ws.getRow(r).height = 32
      r++
      if (s.note) {
        ws.mergeCells(r, 2, r, 3)
        ws.getCell(r, 2).value = s.note
        ws.getCell(r, 2).font = { italic: true, size: 9, color: { argb: 'FF666666' } }
        ws.getCell(r, 2).alignment = { horizontal: 'center' }
        r++
      }
      for (const [c, text] of [
        [2, 'Setting'],
        [3, 'Value']
      ] as const) {
        const cell = ws.getCell(r, c)
        cell.value = text
        cell.font = { bold: true, size: 12, color: { argb: argb(st.headerText) } }
        cell.alignment = { horizontal: 'center' }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.headerFill) } }
        cell.border = box
      }
      r++
      s.rows.forEach(([k, v], i) => {
        const label = ws.getCell(r, 2)
        const value = ws.getCell(r, 3)
        label.value = `${k}:`
        label.alignment = { horizontal: 'right' }
        value.value = v
        value.font = { bold: true }
        for (const cell of [label, value]) {
          cell.border = box
          if (i % 2 && st.stripes)
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: argb(st.stripeColor) }
            }
        }
        r++
      })
    }
    ws.pageSetup.printArea = `A1:D${r}`
  }
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer
}

/** Setup-sheet PDF: same layout, each projector starting on a new page. */
function projectorSheetHtml(logo: string | null): string {
  const entries = projectorSheetEntries()
  const title = 'Projector Setup Sheet'
  if (!entries.length) return page(title, '<p>No devices are marked as projectors.</p>', logo)
  const css = `<style>
    .pj + .pj { page-break-before: always; }
    .pj-head { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px;
               font-size: 16px; font-weight: 700; margin-bottom: 10px; }
    .pj-head .k { text-align: right; }
    .pj-head .loc { font-size: 12px; font-weight: 400; color: #555; }
    .pj-sec { margin: 14px 0 0; page-break-inside: avoid; }
    .pj-banner { background: #1f2a37; color: #fff; font-size: 17px; font-weight: 700;
                 text-align: center; padding: 6px; }
    .pj-note { text-align: center; font-style: italic; color: #666; font-size: 10px; margin: 3px 0; }
    .pj-sec td.k { width: 42%; text-align: right; }
    .pj-sec td.v { font-weight: 600; }
    .pj-sec th { text-align: center; font-size: 11px; }
  </style>`
  const body = entries
    .map((e) => {
      const head = `<div class="pj-head"><span class="k">Projector Model:</span><span>${esc(e.model)}</span><span class="k">Projector Name:</span><span>${esc(e.name)}</span>${
        e.location
          ? `<span class="k loc">Location:</span><span class="loc">${esc(e.location)}</span>`
          : ''
      }</div>`
      const secs = e.sections
        .map(
          (s) =>
            `<div class="pj-sec"><div class="pj-banner">${esc(s.title)}</div>${
              s.note ? `<div class="pj-note">${esc(s.note)}</div>` : ''
            }<table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>${s.rows
              .map(([k, v]) => `<tr><td class="k">${esc(k)}:</td><td class="v">${esc(v)}</td></tr>`)
              .join('')}</tbody></table></div>`
        )
        .join('')
      return `<div class="pj">${head}${secs}</div>`
    })
    .join('')
  return page(title, css + body, logo)
}

// ---- Truck load sheets ----------------------------------------------------
// One page per trip for the shop: which truck, when, from -> to (with
// addresses), who the driver calls on arrival, and every case to load with its
// description + a "loaded" checkbox.

function loadSheetHtml(tripId: number | undefined, logo: string | null): string {
  const trucks = new Map(listTrucks().map((t) => [t.id, t]))
  const trips = listTruckTrips()
    .filter((t) => tripId == null || t.id === tripId)
    .sort((a, b) => (a.date + a.departTime).localeCompare(b.date + b.departTime))
  const title = 'Truck Load Sheet'
  const [caseTpl] = templatesForDoc('loadsheet')
  if (!trips.length) return page(title, '<p>No trips yet.</p>', logo)
  const css = `<style>
    .ls + .ls { page-break-before: always; }
    .ls-show { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: .05em; }
    .ls-head { font-size: 20px; font-weight: 700; margin-bottom: 2px; }
    .ls-sub { font-size: 14px; color: #333; margin-bottom: 12px; }
    .ls-route { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .ls-box { border: 1px solid #cfcfcf; border-radius: 6px; padding: 8px 10px; }
    .ls-box .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #666; }
    .ls-box .place { font-size: 15px; font-weight: 700; margin: 2px 0; }
    .ls-box .addr { white-space: pre-line; font-size: 13px; }
    .ls-box .when { margin-top: 6px; font-size: 12px; }
    .ls-contact { border: 2px solid #1f2a37; background: #fff6d6; border-radius: 6px;
                  padding: 8px 12px; font-size: 15px; margin-bottom: 10px; }
    .ls-contact b { font-size: 16px; }
    .ls-meta { font-size: 12px; margin-bottom: 12px; }
    .ls td.box { width: 54px; text-align: center; font-size: 16px; }
    .ls td.num { font-weight: 700; white-space: nowrap; }
    .ls td.contents { white-space: pre-line; font-size: 11px; color: #333; }
    .ls-sign { display: flex; gap: 30px; margin-top: 22px; font-size: 12px; }
    .ls-sign span { flex: 1; border-top: 1px solid #333; padding-top: 3px; }
  </style>`
  const body = trips
    .map((t, i) => {
      const truck = t.truckId != null ? trucks.get(t.truckId) : undefined
      const truckLine = truck
        ? [truck.name, truck.vendor, truck.size].filter(Boolean).join(' — ')
        : 'Truck not assigned yet'
      const date = t.date
        ? new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })
        : 'Date not set'
      const cases = listCasesByIds(t.caseIds)
      const contact =
        t.contactName || t.contactPhone
          ? `<div class="ls-contact">On arrival, contact <b>${esc(t.contactName || '—')}</b>${
              t.contactPhone ? ` &nbsp;·&nbsp; <b>${esc(t.contactPhone)}</b>` : ''
            }</div>`
          : ''
      const dock =
        t.dockStart || t.dockEnd
          ? `Dock slot ${esc(t.dockStart || '?')}–${esc(t.dockEnd || '?')}`
          : ''
      // Sheets get pulled apart in the shop — every page after the first names the show too.
      const show = i > 0 && docShowName ? `<div class="ls-show">${esc(docShowName)}</div>` : ''
      return `<div class="ls">${show}
        <div class="ls-head">${esc(TRIP_KIND_LABEL[t.kind] ?? 'Trip')} · ${esc(date)}</div>
        <div class="ls-sub">${esc(truckLine)} &nbsp;·&nbsp; Status: ${esc(t.status)}</div>
        <div class="ls-route">
          <div class="ls-box"><div class="lbl">Pick up</div><div class="place">${esc(t.origin || '—')}</div>
            <div class="addr">${esc(t.originAddress)}</div>${t.departTime ? `<div class="when">Depart ${esc(t.departTime)}</div>` : ''}</div>
          <div class="ls-box"><div class="lbl">Deliver to</div><div class="place">${esc(t.destination || '—')}</div>
            <div class="addr">${esc(t.destinationAddress)}</div><div class="when">${[
              t.arriveTime ? `Arrive ${esc(t.arriveTime)}` : '',
              dock
            ]
              .filter(Boolean)
              .join(' &nbsp;·&nbsp; ')}</div></div>
        </div>
        ${contact}
        <div class="ls-meta">Driver: <b>${esc(t.driver || '—')}</b>${t.phone ? ` · ${esc(t.phone)}` : ''}</div>
        ${cases.length ? templateHtml(caseTpl, buildReport(caseTpl, caseRecords(t.id))) : '<p>No cases assigned to this trip.</p>'}
        <div class="ls-meta" style="margin-top:6px">${cases.length} case${cases.length === 1 ? '' : 's'} on this truck.</div>
        ${t.notes ? `<div class="ls-meta"><b>Notes:</b> ${esc(t.notes)}</div>` : ''}
        <div class="ls-sign"><span>Loaded by</span><span>Date / time</span><span>Received by</span></div>
      </div>`
    })
    .join('')
  return page(title, TEMPLATE_CSS + css + body, logo)
}

function tableCsv(t: Table): string {
  return [t.headers, ...t.rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\r\n')
}

/** One workbook, one styled sheet per table (sheet names: max 31 chars, no []:*?/\). */
async function sheetsXlsx(
  sheets: { name: string; table: Table; widths?: number[]; fontPx?: number }[],
  logo: string | null
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const { name, table: t, widths, fontPx } of sheets) {
    const base = name.replace(/[[\]:*?/\\]/g, '-').replace(/^'+|'+$/g, '').slice(0, 28) || 'Sheet'
    let sheetName = base
    for (let n = 2; used.has(sheetName.toLowerCase()); n++) sheetName = `${base} ${n}`
    used.add(sheetName.toLowerCase())
    const ws = wb.addWorksheet(sheetName)
    addTableSheet(wb, ws, t, logo, widths, fontPx)
  }
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer
}

function addTableSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  t: Table,
  logo: string | null,
  widths?: number[],
  fontPx?: number
): void {
  ws.columns = t.headers.map((h, i) => ({
    header: h,
    key: `c${i}`,
    width: widths?.[i] ?? Math.max(10, Math.min(30, h.length + 8))
  }))
  const img = parseImageDataUrl(logo)
  const headerRowNum = img ? 5 : 1
  if (img) {
    ws.spliceRows(1, 0, [], [], [], [])
    const imgId = wb.addImage({ base64: img.base64, extension: img.extension })
    ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 170, height: 60 } })
  }
  ws.views = [{ state: 'frozen', ySplit: headerRowNum }]
  for (const r of t.rows) ws.addRow(r)
  styleSheet(ws, headerRowNum, t.headers.length, fontPx)
}

// ---- Paperwork templates ---------------------------------------------------
// Every templated export (pull sheet, cable schedule, device list, IP schedule,
// the load sheet's case list, the Paperwork page) renders through these.

/** A template's table(s) as HTML: section headings (+ a bundle's swatch and route),
 *  merged repeat cells, centered check boxes. */
function templateHtml(t: PaperworkTemplate, built: BuiltReport, heading = ''): string {
  const total = built.widths.reduce((a, b) => a + b, 0) || 1
  const colgroup = `<colgroup>${built.widths
    .map((w) => `<col style="width:${((w / total) * 100).toFixed(2)}%">`)
    .join('')}</colgroup>`
  const align = (i: number): string => (built.center[i] ? ' style="text-align:center"' : '')
  const head = `<thead><tr>${built.headers.map((h, i) => `<th${align(i)}>${esc(h)}</th>`).join('')}</tr></thead>`
  const cell = (c: string): string => esc(c).replace(/\n/g, '<br>')
  const merged = t.mergeRepeats > 0
  const table = (s: BuiltReport['sections'][number]): string =>
    `<table class="lxr${merged ? ' grouped' : ''}">${colgroup}${head}<tbody>${s.rows
      .map((r, ri) => {
        // Each merged group is its own tbody so it moves to the next page whole.
        const split = merged && ri > 0 && s.spans?.[ri][0] ? '</tbody><tbody>' : ''
        const tds = r
          .map((c, ci) => {
            const span = s.spans?.[ri][ci] ?? 1
            if (!span) return ''
            const cls = merged && ci === 0 ? ' class="dcell"' : ''
            return `<td${span > 1 ? ` rowspan="${span}"` : ''}${cls}${align(ci)}>${cell(c)}</td>`
          })
          .join('')
        return `${split}<tr${s.bands ? ` class="g${s.bands[ri]}"` : ''}>${tds}</tr>`
      })
      .join('')}</tbody></table>`
  const empty =
    t.kind === 'count' && t.columns[0]
      ? `No ${esc(t.columns[0].label)} to list yet.`
      : 'Nothing to list yet.'
  const sections = built.sections.length
    ? built.sections
        .map(
          (s) =>
            (s.title
              ? `<h2 class="sec">${s.color ? `<span class="sw" style="background:${esc(s.color)}"></span>` : ''}${esc(
                  s.title
                )} <span class="meta">(${s.count})</span></h2>${s.note ? `<div class="meta">${esc(s.note)}</div>` : ''}`
              : '') + table(s)
        )
        .join('')
    : `<p>${empty}</p>`
  return `<div class="tpl" style="font-size:${t.fontSize}px">${heading ? `<h2 class="sec">${esc(heading)}</h2>` : ''}${sections}</div>`
}

/** CSV/Excel: one flat table per template; a section title becomes a leading column. */
function templateTable(
  t: PaperworkTemplate,
  built: BuiltReport
): { table: Table; widths: number[] } {
  const grouped = built.sections.some((s) => s.title)
  const noted = built.sections.some((s) => s.note) // a bundle's route and length
  return {
    table: {
      headers: [
        ...(grouped ? [fieldLabel(t.source, t.groupBy)] : []),
        ...(noted ? ['Route'] : []),
        ...built.headers
      ],
      rows: built.sections.flatMap((s) =>
        s.rows.map((r) => [
          ...(grouped ? [s.title] : []),
          ...(noted ? [s.note ?? ''] : []),
          ...r
        ])
      )
    },
    widths: [
      ...(grouped ? [16] : []),
      ...(noted ? [26] : []),
      ...built.widths.map((w) => Math.round(w / 7))
    ]
  }
}

const TEMPLATE_CSS =
  '<style>table.lxr.grouped tbody{break-inside:avoid}table.lxr{table-layout:fixed;width:100%}table.lxr td{overflow-wrap:anywhere}' +
  '.tpl + .tpl{margin-top:18px}.tpl .sec .meta{font-weight:400;margin:0}</style>'

/** Templated docs as a PDF page body. Several templates print one after the other
 *  (the IP schedule), each under its name. */
function templatesPage(
  title: string,
  parts: { t: PaperworkTemplate; built: BuiltReport }[],
  logo: string | null
): string {
  const multi = parts.length > 1
  return page(
    title,
    TEMPLATE_CSS + parts.map((p) => templateHtml(p.t, p.built, multi ? p.t.name : '')).join(''),
    logo
  )
}

/** Write templated docs as CSV, Excel (a sheet per template) or PDF. */
async function writeTemplated(
  outPath: string,
  format: ExportOptions['format'],
  title: string,
  parts: { t: PaperworkTemplate; built: BuiltReport }[],
  logo: string | null
): Promise<void> {
  if (format === 'csv')
    writeCsv(outPath, parts.map((p) => tableCsv(templateTable(p.t, p.built).table)).join('\r\n\r\n'))
  else if (format === 'xlsx')
    writeFileSync(
      outPath,
      await sheetsXlsx(
        parts.map((p) => ({
          name: p.t.name,
          ...templateTable(p.t, p.built),
          fontPx: p.t.fontSize
        })),
        logo
      )
    )
  else
    writeFileSync(
      outPath,
      await htmlToPdf(templatesPage(title, parts, logo), parts[0]?.t.orientation === 'landscape')
    )
}

// ---- Shop order / receiving checklist ------------------------------------

// The column registry: ORDER_COLUMN_META (name, short PDF header, number?, width)
// plus how to read each column off an item.
type ColDef = (typeof ORDER_COLUMN_META)[OrderColumnKey] & {
  cell: (it: OrderItem, qty: number, recv: number, last?: OrderItem) => string
}
const CELL: Record<OrderColumnKey, ColDef['cell']> = {
  category: (it) => it.category || '',
  item: (it) => it.name || '',
  manufacturer: (it) => it.manufacturer || '',
  model: (it) => it.modelNumber || '',
  requested: (_it, qty) => String(qty),
  previous: (_it, _qty, _recv, last) => (last ? String(Number(last.quantity) || 0) : ''),
  received: (_it, _qty, recv) => String(recv),
  outstanding: (_it, qty, recv) => String(Math.max(0, qty - recv)),
  notes: (it) => it.notes || ''
}
const ORDER_COLS = Object.fromEntries(
  (Object.keys(CELL) as OrderColumnKey[]).map((k) => [
    k,
    { ...ORDER_COLUMN_META[k], cell: CELL[k] }
  ])
) as Record<OrderColumnKey, ColDef>

/** A column's header: the format's own text, else its name (PDF: the short name). */
const colHeader = (c: OrderColumn, short = false): string =>
  c.label?.trim() || (short ? ORDER_COLS[c.key].short : ORDER_COLS[c.key].label)

const ALL_KEYS: OrderColumnKey[] = [
  'category',
  'item',
  'manufacturer',
  'model',
  'requested',
  'previous',
  'received',
  'outstanding',
  'notes'
]

/** The built-in default format — reproduces the original fixed layout. */
function defaultFormat(receiving: boolean): OrderExportFormat {
  const shown = new Set<OrderColumnKey>([
    'item',
    'manufacturer',
    'model',
    'requested',
    'received',
    'notes'
  ])
  if (receiving) shown.add('outstanding')
  return {
    id: 0,
    name: 'Default',
    columns: ALL_KEYS.map((key) => ({ key, show: shown.has(key), width: ORDER_COLS[key].width })),
    groupByCategory: true,
    sort: 'category',
    orientation: 'portrait',
    fontSize: 12,
    layout: 'standard',
    createdAt: '',
    updatedAt: ''
  }
}

type Resolved = {
  columns: OrderColumn[] // shown, in print order
  groupByCategory: boolean
  sort: OrderExportFormat['sort']
  orientation: OrderExportFormat['orientation']
  fontSize: number
  layout: OrderExportFormat['layout']
  /** items as of the last export (Old qty column), keyed by itemKey */
  last: PrevItems | null
  /** lines on the baseline that are no longer on the order (when highlighting) */
  removed: OrderItem[]
}

/** Turn a stored format (or the default) into the shown, ordered column list. */
function resolveFormat(fmt: OrderExportFormat | null, receiving: boolean): Resolved {
  const f = fmt ?? defaultFormat(receiving)
  // Keep only known, shown columns; a template may predate a column, so fill gaps.
  const seen = new Set<OrderColumnKey>()
  const columns: OrderColumn[] = []
  for (const c of f.columns) {
    if (!ORDER_COLS[c.key] || seen.has(c.key)) continue
    seen.add(c.key)
    if (c.show)
      columns.push({
        key: c.key,
        show: true,
        width: c.width || ORDER_COLS[c.key].width,
        label: c.label
      })
  }
  if (columns.length === 0) columns.push({ key: 'item', show: true, width: ORDER_COLS.item.width })
  return {
    columns,
    groupByCategory: f.groupByCategory,
    sort: f.sort,
    orientation: f.orientation,
    fontSize: f.fontSize || 12,
    layout: f.layout,
    last: null,
    removed: []
  }
}

/** Columns for a flat medium (CSV/XLSX): when grouping, keep a Category column
 *  up front so the grouping survives in a flat file. */
function flatColumns(r: Resolved): OrderColumn[] {
  const cols = r.columns
  if (r.groupByCategory && !cols.some((c) => c.key === 'category')) {
    return [{ key: 'category', show: true, width: ORDER_COLS.category.width }, ...cols]
  }
  return cols
}

/** Columns for the grouped PDF body: the Category column is redundant with the
 *  section headings, so drop it when grouping. */
function bodyColumns(r: Resolved): OrderColumn[] {
  return r.groupByCategory ? r.columns.filter((c) => c.key !== 'category') : r.columns
}

function sortItems(
  items: ShopOrder['items'],
  sort: OrderExportFormat['sort'] | 'categoryOnly'
): ShopOrder['items'] {
  const out = items.slice()
  if (sort === 'categoryOnly') out.sort((a, b) => (a.category || '￿').localeCompare(b.category || '￿'))
  else if (sort === 'name') out.sort((a, b) => natural(a.name, b.name))
  else if (sort === 'outstanding')
    out.sort((a, b) => {
      const oa = Math.max(0, (Number(a.quantity) || 0) - (Number(a.received) || 0))
      const ob = Math.max(0, (Number(b.quantity) || 0) - (Number(b.received) || 0))
      return ob - oa || natural(a.name, b.name)
    })
  else
    out.sort(
      (a, b) => (a.category || '￿').localeCompare(b.category || '￿') || natural(a.name, b.name)
    )
  return out
}

type ItemChange = { label: string; kind: 'new' | 'chg' | '' }
const itemKey = (it: OrderItem): string =>
  (it.name + '|' + (it.modelNumber || '')).trim().toLowerCase()

type PrevItems = Map<OrderItem, OrderItem>

/** Pair each line with its line at the baseline, or null if there's no baseline.
 *  The same name and model listed twice pairs up in order. */
function matchPrevious(items: OrderItem[], prev: OrderItem[] | null): PrevItems | null {
  if (!prev) return null
  const pool = new Map<string, OrderItem[]>()
  for (const p of prev) pool.set(itemKey(p), [...(pool.get(itemKey(p)) ?? []), p])
  const out: PrevItems = new Map()
  for (const it of items) {
    const p = pool.get(itemKey(it))?.shift()
    if (p) out.set(it, p)
  }
  return out
}

/** Baseline lines with no match on the order now: they came off since last time. */
function removedItems(prev: OrderItem[] | null, map: PrevItems | null): OrderItem[] {
  if (!prev || !map) return []
  const kept = new Set(map.values())
  return prev.filter((p) => !kept.has(p))
}

/** What changed for this item vs. the last export. */
function changeFor(it: OrderItem, prevMap: PrevItems | null): ItemChange {
  if (!prevMap) return { label: '', kind: '' }
  const p = prevMap.get(it)
  if (!p) return { label: 'NEW', kind: 'new' }
  const parts: string[] = []
  if ((Number(p.quantity) || 0) !== (Number(it.quantity) || 0))
    parts.push(`req ${p.quantity}→${it.quantity}`)
  if ((Number(p.received) || 0) !== (Number(it.received) || 0))
    parts.push(`recv ${p.received}→${it.received}`)
  return { label: parts.join(', '), kind: parts.length ? 'chg' : '' }
}

/** SQLite UTC timestamp → local string. */
function fmtTs(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString()
}

/** Flat table (CSV/XLSX) built from the resolved format's columns. When
 *  `prevMap` is set, a leading Change column is added. */
function shopOrderTable(
  order: ShopOrder,
  r: Resolved,
  prevMap: PrevItems | null
): Table {
  const cols = flatColumns(r)
  const rows = sortItems(order.items, r.sort).map((it) => {
    const qty = Number(it.quantity) || 0
    const recv = Number(it.received) || 0
    const last = r.last?.get(it)
    const row = cols.map((c) => ORDER_COLS[c.key].cell(it, qty, recv, last))
    return prevMap ? [changeFor(it, prevMap).label, ...row] : row
  })
  const headers = cols.map((c) => colHeader(c))
  if (prevMap) {
    for (const p of r.removed) {
      const qty = Number(p.quantity) || 0
      const recv = Number(p.received) || 0
      rows.push(['REMOVED', ...cols.map((c) => ORDER_COLS[c.key].cell(p, qty, recv, p))])
    }
  }
  return { headers: prevMap ? ['Change', ...headers] : headers, rows }
}

/** Vendor, date and notes for CSV/XLSX, which have no page header to carry them. */
function orderInfoTable(order: ShopOrder): Table {
  const rows: [string, string | null][] = [
    ['Vendor', order.vendor],
    ['Date', order.orderDate],
    ['Notes', order.notes]
  ]
  return {
    headers: ['Order', order.name],
    rows: rows.filter(([, v]) => v).map(([k, v]) => [k, v as string])
  }
}

/** Cable lines (type · length · qty) flat table for CSV/XLSX. */
function cableOrderTable(order: ShopOrder, receiving: boolean): Table {
  const rows = order.cables
    .slice()
    .sort((a, b) => natural(a.cableType, b.cableType) || natural(a.length, b.length))
    .map((c) => {
      const qty = Number(c.quantity) || 0
      const recv = Number(c.received) || 0
      const base = [c.cableType || '', c.length || '']
      return receiving
        ? [...base, String(qty), String(recv), String(Math.max(0, qty - recv)), c.notes || '']
        : [...base, String(qty), String(recv), c.notes || '']
    })
  const headers = receiving
    ? ['Cable type', 'Length', 'Requested', 'Received', 'Outstanding', 'Notes']
    : ['Cable type', 'Length', 'Requested', 'Received', 'Notes']
  return { headers, rows }
}

/** The cables PDF section (appended after the equipment sections). */
function cableSectionHtml(order: ShopOrder, receiving: boolean): string {
  if (!order.cables.length) return ''
  const rows = order.cables
    .slice()
    .sort((a, b) => natural(a.cableType, b.cableType) || natural(a.length, b.length))
  const head = receiving
    ? '<th class="chk">✓</th><th>Cable type</th><th>Length</th><th class="chk">Req</th><th class="chk">Recv</th><th class="chk">Out</th><th>Notes</th>'
    : '<th>Cable type</th><th>Length</th><th class="chk">Req</th><th class="chk">Recv</th><th>Notes</th>'
  const body = rows
    .map((c) => {
      const qty = Number(c.quantity) || 0
      const recv = Number(c.received) || 0
      const cells = `<td>${esc(c.cableType)}</td><td>${esc(c.length)}</td>`
      return receiving
        ? `<tr><td class="chk">☐</td>${cells}<td class="chk">${qty}</td><td class="chk">${recv}</td><td class="chk">${Math.max(0, qty - recv)}</td><td>${esc(c.notes || '')}</td></tr>`
        : `<tr>${cells}<td class="chk">${qty}</td><td class="chk">${recv}</td><td>${esc(c.notes || '')}</td></tr>`
    })
    .join('')
  return `<section><h2>Cables <span class="meta">(${rows.length})</span></h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`
}

/** A <colgroup> that spreads the shown columns across the page by their width
 *  weights (plus fixed slots for the leading check column, when present). */
function colGroup(cols: OrderColumn[], checkCol: boolean): string {
  const total = cols.reduce((s, c) => s + (c.width || 1), 0) || 1
  const parts: string[] = []
  if (checkCol) parts.push('<col style="width:34px">')
  for (const c of cols) {
    const pct = Math.max(3, Math.round(((c.width || 1) / total) * 100))
    parts.push(`<col style="width:${pct}%">`)
  }
  return `<colgroup>${parts.join('')}</colgroup>`
}

function headCells(cols: OrderColumn[], checkCol: boolean): string {
  const chk = checkCol ? '<th class="chk">✓</th>' : ''
  return (
    chk +
    cols
      .map(
        (c) => `<th${ORDER_COLS[c.key].num ? ' class="chk"' : ''}>${esc(colHeader(c, true))}</th>`
      )
      .join('')
  )
}

function bodyRow(
  it: OrderItem,
  cols: OrderColumn[],
  checkCol: boolean,
  prevMap: PrevItems | null,
  r: Resolved
): string {
  const qty = Number(it.quantity) || 0
  const recv = Number(it.received) || 0
  const last = r.last?.get(it)
  const eq = r.layout === 'equipmentList'
  const ch = changeFor(it, prevMap)
  const cls = ch.kind === 'new' ? ' class="row-new"' : ch.kind === 'chg' ? ' class="row-chg"' : ''
  const tag = ch.label ? ` <span class="chg-tag">${esc(ch.label)}</span>` : ''
  // equipment list: with no Notes column, a note prints under the item name
  const note =
    eq && it.notes && !cols.some((c) => c.key === 'notes')
      ? `<span class="eq-note">${esc(it.notes)}</span>`
      : ''
  const chk = checkCol ? '<td class="chk">☐</td>' : ''
  const cells = cols
    .map((c) => {
      const v = esc(ORDER_COLS[c.key].cell(it, qty, recv, last))
      let inner = v
      // the Change tag rides along on the Item cell
      if (c.key === 'item') inner = v + tag + note
      else if (eq && c.key === 'outstanding')
        inner = `<span class="bal${qty - recv > 0 ? ' due' : ''}">${v}</span>`
      const k = ORDER_COLS[c.key].num ? (c.key === 'previous' ? 'chk prev' : 'chk') : ''
      return `<td${k ? ` class="${k}"` : ''}>${inner}</td>`
    })
    .join('')
  return `<tr${cls}>${chk}${cells}</tr>`
}

/** PDF: order meta header, then either a section per category or one flat table,
 *  with the resolved columns + widths. Receiving adds a ☐ column; highlighting
 *  colors + tags new/changed rows. The equipment-list layout swaps the page
 *  header for its own and adds a title band and an end bar. */
function shopOrderHtml(
  order: ShopOrder,
  receiving: boolean,
  logo: string | null,
  prevMap: PrevItems | null,
  baselineDate: string,
  r: Resolved
): string {
  const eq = r.layout === 'equipmentList'
  const cols = bodyColumns(r)
  const items = sortItems(order.items, r.sort)
  const colg = colGroup(cols, receiving)
  const head = headCells(cols, receiving)

  let bodyHtml: string
  if (!items.length) {
    bodyHtml = '<p>No items on this order.</p>'
  } else if (r.groupByCategory) {
    const groups: { cat: string; items: ShopOrder['items'] }[] = []
    for (const it of sortItems(sortItems(order.items, r.sort === 'outstanding' ? 'outstanding' : 'name'), 'categoryOnly')) {
      const label = it.category?.trim() || 'Uncategorized'
      const last = groups[groups.length - 1]
      if (last && last.cat === label) last.items.push(it)
      else groups.push({ cat: label, items: [it] })
    }
    bodyHtml = groups
      .map((g) => {
        const body = g.items.map((it) => bodyRow(it, cols, receiving, prevMap, r)).join('')
        return `<section><h2>${esc(g.cat)} <span class="meta">(${g.items.length})</span></h2><table class="fixed">${colg}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`
      })
      .join('')
  } else {
    const body = items.map((it) => bodyRow(it, cols, receiving, prevMap, r)).join('')
    bodyHtml = `<section><table class="fixed">${colg}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`
  }

  const meta = [order.vendor, order.orderDate]
    .filter(Boolean)
    .map((x) => esc(x as string))
    .join(' · ')
  const legend = prevMap
    ? `<div class="legend"><span class="sw-new"></span> new &nbsp;&nbsp; <span class="sw-chg"></span> changed since last export${baselineDate ? ` (${esc(baselineDate)})` : ''}</div>`
    : ''
  const cables = cableSectionHtml(order, receiving)
  const gone = r.removed.length
    ? `<section><h2>Removed since last export <span class="meta">(${r.removed.length})</span></h2><ul>${r.removed
        .map((p) => `<li>${esc(p.name)}${p.modelNumber ? ` · ${esc(p.modelNumber)}` : ''} × ${Number(p.quantity) || 0}</li>`)
        .join('')}</ul></section>`
    : ''
  if (eq) {
    const docName = receiving ? 'Receiving checklist' : 'Equipment list'
    const top =
      `<div class="eq-head"><div class="eq-show">${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ''}<div>` +
      `<div class="eq-name">${esc(docShowName || order.name)}</div>${meta ? `<div class="eq-sub">${meta}</div>` : ''}</div></div></div>` +
      `<div class="eq-title">${esc(order.name)}</div>` +
      (order.notes ? `<div class="eq-notes">${esc(order.notes)}</div>` : '')
    return page(
      `${docName} — ${order.name}`,
      top + legend + bodyHtml + gone + cables,
      logo,
      r.fontSize,
      true
    )
  }
  const metaBlock =
    (meta ? `<div class="meta">${meta}</div>` : '') +
    (order.notes ? `<p>${esc(order.notes).replace(/\n/g, '<br>')}</p>` : '')
  const title = (receiving ? 'Receiving Checklist — ' : 'Shop Order — ') + order.name
  return page(title, metaBlock + legend + bodyHtml + gone + cables, logo, r.fontSize)
}

/** XLSX for an order: an Equipment/Receiving sheet + (if any) a Cables sheet.
 *  `widths` (when given) sets the column character widths from the format. */
async function orderXlsx(
  order: ShopOrder,
  receiving: boolean,
  prevMap: PrevItems | null,
  logo: string | null,
  r: Resolved
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const img = parseImageDataUrl(logo)
  // Width per header label: Change column + the resolved columns' weights.
  const widthByHeader = new Map<string, number>()
  for (const c of flatColumns(r))
    widthByHeader.set(colHeader(c), c.width || ORDER_COLS[c.key].width)
  widthByHeader.set('Change', 16)
  const addSheet = (sheetName: string, t: Table, useWidths: boolean): void => {
    const ws = wb.addWorksheet(sheetName)
    ws.columns = t.headers.map((h) => ({
      header: h,
      key: h,
      width:
        useWidths && widthByHeader.has(h)
          ? Math.max(6, widthByHeader.get(h) as number)
          : Math.max(10, Math.min(30, h.length + 8))
    }))
    const headerRowNum = img ? 5 : 1
    if (img) {
      ws.spliceRows(1, 0, [], [], [], [])
      const imgId = wb.addImage({ base64: img.base64, extension: img.extension })
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 170, height: 60 } })
    }
    ws.views = [{ state: 'frozen', ySplit: headerRowNum }]
    for (const row of t.rows) ws.addRow(row)
    styleSheet(ws, headerRowNum, t.headers.length, r.fontSize)
  }
  addSheet(receiving ? 'Receiving' : 'Equipment', shopOrderTable(order, r, prevMap), true)
  if (order.cables.length) addSheet('Cables', cableOrderTable(order, receiving), false)
  const info = orderInfoTable(order)
  if (info.rows.length) addSheet('Order info', info, false)
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer
}

async function htmlToPdf(html: string, landscape: boolean, footerNote?: string): Promise<Buffer> {
  return withPrintWindow(html, async (win) => {
    // Running footer on every page: show name (left) + optional note (center,
    // e.g. the export timestamp) + "Page X of Y" (right).
    const footer =
      '<div style="width:100%;font-size:8px;color:#888;padding:0 0.4in;display:flex;justify-content:space-between;">' +
      `<span>${esc(docShowName || '')}</span>` +
      `<span>${esc(footerNote || '')}</span>` +
      '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape,
      pageSize: 'Letter',
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer,
      margins: { top: 0.5, bottom: 0.6, left: 0.5, right: 0.5 }
    })
    return pdf
  })
}

// ---- Public entry --------------------------------------------------------
const DOC_LABEL: Record<ExportOptions['doc'], string> = {
  pullsheet: 'pull sheet',
  schedule: 'cable schedule',
  labels: 'labels',
  ipschedule: 'IP schedule',
  devicelist: 'device list',
  projectorsheet: 'projector setup sheet',
  loadsheet: 'load sheet',
  order: 'pull order',
  receiving: 'receiving checklist'
}

const DOC_TITLE = {
  pullsheet: 'Pull Sheet',
  schedule: 'Cable Schedule',
  devicelist: 'Device List',
  ipschedule: 'IP Schedule'
} as const

/** A templated doc's template(s), each built from its rows (cables: the chosen bundles). */
function docParts(
  doc: keyof typeof DOC_TITLE,
  bundles?: Bundle[]
): { t: PaperworkTemplate; built: BuiltReport }[] {
  return templatesForDoc(doc).map((t) => ({
    t,
    built: buildReport(t, recordsFor(t.source, bundles))
  }))
}

export async function exportDocument(opts: ExportOptions): Promise<string | null> {
  const logo = getProjectMeta('logo') // per-show logo stamped onto paperwork
  docShowName = getProjectMeta('showName') // used by page() header + pdf footer

  // Shop order: a pull order (for the shop) or a receiving checklist (for the team).
  if (opts.doc === 'order' || opts.doc === 'receiving') {
    const order = opts.orderId != null ? getShopOrderById(opts.orderId) : null
    if (!order) return null
    const receiving = opts.doc === 'receiving'
    const label = receiving ? 'receiving checklist' : 'pull order'
    const res = await dialog.showSaveDialog({
      defaultPath: `${order.name} ${label}.${opts.format}`.replace(/[/\\:]/g, '-'),
      filters: [{ name: opts.format.toUpperCase(), extensions: [opts.format] }]
    })
    if (res.canceled || !res.filePath) return null
    const outPath = res.filePath
    // Change highlighting compares against the snapshot from the last export.
    const baseline = getOrderBaseline(order.id, order.items)
    const previous = matchPrevious(order.items, baseline?.items ?? null)
    const prevMap = opts.highlightChanges ? previous : null
    const baselineDate = fmtTs(baseline?.at ?? null)
    const fmt = opts.formatId != null ? getOrderExportFormatById(opts.formatId) : null
    const resolved = resolveFormat(fmt, receiving)
    resolved.last = previous
    resolved.removed = prevMap ? removedItems(baseline?.items ?? null, previous) : []
    const table = shopOrderTable(order, resolved, prevMap)
    if (opts.format === 'csv') {
      const cablesCsv = order.cables.length
        ? '\r\n\r\nCABLES\r\n' + tableCsv(cableOrderTable(order, receiving))
        : ''
      const info = orderInfoTable(order)
      const infoCsv = info.rows.length ? '\r\n\r\n' + tableCsv(info) : ''
      writeCsv(outPath, tableCsv(table) + cablesCsv + infoCsv)
    } else if (opts.format === 'xlsx')
      writeFileSync(outPath, await orderXlsx(order, receiving, prevMap, logo, resolved))
    else
      writeFileSync(
        outPath,
        await htmlToPdf(
          shopOrderHtml(order, receiving, logo, prevMap, baselineDate, resolved),
          resolved.orientation === 'landscape',
          `Exported ${new Date().toLocaleString()}`
        )
      )
    // Only what goes to the shop moves the baseline; a receiving checklist doesn't.
    if (!receiving) markOrderExported(order.id, order.items)
    shell.openPath(outPath)
    return outPath
  }

  // Truck load sheet(s): PDF, one page per trip.
  if (opts.doc === 'loadsheet') {
    const trip = opts.tripId != null ? listTruckTrips().find((t) => t.id === opts.tripId) : null
    const name = trip
      ? `Load sheet ${trip.date || 'undated'} ${trip.destination || ''}`.trim()
      : 'Load sheets'
    const res = await dialog.showSaveDialog({
      defaultPath: `${name.replace(/[/\\:*?"<>|]/g, '-')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(
      res.filePath,
      await htmlToPdf(
        loadSheetHtml(opts.tripId, logo),
        templatesForDoc('loadsheet')[0].orientation === 'landscape'
      )
    )
    shell.openPath(res.filePath)
    return res.filePath
  }

  // Projector setup sheet (project-wide, portrait).
  if (opts.doc === 'projectorsheet') {
    const res = await dialog.showSaveDialog({
      defaultPath: `Projector setup sheet.${opts.format}`,
      filters: [{ name: opts.format.toUpperCase(), extensions: [opts.format] }]
    })
    if (res.canceled || !res.filePath) return null
    const outPath = res.filePath
    if (opts.format === 'csv') writeCsv(outPath, tableCsv(projectorSheetTable()))
    else if (opts.format === 'xlsx') writeFileSync(outPath, await projectorSheetXlsx(logo))
    else writeFileSync(outPath, await htmlToPdf(projectorSheetHtml(logo), false))
    shell.openPath(outPath)
    return outPath
  }

  // Project-wide device exports (no bundles), laid out by their Paperwork templates.
  if (opts.doc === 'ipschedule' || opts.doc === 'devicelist') {
    const label = opts.doc === 'devicelist' ? 'Device list' : 'IP schedule'
    const res = await dialog.showSaveDialog({
      defaultPath: `${label}.${opts.format}`,
      filters: [{ name: opts.format.toUpperCase(), extensions: [opts.format] }]
    })
    if (res.canceled || !res.filePath) return null
    await writeTemplated(res.filePath, opts.format, DOC_TITLE[opts.doc], docParts(opts.doc), logo)
    shell.openPath(res.filePath)
    return res.filePath
  }

  const idx = buildDeviceIndex()
  const bundles = collectBundles(opts)

  const base = opts.scope === 'bundle' ? (bundles[0]?.name ?? 'Bundle') : 'All bundles'
  const defaultName = `${base} ${DOC_LABEL[opts.doc]}.${opts.format}`.replace(/[/\\:]/g, '-')

  const res = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: opts.format.toUpperCase(), extensions: [opts.format] }]
  })
  if (res.canceled || !res.filePath) return null
  const outPath = res.filePath

  if (opts.doc === 'labels') {
    const html =
      opts.labelStyle === 'flag'
        ? flagLabelsHtml(bundles, idx, logo)
        : labelsHtml(bundles, idx, logo)
    writeFileSync(outPath, await htmlToPdf(html, false))
  } else {
    // pull sheet / cable schedule, laid out by their Paperwork templates
    const doc = opts.doc === 'pullsheet' ? 'pullsheet' : 'schedule'
    await writeTemplated(outPath, opts.format, DOC_TITLE[doc], docParts(doc, bundles), logo)
  }

  shell.openPath(outPath)
  return outPath
}

// ---- Server-facing HTML (for the LAN Show Server) -------------------------
// Thin wrappers that set the module-level show name (used by page()) from the
// current project, then return the same self-styled HTML the PDF path renders.
// These let the embedded web server reuse the exact paperwork layouts.

/** The IP schedule as a standalone HTML page. */
export function ipSchedulePageHtml(): string {
  docShowName = getProjectMeta('showName')
  return templatesPage(DOC_TITLE.ipschedule, docParts('ipschedule'), getProjectMeta('logo'))
}

/** The device list (category-sectioned) as a standalone HTML page. */
export function deviceListPageHtml(): string {
  docShowName = getProjectMeta('showName')
  return templatesPage(DOC_TITLE.devicelist, docParts('devicelist'), getProjectMeta('logo'))
}

// ---- Paperwork page export ---------------------------------------------------

/** Export any template from the Paperwork page as PDF, Excel or CSV. */
export async function exportPaperwork(
  t: PaperworkTemplate,
  format: 'pdf' | 'xlsx' | 'csv'
): Promise<string | null> {
  const logo = getProjectMeta('logo')
  docShowName = getProjectMeta('showName')
  const res = await dialog.showSaveDialog({
    defaultPath: `${t.name.replace(/[/\\:*?"<>|]/g, '-') || 'Paperwork'}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  })
  if (res.canceled || !res.filePath) return null
  await writeTemplated(
    res.filePath,
    format,
    t.name,
    [{ t, built: buildReport(t, recordsFor(t.source)) }],
    logo
  )
  shell.openPath(res.filePath)
  return res.filePath
}
