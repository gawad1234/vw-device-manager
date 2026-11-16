// Minimal OSC 1.0 (types i, f, s, T, F) plus the TCP length-prefix framing Eos uses on port 3032.

export type OscArg = number | string | boolean
export interface OscMessage {
  address: string
  args: OscArg[]
}

function oscString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8')
  return Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) // always ≥1 NUL, padded to 4
}

/** Integers go as `i`, other numbers as `f`. */
export function encodeOsc(address: string, args: OscArg[] = []): Buffer {
  let tags = ','
  const parts: Buffer[] = []
  for (const a of args) {
    if (typeof a === 'boolean') tags += a ? 'T' : 'F'
    else if (typeof a === 'string') {
      tags += 's'
      parts.push(oscString(a))
    } else {
      const b = Buffer.alloc(4)
      if (Number.isInteger(a)) {
        tags += 'i'
        b.writeInt32BE(a)
      } else {
        tags += 'f'
        b.writeFloatBE(a)
      }
      parts.push(b)
    }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...parts])
}

/** Throws on malformed packets or unsupported type tags. */
export function decodeOsc(buf: Buffer): OscMessage {
  let pos = 0
  const str = (): string => {
    const end = buf.indexOf(0, pos)
    if (end < 0) throw new Error('Bad OSC string')
    const s = buf.toString('utf8', pos, end)
    pos = (end + 4) & ~3
    return s
  }
  const address = str()
  if (!address.startsWith('/')) throw new Error('Not an OSC message')
  const tags = pos < buf.length ? str() : ','
  const args: OscArg[] = []
  for (const t of tags.slice(1)) {
    if (t === 'i' || t === 'f') {
      args.push(t === 'i' ? buf.readInt32BE(pos) : buf.readFloatBE(pos))
      pos += 4
    } else if (t === 's') args.push(str())
    else if (t === 'T' || t === 'F') args.push(t === 'T')
    else throw new Error(`Unsupported OSC type '${t}'`)
  }
  return { address, args }
}

export const frame = (packet: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(packet.length)
  return Buffer.concat([len, packet])
}

/** Splits a TCP byte stream into packets (4-byte big-endian length prefix). */
export class OscDeframer {
  private buf = Buffer.alloc(0)
  push(chunk: Buffer): Buffer[] {
    this.buf = Buffer.concat([this.buf, chunk])
    const out: Buffer[] = []
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0)
      if (this.buf.length < 4 + len) break
      out.push(this.buf.subarray(4, 4 + len))
      this.buf = this.buf.subarray(4 + len)
    }
    return out
  }
}
