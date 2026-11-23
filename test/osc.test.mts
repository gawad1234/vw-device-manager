import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { OscDeframer, decodeOsc, encodeOsc, frame } from '../src/main/osc.ts'
import { CUE_TC_CMD, EMPTY_CUE_CMD, EosClient, mergeSplit, parseCueReply } from '../src/main/eos.ts'
import type { OscArg } from '../src/main/osc.ts'

test('OSC encode → decode round-trip', () => {
  const args = [1, -7, 0.5, 'hello', '', 'abcd', true, false]
  const buf = encodeOsc('/eos/cue/1/2.5/fire', args)
  assert.equal(buf.length % 4, 0)
  assert.deepEqual(decodeOsc(buf), { address: '/eos/cue/1/2.5/fire', args })
  assert.deepEqual(decodeOsc(encodeOsc('/eos/ping')), { address: '/eos/ping', args: [] })
  assert.throws(() => decodeOsc(Buffer.from('junk')))
})

test('deframer handles byte-by-byte and merged chunks', () => {
  const a = frame(encodeOsc('/a', [1]))
  const b = frame(encodeOsc('/bb', ['x']))
  const d = new OscDeframer()
  const got: string[] = []
  for (const byte of Buffer.concat([a, b]))
    d.push(Buffer.from([byte])).forEach((p) => got.push(decodeOsc(p).address))
  assert.deepEqual(got, ['/a', '/bb'])
  assert.deepEqual(
    new OscDeframer().push(Buffer.concat([a, b])).map((p) => decodeOsc(p).address),
    ['/a', '/bb']
  )
})

// A full 29-arg cue reply (0 index, 1 UID, 2 label, …, 25 timecode).
const cueArgs = (i: number, label: string, tc: string): OscArg[] => {
  const a: OscArg[] = Array.from({ length: 29 }, () => 0)
  a[0] = i
  a[1] = `uid-${i}`
  a[2] = label
  a[25] = tc
  a[28] = `scene-${i}`
  return a
}

test('split cue reply is merged at listIndex + j', () => {
  const full = cueArgs(3, 'Verse', '01:00:12:05')
  const pending = new Map()
  const addr = '/eos/out/get/cue/1/4.5/0/list'
  assert.equal(mergeSplit(pending, { address: `${addr}/20/29`, args: full.slice(20) }), null)
  const msg = mergeSplit(pending, { address: `${addr}/0/29`, args: full.slice(0, 20) })
  assert.deepEqual(parseCueReply(msg!), {
    list: 1,
    cue: '4.5',
    uid: 'uid-3',
    label: 'Verse',
    timecode: '01:00:12:05',
    scene: 'scene-3'
  })
  assert.equal(pending.size, 0)
})

test('cue parsing: parts and sub-replies skipped, empty timecode is null', () => {
  assert.equal(
    parseCueReply({ address: '/eos/out/get/cue/1/4/1', args: cueArgs(0, 'p', '') }),
    null
  )
  assert.equal(parseCueReply({ address: '/eos/out/get/cue/1/4/0/fx', args: [] }), null)
  assert.equal(
    parseCueReply({ address: '/eos/out/get/cue/1/4/0', args: cueArgs(0, 'x', '') })!.timecode,
    null
  )
})

test('client reads cues from a fake console', async () => {
  const server = net.createServer((s) => {
    const d = new OscDeframer()
    const reply = (address: string, args: OscArg[]): boolean =>
      s.write(frame(encodeOsc(address, args)))
    s.on('data', (c) => {
      for (const p of d.push(c)) {
        const { address } = decodeOsc(p)
        if (address === '/eos/get/version') reply('/eos/out/get/version', ['3.2.0'])
        if (address === '/eos/get/cue/1/count') reply('/eos/out/get/cue/1/count', [2])
        const m = /^\/eos\/get\/cue\/1\/index\/(\d)$/.exec(address)
        if (m) {
          const i = Number(m[1])
          const a = cueArgs(i, `Cue ${i + 1}`, i ? '01:00:05:00' : '')
          reply(`/eos/out/get/cue/1/${i + 1}/0/fx/list/0/1`, [i]) // ignored
          reply(`/eos/out/get/cue/1/${i + 1}/0/list/0/29`, a.slice(0, 20))
          reply(`/eos/out/get/cue/1/${i + 1}/0/list/20/29`, a.slice(20))
        }
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const client = new EosClient()
  const connected = new Promise<void>((r) => client.on('status', (s) => s.version && r()))
  client.connect('127.0.0.1', (server.address() as net.AddressInfo).port)
  await connected
  assert.equal(client.status().version, '3.2.0')
  const cues = await client.getCues(1)
  assert.deepEqual(
    cues.map((c) => [c.cue, c.label, c.timecode]),
    [
      ['1', 'Cue 1', null],
      ['2', 'Cue 2', '01:00:05:00']
    ]
  )
  client.disconnect()
  assert.equal(client.status().state, 'offline')
  server.close()
})

test('connect gives up after 3 s when the console never answers', async () => {
  const client = new EosClient()
  const err = new Promise<string>((r) =>
    client.on('status', (s) => s.state === 'error' && r(s.error ?? ''))
  )
  client.connect('10.255.255.1') // non-routable: SYN goes nowhere
  const msg = await err
  client.disconnect()
  assert.equal(msg, 'No answer from the console at 10.255.255.1')
})

test('command-line cues have spaces around the list slash (Eos rejects "1/13")', () => {
  assert.equal(CUE_TC_CMD(2, '4.5', '01:02:03:04'), 'Cue 2 / 4.5 Execute Time_Code 01020304 #')
  assert.equal(EMPTY_CUE_CMD(1, '13'), 'Record_Only Cue 1 / 13 #')
})
