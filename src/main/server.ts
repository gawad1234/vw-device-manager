import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { app, type BrowserWindow } from 'electron'
import QRCode from 'qrcode'
import { readFileSync } from 'node:fs'
import appIcon from '../../resources/icon.png?asset'
import type {
  OrderItem,
  ServerPins,
  ServerStatus,
  ShopOrder,
  Subnet
} from '../shared/types'
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
import { generateSwitchConfig, type SwitchConfigOptions } from './switch-config'
import { getSwitchConfig } from './library'
import { mainRoute } from '../shared/ip-utils'
import { handlers, bumpChange, getChangeSeq } from './rpc-registry'
import { remoteReadable } from '../shared/remote-scope'

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let server: http.Server | null = null
let win: BrowserWindow | null = null
let lastPort = getShowServerPort()
let lastError: string | null = null

type Role = 'crew' | 'manager'
// kind 'app' = another Device Manager that joined this show (bearer token, /rpc/*).
const sessions = new Map<string, { role: Role; kind?: 'app' }>()

// Wrong PINs per address. A 4-digit PIN would otherwise fall to a script in seconds.
const MAX_PIN_TRIES = 5
const PIN_LOCK_MS = 30_000
const pinFailures = new Map<string, { count: number; until: number }>()

function pinLocked(req: http.IncomingMessage): boolean {
  const f = pinFailures.get(req.socket.remoteAddress ?? '')
  return !!f && f.count >= MAX_PIN_TRIES && Date.now() < f.until
}
function notePinResult(req: http.IncomingMessage, ok: boolean): void {
  const key = req.socket.remoteAddress ?? ''
  if (ok) return void pinFailures.delete(key)
  const f = pinFailures.get(key)
  const count = f && Date.now() < f.until ? f.count + 1 : 1
  pinFailures.set(key, { count, until: Date.now() + PIN_LOCK_MS })
}

/** Log everyone out: what they logged in to has changed (a new PIN, another show). */
export function resetSessions(): void {
  sessions.clear()
  emitStatus()
}

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
  bumpChange()
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
    appClients: [...sessions.values()].filter((x) => x.kind === 'app').length,
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
  pinFailures.clear()
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
  resetSessions()
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
      if (data.length > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy() // stop reading, or a huge upload keeps filling memory
      }
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
  const tab = (href: string, id: string, label: string): string =>
    `<a href="${href}"${active === id ? ' class="on" aria-current="page"' : ''}>${label}</a>`
  const nav = role
    ? `<nav class="tabs" aria-label="Main">${tab('/', 'home', 'Home')}${tab('/orders', 'orders', 'Receive')}${tab('/devices', 'devices', 'Devices')}${tab('/patching', 'patch', 'Patch')}</nav>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e1217">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Crew">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/app-icon.png">
<title>${esc(title)} · ${esc(show)}</title>
<style>
  :root { --bg:#0e1217; --card:#151b22; --line:#2a3440; --text:#e4eef7; --muted:#9aacbd; --accent:#22c7b8; --ink:#052421; --ok:#2e9e5b; }
  .mono, code { font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; font-size:16px; }
  header.top { padding:calc(12px + env(safe-area-inset-top)) 16px 12px; border-bottom:1px solid var(--line); position:sticky; top:0; z-index:5; background:var(--bg); }
  header.top .show { font-weight:700; font-size:17px; }
  header.top .tag { color:var(--muted); font-size:12px; }
  main { padding:16px 16px 110px; max-width:760px; margin:0 auto; }
  .tabs { position:fixed; left:0; right:0; bottom:0; z-index:10; display:grid; grid-template-columns:repeat(4,1fr); background:var(--card); border-top:1px solid var(--line); padding-bottom:env(safe-area-inset-bottom); }
  .tabs a { min-height:56px; display:flex; align-items:center; justify-content:center; color:var(--muted); text-decoration:none; font-size:14px; }
  .tabs a.on { color:var(--accent); font-weight:600; }
  .stack { display:flex; flex-direction:column; gap:10px; }
  .home-card { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:76px; padding:12px 16px; background:var(--card); border:1px solid var(--line); border-radius:12px; color:var(--text); text-decoration:none; }
  .home-card b { display:block; font-size:17px; }
  .home-card span.sub { color:var(--muted); font-size:14px; }
  .back { display:inline-flex; align-items:center; min-height:44px; text-decoration:none; }
  .line { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:12px 14px; background:var(--card); border:1px solid var(--line); border-radius:10px; }
  .line .grow { flex:1 1 100%; min-width:0; }
  .line .name { font-weight:600; }
  .line .sub { display:block; color:var(--muted); font-size:14px; }
  .line .sub.done { color:#7fe0a1; }
  .line .sub.out { color:#f0c674; }
  .stepper { display:flex; align-items:center; gap:6px; }
  .stepper button, .line .all { min-width:48px; height:48px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--text); font-size:20px; }
  .line .all { font-size:14px; padding:0 12px; }
  .stepper output { min-width:40px; text-align:center; font:600 18px ui-monospace,'SF Mono',Menlo,Consolas,monospace; }
  .line details { flex:1 1 100%; color:var(--muted); font-size:14px; }
  .line summary { min-height:32px; display:flex; align-items:center; }
  .savebar { position:fixed; left:0; right:0; bottom:calc(57px + env(safe-area-inset-bottom)); z-index:9; padding:10px 16px; background:var(--bg); border-top:1px solid var(--line); }
  .savebar .btn { width:100%; min-height:52px; font-size:17px; }
  .savebar .btn:disabled { background:#1c232c; color:var(--muted); }
  .savebar .err { margin:0 0 8px; font-size:14px; }
  .pcard { padding:12px 14px; background:var(--card); border:1px solid var(--line); border-radius:10px; }
  .pcard b { display:block; margin-bottom:4px; }
  .pcard div { display:flex; justify-content:space-between; gap:14px; padding:3px 0; }
  .pcard div span:first-child { color:var(--muted); flex:none; }
  .pcard div span:last-child { text-align:right; min-width:0; overflow-wrap:anywhere; }
  .ends { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; width:100%; }
  .ends button, .tested { min-height:52px; padding:4px 8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--text); font-size:14px; }
  .ends button.on, .tested.on { border-color:var(--accent); background:rgba(34,199,184,.14); }
  .tested { width:100%; min-height:44px; }
  .filters { display:flex; gap:8px; margin-bottom:10px; }
  .filters select { flex:1 1 0; min-width:0; min-height:48px; padding:0 10px; border-radius:8px; background:var(--card); color:var(--text); border:1px solid var(--line); }
  input[type=text], input[type=password], input[type=number] { min-height:48px; font-size:16px; }
  .btn { min-height:48px; }
  @media print { .tabs, header.top, .savebar { display:none; } main { padding:0; } }
  h1 { font-size:20px; margin:4px 0 14px; }
  h2 { font-size:16px; margin:20px 0 8px; }
  a { color:var(--accent); }
  .cards { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .card { display:block; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; text-decoration:none; color:var(--text); }
  .card b { display:block; font-size:16px; }
  .card span { color:var(--muted); font-size:13px; }
  .list { list-style:none; margin:0; padding:0; }
  .list li { border:1px solid var(--line); border-radius:10px; margin-bottom:8px; background:var(--card); }
  .list li a { display:flex; justify-content:space-between; align-items:center; gap:10px; min-height:60px; padding:10px 16px; text-decoration:none; color:var(--text); }
  .list .name { font-weight:600; }
  .list .sub { color:var(--muted); font-size:14px; }
  .list .ip { color:#8ff0e6; font-size:14px; white-space:nowrap; }
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
<header class="top"><div class="show">${esc(show)}</div></header>
<main>${body}</main>
${nav}
</body></html>`
}

// ---------------------------------------------------------------------------
// Joined computers (/rpc/*): another Device Manager reads this show's data.
// Read-only for now; the channel allow-list lives in shared/remote-scope.ts.
// ---------------------------------------------------------------------------
function appSession(req: http.IncomingMessage): boolean {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')
  return !!m && sessions.get(m[1])?.kind === 'app'
}
async function handleRpc(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  method: string
): Promise<void> {
  if (!getCurrentProject()) return sendJson(res, 503, { ok: false, error: 'The host has no show open.' })

  if (path === '/rpc/login' && method === 'POST') {
    let body: { pin?: unknown; appVersion?: unknown }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return sendJson(res, 400, { ok: false, error: 'bad request' })
    }
    // The crew directory and every contact detail are readable once joined,
    // so joining needs the Manager PIN — never an open, PIN-less show.
    if (pinLocked(req))
      return sendJson(res, 429, { ok: false, error: 'Too many wrong PINs. Wait 30 seconds and try again.' })
    if (managerPin() === '')
      return sendJson(res, 403, { ok: false, error: 'Set a Manager PIN on the host (Settings → Show Server) to let other computers join.' })
    const pinOk = String(body.pin ?? '').trim() === managerPin()
    notePinResult(req, pinOk)
    if (!pinOk)
      return sendJson(res, 401, { ok: false, error: 'That isn’t the host’s Manager PIN.' })
    if (body.appVersion !== app.getVersion())
      return sendJson(res, 409, { ok: false, error: `The host runs Device Manager ${app.getVersion()} and this computer runs ${String(body.appVersion)}. Update both to the same version.` })
    const token = randomUUID()
    sessions.set(token, { role: 'manager', kind: 'app' })
    emitStatus()
    return sendJson(res, 200, {
      ok: true,
      token,
      showName: getProjectMeta('showName') || getCurrentProject()?.name || 'Shared show',
      hostName: os.hostname().replace(/\.local$/, ''),
      seq: getChangeSeq()
    })
  }

  if (!appSession(req)) return sendJson(res, 401, { ok: false, error: 'Not signed in to this show. Join again.' })

  if (path === '/rpc/changes' && method === 'GET') return sendJson(res, 200, { ok: true, seq: getChangeSeq() })

  if (path === '/rpc/call' && method === 'POST') {
    let body: { channel?: unknown; args?: unknown }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return sendJson(res, 400, { ok: false, error: 'bad request' })
    }
    const channel = String(body.channel ?? '')
    const fn = handlers.get(channel)
    if (!fn || !remoteReadable(channel) || !Array.isArray(body.args))
      return sendJson(res, 403, { ok: false, error: 'not allowed' })
    try {
      return sendJson(res, 200, { ok: true, result: (await fn(null, ...body.args)) ?? null })
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return sendJson(res, 404, { ok: false, error: 'not found' })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const APP_MANIFEST = {
  name: 'Device Manager Crew',
  short_name: 'Crew',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#0e1217',
  theme_color: '#0e1217',
  icons: [{ src: '/app-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }]
}

/** Refuse names that aren't this machine on the LAN. A web page can point its own
 *  public domain at this address (DNS rebinding) to read the crew pages. */
function hostAllowed(req: http.IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return net.isIP(host) !== 0 || !host.includes('.') || host.endsWith('.local')
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (!hostAllowed(req)) return sendJson(res, 403, { ok: false, error: 'not allowed' })

  // What a phone fetches to install the app, before anyone signs in.
  if (path === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' })
    return void res.end(JSON.stringify(APP_MANIFEST))
  }
  if (path === '/app-icon.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' })
    return void res.end(readFileSync(appIcon))
  }
  // A plain web form can't send this type, so another site can't post to the API.
  if (path.startsWith('/api/') && !(req.headers['content-type'] ?? '').includes('application/json')) {
    return sendJson(res, 415, { ok: false, error: 'send JSON' })
  }

  // Other Device Manager apps that joined this show (JSON, bearer token).
  if (path.startsWith('/rpc/')) return handleRpc(req, res, path, method)

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
  if (path === '/install') return sendHtml(res, 200, installPage())
  if (path === '/patching') return sendHtml(res, 200, patchingPage())
  if (path === '/orders') return sendHtml(res, 200, ordersListPage())
  if (path.startsWith('/orders/')) return sendHtml(res, 200, orderPage(Number(path.slice(8))))
  if (path === '/api/receive' && method === 'POST') return apiReceive(req, res)

  if (path === '/devices') return sendHtml(res, 200, devicesListPage())
  if (path.startsWith('/device/') && path.endsWith('/config.cfg')) {
    const d = getDeviceById(Number(path.slice(8, -'/config.cfg'.length)))
    if (!d || !d.isSwitch) {
      return sendHtml(res, 404, layout('Not found', '<h1>Not a switch</h1>', roleOf(req)))
    }
    const cfg = generateSwitchConfig(d, listSubnets(), switchConfigFor(req))
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${cfgFilename(d.name)}"`
    })
    res.end(cfg)
    return
  }
  if (path.startsWith('/device/')) return sendHtml(res, 200, await devicePage(Number(path.slice(8)), req))
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
       <h1>Join the show</h1>
       <p class="muted">Works on the show WiFi. Your phone talks to the computer running the show.</p>
       ${err ? `<p class="err">${esc(err)}</p>` : ''}
       ${hint}
       <input type="password" name="pin" inputmode="numeric" autocomplete="off" placeholder="Show PIN" aria-label="Show PIN" autofocus>
       <p><button class="btn" type="submit" style="width:100%">Join</button></p>
     </form>`,
    null
  )
}
async function doLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (pinLocked(req)) return sendHtml(res, 429, loginPage('Too many wrong PINs. Wait 30 seconds.'))
  const body = await readBody(req)
  const pin = (new URLSearchParams(body).get('pin') ?? '').trim()
  let role: Role | null = null
  if (managerPin() !== '' && pin === managerPin()) role = 'manager'
  else if (crewPin() !== '' && pin === crewPin()) role = 'crew'
  else if (managerPin() === '' && crewPin() === '') role = 'manager' // nothing set → open
  else if (crewPin() === '') role = 'crew'
  notePinResult(req, !!role)
  if (!role) return sendHtml(res, 401, loginPage('That PIN didn’t match.'))
  const sid = randomUUID()
  sessions.set(sid, { role })
  emitStatus()
  redirect(res, '/', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}`)
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function homePage(req: http.IncomingMessage): string {
  const manager = roleOf(req) === 'manager' || managerPin() === ''
  const out = listShopOrders().reduce((n, o) => n + outstanding(o), 0)
  const circuits = listCircuits()
  const full = circuits.filter((c) => c.srcPatched && c.dstPatched).length
  const card = (href: string, name: string, sub: string, pill = ''): string =>
    `<a class="home-card" href="${href}"><span><b>${esc(name)}</b><span class="sub">${esc(sub)}</span></span>${pill}</a>`
  const status = (done: boolean, label: string): string =>
    `<span class="pill ${done ? 'ok' : 'warn'}">${esc(label)}</span>`
  return layout(
    'Home',
    `<h1>Home</h1>
     <div class="stack">
       ${card('/orders', 'Receive', `${out} item${out === 1 ? '' : 's'} still out`, status(out === 0, out ? 'open' : 'done'))}
       ${card('/devices', 'Devices', 'Ports, IPs, VLANs and patching')}
       ${card('/patching', 'Patch', circuits.length ? `${full}/${circuits.length} fully patched` : 'Nothing imported yet', circuits.length ? status(full === circuits.length, full === circuits.length ? 'done' : 'open') : '')}
       ${card('/paperwork', 'Paperwork', 'IP schedule and device list')}
       ${card('/labels', 'Case labels', 'View and print label sheets')}
       ${manager ? card('/admin/qr-sheet', 'QR sheet', 'Printable device QR codes') : ''}
     </div>
     <p class="muted">To find a device, scan its QR code with your Camera app.</p>
     <p id="install"><a class="back" href="/install">Add to Home Screen ›</a></p>
     ${roleOf(req) ? '<form method="POST" action="/logout"><button class="btn sec">Sign out</button></form>' : ''}
     <script>
       if (window.navigator.standalone || matchMedia('(display-mode: standalone)').matches)
         document.getElementById('install').hidden = true;
     </script>`,
    roleOf(req) ?? 'crew',
    'home'
  )
}

function installPage(): string {
  const steps = (items: string[]): string =>
    items.map((t) => `<div class="line"><span class="grow">${esc(t)}</span></div>`).join('')
  return layout(
    'Add to Home Screen',
    `<a class="back" href="/">‹ Home</a>
     <h1>Keep it on your phone</h1>
     <p class="muted">No App Store. It gets its own icon and opens full screen. It still needs the show WiFi.</p>
     <h2>iPhone</h2>
     <div class="stack">${steps(['Open this page in Safari', 'Tap Share, then Add to Home Screen', 'Tap Add'])}</div>
     <h2>Android</h2>
     <div class="stack">${steps(['Open this page in Chrome', 'Tap the ⋮ menu, then Add to Home screen', 'Tap Add'])}</div>`,
    'crew',
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
      const pill = out === 0 ? '<span class="pill ok">complete</span>' : `<span class="pill warn">${out} out</span>`
      return `<li><a href="/orders/${o.id}"><span class="grow"><span class="name">${esc(o.name)}</span>${
        o.vendor ? `<br><span class="sub">${esc(o.vendor)}</span>` : ''
      }</span>${pill}</a></li>`
    })
    .join('')
  return layout(
    'Receive',
    `<h1>Receive</h1>${orders.length ? `<ul class="list">${items}</ul>` : '<p class="muted">No orders yet.</p>'}`,
    'crew',
    'orders'
  )
}
function orderPage(id: number): string {
  const o = getShopOrderById(id)
  if (!o) return layout('Order', '<h1>Order not found</h1><p>It may have been deleted on the host.</p><a class="back" href="/orders">‹ Receive</a>', 'crew', 'orders')
  const rows = o.items
    .map((it, i) => {
      const qty = it.quantity || 0
      const recv = it.received || 0
      const facts = [it.manufacturer, it.modelNumber].filter(Boolean).join(' · ')
      return `<div class="line" data-i="${i}" data-key="${esc(lineKey(it))}" data-max="${qty}" data-was="${recv}">
        <span class="grow"><span class="name">${esc(it.name)}</span>
          ${facts ? `<span class="sub">${esc(facts)}</span>` : ''}
          <span class="sub left"></span></span>
        <span class="stepper">
          <button type="button" class="minus" aria-label="One fewer ${esc(it.name)}">−</button>
          <output class="rc">${recv}</output>
          <button type="button" class="plus" aria-label="One more ${esc(it.name)}">+</button>
        </span>
        <button type="button" class="all">All ${qty}</button>
        <details${it.notes ? ' open' : ''}><summary>Note</summary>
          <input class="nt" type="text" aria-label="Note for ${esc(it.name)}" value="${esc(it.notes ?? '')}" data-was="${esc(it.notes ?? '')}">
        </details>
      </div>`
    })
    .join('')
  return layout(
    o.name,
    `<a class="back" href="/orders">‹ Receive</a>
     <h1>${esc(o.name)}</h1>
     <p class="muted">Tap + as items arrive, then save once.</p>
     <div id="items" class="stack" data-order="${o.id}">${rows || '<p class="muted">No items on this order.</p>'}</div>
     ${rows ? '<div class="savebar"><p class="err" id="saveErr" hidden></p><button class="btn" id="save" type="button" disabled>Nothing to save</button></div>' : ''}
     <script>
       var lines = [].slice.call(document.querySelectorAll('.line'));
       var bar = document.getElementById('save'), errBox = document.getElementById('saveErr');
       function count(l){ return +l.querySelector('.rc').textContent; }
       function changed(l){
         return count(l) !== +l.getAttribute('data-was') ||
           l.querySelector('.nt').value !== l.querySelector('.nt').getAttribute('data-was');
       }
       function draw(saved){
         lines.forEach(function(l){
           var left = +l.getAttribute('data-max') - count(l), sub = l.querySelector('.left');
           sub.textContent = l.getAttribute('data-max') + ' ordered · ' + (left ? left + ' out' : 'all here');
           sub.className = 'sub left ' + (left ? 'out' : 'done');
         });
         var n = lines.filter(changed).length;
         if (!bar) return;
         bar.disabled = !n;
         bar.textContent = n ? 'Save ' + n + ' line' + (n === 1 ? '' : 's') : (saved ? '✓ Saved' : 'Nothing to save');
       }
       lines.forEach(function(l){
         var max = +l.getAttribute('data-max'), rc = l.querySelector('.rc');
         function set(v){ rc.textContent = Math.max(0, Math.min(max, v)); draw(); }
         l.querySelector('.minus').addEventListener('click', function(){ set(count(l) - 1); });
         l.querySelector('.plus').addEventListener('click', function(){ set(count(l) + 1); });
         l.querySelector('.all').addEventListener('click', function(){ set(max); });
         l.querySelector('.nt').addEventListener('input', function(){ draw(); });
       });
       function saveLine(l){
         return fetch('/api/receive', { method:'POST', headers:{'Content-Type':'application/json'},
           body: JSON.stringify({ orderId:+document.getElementById('items').getAttribute('data-order'), index:+l.getAttribute('data-i'), key:l.getAttribute('data-key'), received:count(l), notes:l.querySelector('.nt').value }) })
           .then(function(r){ return r.json(); })
           .then(function(d){
             if (!d || !d.ok) throw new Error((d && d.error) || 'Save failed.');
             l.setAttribute('data-was', d.received);
             l.querySelector('.nt').setAttribute('data-was', l.querySelector('.nt').value);
           });
       }
       if (bar) bar.addEventListener('click', function(){
         bar.disabled = true; bar.textContent = 'Saving…'; errBox.hidden = true;
         // One at a time: each save rereads the order, so together they could overwrite each other.
         lines.filter(changed).reduce(function(p, l){ return p.then(function(){ return saveLine(l); }); }, Promise.resolve())
           .then(function(){ draw(true); })
           .catch(function(e){ errBox.textContent = e.message === 'Failed to fetch' || e.name === 'TypeError' ? 'Couldn’t reach the show. Check the WiFi and try again.' : e.message; errBox.hidden = false; draw(); });
       });
       document.addEventListener('click', function(e){
         var a = e.target.closest && e.target.closest('a');
         if (a && lines.some(changed) && !confirm('Leave without saving these counts?')) e.preventDefault();
       });
       draw();
     </script>`,
    'crew',
    'orders'
  )
}
function lineKey(it: OrderItem | null): string | null {
  return it ? `${it.name}|${it.modelNumber ?? ''}` : null
}
async function apiReceive(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!allow(req, 'crew')) return sendJson(res, 403, { ok: false, error: 'not allowed' })
  let payload: { orderId?: number; index?: number; key?: string; received?: number; notes?: string }
  try {
    payload = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad request' })
  }
  const { orderId, index: at } = payload
  if (typeof orderId !== 'number' || typeof at !== 'number') {
    return sendJson(res, 400, { ok: false, error: 'bad request' })
  }
  const result = await serialize(() => {
    const o = getShopOrderById(orderId)
    if (!o) return { ok: false, error: 'item not found' }
    // This page may be older than the order: find the line by what it is, so a line
    // removed on the desktop can't send this count to the wrong item.
    const items = o.items.map((it) => ({ ...it }))
    const index = lineKey(items[at] ?? null) === payload.key ? at : items.findIndex((it) => lineKey(it) === payload.key)
    if (index < 0) return { ok: false, error: 'This order changed. Reload the page.' }
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
  const subnets = listSubnets()
  const items = devices
    .map(
      (d) =>
        `<li><a href="/device/${d.id}"><span class="grow"><span class="name">${esc(d.name)}</span>${
          d.deviceType || d.location
            ? `<br><span class="sub">${esc([d.deviceType, d.location].filter(Boolean).join(' · '))}</span>`
            : ''
        }</span><span class="mono ip">${esc(mainRoute(d, subnets).ip)}</span></a></li>`
    )
    .join('')
  return layout(
    'Devices',
    `<h1>Devices</h1>
     <input type="text" id="q" placeholder="Search name or IP" aria-label="Search devices" oninput="var v=this.value.toLowerCase();document.querySelectorAll('#dl li').forEach(function(li){li.style.display=li.textContent.toLowerCase().includes(v)?'':'none';});" style="margin-bottom:12px">
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
/** The switch admin password and SNMP community are for logged-in managers only;
 *  the crew's copy of a config leaves them out. */
function switchConfigFor(req: http.IncomingMessage): SwitchConfigOptions {
  const cfg = getSwitchConfig()
  return roleOf(req) === 'manager' ? cfg : { ...cfg, adminPassword: '', crewCopy: true }
}
async function devicePage(id: number, req: http.IncomingMessage): Promise<string> {
  const d = getDeviceById(id)
  if (!d) return layout('Device', '<h1>Device not found</h1><p>It may have been deleted on the host.</p><a class="back" href="/devices">‹ Devices</a>', 'crew', 'devices')
  const subnetList = listSubnets()
  const subnets = new Map(subnetList.map((s) => [s.id, s]))
  const field = (k: string, v: string, mono = false): string =>
    `<div><span>${esc(k)}</span><span${mono ? ' class="mono"' : ''}>${esc(v)}</span></div>`
  const meta = [
    d.deviceType ? field('Type', d.deviceType) : '',
    d.location ? field('Location', d.location) : '',
    d.macAddress ? field('MAC', d.macAddress, true) : '',
    d.isSwitch && d.managementIp ? field('Management IP', d.managementIp, true) : '',
    d.isSwitch && d.oobIp ? field('OOB IP', d.oobIp, true) : ''
  ].join('')
  const portRows = d.ports
    .filter((p) => !p.isUnused)
    .map((p) => {
      const tagged = p.taggedSubnetIds.map((sid) => subnetLabel(subnets, sid)).join(', ')
      return `<div class="pcard"><b>${esc(p.label)}</b>
        ${d.isSwitch ? '' : field('IP', p.ipAddress ?? '—', true)}
        ${field('Untagged', subnetLabel(subnets, p.untaggedSubnetId))}
        ${tagged ? field('Tagged', tagged) : ''}</div>`
    })
    .join('')
  const qr = await qrSvg(deviceUrl(d.id))
  const circuits = listCircuits().filter((c) => c.srcName === d.name || c.dstName === d.name)
  return layout(
    d.name,
    `<a class="back" href="/devices">‹ Devices</a>
     <h1>${esc(d.name)}${d.isSwitch ? ' <span class="pill">switch</span>' : ''}</h1>
     ${meta ? `<div class="pcard">${meta}</div>` : ''}
     <h2>Ports</h2>
     <div class="stack">${portRows || '<p class="muted">No ports.</p>'}</div>
     ${connectionsSection(d.name, circuits)}
     ${d.isSwitch ? switchConfigSection(generateSwitchConfig(d, subnetList, switchConfigFor(req)), d.id) : ''}
     ${d.notes ? `<h2>Notes</h2><p>${esc(d.notes).replace(/\n/g, '<br>')}</p>` : ''}
     <h2>This device’s QR</h2><div class="qr">${qr}</div>
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

function patchingPage(): string {
  const circuits = listCircuits()
  const racks = [...new Set(circuits.flatMap((c) => [c.srcRack, c.dstRack]).filter(Boolean))].sort()
  const end = (id: string, label: string, on: boolean): string =>
    `<button type="button" class="${id}${on ? ' on' : ''}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(label)}</button>`
  const cards = circuits
    .map((c) => {
      const a = [c.srcName, c.srcSocket].filter(Boolean).join(' · ') || '—'
      const b = [c.dstName, c.dstSocket].filter(Boolean).join(' · ') || '—'
      return `<div class="line circuit" data-id="${c.id}" data-a="${esc(a)}" data-b="${esc(b)}" data-racks="${esc(`${c.srcRack}|${c.dstRack}`)}">
        <span class="grow" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <span class="name mono">${esc(c.cableNumber || c.signal || 'Cable')}</span><span class="pill st"></span>
        </span>
        <div class="ends">${end('src', a, c.srcPatched)}${end('dst', b, c.dstPatched)}</div>
        <button type="button" class="tested${c.tested ? ' on' : ''}" aria-pressed="${c.tested}">${c.tested ? '✓ Tested' : 'Mark tested'}</button>
      </div>`
    })
    .join('')
  return layout(
    'Patch',
    `<h1>Patch</h1>
     ${circuits.length ? `<p class="muted"><span id="tally"></span> fully patched</p>
     <div class="filters">
       <select id="rack" aria-label="Rack"><option value="">All racks</option>${racks.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
       <select id="show" aria-label="Show"><option value="">All</option><option value="todo">Not done</option></select>
     </div>
     <div class="stack" id="circuits">${cards}</div>` : '<p class="muted">Nothing imported yet. Import a circuit report in Device Manager on the host.</p>'}
     <script>
       var cards = [].slice.call(document.querySelectorAll('.circuit'));
       function on(c, k){ return c.querySelector('.' + k).classList.contains('on'); }
       function draw(){
         var rack = document.getElementById('rack'), show = document.getElementById('show'), full = 0;
         if (!rack) return;
         cards.forEach(function(c){
           var both = on(c, 'src') && on(c, 'dst'), one = on(c, 'src') || on(c, 'dst'), st = c.querySelector('.st');
           if (both) full++;
           st.textContent = both ? 'patched' : one ? 'one end' : 'not patched';
           st.className = 'pill st ' + (both ? 'ok' : one ? 'warn' : '');
           var inRack = !rack.value || c.getAttribute('data-racks').split('|').indexOf(rack.value) >= 0;
           c.hidden = !inRack || (show.value === 'todo' && both && on(c, 'tested'));
           c.style.display = c.hidden ? 'none' : '';
         });
         document.getElementById('tally').textContent = full + '/' + cards.length;
       }
       function paint(c, d){
         [['src', d.srcPatched, c.getAttribute('data-a')], ['dst', d.dstPatched, c.getAttribute('data-b')]].forEach(function(e){
           var b = c.querySelector('.' + e[0]);
           b.classList.toggle('on', e[1]); b.setAttribute('aria-pressed', e[1]);
           b.textContent = (e[1] ? '✓ ' : '') + e[2];
         });
         var t = c.querySelector('.tested');
         t.classList.toggle('on', d.tested); t.setAttribute('aria-pressed', d.tested);
         t.textContent = d.tested ? '✓ Tested' : 'Mark tested';
         draw();
       }
       function send(c, body){
         body.id = +c.getAttribute('data-id');
         fetch('/api/patch', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
           .then(function(r){ return r.json(); })
           .then(function(d){ if (d && d.ok) paint(c, d); else alert((d && d.error) || 'Save failed.'); })
           .catch(function(){ alert('Couldn’t reach the show. Check the WiFi and try again.'); });
       }
       cards.forEach(function(c){
         c.querySelector('.src').addEventListener('click', function(){ send(c, { end:'src', patched:!on(c, 'src') }); });
         c.querySelector('.dst').addEventListener('click', function(){ send(c, { end:'dst', patched:!on(c, 'dst') }); });
         c.querySelector('.tested').addEventListener('click', function(){ send(c, { tested:!on(c, 'tested') }); });
       });
       ['rack', 'show'].forEach(function(id){ var el = document.getElementById(id); if (el) el.addEventListener('change', draw); });
       draw();
     </script>`,
    'crew',
    'patch'
  )
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
    return { ok: true, myPatched, tested: saved.tested, srcPatched: saved.srcPatched, dstPatched: saved.dstPatched }
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
    `<a class="back" href="/">‹ Home</a>
     <h1>Paperwork</h1>
     <div class="cards">
       <a class="card" href="/paperwork/ip-schedule"><b>IP schedule</b><span>Switch ports + device IPs</span></a>
       <a class="card" href="/paperwork/devices"><b>Device list</b><span>By category, with main IP/VLAN</span></a>
     </div>`,
    'crew',
    'home'
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
    `<a class="back" href="/">‹ Home</a>
     <h1>Case labels</h1>
     <h2>Templates</h2>${templates.length ? `<ul class="list">${tpl}</ul>` : '<p class="muted">No templates.</p>'}
     ${cases.length ? `<h2>Cases</h2><ul class="list">${cs}</ul>` : ''}
     <p class="muted">Open one, then use your browser’s Print to put it on Uline S-19323 sheets.</p>`,
    'crew',
    'home'
  )
}
function templateSheetPage(id: number): string {
  const t = getLabelTemplateById(id)
  if (!t) return layout('Label', '<h1>Template not found</h1>', 'crew', 'home')
  return renderTemplateSheetHtml(t, 1)
}
function caseSheetPage(id: number): string {
  const c = getCaseById(id)
  if (!c) return layout('Label', '<h1>Case not found</h1>', 'crew', 'home')
  const templates = listLabelTemplates()
  if (templates.length === 0) return layout('Label', '<h1>No templates</h1><p class="muted">Create a label template first.</p>', 'crew', 'home')
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
