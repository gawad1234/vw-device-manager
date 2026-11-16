import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkHosts, checkHostsOnce, mapLimit, pingArgs } from '../src/main/reachability.ts'

test('one short ping per platform', () => {
  assert.deepEqual(pingArgs('10.0.0.1', 'darwin'), ['-c', '1', '-t', '1', '10.0.0.1'])
  assert.deepEqual(pingArgs('10.0.0.1', 'win32'), ['-n', '1', '-w', '1000', '10.0.0.1'])
  assert.deepEqual(pingArgs('10.0.0.1', 'linux'), ['-c', '1', '-W', '1', '10.0.0.1'])
})

test('only plain IPv4 addresses reach ping', async () => {
  const tried: string[] = []
  const r = await checkHosts(['10.0.0.1', '-c 99 x', '10.0.0.1; rm -rf', '999.1.1.1', ' 10.0.0.2 '], async (ip) => {
    tried.push(ip)
    return ip === '10.0.0.1'
  })
  assert.deepEqual(tried.sort(), ['10.0.0.1', '10.0.0.2'])
  assert.equal(r['10.0.0.1'], true)
  assert.equal(r['10.0.0.2'], false)
  assert.equal(r['-c 99 x'], false)
})

test('mapLimit keeps order and never runs more than the limit at once', async () => {
  let running = 0
  let peak = 0
  const out = await mapLimit([...Array(40).keys()], 16, async (n) => {
    peak = Math.max(peak, ++running)
    await new Promise((r) => setTimeout(r, 2))
    running--
    return n * 2
  })
  assert.equal(peak, 16)
  assert.deepEqual(out, [...Array(40).keys()].map((n) => n * 2))
})

test('zero-padded octets are pinged as decimal, keyed by the original string', async () => {
  const tried: string[] = []
  const r = await checkHosts(['192.168.001.050'], async (ip) => (tried.push(ip), true))
  assert.deepEqual(tried, ['192.168.1.50'])
  assert.deepEqual(r, { '192.168.001.050': true })
})

test('a running sweep for the same list is shared, not repeated', async () => {
  let calls = 0
  const run = async (): Promise<boolean> => {
    calls++
    await new Promise((r) => setTimeout(r, 5))
    return true
  }
  const a = checkHostsOnce(['10.0.0.1'], run)
  const b = checkHostsOnce(['10.0.0.1'], run)
  assert.equal(a, b)
  await a
  await checkHostsOnce(['10.0.0.1'], run) // finished sweeps aren't reused
  assert.equal(calls, 2)
})
