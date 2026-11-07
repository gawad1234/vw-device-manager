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
  assert.equal(channelScope('vlanManager:save'), 'local')
  assert.equal(channelScope('stickers:print'), 'host-only')
})

test('host addresses are normalised, defaulting to the Show Server port', () => {
  assert.equal(normalizeAddress(' 192.168.1.20:8787 '), 'http://192.168.1.20:8787')
  assert.equal(normalizeAddress('http://vw-mac.local:9000/'), 'http://vw-mac.local:9000')
  assert.equal(normalizeAddress('10.0.0.5'), 'http://10.0.0.5:8787')
  assert.equal(normalizeAddress('evil.com/../x'), null)
  assert.equal(normalizeAddress(''), null)
})

test('every list and get handler is readable remotely, and local tools stay local', async () => {
  const { readFileSync } = await import('node:fs')
  const ipc = readFileSync(new URL('../src/main/ipc.ts', import.meta.url), 'utf-8')
  const channels = [...ipc.matchAll(/handle\(\s*'([\w]+:[\w]+)'/g)].map((m) => m[1])
  assert.ok(channels.length > 100)
  const local = /^(updates|server|project|lightingSync|vlanManager|library):/
  for (const c of channels) {
    if (/:(list|get)$/.test(c) && !local.test(c)) assert.equal(channelScope(c), 'read', c)
  }
  assert.equal(channelScope('library:chooseFolder'), 'local')
  assert.equal(channelScope('wallpapers:save'), 'host-only')
})
