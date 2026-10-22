import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateInstallScript, kitFileNames } from '../src/main/software-kit.ts'

test('same-named installers get unique kit file names', () => {
  assert.deepEqual(kitFileNames(['C:\\a\\setup.exe', '/b/Setup.exe', '/c/tool.msi']), [
    'setup.exe',
    '2-Setup.exe',
    'tool.msi'
  ])
})

test('install script lists each installer with quoted, msi-aware entries', () => {
  const ps = generateInstallScript('Ops PC', [
    { name: "Bob's App", file: 'app.msi', args: '/qn /norestart' },
    { name: 'Tool', file: 'tool.exe', args: '' }
  ])
  assert.match(
    ps,
    /Name = 'Bob''s App'; File = 'app\.msi'; Msi = \$true; Args = '\/qn \/norestart'/
  )
  assert.match(ps, /Name = 'Tool'; File = 'tool\.exe'; Msi = \$false; Args = ''/)
  assert.match(ps, /\$computer = 'Ops PC'/)
  assert.match(ps, /-Verb RunAs/)
})
