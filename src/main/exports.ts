import { BrowserWindow, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import ExcelJS from 'exceljs'
import { getProjectMeta, listBundles, listDevices, listSubnets } from './repository'
import { ipInCidr } from './ip-utils'
import type { Bundle, CableEndpoint, ExportOptions } from '../shared/types'

// The show name for the export in progress — read once in exportDocument and
// used by the shared page() header and printToPDF footer (avoids threading it
// through every renderer).
let docShowName: string | null = null

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
  const titleBlock = docShowName
    ? `<div class="show">${esc(docShowName)}</div><div class="doctitle">${esc(title)}</div>`
    : `<div class="show">${esc(title)}</div>`
  const header = `<header class="ph"><div class="ph-l">${titleBlock}</div>${
    logo ? `<img class="logo" src="${logo}" alt="logo">` : ''
  }</header>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
           color: #1b1b1f; margin: 0; padding: 22px; font-size: 12px; }
    .ph { display: flex; align-items: center; justify-content: space-between; gap: 16px;
          border-bottom: 2px solid #dddddd; padding-bottom: 10px; margin-bottom: 16px; }
    .ph-l { display: flex; flex-direction: column; gap: 2px; }
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

// ---- IP schedule (device-side) + generic table renderers ----------------
interface Table {
  headers: string[]
  rows: string[][]
}

/** Numeric VLAN for sorting; non-numeric / blank sorts last. */
function vlanSortKey(vlan: string): number {
  const n = parseInt(vlan, 10)
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

/** One row per port (blank IP shown if unassigned), plus a switch's
 *  management / out-of-band IPs. Sorted by VLAN, then grouped by device. */
function ipScheduleTable(): Table {
  const subnets = new Map(listSubnets().map((s) => [s.id, s]))
  const raw: {
    device: string
    port: string
    ip: string
    net: string
    cidr: string
    vlan: string
    mac: string
    type: string
    location: string
  }[] = []

  for (const d of listDevices()) {
    const base = {
      device: d.name,
      mac: d.macAddress ?? '',
      type: d.deviceType ?? '',
      location: d.location ?? ''
    }
    for (const p of d.ports) {
      const s = p.untaggedSubnetId != null ? subnets.get(p.untaggedSubnetId) : undefined
      raw.push({
        ...base,
        port: p.label,
        ip: p.ipAddress ?? '',
        net: s?.name ?? '',
        cidr: s?.cidr ?? '',
        vlan: s?.vlan ?? ''
      })
    }
    if (d.isSwitch) {
      if (d.managementIp)
        raw.push({ ...base, port: 'Management', ip: d.managementIp, net: '', cidr: '', vlan: '' })
      if (d.oobIp)
        raw.push({ ...base, port: 'Out-of-band', ip: d.oobIp, net: '', cidr: '', vlan: '' })
    }
  }

  // Sort by VLAN, then group by device name, then port.
  raw.sort(
    (a, b) =>
      vlanSortKey(a.vlan) - vlanSortKey(b.vlan) ||
      a.device.localeCompare(b.device) ||
      a.port.localeCompare(b.port)
  )
  return {
    headers: ['Device', 'Port', 'IP Address', 'Network', 'CIDR', 'VLAN', 'MAC', 'Type', 'Location'],
    rows: raw.map((r) => [r.device, r.port, r.ip, r.net, r.cidr, r.vlan, r.mac, r.type, r.location])
  }
}

/** One row per device: name, location, and its "main" VLAN + IP. The main IP is
 *  a switch's management IP (else its OOB, else its first port with an IP), or a
 *  regular device's first port that has an IP. The main VLAN is that IP's VLAN —
 *  from the port's untagged subnet when set, otherwise matched by CIDR. Sorted
 *  by device name. */
function deviceListTable(): Table {
  const subnets = listSubnets()
  const byId = new Map(subnets.map((s) => [s.id, s]))
  const vlanFor = (subnetId: number | null, ip: string): string => {
    if (subnetId != null) {
      const s = byId.get(subnetId)
      if (s) return s.vlan ?? '' // the port's assigned network is authoritative
    }
    if (ip) {
      // No assigned subnet (e.g. a switch mgmt IP) — find the network it lives in.
      const hit = subnets.find((s) => s.cidr && ipInCidr(ip, s.cidr) === true)
      if (hit) return hit.vlan ?? ''
    }
    return ''
  }

  const rows = listDevices()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => {
      let ip = ''
      let subnetId: number | null = null
      if (d.isSwitch && (d.managementIp || d.oobIp)) {
        ip = d.managementIp || d.oobIp || '' // switch IPs aren't tied to a port subnet
      } else {
        const p = d.ports.find((x) => x.ipAddress) ?? d.ports[0]
        if (p) {
          ip = p.ipAddress ?? ''
          subnetId = p.untaggedSubnetId
        }
      }
      return [d.name, d.location ?? '', vlanFor(subnetId, ip), ip]
    })

  return { headers: ['Device', 'Location', 'Main VLAN', 'Main IP'], rows }
}

/** Render a Table as a plain PDF page (alternating row shading via page() CSS). */
function simpleTableHtml(title: string, t: Table, logo: string | null): string {
  const head = t.headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = t.rows.length
    ? t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${t.headers.length}">No devices yet.</td></tr>`
  return page(title, `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`, logo)
}

function tableCsv(t: Table): string {
  return [t.headers, ...t.rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\r\n')
}

async function tableXlsx(t: Table, logo: string | null, sheetName = 'Sheet1'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  ws.columns = t.headers.map((h) => ({
    header: h,
    key: h,
    width: Math.max(10, Math.min(30, h.length + 8))
  }))
  const img = parseImageDataUrl(logo)
  const headerRowNum = img ? 5 : 1
  if (img) {
    ws.spliceRows(1, 0, [], [], [], [])
    const imgId = wb.addImage({ base64: img.base64, extension: img.extension })
    ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 170, height: 60 } })
  }
  ws.getRow(headerRowNum).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: headerRowNum }]
  for (const r of t.rows) ws.addRow(r)
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer
}

/**
 * IP schedule PDF: two sections (switch port-config, then device IPs). Each
 * device's device-level columns are one merged cell (rowspan) instead of
 * repeating, and each device group alternates shade. Ports within a device are
 * ordered by VLAN.
 */
function ipScheduleHtml(logo: string | null): string {
  const subnets = new Map(listSubnets().map((s) => [s.id, s]))
  const subLabel = (id: number | null): string => {
    if (id == null) return ''
    const s = subnets.get(id)
    if (!s) return ''
    return s.vlan ? `VLAN ${s.vlan}${s.name ? ` (${s.name})` : ''}` : s.name
  }
  const portVlan = (p: { untaggedSubnetId: number | null }): number =>
    vlanSortKey(
      (p.untaggedSubnetId != null ? subnets.get(p.untaggedSubnetId)?.vlan : '') ?? ''
    )

  const devices = listDevices()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
  const sortedPorts = <T extends { untaggedSubnetId: number | null; label: string }>(
    ports: T[]
  ): T[] => ports.slice().sort((a, b) => portVlan(a) - portVlan(b) || a.label.localeCompare(b.label))

  // Build a grouped table: `lead(device)` = the merged device-level cells for a
  // group's first row; `cells(port)` = the per-port cells. Empty devices get one
  // blank row so they still appear.
  function groupedTable(
    heading: string,
    headers: string[],
    group: typeof devices,
    lead: (d: (typeof devices)[number], span: number) => string,
    cells: (d: (typeof devices)[number], p: (typeof devices)[number]['ports'][number] | null) => string
  ): string {
    if (!group.length) return ''
    const rows = group
      .map((d, gi) => {
        const ports = sortedPorts(d.ports)
        const list = ports.length ? ports : [null]
        return list
          .map((p, i) => `<tr class="g${gi % 2}">${i === 0 ? lead(d, list.length) : ''}${cells(d, p)}</tr>`)
          .join('')
      })
      .join('')
    const head = headers.map((h) => `<th>${esc(h)}</th>`).join('')
    return `<h2 class="sec">${esc(heading)}</h2><table class="grouped"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
  }

  const switchTable = groupedTable(
    'Network switches — port config',
    ['Switch', 'Mgmt IP', 'OOB IP', 'Port', 'Native VLAN', 'Tagged VLANs'],
    devices.filter((d) => d.isSwitch),
    (d, span) =>
      `<td rowspan="${span}" class="dcell">${esc(d.name)}</td><td rowspan="${span}">${esc(
        d.managementIp || '—'
      )}</td><td rowspan="${span}">${esc(d.oobIp || '—')}</td>`,
    (_d, p) =>
      `<td>${p ? esc(p.label) : '—'}</td><td>${esc(p ? subLabel(p.untaggedSubnetId) : '')}</td><td>${esc(
        p ? p.taggedSubnetIds.map((id) => subLabel(id)).filter(Boolean).join(', ') : ''
      )}</td>`
  )

  const deviceTable = groupedTable(
    'Devices',
    ['Device', 'MAC', 'Type', 'Location', 'Port', 'IP Address', 'Network', 'VLAN'],
    devices.filter((d) => !d.isSwitch),
    (d, span) =>
      `<td rowspan="${span}" class="dcell">${esc(d.name)}</td><td rowspan="${span}">${esc(
        d.macAddress || ''
      )}</td><td rowspan="${span}">${esc(d.deviceType || '')}</td><td rowspan="${span}">${esc(
        d.location || ''
      )}</td>`,
    (_d, p) => {
      const s = p && p.untaggedSubnetId != null ? subnets.get(p.untaggedSubnetId) : undefined
      return `<td>${p ? esc(p.label) : '—'}</td><td>${p && p.ipAddress ? esc(p.ipAddress) : ''}</td><td>${esc(
        s?.name || ''
      )}</td><td>${esc(s?.vlan || '')}</td>`
    }
  )

  return page('IP Schedule', switchTable + deviceTable || '<p>No devices yet.</p>', logo)
}

async function htmlToPdf(html: string, landscape: boolean): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  try {
    await win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // Running footer on every page: show name (left) + "Page X of Y" (right).
    const footer =
      '<div style="width:100%;font-size:8px;color:#888;padding:0 0.4in;display:flex;justify-content:space-between;">' +
      `<span>${esc(docShowName || '')}</span>` +
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
  } finally {
    win.destroy()
  }
}

// ---- Public entry --------------------------------------------------------
const DOC_LABEL: Record<ExportOptions['doc'], string> = {
  pullsheet: 'pull sheet',
  schedule: 'cable schedule',
  labels: 'labels',
  ipschedule: 'IP schedule',
  devicelist: 'device list'
}

export async function exportDocument(opts: ExportOptions): Promise<string | null> {
  const logo = getProjectMeta('logo') // per-show logo stamped onto paperwork
  docShowName = getProjectMeta('showName') // used by page() header + pdf footer

  // Project-wide device exports (no bundles): the IP schedule and the device list.
  if (opts.doc === 'ipschedule' || opts.doc === 'devicelist') {
    const isDeviceList = opts.doc === 'devicelist'
    const label = isDeviceList ? 'Device list' : 'IP schedule'
    const res = await dialog.showSaveDialog({
      defaultPath: `${label}.${opts.format}`,
      filters: [{ name: opts.format.toUpperCase(), extensions: [opts.format] }]
    })
    if (res.canceled || !res.filePath) return null
    const outPath = res.filePath
    const table = isDeviceList ? deviceListTable() : ipScheduleTable()
    if (opts.format === 'csv') {
      writeFileSync(outPath, tableCsv(table), 'utf-8')
    } else if (opts.format === 'xlsx') {
      writeFileSync(outPath, await tableXlsx(table, logo, isDeviceList ? 'Devices' : 'IP Schedule'))
    } else {
      // Device list is a simple 4-column table (portrait); the IP schedule PDF
      // gets its bespoke sectioned/merged layout (landscape).
      const html = isDeviceList ? simpleTableHtml('Device List', table, logo) : ipScheduleHtml(logo)
      writeFileSync(outPath, await htmlToPdf(html, !isDeviceList))
    }
    shell.openPath(outPath)
    return outPath
  }

  const idx = buildDeviceIndex()
  const bundles = collectBundles(opts)
  const includeBundle = opts.scope === 'all'
  const rows = bundles.flatMap((b) => bundleToRows(b, idx))

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
