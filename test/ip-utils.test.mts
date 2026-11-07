import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ipInCidr, mainRoute, parseCidr } from '../src/shared/ip-utils.ts'
import { maskFromCidr } from '../src/main/switch-config.ts'

test('a range must spell out its prefix', () => {
  assert.equal(parseCidr('10.0.0.0/'), null)
  assert.equal(ipInCidr('192.168.1.1', '10.0.0.0/'), null)
  assert.equal(parseCidr('10.0.0.0'), null)
  assert.equal(parseCidr('10.0.0.0/33'), null)
  assert.equal(parseCidr('256.0.0.0/8'), null)
})

test('range edges', () => {
  assert.equal(ipInCidr('10.0.10.0', '10.0.10.0/24'), true)
  assert.equal(ipInCidr('10.0.10.255', '10.0.10.0/24'), true)
  assert.equal(ipInCidr('10.0.11.0', '10.0.10.0/24'), false)
  assert.equal(ipInCidr('10.0.10.1', '10.0.10.1/32'), true)
  assert.equal(ipInCidr('10.0.10.2', '10.0.10.1/32'), false)
  assert.equal(ipInCidr('8.8.8.8', '0.0.0.0/0'), true)
})

test('masks', () => {
  assert.equal(maskFromCidr('10.0.0.0/8'), '255.0.0.0')
  assert.equal(maskFromCidr('10.0.0.1/32'), '255.255.255.255')
  assert.equal(maskFromCidr('0.0.0.0/0'), '0.0.0.0')
})

test('main route: starred port, then switch management IP, then first port with an IP', () => {
  const subnets = [
    { id: 1, cidr: '10.0.10.0/24', vlan: '10' },
    { id: 2, cidr: '10.0.20.0/24', vlan: '20' }
  ]
  const port = (o: object): never =>
    ({ isPrimary: false, isUnused: false, ipAddress: null, untaggedSubnetId: null, ...o }) as never
  const dev = (ports: never[], sw = {}): never =>
    ({ ports, isSwitch: false, managementIp: null, oobIp: null, ...sw }) as never

  // first in-use port with an IP; VLAN found by CIDR
  assert.deepEqual(
    mainRoute(
      dev([port({ isUnused: true, ipAddress: '10.0.20.5' }), port({ ipAddress: '10.0.10.5' })]),
      subnets
    ),
    { ip: '10.0.10.5', vlan: '10' }
  )
  // the starred port wins, and its assigned network beats the CIDR match
  assert.deepEqual(
    mainRoute(
      dev([
        port({ ipAddress: '10.0.10.5' }),
        port({ isPrimary: true, ipAddress: '10.0.10.6', untaggedSubnetId: 2 })
      ]),
      subnets
    ),
    { ip: '10.0.10.6', vlan: '20' }
  )
  // a switch uses its management IP
  assert.deepEqual(
    mainRoute(
      dev([port({ ipAddress: '10.0.10.5' })], { isSwitch: true, managementIp: '10.0.20.1' }),
      subnets
    ),
    { ip: '10.0.20.1', vlan: '20' }
  )
  assert.deepEqual(mainRoute(dev([]), subnets), { ip: '', vlan: '' })
})
