import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupFor, parseSacn } from '../src/main/sacn.ts'

const CID = Buffer.from('00112233445566778899aabbccddeeff', 'hex')

function root(vector: number, size: number): Buffer {
  const b = Buffer.alloc(size)
  b.writeUInt16BE(0x0010, 0)
  b.write('ASC-E1.17', 4, 'latin1')
  b.writeUInt32BE(vector, 18)
  CID.copy(b, 22)
  b.write('Eos Ti', 44, 'utf8')
  return b
}

function dataPacket(universe: number, levels: number[], opts = 0, startCode = 0): Buffer {
  const b = root(0x04, 126 + levels.length)
  b.writeUInt32BE(0x02, 40)
  b[108] = 100
  b[112] = opts
  b.writeUInt16BE(universe, 113)
  b[117] = 0x02
  b.writeUInt16BE(levels.length + 1, 123)
  b[125] = startCode
  Buffer.from(levels).copy(b, 126)
  return b
}

test('data packet: source, priority, universe, levels', () => {
  const p = parseSacn(dataPacket(12, [255, 0, 128]))
  assert.ok(p && p.kind === 'data')
  assert.equal(p.cid, '00112233445566778899aabbccddeeff')
  assert.equal(p.sourceName, 'Eos Ti')
  assert.equal(p.priority, 100)
  assert.equal(p.universe, 12)
  assert.equal(p.startCode, 0)
  assert.deepEqual([...p.values], [255, 0, 128])
  assert.equal(p.terminated, false)
})

test('stream-terminated and preview flags', () => {
  const t = parseSacn(dataPacket(1, [1], 0x40))
  const v = parseSacn(dataPacket(1, [1], 0x80))
  assert.ok(t?.kind === 'data' && t.terminated && !t.preview)
  assert.ok(v?.kind === 'data' && v.preview && !v.terminated)
})

test('universe discovery lists universes', () => {
  const list = [1, 2, 300]
  const b = root(0x08, 120 + list.length * 2)
  b.writeUInt32BE(0x02, 40)
  b.writeUInt16BE(0x7000 | (8 + list.length * 2), 112)
  b.writeUInt32BE(0x01, 114)
  list.forEach((u, i) => b.writeUInt16BE(u, 120 + i * 2))
  const p = parseSacn(b)
  assert.ok(p?.kind === 'discovery')
  assert.deepEqual(p.universes, list)
})

test('junk, truncated and Art-Net packets are ignored', () => {
  assert.equal(parseSacn(Buffer.from('hello')), null)
  assert.equal(parseSacn(dataPacket(1, [1]).subarray(0, 100)), null)
  assert.equal(parseSacn(Buffer.from('Art-Net\0' + 'x'.repeat(40))), null)
})

test('multicast group per universe', () => {
  assert.equal(groupFor(1), '239.255.0.1')
  assert.equal(groupFor(300), '239.255.1.44')
})

test('adapter filter: same network only', async () => {
  const { onAdapter, adapters } = await import('../src/main/sacn.ts')
  const en0 = { name: 'en0', address: '10.101.1.5', netmask: '255.255.0.0' }
  assert.equal(onAdapter('10.101.200.9', en0), true)
  assert.equal(onAdapter('192.168.1.20', en0), false)
  assert.deepEqual(
    adapters({
      lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
      en0: [
        { address: '10.101.1.5', netmask: '255.255.0.0', family: 'IPv4', internal: false },
        { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false }
      ]
    } as never),
    [en0]
  )
})
