// ETC Eos client: OSC over TCP 3032. Reads cues, fires cues, creates empty cues.
// Protocol notes: _Master/knowledge/etc-eos-osc.md (researched, not yet checked on a console).
import { EventEmitter } from 'node:events'
import net from 'node:net'
import { OscDeframer, decodeOsc, encodeOsc, frame, type OscArg, type OscMessage } from './osc'
import type { EosCue, EosStatus } from '../shared/types'

// User 0 is the background user: its command line is nobody's, so we never clobber the operator's.
const OSC_USER = 0
// Eos needs spaces around the list slash: "Cue 1/13" is a syntax error, "Cue 1 / 13" works (ETCnomad 3.3, 2026-11-13).
// shortcut: parses on ETCnomad, but creating a cue this way was not run (it would add a cue to the show)
export const EMPTY_CUE_CMD = (list: number, cue: string): string =>
  `Record_Only Cue ${list} / ${cue} #`
// From Live, per the Show Control guide ("Cue 3 Execute Timecode 3215 Enter"): the console picks
// the event number, so we never track event numbers (they renumber on every add). Checked on
// ETCnomad 3.3: it MOVES the cue's existing event (one event per cue), it doesn't add a second.
export const CUE_TC_CMD = (list: number, cue: string, tc: string): string =>
  `Cue ${list} / ${cue} Execute Timecode ${tc.replace(/\D/g, '')} #`
const TIMEOUT_MS = 3000

/**
 * Eos splits long replies into /list/<listIndex>/<total> pieces whose args belong at
 * listIndex + j. Returns the whole reply (address without /list/…) once every arg arrived.
 */
export function mergeSplit(pending: Map<string, OscArg[]>, msg: OscMessage): OscMessage | null {
  const m = /^(.*)\/list\/(\d+)\/(\d+)$/.exec(msg.address)
  if (!m) return msg
  const [, path, idx, tot] = m
  const args = pending.get(path) ?? new Array<OscArg>(Number(tot))
  msg.args.forEach((a, j) => (args[Number(idx) + j] = a))
  if (args.filter((a) => a !== undefined).length < args.length) {
    pending.set(path, args)
    return null
  }
  pending.delete(path)
  return { address: path, args }
}

const str = (a: OscArg | undefined): string => (a === undefined ? '' : String(a))

/** A whole /eos/out/get/cue/<list>/<cue>/<part> reply, base cues (part 0) only. Args: 1 UID, 2 label, 25 timecode, 28 scene. */
export function parseCueReply(msg: OscMessage): EosCue | null {
  const m = /^\/eos\/out\/get\/cue\/(\d+)\/([^/]+)\/(\d+)$/.exec(msg.address)
  if (!m || m[3] !== '0') return null
  return {
    list: Number(m[1]),
    cue: m[2],
    uid: str(msg.args[1]),
    label: str(msg.args[2]),
    timecode: str(msg.args[25]) || null,
    scene: str(msg.args[28])
  }
}

export class EosClient extends EventEmitter {
  private st: EosStatus = { state: 'offline', host: '' }
  private port = 3032
  private socket: net.Socket | null = null
  private deframer = new OscDeframer()
  private pending = new Map<string, OscArg[]>()
  private replies = new EventEmitter()
  private wanted = false
  private backoff = 1000
  private missed = 0
  private timers: NodeJS.Timeout[] = []

  constructor() {
    super()
    this.replies.setMaxListeners(0)
  }

  status(): EosStatus {
    return { ...this.st }
  }

  private setStatus(s: Partial<EosStatus>): void {
    this.st = { host: this.st.host, state: this.st.state, ...s }
    this.emit('status', this.status())
  }

  connect(host: string, port = 3032): void {
    this.disconnect()
    this.wanted = true
    this.st.host = host
    this.port = port
    this.open()
  }

  disconnect(): void {
    this.wanted = false
    this.cleanup()
    if (this.st.state !== 'offline') this.setStatus({ state: 'offline' })
  }

  private cleanup(): void {
    this.timers.forEach(clearTimeout)
    this.timers = []
    this.socket
      ?.removeAllListeners()
      .on('error', () => {})
      .destroy()
    this.socket = null
    this.deframer = new OscDeframer()
    this.pending.clear()
  }

  private open(): void {
    this.setStatus({ state: 'connecting' })
    const sock = net.connect(this.port, this.st.host)
    this.socket = sock
    let lastError = ''
    // No TCP answer in 3 s (wrong IP, console off): give up and let 'close' retry with backoff.
    sock.setTimeout(TIMEOUT_MS, () =>
      sock.destroy(new Error(`No answer from the console at ${this.st.host}`))
    )
    sock.on('connect', () => {
      sock.setTimeout(0)
      this.backoff = 1000
      this.missed = 0
      this.send('/eos/get/version')
      this.send('/eos/subscribe', [1])
      // No version reply within 2 s: still connected, just without a version.
      this.timers.push(
        setTimeout(
          () => this.st.state === 'connecting' && this.setStatus({ state: 'connected' }),
          2000
        )
      )
      this.timers.push(
        setInterval(() => {
          if (++this.missed > 3) return void sock.destroy()
          this.send('/eos/ping')
        }, 5000)
      )
    })
    sock.on('data', (chunk) => {
      for (const p of this.deframer.push(chunk)) {
        try {
          this.onMessage(decodeOsc(p))
        } catch {
          // ignore packets we can't decode
        }
      }
    })
    sock.on('error', (e) => (lastError = e.message))
    sock.on('close', () => {
      this.cleanup()
      if (!this.wanted) return
      this.setStatus({ state: 'error', error: lastError || 'Connection to Eos lost' })
      this.timers.push(setTimeout(() => this.wanted && this.open(), this.backoff))
      this.backoff = Math.min(this.backoff * 2, 10000)
    })
  }

  private onMessage(raw: OscMessage): void {
    this.missed = 0 // anything from the console proves it is alive
    const msg = mergeSplit(this.pending, raw)
    if (!msg) return
    const a = msg.address
    if (a === '/eos/out/get/version')
      this.setStatus({ state: 'connected', version: str(msg.args[0]) })
    else if (a.startsWith('/eos/out/notify/cue/')) this.emit('cues', Number(a.split('/')[5]) || 0)
    else if (a === '/eos/out/event/show/loaded' || a === '/eos/out/event/show/cleared')
      this.emit('cues', 0)
    this.replies.emit('msg', msg)
  }

  private send(address: string, args: OscArg[] = []): void {
    if (!this.socket || this.socket.connecting || this.socket.destroyed)
      throw new Error('Not connected to Eos')
    this.socket.write(frame(encodeOsc(address, args)))
  }

  /**
   * Sends `requests`, then hands each reply to `take` until it returns true.
   * Rejects if the console goes quiet for 3 s.
   */
  private ask(requests: string[], take: (m: OscMessage) => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout
      const done = (err?: Error): void => {
        clearTimeout(timer)
        this.replies.off('msg', onMsg)
        if (err) reject(err)
        else resolve()
      }
      const arm = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => done(new Error('Eos did not answer in time')), TIMEOUT_MS)
      }
      const onMsg = (m: OscMessage): void => {
        arm()
        if (take(m)) done()
      }
      this.replies.on('msg', onMsg)
      arm()
      try {
        requests.forEach((r) => this.send(r))
      } catch (e) {
        done(e as Error)
      }
    })
  }

  private async count(get: string): Promise<number> {
    let n = 0
    const reply = get.replace('/eos/get/', '/eos/out/get/')
    await this.ask([get], (m) => {
      if (m.address !== reply) return false
      n = Number(m.args[0]) || 0
      return true
    })
    return n
  }

  /** Index requests for 0..n-1; finished when a reply has come back for every index (reply arg 0). */
  private async byIndex<T>(
    base: string,
    n: number,
    parse: (m: OscMessage) => T | null
  ): Promise<T[]> {
    const out: T[] = []
    if (!n) return out
    const seen = new Set<number>()
    const prefix = base.replace('/eos/get/', '/eos/out/get/') + '/'
    await this.ask(
      Array.from({ length: n }, (_, i) => `${base}/index/${i}`),
      (m) => {
        if (!m.address.startsWith(prefix)) return false
        const item = parse(m)
        if (item) out.push(item)
        if (/\/\d+$/.test(m.address)) seen.add(Number(m.args[0])) // skips /fx /links /actions replies
        return seen.size >= n
      }
    )
    return out
  }

  async getCues(list: number): Promise<EosCue[]> {
    const n = await this.count(`/eos/get/cue/${list}/count`)
    return this.byIndex(`/eos/get/cue/${list}`, n, parseCueReply)
  }

  fireCue(list: number, cue: string): void {
    this.send(`/eos/cue/${list}/${cue}/fire`)
  }

  async createEmptyCue(list: number, cue: string): Promise<void> {
    this.send(`/eos/user/${OSC_USER}/newcmd`, [EMPTY_CUE_CMD(list, cue)])
  }

  /** Moves the cue's timecode event to `tc` (HH:MM:SS:FF). */
  setCueTimecode(list: number, cue: string, tc: string): void {
    this.send(`/eos/user/${OSC_USER}/newcmd`, [CUE_TC_CMD(list, cue, tc)])
  }

  // Checked on ETCnomad 3.3: sets that cue's Scene; '' clears it.
  setCueScene(list: number, cue: string, scene: string): void {
    this.send(`/eos/set/cue/${list}/${cue}/scene`, [scene])
  }
}

export const eos = new EosClient()
