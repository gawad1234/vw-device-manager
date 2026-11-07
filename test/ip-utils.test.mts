import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ipInCidr, parseCidr } from '../src/main/ip-utils.ts'
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
