// Client side of sharing a show over the LAN: this computer joins a show that
// another computer (the host) has open, and reads its data through the host's
// Show Server (/rpc/*). View-only for now — ipc.ts refuses changes while joined.
import { app, type BrowserWindow } from 'electron'
import type { ProjectInfo } from '../shared/types'
import { HOST_UNREACHABLE, normalizeAddress } from '../shared/remote-scope'

interface Session {
  base: string // http://host:port
  token: string
  showName: string
  hostName: string
  seq: number
  fails: number
  offline: boolean
}

let session: Session | null = null
let win: BrowserWindow | null = null
let poll: ReturnType<typeof setInterval> | null = null

const TIMEOUT_MS = 5000

export function setRemoteWindow(w: BrowserWindow): void {
  win = w
}
function notify(): void {
  if (win && !win.isDestroyed()) win.webContents.send('data-changed')
}

export function isJoined(): boolean {
  return session !== null
}

/** The shared show as the header shows it, or null when not joined. */
export function info(): ProjectInfo | null {
  if (!session) return null
  return {
    path: '',
    name: session.showName,
    remote: { host: session.hostName, offline: session.offline }
  }
}


async function post(
  base: string,
  path: string,
  body: unknown,
  token?: string
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, data }
}

export async function join(address: string, pin: string): Promise<ProjectInfo | { error: string }> {
  const base = normalizeAddress(address)
  if (!base) return { error: 'Enter the host’s address, like 192.168.1.20:8787.' }
  let r
  try {
    r = await post(base, '/rpc/login', { pin, appVersion: app.getVersion() })
  } catch {
    return {
      error: `Couldn’t reach ${base.slice(7)}. Check the address, that the host’s Show Server is on, and that both computers are on the same network.`
    }
  }
  if (!r.data.ok) return { error: String(r.data.error ?? `The host answered ${r.status}.`) }
  leave()
  session = {
    base,
    token: String(r.data.token),
    showName: String(r.data.showName ?? 'Shared show'),
    hostName: String(r.data.hostName ?? base.slice(7)),
    seq: Number(r.data.seq ?? 0),
    fails: 0,
    offline: false
  }
  // Every 1.5 s while this window is in front, every 4.5 s behind other windows.
  let tick = 0
  poll = setInterval(() => {
    const focused = !!win && !win.isDestroyed() && win.isFocused()
    if (focused || ++tick % 3 === 0) void checkChanges()
  }, 1500)
  return info()!
}

/** Stop using the shared show; the local project (still open underneath) comes back. */
export function leave(): void {
  if (poll) clearInterval(poll)
  poll = null
  session = null
}

function setOffline(s: Session, offline: boolean): void {
  if (s.offline !== offline) {
    s.offline = offline
    notify() // the header re-reads project:current
  }
}
function failed(s: Session): void {
  if (++s.fails >= 3) setOffline(s, true)
}

async function checkChanges(): Promise<void> {
  const s = session
  if (!s) return
  try {
    const res = await fetch(`${s.base}/rpc/changes`, {
      headers: { Authorization: `Bearer ${s.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const data = (await res.json()) as { ok?: boolean; seq?: number }
    if (!data.ok) return failed(s)
    s.fails = 0
    setOffline(s, false)
    if (data.seq !== s.seq) {
      s.seq = data.seq ?? 0
      notify()
    }
  } catch {
    failed(s)
  }
}

/** Run a data read on the host. */
export async function call(channel: string, args: unknown[]): Promise<unknown> {
  const s = session
  if (!s) throw new Error('Not joined to a shared show.')
  let r
  try {
    r = await post(s.base, '/rpc/call', { channel, args }, s.token)
  } catch {
    failed(s)
    throw new Error(HOST_UNREACHABLE)
  }
  s.fails = 0
  setOffline(s, false)
  if (!r.data.ok) throw new Error(String(r.data.error ?? 'The host refused that.'))
  return r.data.result
}
