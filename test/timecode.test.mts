import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultOffset,
  framesToTc,
  nextCueNumber,
  songTc,
  tcToFrames
} from '../src/shared/timecode.ts'

test('frames and timecode round-trip', () => {
  for (const fps of [24, 25, 30] as const) {
    for (const f of [0, 1, fps - 1, fps, 3600 * fps - 1, 86399 * fps + fps - 1]) {
      assert.equal(tcToFrames(framesToTc(f, fps), fps), f)
    }
  }
  assert.equal(framesToTc(30 * 3661 + 7, 30), '01:01:01:07')
})

test('song timecode = offset + rounded frames', () => {
  assert.equal(songTc(defaultOffset(1, 30), 42.3, 30), '02:00:42:09')
  assert.equal(defaultOffset(0, 25), 3600 * 25)
  assert.equal(defaultOffset(22, 30), 23 * 3600 * 30)
  assert.equal(defaultOffset(23, 30), 0) // song 24 wraps to hour 00
  assert.equal(defaultOffset(24, 30), 3600 * 30)
})

test('invalid timecode is null', () => {
  for (const bad of [
    '',
    '1:00:00',
    '01:60:00:00',
    '01:00:60:00',
    '01:00:00:30',
    '24:00:00:00',
    'aa:bb:cc:dd'
  ]) {
    assert.equal(tcToFrames(bad, 30), null, bad)
  }
  assert.equal(tcToFrames('01:00:00:24', 24), null)
  assert.equal(tcToFrames('01:00:00:24', 25), 3600 * 25 + 24)
})

test('next cue number fits between neighbours', () => {
  assert.equal(nextCueNumber(22, 23), 22.5)
  assert.equal(nextCueNumber(22, 25), 23)
  assert.equal(nextCueNumber(null, 5), 4)
  assert.equal(nextCueNumber(null, 1), 0.5)
  assert.equal(nextCueNumber(22, null), 23)
  assert.equal(nextCueNumber(22.5, null), 23)
  assert.equal(nextCueNumber(null, null), 1)
  assert.equal(nextCueNumber(22.5, 23), 22.75)
})
