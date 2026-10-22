import { BrowserWindow, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import ExcelJS from 'exceljs'
import {
  getProjectMeta,
  getOrderExportSnapshot,
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
import { maskFromCidr } from './switch-config'
import {
  PROJECTOR_GROUPS,
  PROJECTOR_SETTINGS,
  projectorValueLabel
} from '../shared/projector-settings'
import { getCompanyName, getCompanyLogo } from './library'
import type {
  Bundle,
  CableEndpoint,
  ExportOptions,
  OrderColumn,
  OrderColumnKey,
  OrderExportFormat,
  OrderItem,
  PackCase,
  ShopOrder
} from '../shared/types'

// The show name for the export in progress — read once in exportDocument and
// used by the shared page() header and printToPDF footer (avoids threading it
// through every renderer).
let docShowName: string | null = null

// ---- Endpoint resolution -------------------------------------------------
// A cable endpoint is a device (+ optional port) or free text. Resolve it to a
// readable string using the current device list.
type DeviceIndex = Map<number, { name: string; ports: Map<number, string> }>

export function buildDeviceIndex(): DeviceIndex {
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

type Density = 'compact' | 'normal' | 'large'
const DENSITY_CSS: Record<Density, string> = {
  compact: 'body{font-size:10.5px}th,td{padding:3px 5px}',
  normal: '',
  large: 'body{font-size:13.5px}th,td{padding:7px 9px}h2{font-size:15px}'
}

function page(title: string, body: string, logo: string | null, density: Density = 'normal'): string {
  const titleBlock = docShowName
    ? `<div class="show">${esc(docShowName)}</div><div class="doctitle">${esc(title)}</div>`
    : `<div class="show">${esc(title)}</div>`
  // Company letterhead (shared across projects) sits above the show name.
  const companyName = getCompanyName()
  const companyLogo = getCompanyLogo()
  const companyBlock =
    companyName || companyLogo
      ? `<div class="company">${companyLogo ? `<img class="clogo" src="${companyLogo}" alt="">` : ''}${
          companyName ? `<span class="cname">${esc(companyName)}</span>` : ''
        }</div>`
      : ''
  const header = `<header class="ph"><div class="ph-l">${companyBlock}${titleBlock}</div>${
    logo ? `<img class="logo" src="${logo}" alt="logo">` : ''
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
    table.fixed td { overflow-wrap: anywhere; }
    th, td { border: 1px solid #cfcfcf; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
    td.chk, th.chk { text-align: center; width: 58px; font-size: 15px; }
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
    ${DENSITY_CSS[density]}
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
      if (p.isUnused) continue // jacks flagged "not needed" don't appear in schedules
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

interface DeviceEntry {
  name: string
  category: string // '' = uncategorized
  type: string
  location: string
  vlan: string
  ip: string
}

/** One entry per device: name, category, location, and its "main" VLAN + IP.
 *  The main IP is the user-designated primary port if set, else a switch's
 *  management IP (else OOB), else the first port with an IP. The main VLAN is
 *  that IP's VLAN — the port's untagged subnet when set, otherwise matched by
 *  CIDR. Sorted by category (uncategorized last), then device name. */
function deviceListEntries(): DeviceEntry[] {
  const subnets = listSubnets()
  const byId = new Map(subnets.map((s) => [s.id, s]))
  const vlanFor = (subnetId: number | null, ip: string): string => {
    if (subnetId != null) {
      const s = byId.get(subnetId)
      if (s) return s.vlan ?? '' // the port's assigned network is authoritative
    }
    if (ip) {
      const hit = subnets.find((s) => s.cidr && ipInCidr(ip, s.cidr) === true)
      if (hit) return hit.vlan ?? ''
    }
    return ''
  }

  const catSortKey = (c: string): string => (c ? c.toLowerCase() : '￿') // uncategorized last

  return listDevices()
    .map((d) => {
      let ip = ''
      let subnetId: number | null = null
      const chosen = d.ports.find((x) => x.isPrimary && !x.isUnused) // user-designated main port
      if (chosen) {
        ip = chosen.ipAddress ?? ''
        subnetId = chosen.untaggedSubnetId
      } else if (d.isSwitch && (d.managementIp || d.oobIp)) {
        ip = d.managementIp || d.oobIp || '' // switch IPs aren't tied to a port subnet
      } else {
        // Auto-pick among jacks that are actually in use.
        const usable = d.ports.filter((x) => !x.isUnused)
        const p = usable.find((x) => x.ipAddress) ?? usable[0]
        if (p) {
          ip = p.ipAddress ?? ''
          subnetId = p.untaggedSubnetId
        }
      }
      return {
        name: d.name,
        category: d.category?.trim() || '',
        type: d.deviceType ?? '',
        location: d.location ?? '',
        vlan: vlanFor(subnetId, ip),
        ip
      }
    })
    .sort(
      (a, b) =>
        catSortKey(a.category).localeCompare(catSortKey(b.category)) || a.name.localeCompare(b.name)
    )
}

/** Flat device-list table (for CSV/XLSX): a Category column, rows grouped by
 *  category via the sort so filtering/pivoting is easy. */
function deviceListTable(): Table {
  return {
    headers: ['Device', 'Category', 'Type', 'Location', 'Main VLAN', 'Main IP'],
    rows: deviceListEntries().map((e) => [
      e.name,
      e.category || 'Uncategorized',
      e.type,
      e.location,
      e.vlan,
      e.ip
    ])
  }
}

/** Device-list PDF: a section per category (heading + table). */
function deviceListHtml(logo: string | null): string {
  const entries = deviceListEntries()
  if (!entries.length) return page('Device List', '<p>No devices yet.</p>', logo)

  // Group consecutive entries (they're already sorted by category).
  const groups: { cat: string; items: DeviceEntry[] }[] = []
  for (const e of entries) {
    const label = e.category || 'Uncategorized'
    const last = groups[groups.length - 1]
    if (last && last.cat === label) last.items.push(e)
    else groups.push({ cat: label, items: [e] })
  }

  const sections = groups
    .map((g) => {
      const body = g.items
        .map(
          (e) =>
            `<tr><td>${esc(e.name)}</td><td>${esc(e.type)}</td><td>${esc(e.location)}</td><td>${esc(
              e.vlan
            )}</td><td>${esc(e.ip)}</td></tr>`
        )
        .join('')
      return `<section><h2>${esc(g.cat)} <span class="meta">(${g.items.length})</span></h2><table><thead><tr><th>Device</th><th>Type</th><th>Location</th><th>Main VLAN</th><th>Main IP</th></tr></thead><tbody>${body}</tbody></table></section>`
    })
    .join('')
  return page('Device List', sections, logo)
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
    .sort((a, b) => a.name.localeCompare(b.name))
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
  const thin = { style: 'thin' as const, color: { argb: 'FFCFCFCF' } }
  const box = { top: thin, bottom: thin, left: thin, right: thin }
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
        cell.font = { bold: true, size: 12 }
        cell.alignment = { horizontal: 'center' }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E9EF' } }
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
          if (i % 2)
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } }
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

const TRIP_KIND_LABEL: Record<string, string> = {
  delivery: 'Delivery',
  'load-in': 'Load-in',
  'load-out': 'Load-out',
  return: 'Return',
  other: 'Trip'
}

/** A case's description: its "Description" field if it has one, else its other fields
 *  (minus any "Truck" field — on a load sheet the truck is the page itself). */
function caseDescription(c: PackCase): string {
  const desc = c.fields.find((f) => /desc/i.test(f.label) && f.value.trim())
  if (desc) return desc.value
  return c.fields
    .filter((f) => f.value.trim() && !/truck/i.test(f.label))
    .map((f) => `${f.label}: ${f.value}`)
    .join(' · ')
}

function loadSheetHtml(tripId: number | undefined, logo: string | null): string {
  const trucks = new Map(listTrucks().map((t) => [t.id, t]))
  const trips = listTruckTrips()
    .filter((t) => tripId == null || t.id === tripId)
    .sort((a, b) => (a.date + a.departTime).localeCompare(b.date + b.departTime))
  const title = 'Truck Load Sheet'
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
      const rows = cases
        .map(
          (c) =>
            `<tr><td class="num">${esc(c.name)}</td><td>${esc(caseDescription(c))}</td><td class="contents">${esc(c.contents)}</td><td class="box">☐</td></tr>`
        )
        .join('')
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
        <table><thead><tr><th>Case</th><th>Description</th><th>Contents</th><th>Loaded</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No cases assigned to this trip.</td></tr>'}</tbody></table>
        <div class="ls-meta" style="margin-top:6px">${cases.length} case${cases.length === 1 ? '' : 's'} on this truck.</div>
        ${t.notes ? `<div class="ls-meta"><b>Notes:</b> ${esc(t.notes)}</div>` : ''}
        <div class="ls-sign"><span>Loaded by</span><span>Date / time</span><span>Received by</span></div>
      </div>`
    })
    .join('')
  return page(title, css + body, logo)
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
        const ports = sortedPorts(d.ports.filter((p) => !p.isUnused))
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

// ---- Shop order / receiving checklist ------------------------------------

// The column registry: label (and a short PDF header), whether it's a narrow
// centered number, a default width weight, and how to read it off an item.
type ColDef = {
  label: string
  short: string
  num: boolean
  width: number
  cell: (it: OrderItem, qty: number, recv: number) => string
}
const ORDER_COLS: Record<OrderColumnKey, ColDef> = {
  category: { label: 'Category', short: 'Category', num: false, width: 16, cell: (it) => it.category || '' },
  item: { label: 'Item', short: 'Item', num: false, width: 28, cell: (it) => it.name || '' },
  manufacturer: { label: 'Manufacturer', short: 'Manufacturer', num: false, width: 18, cell: (it) => it.manufacturer || '' },
  model: { label: 'Model', short: 'Model', num: false, width: 18, cell: (it) => it.modelNumber || '' },
  requested: { label: 'Requested', short: 'Req', num: true, width: 10, cell: (_it, qty) => String(qty) },
  received: { label: 'Received', short: 'Recv', num: true, width: 10, cell: (_it, _qty, recv) => String(recv) },
  outstanding: { label: 'Outstanding', short: 'Out', num: true, width: 10, cell: (_it, qty, recv) => String(Math.max(0, qty - recv)) },
  notes: { label: 'Notes', short: 'Notes', num: false, width: 24, cell: (it) => it.notes || '' }
}

const ALL_KEYS: OrderColumnKey[] = [
  'category', 'item', 'manufacturer', 'model', 'requested', 'received', 'outstanding', 'notes'
]

/** The built-in default format — reproduces the original fixed layout. */
function defaultFormat(receiving: boolean): OrderExportFormat {
  const shown = new Set<OrderColumnKey>([
    'item', 'manufacturer', 'model', 'requested', 'received', 'notes'
  ])
  if (receiving) shown.add('outstanding')
  return {
    id: 0,
    name: 'Default',
    columns: ALL_KEYS.map((key) => ({ key, show: shown.has(key), width: ORDER_COLS[key].width })),
    groupByCategory: true,
    sort: 'category',
    orientation: 'portrait',
    density: 'normal',
    createdAt: '',
    updatedAt: ''
  }
}

type Resolved = {
  columns: OrderColumn[] // shown, in print order
  groupByCategory: boolean
  sort: OrderExportFormat['sort']
  orientation: OrderExportFormat['orientation']
  density: OrderExportFormat['density']
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
    if (c.show) columns.push({ key: c.key, show: true, width: c.width || ORDER_COLS[c.key].width })
  }
  if (columns.length === 0) columns.push({ key: 'item', show: true, width: ORDER_COLS.item.width })
  return {
    columns,
    groupByCategory: f.groupByCategory,
    sort: f.sort,
    orientation: f.orientation,
    density: f.density
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

function sortItems(items: ShopOrder['items'], sort: OrderExportFormat['sort']): ShopOrder['items'] {
  const out = items.slice()
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'outstanding')
    out.sort((a, b) => {
      const oa = Math.max(0, (Number(a.quantity) || 0) - (Number(a.received) || 0))
      const ob = Math.max(0, (Number(b.quantity) || 0) - (Number(b.received) || 0))
      return ob - oa || a.name.localeCompare(b.name)
    })
  else
    out.sort(
      (a, b) => (a.category || '￿').localeCompare(b.category || '￿') || a.name.localeCompare(b.name)
    )
  return out
}

type ItemChange = { label: string; kind: 'new' | 'chg' | '' }
const itemKey = (it: OrderItem): string =>
  (it.name + '|' + (it.modelNumber || '')).trim().toLowerCase()

/** Map the previous (last-export) items by identity, or null if not highlighting. */
function prevItemMap(prev: OrderItem[] | null): Map<string, OrderItem> | null {
  if (!prev) return null
  return new Map(prev.map((p) => [itemKey(p), p]))
}

/** What changed for this item vs. the last export. */
function changeFor(it: OrderItem, prevMap: Map<string, OrderItem> | null): ItemChange {
  if (!prevMap) return { label: '', kind: '' }
  const p = prevMap.get(itemKey(it))
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
  prevMap: Map<string, OrderItem> | null
): Table {
  const cols = flatColumns(r)
  const rows = sortItems(order.items, r.sort).map((it) => {
    const qty = Number(it.quantity) || 0
    const recv = Number(it.received) || 0
    const row = cols.map((c) => ORDER_COLS[c.key].cell(it, qty, recv))
    return prevMap ? [changeFor(it, prevMap).label, ...row] : row
  })
  const headers = cols.map((c) => ORDER_COLS[c.key].label)
  return { headers: prevMap ? ['Change', ...headers] : headers, rows }
}

/** Cable lines (type · length · qty) flat table for CSV/XLSX. */
function cableOrderTable(order: ShopOrder, receiving: boolean): Table {
  const rows = order.cables
    .slice()
    .sort((a, b) => a.cableType.localeCompare(b.cableType) || a.length.localeCompare(b.length))
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
    .sort((a, b) => a.cableType.localeCompare(b.cableType) || a.length.localeCompare(b.length))
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
      .map((c) => `<th${ORDER_COLS[c.key].num ? ' class="chk"' : ''}>${esc(ORDER_COLS[c.key].short)}</th>`)
      .join('')
  )
}

function bodyRow(
  it: OrderItem,
  cols: OrderColumn[],
  checkCol: boolean,
  prevMap: Map<string, OrderItem> | null
): string {
  const qty = Number(it.quantity) || 0
  const recv = Number(it.received) || 0
  const ch = changeFor(it, prevMap)
  const cls = ch.kind === 'new' ? ' class="row-new"' : ch.kind === 'chg' ? ' class="row-chg"' : ''
  const tag = ch.label ? ` <span class="chg-tag">${esc(ch.label)}</span>` : ''
  const chk = checkCol ? '<td class="chk">☐</td>' : ''
  const cells = cols
    .map((c) => {
      const v = esc(ORDER_COLS[c.key].cell(it, qty, recv))
      // the Change tag rides along on the Item cell
      const inner = c.key === 'item' ? v + tag : v
      return `<td${ORDER_COLS[c.key].num ? ' class="chk"' : ''}>${inner}</td>`
    })
    .join('')
  return `<tr${cls}>${chk}${cells}</tr>`
}

/** PDF: order meta header, then either a section per category or one flat table,
 *  with the resolved columns + widths. Receiving adds a ☐ column; highlighting
 *  colors + tags new/changed rows. */
function shopOrderHtml(
  order: ShopOrder,
  receiving: boolean,
  logo: string | null,
  prevMap: Map<string, OrderItem> | null,
  baselineDate: string,
  r: Resolved
): string {
  const cols = bodyColumns(r)
  const items = sortItems(order.items, r.sort)
  const colg = colGroup(cols, receiving)
  const head = headCells(cols, receiving)

  let bodyHtml: string
  if (!items.length) {
    bodyHtml = '<p>No items on this order.</p>'
  } else if (r.groupByCategory) {
    const groups: { cat: string; items: ShopOrder['items'] }[] = []
    for (const it of sortItems(order.items, 'category')) {
      const label = it.category?.trim() || 'Uncategorized'
      const last = groups[groups.length - 1]
      if (last && last.cat === label) last.items.push(it)
      else groups.push({ cat: label, items: [it] })
    }
    bodyHtml = groups
      .map((g) => {
        const body = g.items.map((it) => bodyRow(it, cols, receiving, prevMap)).join('')
        return `<section><h2>${esc(g.cat)} <span class="meta">(${g.items.length})</span></h2><table class="fixed">${colg}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`
      })
      .join('')
  } else {
    const body = items.map((it) => bodyRow(it, cols, receiving, prevMap)).join('')
    bodyHtml = `<section><table class="fixed">${colg}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`
  }

  const meta = [order.vendor, order.orderDate].filter(Boolean).map((x) => esc(x as string)).join(' · ')
  const metaBlock = meta ? `<div class="meta">${meta}</div>` : ''
  const legend = prevMap
    ? `<div class="legend"><span class="sw-new"></span> new &nbsp;&nbsp; <span class="sw-chg"></span> changed since last export${baselineDate ? ` (${esc(baselineDate)})` : ''}</div>`
    : ''
  const title = (receiving ? 'Receiving Checklist — ' : 'Shop Order — ') + order.name
  return page(title, metaBlock + legend + bodyHtml + cableSectionHtml(order, receiving), logo, r.density)
}

/** XLSX for an order: an Equipment/Receiving sheet + (if any) a Cables sheet.
 *  `widths` (when given) sets the column character widths from the format. */
async function orderXlsx(
  order: ShopOrder,
  receiving: boolean,
  prevMap: Map<string, OrderItem> | null,
  logo: string | null,
  r: Resolved
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const img = parseImageDataUrl(logo)
  // Width per header label: Change column + the resolved columns' weights.
  const widthByHeader = new Map<string, number>()
  for (const c of flatColumns(r)) widthByHeader.set(ORDER_COLS[c.key].label, c.width || ORDER_COLS[c.key].width)
  widthByHeader.set('Change', 16)
  const addSheet = (sheetName: string, t: Table, useWidths: boolean): void => {
    const ws = wb.addWorksheet(sheetName)
    ws.columns = t.headers.map((h) => ({
      header: h,
      key: h,
      width: useWidths && widthByHeader.has(h) ? Math.max(6, widthByHeader.get(h) as number) : Math.max(10, Math.min(30, h.length + 8))
    }))
    const headerRowNum = img ? 5 : 1
    if (img) {
      ws.spliceRows(1, 0, [], [], [], [])
      const imgId = wb.addImage({ base64: img.base64, extension: img.extension })
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 170, height: 60 } })
    }
    ws.getRow(headerRowNum).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: headerRowNum }]
    for (const row of t.rows) ws.addRow(row)
  }
  addSheet(receiving ? 'Receiving' : 'Equipment', shopOrderTable(order, r, prevMap), true)
  if (order.cables.length) addSheet('Cables', cableOrderTable(order, receiving), false)
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer
}

async function htmlToPdf(html: string, landscape: boolean, footerNote?: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  try {
    await win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
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
  devicelist: 'device list',
  projectorsheet: 'projector setup sheet',
  loadsheet: 'load sheet',
  order: 'pull order',
  receiving: 'receiving checklist'
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
    const prevMap = opts.highlightChanges ? prevItemMap(getOrderExportSnapshot(order.id)) : null
    const baselineDate = fmtTs(order.lastExportAt)
    const fmt = opts.formatId != null ? getOrderExportFormatById(opts.formatId) : null
    const resolved = resolveFormat(fmt, receiving)
    const table = shopOrderTable(order, resolved, prevMap)
    if (opts.format === 'csv') {
      const cablesCsv = order.cables.length
        ? '\r\n\r\nCABLES\r\n' + tableCsv(cableOrderTable(order, receiving))
        : ''
      writeFileSync(outPath, tableCsv(table) + cablesCsv, 'utf-8')
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
    // Snapshot the current items as the new baseline for the next export's diff.
    markOrderExported(order.id, order.items)
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
    writeFileSync(res.filePath, await htmlToPdf(loadSheetHtml(opts.tripId, logo), false))
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
    if (opts.format === 'csv') writeFileSync(outPath, tableCsv(projectorSheetTable()), 'utf-8')
    else if (opts.format === 'xlsx') writeFileSync(outPath, await projectorSheetXlsx(logo))
    else writeFileSync(outPath, await htmlToPdf(projectorSheetHtml(logo), false))
    shell.openPath(outPath)
    return outPath
  }

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
      // Device list is a category-sectioned table (portrait); the IP schedule
      // PDF gets its bespoke sectioned/merged layout (landscape).
      const html = isDeviceList ? deviceListHtml(logo) : ipScheduleHtml(logo)
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

// ---- Server-facing HTML (for the LAN Show Server) -------------------------
// Thin wrappers that set the module-level show name (used by page()) from the
// current project, then return the same self-styled HTML the PDF path renders.
// These let the embedded web server reuse the exact paperwork layouts.

/** The IP schedule as a standalone HTML page. */
export function ipSchedulePageHtml(): string {
  docShowName = getProjectMeta('showName')
  return ipScheduleHtml(getProjectMeta('logo'))
}

/** The device list (category-sectioned) as a standalone HTML page. */
export function deviceListPageHtml(): string {
  docShowName = getProjectMeta('showName')
  return deviceListHtml(getProjectMeta('logo'))
}
