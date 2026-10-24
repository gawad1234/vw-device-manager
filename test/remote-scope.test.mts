import { test } from 'node:test'
import assert from 'node:assert/strict'
import { channelScope, normalizeAddress, remoteReadable } from '../src/shared/remote-scope.ts'

test('a joined computer may only read show data from the host', () => {
  for (const c of ['devices:list', 'crew:directory', 'stickers:sheets', 'showName:get', 'circuits:list'])
    assert.equal(remoteReadable(c), true, c)
  for (const c of ['devices:remove', 'devices:update', 'project:open', 'server:setPins', 'updates:install', 'export:run'])
    assert.equal(remoteReadable(c), false, c)
})

test('unknown channels are writes, so a new handler is refused while joined', () => {
  assert.equal(channelScope('somethingNew:save'), 'write')
  assert.equal(channelScope('project:join'), 'local')
  assert.equal(channelScope('stickers:print'), 'host-only')
})

test('host addresses are normalised, defaulting to the Show Server port', () => {
  assert.equal(normalizeAddress(' 192.168.1.20:8787 '), 'http://192.168.1.20:8787')
  assert.equal(normalizeAddress('http://vw-mac.local:9000/'), 'http://vw-mac.local:9000')
  assert.equal(normalizeAddress('10.0.0.5'), 'http://10.0.0.5:8787')
  assert.equal(normalizeAddress('evil.com/../x'), null)
  assert.equal(normalizeAddress(''), null)
})
