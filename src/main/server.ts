import http from 'node:http'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import QRCode from 'qrcode'
import type { ServerPins, ServerStatus, ShopOrder, Subnet } from '../shared/types'
import {
  getShowServerEnabled,
  setShowServerEnabled,
  getShowServerPort,
  setShowServerPort
} from './projects'
import {
  getProjectMeta,
  setProjectMeta,
  listShopOrders,
  getShopOrderById,
  updateShopOrder,
  listDevices,
  getDeviceById,
  listSubnets,
  listLabelTemplates,
  getLabelTemplateById,
  listCases,
  getCaseById,
  listCircuits,
  getCircuitById,
  setCircuitStatus
} from './repository'
import type { Circuit } from '../shared/types'
import { getCurrentProject } from './projects'
import { ipSchedulePageHtml, deviceListPageHtml } from './exports'
import { renderTemplateSheetHtml, renderCasesSheetHtml } from './caselabels'
import { generateSwitchConfig } from './switch-config'
import { getSwitchConfig } from './library'

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let server: http.Server | null = null
let win: BrowserWindow | null = null
let lastPort = getShowServerPort()
let lastError: string | null = null

type Role = 'crew' | 'manager'
const sessions = new Map<string, { role: Role }>()

// Serialize all DB writes (crew check-ins) so two browsers can't clobber the
// whole-order JSON blob — each write re-reads inside the chain.
let writeChain: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => T): Promise<T> {
  const next = writeChain.then(fn, fn) as Promise<T>
  writeChain = next.catch(() => undefined)
  return next
}

export function setServerWindow(w: BrowserWindow): void {
  win = w
}
function notifyDataChanged(): void {
  if (win && !win.isDestroyed()) win.webContents.send('data-changed')
}
function emitStatus(): void {
  if (win && !win.isDestroyed()) win.webContents.send('server-status', getServerStatus())
}

// ---------------------------------------------------------------------------
// LAN helpers
// ---------------------------------------------------------------------------
function lanIps(): string[] {
  const out: string[] = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}
function lanUrls(port: number): string[] {
  const ips = lanIps()
  if (ips.length === 0) return [`http://localhost:${port}`]
  return ips.map((ip) => `http://${ip}:${port}`)
}

// ---------------------------------------------------------------------------
// Public control API (called from IPC)
// ---------------------------------------------------------------------------
export function getServerStatus(): ServerStatus {
  return {
    running: !!server,
    enabled: getShowServerEnabled(),
    port: lastPort,
    urls: server ? lanUrls(lastPort) : [],
    clientCount: sessions.size,
    error: lastError
  }
}

export function startServer(): Promise<ServerStatus> {
  if (server) return Promise.resolve(getServerStatus())
  const port = getShowServerPort()
  lastPort = port
  lastError = null
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        try {
          sendHtml(res, 500, layout('Error', `<p class="err">${esc(String(err))}</p>`, null))
        } catch {
          /* response already sent */
        }
      })
    })
    s.on('error', (err: NodeJS.ErrnoException) => {
      lastError =
        err.code === 'EADDRINUSE'
          ? `Port ${port} is already in use — pick another port.`
          : err.message
      server = null
      emitStatus()
      resolve(getServerStatus())
    })
    s.listen(port, '0.0.0.0', () => {
      server = s
      lastError = null
      emitStatus()
      resolve(getServerStatus())
    })
  })
}

export function stopServer(): Promise<ServerStatus> {
  sessions.clear()
  return new Promise((resolve) => {
    if (!server) return resolve(getServerStatus())
    const s = server
    server = null
    s.close(() => {
      emitStatus()
      resolve(getServerStatus())
    })
  })
}

export async function restartServer(): Promise<ServerStatus> {
  await stopServer()
  return startServer()
}

/** Start on launch if the per-machine preference says so. */
export async function initServer(): Promise<void> {
  if (getShowServerEnabled()) await startServer()
}

export async function setEnabled(value: boolean): Promise<ServerStatus> {
  setShowServerEnabled(value)
  if (value) await startServer()
  else await stopServer()
  emitStatus()
  return getServerStatus()
}

export async function setPort(port: number): Promise<ServerStatus> {
  setShowServerPort(port)
  lastPort = getShowServerPort()
  if (server) await restartServer()
  else emitStatus()
  return getServerStatus()
}

/** A data-URL PNG QR of the primary connect URL, for the desktop Settings panel. */
export async function connectQr(): Promise<string | null> {
  const url = server ? lanUrls(lastPort)[0] : null
  if (!url) return null
  try {
    return await QRCode.toDataURL(url, { margin: 1, width: 180 })
  } catch {
    return null
  }
}

export function getPins(): ServerPins {
  return {
    crew: getProjectMeta('serverCrewPin') ?? '',
    manager: getProjectMeta('serverManagerPin') ?? ''
  }
}
export function setPins(pins: ServerPins): void {
  setProjectMeta('serverCrewPin', (pins.crew ?? '').trim())
  setProjectMeta('serverManagerPin', (pins.manager ?? '').trim())
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function crewPin(): string {
  return (getProjectMeta('serverCrewPin') ?? '').trim()
}
function managerPin(): string {
  return (getProjectMeta('serverManagerPin') ?? '').trim()
}
function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = req.headers.cookie
  if (!raw) return out
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}
function roleOf(req: http.IncomingMessage): Role | null {
  const sid = parseCookies(req)['sid']
  return sid ? (sessions.get(sid)?.role ?? null) : null
}
/** Can this request reach a route needing `need`? Blank PIN ⇒ that tier is open. */
function allow(req: http.IncomingMessage, need: Role): boolean {
  const r = roleOf(req)
  if (need === 'manager') return r === 'manager' || managerPin() === ''
  return r === 'manager' || r === 'crew' || crewPin() === ''
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  )
}
function sendHtml(res: http.ServerResponse, code: number, html: string): void {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}
function sendJson(res: http.ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}
function redirect(res: http.ServerResponse, to: string, cookie?: string): void {
  const headers: http.OutgoingHttpHeaders = { Location: to }
  if (cookie) headers['Set-Cookie'] = cookie
  res.writeHead(302, headers)
  res.end()
}
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

async function qrSvg(url: string, size = 180): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1, width: size })
}

// ---------------------------------------------------------------------------
// Shared page chrome (mobile-first)
// ---------------------------------------------------------------------------
function layout(title: string, body: string, role: Role | null, active = ''): string {
  const show = getProjectMeta('showName') || getCurrentProject()?.name || 'Device Manager'
  const nav = role
    ? `<nav class="nav">
        <a href="/" class="${active === 'home' ? 'on' : ''}">Home</a>
        <a href="/orders" class="${active === 'orders' ? 'on' : ''}">Receiving</a>
        <a href="/devices" class="${active === 'devices' ? 'on' : ''}">Devices</a>
        <a href="/paperwork" class="${active === 'paper' ? 'on' : ''}">Paperwork</a>
        <a href="/labels" class="${active === 'labels' ? 'on' : ''}">Labels</a>
      </nav>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(show)}</title>
<style>
  :root { --bg:#0e1217; --card:#151b22; --line:#2a3440; --text:#e4eef7; --muted:#9aacbd; --accent:#22c7b8; --ink:#052421; --ok:#2e9e5b; }
  .mono, code { font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:16px; }
  header.top { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); }
  header.top .show { font-weight:700; font-size:17px; }
  header.top .tag { color:var(--muted); font-size:12px; }
  .nav { display:flex; gap:4px; flex-wrap:wrap; padding:8px 12px; border-bottom:1px solid var(--line); overflow-x:auto; }
  .nav a { color:var(--muted); text-decoration:none; padding:7px 12px; border-radius:8px; white-space:nowrap; }
  .nav a.on, .nav a:active { background:var(--card); color:var(--text); }
  main { padding:16px; max-width:760px; margin:0 auto; }
  h1 { font-size:20px; margin:4px 0 14px; }
  h2 { font-size:16px; margin:20px 0 8px; }
  a { color:var(--accent); }
  .cards { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .card { display:block; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; text-decoration:none; color:var(--text); }
  .card b { display:block; font-size:16px; }
  .card span { color:var(--muted); font-size:13px; }
  .list { list-style:none; margin:0; padding:0; }
  .list li { border:1px solid var(--line); border-radius:10px; margin-bottom:8px; background:var(--card); }
  .list li a { display:flex; justify-content:space-between; gap:10px; padding:14px 16px; text-decoration:none; color:var(--text); }
  .pill { font-size:12px; padding:2px 9px; border-radius:999px; background:#242a33; color:var(--muted); white-space:nowrap; }
  .pill.ok { background:#13351f; color:#7fe0a1; }
  .pill.warn { background:#3a2f12; color:#f0c674; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:13px; }
  .row { display:flex; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .row .grow { flex:1 1 180px; min-width:0; }
  .row .name { font-weight:600; }
  .row .sub { color:var(--muted); font-size:13px; }
  input,button,select { font:inherit; }
  input[type=number], input[type=text], input[type=password] { background:#0c0e12; border:1px solid var(--line); color:var(--text); border-radius:8px; padding:9px 10px; width:100%; }
  .qty { width:72px; text-align:center; }
  .btn { background:var(--accent); color:var(--ink); border:none; border-radius:9px; padding:10px 14px; font-weight:600; cursor:pointer; }
  .btn.sec { background:#242a33; color:var(--text); }
  .muted { color:var(--muted); }
  .err { color:#f0877f; }
  .saved { color:var(--ok); font-size:13px; }
  .qr { background:#fff; padding:10px; border-radius:12px; display:inline-block; }
  pre.cfg { font-family: ui-monospace,'SF Mono','Cascadia Code',Menlo,Consolas,monospace; font-size:12px; line-height:1.45; background:#0c0e12; border:1px solid var(--line); border-radius:8px; padding:12px 14px; overflow-x:auto; white-space:pre; margin-top:10px; }
  .center { text-align:center; }
  form.login { max-width:320px; margin:12vh auto 0; }
  @media (max-width:520px){ .cards{grid-template-columns:1fr;} }
</style></head><body>
<header class="top"><div><div class="show">${esc(show)}</div><div class="tag">Device Manager — Show Server</div></div>${
    role ? `<form method="POST" action="/logout" style="margin:0"><button class="btn sec">Sign out</button></form>` : ''
  }</header>
${nav}
<main>${body}</main>
</body></html>`
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'

  // No project open → nothing to serve.
  if (!getCurrentProject()) {
    return sendHtml(res, 503, layout('No project', '<h1>No show open</h1><p class="muted">The operator needs to open a project in Device Manager.</p>', null))
  }

  // Auth routes (always reachable).
  if (path === '/login' && method === 'GET') return sendHtml(res, 200, loginPage())
  if (path === '/login' && method === 'POST') return doLogin(req, res)
  if (path === '/logout' && method === 'POST') {
    const sid = parseCookies(req)['sid']
    if (sid) sessions.delete(sid)
    emitStatus()
    return redirect(res, '/', 'sid=; Path=/; Max-Age=0')
  }

  // Everything below needs at least crew access.
  if (!allow(req, 'crew')) return redirect(res, '/login')

  if (path === '/' ) return sendHtml(res, 200, homePage(req))
  if (path === '/orders') return sendHtml(res, 200, ordersListPage())
  if (path.startsWith('/orders/')) return sendHtml(res, 200, orderPage(Number(path.slice(8))))
  if (path === '/api/receive' && method === 'POST') return apiReceive(req, res)

  if (path === '/devices') return sendHtml(res, 200, devicesListPage())
  if (path.startsWith('/device/') && path.endsWith('/config.cfg')) {
    const d = getDeviceById(Number(path.slice(8, -'/config.cfg'.length)))
    if (!d || !d.isSwitch) {
      return sendHtml(res, 404, layout('Not found', '<h1>Not a switch</h1>', roleOf(req)))
    }
    const cfg = generateSwitchConfig(d, listSubnets(), getSwitchConfig())
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${cfgFilename(d.name)}"`
    })
    res.end(cfg)
    return
  }
  if (path.startsWith('/device/')) return sendHtml(res, 200, await devicePage(Number(path.slice(8))))
  if (path === '/api/patch' && method === 'POST') return apiPatch(req, res)

  if (path === '/paperwork') return sendHtml(res, 200, paperworkHubPage())
  if (path === '/paperwork/ip-schedule') return sendHtml(res, 200, ipSchedulePageHtml())
  if (path === '/paperwork/devices') return sendHtml(res, 200, deviceListPageHtml())

  if (path === '/labels') return sendHtml(res, 200, labelsHubPage())
  if (path.startsWith('/labels/template/')) return sendHtml(res, 200, templateSheetPage(Number(path.slice(17))))
  if (path.startsWith('/labels/case/')) return sendHtml(res, 200, caseSheetPage(Number(path.slice(13))))

  // Manager-only.
  if (path === '/admin/qr-sheet') {
    if (!allow(req, 'manager')) return redirect(res, '/login')
    return sendHtml(res, 200, await qrSheetPage(req))
  }

  return sendHtml(res, 404, layout('Not found', '<h1>Not found</h1><p><a href="/">Home</a></p>', roleOf(req)))
}

// ---------------------------------------------------------------------------
// Auth pages
// ---------------------------------------------------------------------------
function loginPage(err?: string): string {
  const hint = managerPin() === '' && crewPin() === '' ? '<p class="muted">No PIN is set — just continue.</p>' : ''
  return layout(
    'Sign in',
    `<form class="login" method="POST" action="/login">
       <h1>Enter PIN</h1>
       ${err ? `<p class="err">${esc(err)}</p>` : ''}
       ${hint}
       <input type="password" name="pin" inputmode="numeric" autocomplete="off" placeholder="Show PIN" autofocus>
       <p><button class="btn" type="submit" style="width:100%">Continue</button></p>
     </form>`,
    null
  )
}
async function doLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req)
  const pin = decodeURIComponent((new URLSearchParams(body).get('pin') ?? '').trim())
  let role: Role | null = null
  if (managerPin() !== '' && pin === managerPin()) role = 'manager'
  else if (crewPin() !== '' && pin === crewPin()) role = 'crew'
  else if (managerPin() === '' && crewPin() === '') role = 'manager' // nothing set → open
  else if (crewPin() === '') role = 'crew'
  if (!role) return sendHtml(res, 401, loginPage('That PIN didn’t match.'))
  const sid = randomUUID()
  sessions.set(sid, { role })
  emitStatus()
  redirect(res, '/', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`)
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function homePage(req: http.IncomingMessage): string {
  const manager = roleOf(req) === 'manager' || managerPin() === ''
  const orders = listShopOrders()
  const open = orders.filter((o) => outstanding(o) > 0).length
  const cards = [
    ['/orders', 'Receiving', `${open} order${open === 1 ? '' : 's'} with items outstanding`],
    ['/devices', 'Devices', 'How each device should be configured'],
    ['/paperwork', 'Paperwork', 'IP schedule & device list'],
    ['/labels', 'Case labels', 'View & print label sheets']
  ]
  if (manager) cards.push(['/admin/qr-sheet', 'QR sheet', 'Printable device QR codes'])
  return layout(
    'Home',
    `<h1>Show Server</h1>
     <div class="cards">${cards
       .map(([href, b, s]) => `<a class="card" href="${href}"><b>${esc(b)}</b><span>${esc(s)}</span></a>`)
       .join('')}</div>`,
    roleOf(req),
    'home'
  )
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------
function outstanding(o: ShopOrder): number {
  return o.items.reduce((n, it) => n + Math.max(0, (it.quantity || 0) - (it.received || 0)), 0)
}
function ordersListPage(): string {
  const orders = listShopOrders()
  const items = orders
    .map((o) => {
      const out = outstanding(o)
      const pill = out === 0 ? '<span class="pill ok">complete</span>' : `<span class="pill warn">${out} outstanding</span>`
      return `<li><a href="/orders/${o.id}"><span class="grow"><span class="name">${esc(o.name)}</span>${
        o.vendor ? `<br><span class="sub">${esc(o.vendor)}</span>` : ''
      }</span>${pill}</a></li>`
    })
    .join('')
  return layout(
    'Receiving',
    `<h1>Receiving</h1>${orders.length ? `<ul class="list">${items}</ul>` : '<p class="muted">No orders yet.</p>'}`,
    'crew',
    'orders'
  )
}
function orderPage(id: number): string {
  const o = getShopOrderById(id)
  if (!o) return layout('Order', '<h1>Order not found</h1><p><a href="/orders">Back</a></p>', 'crew', 'orders')
  const rows = o.items
    .map((it, i) => {
      const out = Math.max(0, (it.quantity || 0) - (it.received || 0))
      return `<div class="row" data-i="${i}">
        <span class="grow"><span class="name">${esc(it.name)}</span>
          <span class="sub">${esc([it.manufacturer, it.modelNumber].filter(Boolean).join(' · '))}${
        it.manufacturer || it.modelNumber ? ' · ' : ''
      }ordered ${it.quantity || 0}${out ? ` · <b>${out} out</b>` : ''}</span></span>
        <label class="muted" style="font-size:13px">recv
          <input class="qty rc" type="number" min="0" max="${it.quantity || 0}" value="${it.received || 0}"></label>
        <input class="nt" type="text" placeholder="notes" value="${esc(it.notes ?? '')}" style="flex:1 1 150px">
        <button class="btn save">Save</button>
        <span class="saved" style="display:none">✓ saved</span>
      </div>`
    })
    .join('')
  return layout(
    esc(o.name),
    `<h1>${esc(o.name)}</h1>
     <p class="muted">Enter how many of each item actually arrived, add a note if needed, and press Save.</p>
     <div id="items" data-order="${o.id}">${rows || '<p class="muted">No items on this order.</p>'}</div>
     <p><a href="/orders">← all orders</a></p>
     <script>
       document.querySelectorAll('.row').forEach(function(row){
         var btn = row.querySelector('.save'); if(!btn) return;
         btn.addEventListener('click', function(){
           var i = +row.getAttribute('data-i');
           var received = +row.querySelector('.rc').value || 0;
           var notes = row.querySelector('.nt').value;
           btn.disabled = true;
           fetch('/api/receive', { method:'POST', headers:{'Content-Type':'application/json'},
             body: JSON.stringify({ orderId: +document.getElementById('items').getAttribute('data-order'), index:i, received:received, notes:notes }) })
             .then(function(r){ return r.json(); })
             .then(function(d){
               btn.disabled = false;
               if(d && d.ok){ var s=row.querySelector('.saved'); s.style.display='inline'; row.querySelector('.rc').value=d.received; setTimeout(function(){s.style.display='none';},1500); }
               else { alert((d&&d.error)||'Save failed'); }
             })
             .catch(function(){ btn.disabled=false; alert('Network error'); });
         });
       });
     </script>`,
    'crew',
    'orders'
  )
}
async function apiReceive(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!allow(req, 'crew')) return sendJson(res, 403, { ok: false, error: 'not allowed' })
  let payload: { orderId?: number; index?: number; received?: number; notes?: string }
  try {
    payload = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad request' })
  }
  const { orderId, index } = payload
  if (typeof orderId !== 'number' || typeof index !== 'number') {
    return sendJson(res, 400, { ok: false, error: 'bad request' })
  }
  const result = await serialize(() => {
    const o = getShopOrderById(orderId)
    if (!o || index < 0 || index >= o.items.length) return { ok: false, error: 'item not found' }
    const items = o.items.map((it) => ({ ...it }))
    const qty = items[index].quantity || 0
    const recv = Math.max(0, Math.min(qty, Math.trunc(Number(payload.received) || 0)))
    items[index].received = recv
    if (typeof payload.notes === 'string') items[index].notes = payload.notes.trim() || null
    updateShopOrder(orderId, {
      name: o.name,
      vendor: o.vendor,
      orderDate: o.orderDate,
      notes: o.notes,
      items,
      cables: o.cables
    })
    return { ok: true, received: recv }
  })
  if (result.ok) notifyDataChanged()
  sendJson(res, result.ok ? 200 : 400, result)
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------
function devicesListPage(): string {
  const devices = listDevices()
  const items = devices
    .map(
      (d) =>
        `<li><a href="/device/${d.id}"><span class="grow"><span class="name">${esc(d.name)}</span>${
          d.deviceType || d.location
            ? `<br><span class="sub">${esc([d.deviceType, d.location].filter(Boolean).join(' · '))}</span>`
            : ''
        }</span>${d.isSwitch ? '<span class="pill">switch</span>' : ''}</a></li>`
    )
    .join('')
  return layout(
    'Devices',
    `<h1>Devices</h1>
     <input type="text" id="q" placeholder="Filter…" oninput="var v=this.value.toLowerCase();document.querySelectorAll('#dl li').forEach(function(li){li.style.display=li.textContent.toLowerCase().includes(v)?'':'none';});" style="margin-bottom:12px">
     ${devices.length ? `<ul class="list" id="dl">${items}</ul>` : '<p class="muted">No devices yet.</p>'}`,
    'crew',
    'devices'
  )
}
function subnetLabel(subnets: Map<number, Subnet>, id: number | null): string {
  if (id == null) return '—'
  const s = subnets.get(id)
  if (!s) return `#${id}`
  return s.vlan ? `${s.name} (VLAN ${s.vlan})` : s.name
}
async function devicePage(id: number): Promise<string> {
  const d = getDeviceById(id)
  if (!d) return layout('Device', '<h1>Device not found</h1><p><a href="/devices">Back</a></p>', 'crew', 'devices')
  const subnetList = listSubnets()
  const subnets = new Map(subnetList.map((s) => [s.id, s]))
  const meta: string[] = []
  if (d.deviceType) meta.push(`<tr><th>Type</th><td>${esc(d.deviceType)}</td></tr>`)
  if (d.location) meta.push(`<tr><th>Location</th><td>${esc(d.location)}</td></tr>`)
  if (d.macAddress) meta.push(`<tr><th>MAC</th><td>${esc(d.macAddress)}</td></tr>`)
  if (d.isSwitch) {
    if (d.managementIp) meta.push(`<tr><th>Management IP</th><td>${esc(d.managementIp)}</td></tr>`)
    if (d.oobIp) meta.push(`<tr><th>OOB IP</th><td>${esc(d.oobIp)}</td></tr>`)
  }
  const portRows = d.ports
    .filter((p) => !p.isUnused)
    .map((p) => {
      const tagged = p.taggedSubnetIds.map((sid) => subnetLabel(subnets, sid)).join(', ')
      return `<tr><td>${esc(p.label)}</td><td>${d.isSwitch ? '—' : esc(p.ipAddress ?? '—')}</td>
        <td>${esc(subnetLabel(subnets, p.untaggedSubnetId))}</td><td>${esc(tagged || '—')}</td></tr>`
    })
    .join('')
  const qr = await qrSvg(deviceUrl(d.id))
  const circuits = listCircuits().filter((c) => c.srcName === d.name || c.dstName === d.name)
  return layout(
    esc(d.name),
    `<h1>${esc(d.name)}${d.isSwitch ? ' <span class="pill">switch</span>' : ''}</h1>
     ${meta.length ? `<table>${meta.join('')}</table>` : ''}
     <h2>Ports / networks</h2>
     <table><tr><th>Port</th><th>IP</th><th>Untagged VLAN</th><th>Tagged VLANs</th></tr>${
       portRows || '<tr><td colspan="4" class="muted">No ports.</td></tr>'
     }</table>
     ${connectionsSection(d.name, circuits)}
     ${d.isSwitch ? switchConfigSection(generateSwitchConfig(d, subnetList, getSwitchConfig()), d.id) : ''}
     ${d.notes ? `<h2>Notes</h2><p>${esc(d.notes).replace(/\n/g, '<br>')}</p>` : ''}
     <h2>This device’s QR</h2><div class="qr">${qr}</div>
     <p><a href="/devices">← all devices</a></p>
     ${patchScript()}`,
    'crew',
    'devices'
  )
}

function cfgFilename(name: string): string {
  const base = name.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'switch'
  return base + '.cfg'
}

/** The generated full switch config, with copy + download. */
function switchConfigSection(config: string, deviceId: number): string {
  return `<h2>Switch config</h2>
    <p class="muted">Full NETGEAR M4350 config for this switch — ports numbered in order (1/0/1, 1/0/2, …). Upload it to the switch as its startup-config.</p>
    <p>
      <a class="btn" href="/device/${deviceId}/config.cfg">Download .cfg</a>
      <button class="btn sec" type="button" onclick="(function(b){navigator.clipboard.writeText(document.getElementById('swcfg').textContent).then(function(){var t=b.textContent;b.textContent='Copied ✓';setTimeout(function(){b.textContent=t;},1500);});})(this)">Copy</button>
    </p>
    <pre id="swcfg" class="cfg">${esc(config)}</pre>`
}

/** The connections/patching list for a device page — crew tick THIS end patched
 *  and tested (tested marks both ends). The far end shows as a read-only badge. */
function connectionsSection(deviceName: string, circuits: Circuit[]): string {
  if (circuits.length === 0) return ''
  const thisEndPatched = circuits.filter((c) =>
    c.srcName === deviceName ? c.srcPatched : c.dstPatched
  ).length
  const rows = circuits
    .map((c) => {
      const isSrc = c.srcName === deviceName
      const mySocket = isSrc ? c.srcSocket : c.dstSocket
      const other = isSrc ? c.dstName : c.srcName
      const otherSkt = isSrc ? c.dstSocket : c.srcSocket
      const myPatched = isSrc ? c.srcPatched : c.dstPatched
      const farPatched = isSrc ? c.dstPatched : c.srcPatched
      return `<div class="row" data-id="${c.id}" data-end="${isSrc ? 'src' : 'dst'}">
        <span class="grow"><span class="name">${esc(mySocket || '—')}</span>
          <span class="sub">→ ${esc(other || '—')} · ${esc(otherSkt)} · ${esc(c.signal)}${c.cableNumber ? ` · ${esc(c.cableNumber)}` : ''}</span>
          <span class="sub far ${farPatched ? 'on' : ''}">far end ${farPatched ? 'patched ✓' : 'not patched'}</span></span>
        <label class="muted" style="font-size:13px"><input type="checkbox" class="pp" ${myPatched ? 'checked' : ''}> patched</label>
        <label class="muted" style="font-size:13px"><input type="checkbox" class="tt" ${c.tested ? 'checked' : ''}> tested</label>
      </div>`
    })
    .join('')
  return `<h2>Connections (patching) <span class="muted" style="font-size:13px">${thisEndPatched}/${circuits.length} patched here</span></h2>
    <div id="conns">${rows}</div>`
}

/** Shared inline script: POST this-end patched / tested toggles on a device page.
 *  On success it re-reads the row so tested auto-checking both ends is reflected. */
function patchScript(): string {
  return `<script>
    document.querySelectorAll('#conns .row').forEach(function(row){
      var id = +row.getAttribute('data-id');
      var end = row.getAttribute('data-end');
      var pp = row.querySelector('.pp'), tt = row.querySelector('.tt');
      function send(body){
        body.id = id;
        fetch('/api/patch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
          .then(function(r){return r.json();})
          .then(function(d){ if(d&&d.ok){ pp.checked=d.myPatched; tt.checked=d.tested; } else { alert((d&&d.error)||'Save failed'); } })
          .catch(function(){ alert('Network error'); });
      }
      pp.addEventListener('change', function(){ send({ end:end, patched:pp.checked }); });
      tt.addEventListener('change', function(){ send({ end:end, tested:tt.checked }); });
    });
  </script>`
}

async function apiPatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!allow(req, 'crew')) return sendJson(res, 403, { ok: false, error: 'not allowed' })
  let p: { id?: number; end?: 'src' | 'dst'; patched?: boolean; tested?: boolean }
  try {
    p = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad request' })
  }
  if (typeof p.id !== 'number') return sendJson(res, 400, { ok: false, error: 'bad request' })
  const result = await serialize(() => {
    const c = getCircuitById(p.id as number)
    if (!c) return { ok: false, error: 'circuit not found' }
    const next = { srcPatched: c.srcPatched, dstPatched: c.dstPatched, tested: c.tested, notes: c.notes }
    if (typeof p.patched === 'boolean') {
      if (p.end === 'src') next.srcPatched = p.patched
      else if (p.end === 'dst') next.dstPatched = p.patched
    }
    if (typeof p.tested === 'boolean') {
      next.tested = p.tested
      if (p.tested) {
        next.srcPatched = true // testing implies both ends patched
        next.dstPatched = true
      }
    }
    const saved = setCircuitStatus(c.id, next)
    const myPatched = p.end === 'dst' ? saved.dstPatched : saved.srcPatched
    return { ok: true, myPatched, tested: saved.tested }
  })
  if (result.ok) notifyDataChanged()
  sendJson(res, result.ok ? 200 : 400, result)
}

// ---------------------------------------------------------------------------
// Paperwork hub
// ---------------------------------------------------------------------------
function paperworkHubPage(): string {
  return layout(
    'Paperwork',
    `<h1>Paperwork</h1>
     <div class="cards">
       <a class="card" href="/paperwork/ip-schedule"><b>IP schedule</b><span>Switch ports + device IPs</span></a>
       <a class="card" href="/paperwork/devices"><b>Device list</b><span>By category, with main IP/VLAN</span></a>
     </div>`,
    'crew',
    'paper'
  )
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
function labelsHubPage(): string {
  const templates = listLabelTemplates()
  const cases = listCases()
  const tpl = templates
    .map((t) => `<li><a href="/labels/template/${t.id}"><span class="grow">${esc(t.name)}</span><span class="pill">template</span></a></li>`)
    .join('')
  const cs = cases
    .map((c) => `<li><a href="/labels/case/${c.id}"><span class="grow">${esc(c.name)}</span><span class="pill">case</span></a></li>`)
    .join('')
  return layout(
    'Labels',
    `<h1>Case labels</h1>
     <h2>Templates</h2>${templates.length ? `<ul class="list">${tpl}</ul>` : '<p class="muted">No templates.</p>'}
     ${cases.length ? `<h2>Cases</h2><ul class="list">${cs}</ul>` : ''}
     <p class="muted">Open one, then use your browser’s Print to put it on Uline S-19323 sheets.</p>`,
    'crew',
    'labels'
  )
}
function templateSheetPage(id: number): string {
  const t = getLabelTemplateById(id)
  if (!t) return layout('Label', '<h1>Template not found</h1>', 'crew', 'labels')
  return renderTemplateSheetHtml(t, 1)
}
function caseSheetPage(id: number): string {
  const c = getCaseById(id)
  if (!c) return layout('Label', '<h1>Case not found</h1>', 'crew', 'labels')
  const templates = listLabelTemplates()
  if (templates.length === 0) return layout('Label', '<h1>No templates</h1><p class="muted">Create a label template first.</p>', 'crew', 'labels')
  return renderCasesSheetHtml(templates[0], [c])
}

// ---------------------------------------------------------------------------
// QR sheet (manager)
// ---------------------------------------------------------------------------
function deviceUrl(id: number): string {
  const ip = lanIps()[0] ?? 'localhost'
  return `http://${ip}:${lastPort}/device/${id}`
}
async function qrSheetPage(req: http.IncomingMessage): Promise<string> {
  const devices = listDevices()
  const cells = await Promise.all(
    devices.map(async (d) => {
      const svg = await qrSvg(deviceUrl(d.id), 150)
      return `<div style="display:inline-block;width:2.2in;margin:0.1in;text-align:center;vertical-align:top;page-break-inside:avoid">
        <div class="qr" style="padding:6px">${svg}</div>
        <div style="font-size:11px;margin-top:4px">${esc(d.name)}</div></div>`
    })
  )
  return layout(
    'QR sheet',
    `<h1>Device QR sheet</h1>
     <p class="muted">Print this and stick a code on each device — scanning opens its config page. <button class="btn sec" onclick="window.print()">Print</button></p>
     <div>${cells.join('') || '<p class="muted">No devices.</p>'}</div>`,
    roleOf(req),
    ''
  )
}
