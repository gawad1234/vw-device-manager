// Run with: npm test  (Node's built-in runner; Node strips the TS types)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectorCommands, projectorCommandsCsv } from '../src/shared/projector-settings.ts'

test('chosen settings become Panasonic commands', () => {
  const cmds = projectorCommands({
    model: 'PT-RZ21K',
    values: {
      lightOutput: '75',
      startupInput: 'VXX:SISS1=SD1',
      projectorId: '7',
      blendLeftWidth: '384',
      lensMemory1Name: 'WIDE, stage',
      projectorName: 'PJ-01' // manual: no command
    }
  })
  assert.deepEqual(cmds, [
    'RIS:07',
    'VXX:SISS1=SD1',
    'VXX:LOPI2=+00750',
    'VXX:ELWI0=+00384',
    'VXX:NCGS5=WIDE  stage'
  ])
})

test('bad values are skipped, not sent', () => {
  const cmds = projectorCommands({
    model: 'PT-RZ21K',
    values: { lightOutput: '150', projectorId: 'x', startupInput: 'POF', edgeBlend: '' }
  })
  assert.deepEqual(cmds, [])
})

test('CSV lines end with a comma', () => {
  assert.equal(projectorCommandsCsv({ model: '', values: { startupLogo: 'MLO:0' } }), 'MLO:0,\r\n')
})
