// Program › sACN: listen for streaming ACN (E1.31) on this computer's network and
// report who is sending which universes, and the levels. Plain node:dgram, no
// dependency. Listening only, never sends. Like discovery.ts, it stops by itself
// when the page stops asking (closed, or the window crashed).
import dgram from 'node:dgram'
import os from 'node:os'
import type { SacnAdapter, SacnSnapshot } from '../shared/types'

export const SACN_PORT = 5568
/** E1.31 universe discovery: sources list their universes here every 10 s */
export const DISCOVERY_UNIVERSE = 64214
/** E1.31's network data loss timeout */
const STALE_MS = 2500
/** discovery is sent every 10 s; allow two misses */
const ANNOUNCE_STALE_MS = 25000
const IDLE_MS = 10000
const ACN_ID = Buffer.from('ASC-E1.17\0\0\0', 'latin1')

export type SacnPacket =
  | {
      kind: 'data'
      cid: string
      sourceName: string
      priority: number
      universe: number
      /** 0 = dimmer levels; anything else (0xDD per-address priority…) has no levels */
      startCode: number
      terminated: boolean
      preview: boolean
      values: Uint8Array
    }
  | { kind: 'discovery'; cid: string; sourceName: string; universes: number[] }

const nameAt = (b: Buffer, at: number): string => {
  const end = b.indexOf(0, at)
  return b.toString('utf8', at, end < 0 || end > at + 64 ? at + 64 : end).trim()
}

/** One E1.31 packet, or null for anything else landing on the port. */
export function parseSacn(b: Buffer): SacnPacket | null {
  if (b.length < 38 || b.readUInt16BE(0) !== 0x0010 || !b.subarray(4, 16).equals(ACN_ID))
    return null
  const rootVector = b.readUInt32BE(18)
  const cid = b.toString('hex', 22, 38)
  if (rootVector === 0x04) {
    if (b.length < 126 || b.readUInt32BE(40) !== 0x02 || b[117] !== 0x02) return null
    const count = Math.min(b.readUInt16BE(123) - 1, 512, b.length - 126)
    return {
      kind: 'data',
      cid,
      sourceName: nameAt(b, 44),
      priority: b[108],
      universe: b.readUInt16BE(113),
      startCode: b[125],
      terminated: (b[112] & 0x40) !== 0,
      preview: (b[112] & 0x80) !== 0,
      values: new Uint8Array(b.subarray(126, 126 + Math.max(0, count)))
    }
  }
  if (rootVector === 0x08 && b.length >= 120 && b.readUInt32BE(40) === 0x02) {
    const len = b.readUInt16BE(112) & 0x0fff
    const n = Math.max(0, Math.min((len - 8) >> 1, (b.length - 120) >> 1))
    const universes: number[] = []
    for (let i = 0; i < n; i++) universes.push(b.readUInt16BE(120 + i * 2))
    return { kind: 'discovery', cid, sourceName: nameAt(b, 44), universes }
  }
  return null
}

/** Multicast group a universe is sent to: 239.255.<hi>.<lo>. */
export const groupFor = (u: number): string => `239.255.${(u >> 8) & 255}.${u & 255}`

// ---- live state -------------------------------------------------------------
interface Stream {
  name: string
  ip: string
  priority: number
  preview: boolean
  levels: Uint8Array | null
  seen: number
  packets: number
  /** packets / seen at the last snapshot, for the rate */
  lastPackets: number
  lastAt: number
  rate: number
}
let sock: dgram.Socket | null = null
let error = ''
/** the adapter's IPv4 address to listen on; '' = every adapter */
let adapter = ''
let idleTimer: ReturnType<typeof setTimeout> | null = null
const joined = new Set<number>()
/** `${universe}/${cid}` → what that source is sending on that universe */
const streams = new Map<string, Stream>()
/** cid → name/ip and the universes its discovery packets announce */
const announced = new Map<string, { name: string; ip: string; universes: Map<number, number> }>()

/** This computer's IPv4 network adapters, for the picker. */
export function adapters(ifaces = os.networkInterfaces()): SacnAdapter[] {
  const out: SacnAdapter[] = []
  for (const [name, list] of Object.entries(ifaces))
    for (const ni of list ?? [])
      if (ni.family === 'IPv4' && !ni.internal)
        out.push({ name, address: ni.address, netmask: ni.netmask })
  return out
}

const ipNum = (ip: string): number =>
  ip.split('.').reduce((n, x) => ((n << 8) | (Number(x) & 255)) >>> 0, 0)

/** Is `ip` on the same network as the adapter? (unicast sACN reaches every adapter, so filter it) */
export function onAdapter(ip: string, a: SacnAdapter): boolean {
  const m = ipNum(a.netmask)
  return (ipNum(ip) & m) >>> 0 === (ipNum(a.address) & m) >>> 0
}

const chosen = (): SacnAdapter[] => adapters().filter((a) => !adapter || a.address === adapter)

function join(u: number): void {
  if (!sock || joined.has(u) || u < 1 || u > 64214) return
  joined.add(u)
  // join on every interface, or macOS only listens on its default one
  for (const a of chosen()) {
    try {
      sock.addMembership(groupFor(u), a.address)
    } catch {
      /* that interface can't do multicast; others may */
    }
  }
}

function onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
  const p = parseSacn(msg)
  if (!p) return
  if (adapter && !chosen().some((a) => onAdapter(rinfo.address, a))) return
  const now = Date.now()
  if (p.kind === 'discovery') {
    const a = announced.get(p.cid) ?? { name: '', ip: '', universes: new Map() }
    a.name = p.sourceName
    a.ip = rinfo.address
    for (const u of p.universes) {
      a.universes.set(u, now)
      join(u) // so their levels show up without typing the universe in
    }
    announced.set(p.cid, a)
    return
  }
  const key = `${p.universe}/${p.cid}`
  if (p.terminated) {
    streams.delete(key)
    return
  }
  const s = streams.get(key) ?? {
    name: '',
    ip: '',
    priority: 0,
    preview: false,
    levels: null,
    seen: now,
    packets: 0,
    lastPackets: 0,
    lastAt: now,
    rate: 0
  }
  s.name = p.sourceName
  s.ip = rinfo.address
  s.priority = p.priority
  s.preview = p.preview
  s.seen = now
  s.packets++
  if (p.startCode === 0) s.levels = p.values
  streams.set(key, s)
}

function start(): void {
  error = ''
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  sock = s
  s.on('message', onMessage)
  s.on('error', (e) => {
    error = `Can't listen on port ${SACN_PORT}: ${e.message}`
    stop(true)
  })
  s.bind(SACN_PORT, () => {
    if (sock !== s) return
    join(DISCOVERY_UNIVERSE)
  })
}

function stop(keepError = false): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  try {
    sock?.close()
  } catch {
    /* already closed */
  }
  sock = null
  joined.clear()
  streams.clear()
  announced.clear()
  if (!keepError) error = ''
}

/** Start listening (if not already), also join `watch` universes, and return what's
 *  been heard. Call it repeatedly while the page is open. */
export function scan(watch: number[], adapterIp = ''): SacnSnapshot {
  if (adapterIp !== adapter) {
    stop() // memberships are per adapter: start over on the new one
    adapter = adapterIp
  }
  if (!sock && !error) start()
  for (const u of watch) join(u)
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => stop(), IDLE_MS)
  const now = Date.now()
  for (const [k, s] of streams) if (now - s.seen > STALE_MS) streams.delete(k)

  const universes = new Map<number, SacnSnapshot['universes'][number]>()
  for (const [k, s] of streams) {
    const [u, cid] = k.split('/')
    const dt = (now - s.lastAt) / 1000
    if (dt >= 0.4) {
      s.rate = Math.round((s.packets - s.lastPackets) / dt)
      s.lastPackets = s.packets
      s.lastAt = now
    }
    const uni = universes.get(+u) ?? { universe: +u, sources: [], levels: null }
    uni.sources.push({
      cid,
      name: s.name,
      ip: s.ip,
      priority: s.priority,
      rate: s.rate,
      preview: s.preview
    })
    universes.set(+u, uni)
  }
  // a receiver follows the highest priority; on a tie show the busiest stream
  for (const uni of universes.values()) {
    uni.sources.sort((a, b) => b.priority - a.priority || b.rate - a.rate)
    const top = streams.get(`${uni.universe}/${uni.sources[0].cid}`)
    uni.levels = top?.levels ? Array.from(top.levels) : null
  }

  const sources = new Map<string, SacnSnapshot['sources'][number]>()
  for (const uni of universes.values())
    for (const s of uni.sources) {
      const src = sources.get(s.cid) ?? {
        cid: s.cid,
        name: s.name,
        ip: s.ip,
        sending: [],
        announced: []
      }
      src.sending.push(uni.universe)
      sources.set(s.cid, src)
    }
  for (const [cid, a] of announced) {
    const live = [...a.universes].filter(([, t]) => now - t < ANNOUNCE_STALE_MS).map(([u]) => u)
    if (!live.length) continue
    const src = sources.get(cid) ?? { cid, name: a.name, ip: a.ip, sending: [], announced: [] }
    src.announced = live.sort((x, y) => x - y)
    sources.set(cid, src)
  }

  return {
    listening: sock != null,
    adapter,
    error,
    port: SACN_PORT,
    sources: [...sources.values()]
      .map((s) => ({ ...s, sending: s.sending.sort((x, y) => x - y) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.ip.localeCompare(b.ip)),
    universes: [...universes.values()].sort((a, b) => a.universe - b.universe)
  }
}

/** Stop now (page closed), and clear a port error so the next scan retries. */
export function stopScan(): void {
  stop()
}
