import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import * as library from '../src/main/library.ts'
import { openDb } from '../src/main/db.ts'

const path = join(app.getPath('userData'), 'library.json')
const member = { name: 'A', phone: '', email: '' } as never

beforeEach(() => {
  for (const f of [path, path + '.bak']) rmSync(f, { force: true })
})

test('a damaged file with no backup stops saves instead of wiping the library', () => {
  writeFileSync(path, '{"crew":[{"id":1')
  assert.throws(() => library.listCrew(), /can't be read/)
  assert.throws(() => library.addNetworkSignal('Dante'), /can't be read/)
  assert.equal(readFileSync(path, 'utf-8'), '{"crew":[{"id":1')
})

test('a damaged file falls back to the copy from the last save', () => {
  library.createCrewMember(member)
  library.createCrewMember({ ...(member as object), name: 'B' } as never)
  assert.ok(existsSync(path + '.bak'))
  writeFileSync(path, '{"crew"')
  assert.deepEqual(library.listCrew().map((c) => c.name), ['A'])
})

test('saving keeps fields from a newer version', () => {
  writeFileSync(path, JSON.stringify({ crew: [], fromTheFuture: { keep: true } }))
  library.addNetworkSignal('Dante')
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf-8')).fromTheFuture, { keep: true })
})

test('a deleted id is never given to someone new', () => {
  library.createCrewMember(member)
  const second = library.createCrewMember({ ...(member as object), name: 'B' } as never)
  library.deleteCrewMember(second.id)
  const third = library.createCrewMember({ ...(member as object), name: 'C' } as never)
  assert.notEqual(third.id, second.id)
})

test('a library from before the counter still retires ids', () => {
  writeFileSync(path, JSON.stringify({ crew: [{ id: 7, name: 'Old' }] }))
  library.deleteCrewMember(7)
  assert.equal(library.createCrewMember(member).id, 8)
})

test('switch logins never land in the library file', async () => {
  writeFileSync(path, JSON.stringify({ switchConfig: { baseTemplate: 'x', adminUser: 'a', adminPassword: 'hunter2' } }))
  await library.ensureLibrary()
  assert.doesNotMatch(readFileSync(path, 'utf-8'), /hunter2/)
  assert.doesNotMatch(readFileSync(path + '.bak', 'utf-8'), /hunter2/)
  await openDb(join(app.getPath('userData'), 'mon.vwdm'))
  const cfg = library.getSwitchConfig()
  assert.equal(cfg.adminPassword, 'hunter2')
  library.setSwitchConfig({
    ...cfg,
    monitoring: { ...cfg.monitoring, snmpCommunity: 'showro', logServers: '10.0.0.5' }
  })
  assert.doesNotMatch(readFileSync(path, 'utf-8'), /hunter2|showro|10\.0\.0\.5/)
  const back = library.getSwitchConfig().monitoring
  assert.equal(back.snmpCommunity, 'showro')
  assert.equal(back.logServers, '10.0.0.5')
  assert.equal(back.syslogPort, 514)
})
