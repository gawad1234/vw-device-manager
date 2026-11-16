import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  crossedMarkers,
  importConsoleCues,
  cueStatus,
  scenePlan,
  syncFromConsole
} from '../src/shared/song-cues.ts'
import { songSpan } from '../src/shared/timecode.ts'
import type { SongMarker } from '../src/shared/types.ts'

const m = (cue: string, t: number, created = false): SongMarker => ({ cue, label: '', t, created })

test('only markers passed while playing forward fire', () => {
  const ms = [m('1', 0), m('2', 1.0), m('3', 1.1), m('4', 5)]
  assert.deepEqual(
    crossedMarkers(ms, 0.95, 1.05).map((x) => x.cue),
    ['2']
  )
  assert.deepEqual(
    crossedMarkers(ms, 1.0, 1.1).map((x) => x.cue),
    ['3']
  ) // prev < t <= now
  assert.deepEqual(crossedMarkers(ms, 0.9, 4.9), []) // a seek forward
  assert.deepEqual(crossedMarkers(ms, 1.2, 0.9), []) // a rewind
  assert.deepEqual(crossedMarkers(ms, 1, 1), [])
  // Play from 0 starts just below 0 so a flag at 0 fires
  assert.deepEqual(crossedMarkers(ms, 0, 0.01), [])
  assert.deepEqual(
    crossedMarkers(ms, -0.001, 0.01).map((x) => x.cue),
    ['1']
  )
})

test('console import window is the song span, not a fixed hour', () => {
  const fps = 30
  const span = songSpan(3600 * fps, 120, fps) // 01:00:00:00, a 2-minute song
  const cues = [
    { list: 1, cue: '1', label: '', timecode: '01:01:59:29', uid: 'a' },
    { list: 1, cue: '2', label: '', timecode: '01:02:00:00', uid: 'b' }
  ]
  assert.deepEqual(
    importConsoleCues([], cues, span, fps)!.map((x) => x.cue),
    ['1']
  )
})

test('console cues inside the song hour become flags, once', () => {
  const fps = 30
  const offset = 2 * 3600 * fps // 02:00:00:00
  const hour: [number, number] = songSpan(offset, 0, fps)
  const cues = [
    { list: 1, cue: '22', label: 'Chorus', timecode: '02:00:42:09', uid: 'a' },
    { list: 1, cue: '23.50', label: 'Already here', timecode: '02:01:00:00', uid: 'b' },
    { list: 1, cue: '30', label: 'Next song', timecode: '03:00:00:00', uid: 'c' },
    { list: 1, cue: '31', label: 'No TC', timecode: null, uid: 'd' }
  ]
  const out = importConsoleCues([m('23.5', 60)], cues, hour, fps)!
  assert.deepEqual(
    out.map((x) => [x.cue, x.t]),
    [
      ['22', 42.3],
      ['23.5', 60]
    ]
  )
  assert.equal(importConsoleCues(out, cues, hour, fps), null)
})

test('console status per flag', () => {
  const on = new Set(['1', '2'])
  assert.equal(cueStatus(m('1', 0), on), 'On console')
  assert.equal(cueStatus(m('2.0', 0, true), on), 'Created · empty')
  assert.equal(cueStatus(m('3', 0, true), on), 'New here')
  assert.equal(cueStatus(m('4', 0), on), 'Not on console')
  assert.equal(cueStatus(m('1', 0), null), '')
})

test('sync from console: adds timed cues, takes console labels, lists untimed ones once', () => {
  const fps = 30
  const offset = 2 * 3600 * fps
  const cues = [
    { list: 1, cue: '22', label: 'Chorus', timecode: '02:00:42:09', uid: 'a' },
    { list: 1, cue: '23', label: 'Renamed', timecode: null, uid: 'b' },
    { list: 1, cue: '24', label: 'Untimed', timecode: null, uid: 'c' },
    { list: 1, cue: '40', label: 'Other song has it', timecode: null, uid: 'd' }
  ]
  const r = syncFromConsole(
    [{ ...m('23', 10), label: 'Old' }],
    cues,
    songSpan(offset, 0, fps),
    fps,
    new Set(['40'])
  )
  assert.equal(r.added, 1)
  assert.equal(r.relabeled, 1)
  assert.deepEqual(
    r.markers.map((x) => [x.cue, x.label]),
    [
      ['23', 'Renamed'],
      ['22', 'Chorus']
    ]
  )
  assert.deepEqual(
    r.unplaced.map((c) => c.cue),
    ['24']
  )
})

test('the first flagged console cue gets the song title as its scene, never over an existing one', () => {
  const c = (cue: string, scene = '') => ({
    list: 1,
    cue,
    label: '',
    timecode: null,
    uid: cue,
    scene
  })
  const ms = [m('5', 10), m('2', 3), m('9', 1)] // 9 is only here, not on the console
  assert.deepEqual(scenePlan(ms, [c('2'), c('5.0')], 'Song A '), [{ cue: '2', scene: 'Song A' }])
  // the operator's own scene on the first cue, or on a later one, is left alone
  assert.deepEqual(scenePlan(ms, [c('2', 'Full track'), c('5', 'Song A')], 'Song A'), [])
  assert.deepEqual(scenePlan(ms, [c('2', 'Song A')], 'Song A'), []) // already done
  assert.deepEqual(scenePlan(ms, [c('2')], '  '), [])
  assert.deepEqual(scenePlan([], [c('2')], 'Song A'), [])
})
