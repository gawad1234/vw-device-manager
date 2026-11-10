import { test } from 'node:test'
import assert from 'node:assert/strict'
import { broadcastAddresses, encodeBeacon, parseBeacon } from '../src/main/discovery.ts'

test('broadcast address per LAN interface; loopback and IPv6 skipped', () => {
  const ni = (address: string, netmask: string, family = 'IPv4', internal = false): never =>
    ({ address, netmask, family, internal }) as never
  assert.deepEqual(
    broadcastAddresses({
      lo0: [ni('127.0.0.1', '255.0.0.0', 'IPv4', true)],
      en0: [ni('192.168.1.20', '255.255.255.0'), ni('fe80::1', 'ffff::', 'IPv6')],
      en1: [ni('10.20.5.7', '255.255.252.0')],
      utun4: [ni('100.110.25.69', '255.255.255.255')]
    }),
    ['192.168.1.255', '10.20.7.255']
  )
})

test('beacon round-trips; junk and bad ports are ignored', () => {
  const msg = encodeBeacon({ showName: 'Tour', hostName: 'VW-Mac', port: 8787 })
  assert.deepEqual(parseBeacon(msg, '192.168.1.20'), {
    address: '192.168.1.20:8787',
    port: 8787,
    showName: 'Tour',
    hostName: 'VW-Mac'
  })
  assert.equal(parseBeacon(Buffer.from('hello'), '1.2.3.4'), null)
  assert.equal(parseBeacon(Buffer.from('{"magic":"other","port":1}'), '1.2.3.4'), null)
  assert.equal(parseBeacon(Buffer.from('{"magic":"vwdm-show/1","port":99999}'), '1.2.3.4'), null)
})
