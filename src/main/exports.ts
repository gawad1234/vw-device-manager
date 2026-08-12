import { BrowserWindow, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import ExcelJS from 'exceljs'
import { getProjectMeta, listBundles, listDevices } from './repository'
import type { Bundle, CableEndpoint, ExportOptions } from '../shared/types'

// ---- Endpoint resolution -------------------------------------------------
// A cable endpoint is a device (+ optional port) or free text. Resolve it to a
// readable string using the current device list.
type DeviceIndex = Map<number, { name: string; ports: Map<number, string> }>

function buildDeviceIndex(): DeviceIndex {
  const idx: DeviceIndex = new Map()
  for (const d of listDevices()) {
    idx.set(d.id, { name: d.name, ports: new Map(d.ports.map((p) => [p.id, p.label])) })
  }
  return idx
}

function resolveEndpoint(ep: CableEndpoint, idx: DeviceIndex): string {
  if (ep.deviceId != null) {
    const dev = idx.get(ep.deviceId)
    if (dev) {
      const port = ep.portId != null ? dev.ports.get(ep.portId) : undefined
      return port ? `${dev.name} · ${port}` : dev.name
    }
  }
  return ep.text?.trim() || '—'
}

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

function bundleToRows(bundle: Bundle, idx: DeviceIndex): Row[] {
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
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

function toCsv(rows: Row[], includeBundle: boolean): string {
  const headers = [
    ...(includeBundle ? ['Bundle'] : []),
    'Cable',
    'Type',
    'From',
    'To',
    'Length',
    'Pulled',
    'Labeled',
    'Notes'
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    const cells = [
      ...(includeBundle ? [r.bundle] : []),
      r.cable,
      r.type,
      r.from,
      r.to,
      r.length,
      r.pulled ? 'Yes' : 'No',
      r.labeled ? 'Yes' : 'No',
      r.notes
    ]
    lines.push(cells.map((c) => csvCell(String(c))).join(','))
  }
  return lines.join('\r\n')
}

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

async function toXlsx(rows: Row[], includeBundle: boolean, logo: string | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Cables')
  ws.columns = [
    ...(includeBundle ? [{ header: 'Bundle', key: 'bundle', width: 22 }] : []),
    { header: 'Cable', key: 'cable', width: 18 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'From', key: 'from', width: 26 },
    { header: 'To', key: 'to', width: 26 },
    { header: 'Length', key: 'length', width: 10 },
    { header: 'Pulled', key: 'pulled', width: 8 },
    { header: 'Labeled', key: 'labeled', width: 9 },
    { header: 'Notes', key: 'notes', width: 24 }
  ]

  // Logo: push the header/data down a few rows and float the image top-left.
  const img = parseImageDataUrl(logo)
  const headerRowNum = img ? 5 : 1
  if (img) {
    ws.spliceRows(1, 0, [], [], [], [])
    const imgId = wb.addImage({ base64: img.base64, extension: img.extension })
    ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 170, height: 60 } })
  }
  ws.getRow(headerRowNum).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: headerRowNum }]
  for (const r of rows) {
    ws.addRow({
      bundle: r.bundle,
      cable: r.cable,
      type: r.type,
      from: r.from,
      to: r.to,
      length: r.length,
      pulled: r.pulled ? '✓' : '',
      labeled: r.labeled ? '✓' : '',
      notes: r.notes
    })
  }
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer
}

// ---- PDF (HTML -> Electron printToPDF, no dependency) --------------------
function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  )
}

function page(title: string, body: string, logo: string | null): string {
  const header = `<header class="ph"><h1>${esc(title)}</h1>${
    logo ? `<img class="logo" src="${logo}" alt="logo">` : ''
  }</header>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
           color: #1b1b1f; margin: 0; padding: 22px; font-size: 12px; }
    .ph { display: flex; align-items: center; justify-content: space-between; gap: 16px;
          border-bottom: 2px solid #dddddd; padding-bottom: 10px; margin-bottom: 16px; }
    .ph h1 { margin: 0; }
    .logo { max-height: 60px; max-width: 240px; object-fit: contain; }
    h1 { font-size: 18px; margin: 0 0 14px; }
    section { margin-bottom: 20px; page-break-inside: avoid; }
    h2 { font-size: 14px; margin: 0 0 2px; display: flex; align-items: center; gap: 8px; }
    .sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; border: 1px solid #0003; }
    .meta { color: #666; font-size: 11px; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cfcfcf; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
    td.chk, th.chk { text-align: center; width: 58px; font-size: 15px; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .labels { display: flex; flex-wrap: wrap; gap: 8px; }
    .label { width: 2.6in; border: 1px solid #bbb; border-left-width: 6px; border-radius: 4px;
             padding: 7px 9px; page-break-inside: avoid; }
    .label .name { font-weight: 700; font-size: 13px; }
    .label .ends { font-size: 11px; margin-top: 2px; }
    .label .type { font-size: 10px; color: #666; margin-top: 2px; }
    /* wrap-around flag labels: [ end ][ striped wrap zone ][ mirrored end ] */
    .flags { display: flex; flex-wrap: wrap; gap: 8px; }
    .flag { display: flex; align-items: stretch; height: 0.5in; width: 3.4in;
            border: 1px solid #bbbbbb; border-radius: 3px; overflow: hidden; }
    .fend { flex: 0 0 1.2in; padding: 2px 7px; overflow: hidden; display: flex;
            flex-direction: column; justify-content: center; border-top: 3px solid var(--c, #888); }
    .fend.mir { transform: scaleX(-1); }
    .fwrap { flex: 1; border-left: 1px dashed #999999; border-right: 1px dashed #999999;
             background: repeating-linear-gradient(45deg,#f4f4f4,#f4f4f4 3px,#fff 3px,#fff 6px); }
    .fname { font-weight: 700; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fends { font-size: 8px; color: #555555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style></head><body>${header}${body}</body></html>`
}

function pullSheetHtml(bundles: Bundle[], idx: DeviceIndex, logo: string | null): string {
  const sections = bundles
    .map((b) => {
      const rows = bundleToRows(b, idx)
      const body =
        rows
          .map(
            (r) =>
              `<tr><td>${esc(r.cable)}</td><td>${esc(r.type)}</td><td>${esc(r.from)}</td><td>${esc(
                r.to
              )}</td><td class="chk">${r.pulled ? '☑' : '☐'}</td><td class="chk">${
                r.labeled ? '☑' : '☐'
              }</td></tr>`
          )
          .join('') || '<tr><td colspan="6">No cables in this bundle.</td></tr>'
      return `<section><h2><span class="sw" style="background:${b.color || '#cccccc'}"></span>${esc(
        b.name
      )}</h2><div class="meta">${esc(b.fromLocation || '—')} → ${esc(b.toLocation || '—')}${
        b.length ? ' · ' + esc(b.length) : ''
      }</div><table><thead><tr><th>Cable</th><th>Type</th><th>From</th><th>To</th><th class="chk">Pulled</th><th class="chk">Labeled</th></tr></thead><tbody>${body}</tbody></table></section>`
    })
    .join('')
  return page('Pull Sheet', sections, logo)
}

function scheduleHtml(rows: Row[], logo: string | null): string {
  const body =
    rows
      .map(
        (r) =>
          `<tr><td>${esc(r.bundle)}</td><td>${esc(r.cable)}</td><td>${esc(r.type)}</td><td>${esc(
            r.from
          )}</td><td>${esc(r.to)}</td><td>${esc(r.length)}</td><td class="chk">${
            r.pulled ? '☑' : ''
          }</td><td class="chk">${r.labeled ? '☑' : ''}</td><td>${esc(r.notes)}</td></tr>`
      )
      .join('') || '<tr><td colspan="9">No cables.</td></tr>'
  const table = `<table><thead><tr><th>Bundle</th><th>Cable</th><th>Type</th><th>From</th><th>To</th><th>Length</th><th class="chk">Pulled</th><th class="chk">Labeled</th><th>Notes</th></tr></thead><tbody>${body}</tbody></table>`
  return page('Cable Schedule', table, logo)
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
 * ends together to form the flag. The right end is mirrored so both faces of the
 * finished flag read correctly.
 */
function flagLabelsHtml(bundles: Bundle[], idx: DeviceIndex, logo: string | null): string {
  const flags =
    bundles
      .flatMap((b) =>
        bundleToRows(b, idx).map((r) => {
          const end = `<div class="fname">${esc(r.cable)}</div><div class="fends">${esc(
            `${r.from} → ${r.to}`
          )}</div>`
          return `<div class="flag" style="--c:${b.color || '#888888'}"><div class="fend">${end}</div><div class="fwrap"></div><div class="fend mir">${end}</div></div>`
        })
      )
      .join('') || '<p>No cables.</p>'
  return page('Cable Labels (wrap flags)', `<div class="flags">${flags}</div>`, logo)
}

async function htmlToPdf(html: string, landscape: boolean): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  try {
    await win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape,
      pageSize: 'Letter',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    })
    return pdf
  } finally {
    win.destroy()
  }
}

// ---- Public entry --------------------------------------------------------
const DOC_LABEL: Record<ExportOptions['doc'], string> = {
  pullsheet: 'pull sheet',
  schedule: 'cable schedule',
  labels: 'labels'
}

export async function exportDocument(opts: ExportOptions): Promise<string | null> {
  const idx = buildDeviceIndex()
  const bundles = collectBundles(opts)
  const includeBundle = opts.scope === 'all'
  const rows = bundles.flatMap((b) => bundleToRows(b, idx))
  const logo = getProjectMeta('logo') // per-show logo stamped onto paperwork

  const base = opts.scope === 'bundle' ? (bundles[0]?.name ?? 'Bundle') : 'All bundles'
  const defaultName = `${base} ${DOC_LABEL[opts.doc]}.${opts.format}`.replace(/[/\\:]/g, '-')

  const res = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: opts.format.toUpperCase(), extensions: [opts.format] }]
  })
  if (res.canceled || !res.filePath) return null
  const outPath = res.filePath

  if (opts.format === 'csv') {
    writeFileSync(outPath, toCsv(rows, includeBundle), 'utf-8')
  } else if (opts.format === 'xlsx') {
    writeFileSync(outPath, await toXlsx(rows, includeBundle, logo))
  } else {
    const html =
      opts.doc === 'pullsheet'
        ? pullSheetHtml(bundles, idx, logo)
        : opts.doc === 'labels'
          ? opts.labelStyle === 'flag'
            ? flagLabelsHtml(bundles, idx, logo)
            : labelsHtml(bundles, idx, logo)
          : scheduleHtml(rows, logo)
    writeFileSync(outPath, await htmlToPdf(html, opts.doc === 'schedule'))
  }

  shell.openPath(outPath)
  return outPath
}
