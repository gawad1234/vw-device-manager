import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_PIN_TRIES,
  PIN_LOCK_MS,
  notePinResult,
  pinFailures,
  pinLocked,
  pinLogin
} from '../src/main/pin-login.ts'

test('a wrong PIN that falls through to an open crew tier counts as a failure', () => {
  assert.deepEqual(pinLogin('1234', '9999', ''), { role: 'crew', result: 'fail' })
  assert.deepEqual(pinLogin('', '9999', ''), { role: 'crew', result: 'none' })
  assert.deepEqual(pinLogin('9999', '9999', ''), { role: 'manager', result: 'ok' })
  assert.deepEqual(pinLogin('1111', '9999', '1111'), { role: 'crew', result: 'ok' })
  assert.deepEqual(pinLogin('0000', '9999', '1111'), { role: null, result: 'fail' })
  assert.deepEqual(pinLogin('x', '', ''), { role: 'manager', result: 'none' })
})

test('lockout after MAX tries; open-crew logins never reset it; expires', () => {
  pinFailures.clear()
  const t = 1_000_000
  for (let i = 0; i < MAX_PIN_TRIES - 1; i++)
    notePinResult('a', pinLogin('1', '9999', '').result, t)
  notePinResult('a', pinLogin('', '9999', '').result, t) // blank crew login: no reset
  assert.equal(pinLocked('a', t), false)
  notePinResult('a', 'fail', t)
  assert.equal(pinLocked('a', t), true)
  assert.equal(pinLocked('b', t), false)
  assert.equal(pinLocked('a', t + PIN_LOCK_MS), false)
  notePinResult('a', 'ok', t)
  assert.equal(pinLocked('a', t), false)
})
