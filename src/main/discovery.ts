// Finding shared shows on the LAN without typing an address. While its Show
// Server runs, a host broadcasts a small UDP beacon every 2 s; the Join dialog
// listens and lists who it hears. Plain node:dgram, no dependency. Discovery is
// a convenience: any socket error just turns it off, never the Show Server.
import dgram from 'node:dgram'
import os from 'node:os'

export const DISCOVERY_PORT = 8786
const MAGIC = 'vwdm-show/1'
const BEACON_MS = 2000
/** a host not heard from for this long drops off the list */
const STALE_MS = 7000
/** stop listening if the Join dialog stops asking (closed, or the window crashed) */
const IDLE_MS = 10000

export interface BeaconInfo {
  showName: string
  hostName: string
  port: number
}
export interface FoundHost extends BeaconInfo {
  /** what goes in the Join dialog's address box, e.g. 192.168.1.20:8787 */
  address: string
}

/** Directed broadcast address of every LAN interface (more reliable than
 *  255.255.255.255, which macOS sends out of one interface only). */
export function broadcastAddresses(ifaces = os.networkInterfaces()): string[] {
  const out = new Set<string>()
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      // a /32 (VPNs like Tailscale) has no broadcast address
      if (ni.family !== 'IPv4' || ni.internal || ni.netmask === '255.255.255.255') continue
      const a = ni.address.split('.').map(Number)
      const m = ni.netmask.split('.').map(Number)
      out.add(a.map((x, i) => (x | (~m[i] & 255)) & 255).join('.'))
    }
  }
  return [...out]
}

export function encodeBeacon(b: BeaconInfo): Buffer {
  return Buffer.from(JSON.stringify({ magic: MAGIC, ...b }))
}

/** A beacon from `fromIp`, or null for anything else that lands on the port. */
export function parseBeacon(msg: Buffer, fromIp: string): FoundHost | null {
  try {
    const d = JSON.parse(msg.toString('utf8'))
    const port = Number(d?.port)
    if (d?.magic !== MAGIC || !Number.isInteger(port) || port < 1 || port > 65535) return null
    return {
      address: `${fromIp}:${port}`,
      port,
      showName: String(d.showName ?? '').slice(0, 200) || 'Shared show',
      hostName: String(d.hostName ?? '').slice(0, 200) || fromIp
    }
  } catch {
    return null
  }
}

// ---- host side: announce ---------------------------------------------------
let beacon: dgram.Socket | null = null
let beaconTimer: ReturnType<typeof setInterval> | null = null

/** `info` is re-read every beat so a renamed show shows up right away. */
export function startBeacon(info: () => BeaconInfo): void {
  stopBeacon()
  const sock = dgram.createSocket('udp4')
  beacon = sock
  sock.on('error', () => stopBeacon())
  sock.bind(0, () => {
    if (beacon !== sock) return
    sock.setBroadcast(true)
    const beat = (): void => {
      const msg = encodeBeacon(info())
      for (const addr of broadcastAddresses()) sock.send(msg, DISCOVERY_PORT, addr, () => {})
    }
    beat()
    beaconTimer = setInterval(beat, BEACON_MS)
  })
}

export function stopBeacon(): void {
  if (beaconTimer) clearInterval(beaconTimer)
  beaconTimer = null
  try {
    beacon?.close()
  } catch {
    /* already closed */
  }
  beacon = null
}

// ---- joining side: listen ----------------------------------------------------
let listener: dgram.Socket | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
const heard = new Map<string, FoundHost & { seen: number }>()

/** Start listening (if not already) and return the hosts heard recently. Call it
 *  repeatedly while the Join dialog is open. */
export function scan(): FoundHost[] {
  if (!listener) {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    listener = sock
    sock.on('error', () => stopScan())
    sock.on('message', (msg, rinfo) => {
      const h = parseBeacon(msg, rinfo.address)
      if (h) heard.set(h.address, { ...h, seen: Date.now() })
    })
    sock.bind(DISCOVERY_PORT)
  }
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(stopScan, IDLE_MS)
  const now = Date.now()
  return [...heard.values()]
    .filter((h) => now - h.seen < STALE_MS)
    .map((h) => ({ address: h.address, showName: h.showName, hostName: h.hostName, port: h.port }))
    .sort((a, b) => a.showName.localeCompare(b.showName))
}

export function stopScan(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  try {
    listener?.close()
  } catch {
    /* already closed */
  }
  listener = null
  heard.clear()
}
