import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { readSettings, writeSettings } from '../src/main/settings.ts'

const dir = app.getPath('userData')
const path = join(dir, 'settings.json')

test('missing settings read as empty; saves round-trip', () => {
  rmSync(path, { force: true })
  assert.deepEqual(readSettings(), {})
  writeSettings({ lastProject: '/a.vwdm' })
  assert.deepEqual(readSettings(), { lastProject: '/a.vwdm' })
})

test('an unreadable settings file is set aside, never saved over', () => {
  writeFileSync(path, '{"lastProject": "/a.vw')
  assert.deepEqual(readSettings(), {})
  assert.equal(existsSync(path), false)
  const aside = readdirSync(dir).find((f) => f.startsWith('settings.json.unreadable-'))
  assert.ok(aside)
  assert.equal(readFileSync(join(dir, aside), 'utf-8'), '{"lastProject": "/a.vw')
  rmSync(join(dir, aside))
})
