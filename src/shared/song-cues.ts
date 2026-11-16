// Timecode page logic that doesn't need the DOM: firing, console merge, status.
import { tcToFrames, type Fps } from './timecode'
import type { EosCue, SongMarker } from './types'

/** Longest step between two playhead reads that still counts as playing (not a seek). */
export const MAX_STEP_SEC = 0.25

/** Markers the playhead passed going forward from `prev` to `now`; a seek or rewind fires nothing. */
export function crossedMarkers(markers: SongMarker[], prev: number, now: number): SongMarker[] {
  if (!(now > prev) || now - prev >= MAX_STEP_SEC) return []
  return markers.filter((m) => m.t > prev && m.t <= now)
}

/** "22.50" and "22.5" are the same Eos cue. */
export const cueKey = (cue: string): string => {
  const n = Number(cue)
  return cue.trim() !== '' && Number.isFinite(n) ? String(n) : cue.trim()
}

/** Console cues with a timecode inside this song's span (see songSpan) that have no flag here
 *  yet, as new flags; null when there's nothing to add. */
export function importConsoleCues(
  markers: SongMarker[],
  consoleCues: EosCue[],
  [offsetFrames, endFrames]: [number, number],
  fps: Fps
): SongMarker[] | null {
  const have = new Set(markers.map((m) => cueKey(m.cue)))
  const added: SongMarker[] = []
  for (const c of consoleCues) {
    const frames = c.timecode ? tcToFrames(c.timecode, fps) : null
    if (frames == null || frames < offsetFrames || frames >= endFrames) continue
    if (have.has(cueKey(c.cue))) continue
    have.add(cueKey(c.cue))
    added.push({ cue: c.cue, label: c.label, t: (frames - offsetFrames) / fps })
  }
  return added.length ? [...markers, ...added].sort((a, b) => a.t - b.t) : null
}

export interface ConsoleSync {
  markers: SongMarker[]
  added: number
  relabeled: number
  /** cues on the list with no timecode that no song has a flag for yet */
  unplaced: EosCue[]
}

/** "Sync from console": flags for this song's timecoded cues, the console's labels on the flags
 *  here, and the list's untimed cues no song has placed (`flaggedInList`: every song on the list). */
export function syncFromConsole(
  markers: SongMarker[],
  consoleCues: EosCue[],
  span: [number, number],
  fps: Fps,
  flaggedInList: Set<string>
): ConsoleSync {
  const byKey = new Map(consoleCues.map((c) => [cueKey(c.cue), c]))
  let relabeled = 0
  const kept = markers.map((m) => {
    const c = byKey.get(cueKey(m.cue))
    if (!c || c.label === m.label) return m
    relabeled++
    return { ...m, label: c.label }
  })
  const merged = importConsoleCues(kept, consoleCues, span, fps) ?? kept
  const here = new Set(merged.map((m) => cueKey(m.cue)))
  const unplaced = consoleCues.filter(
    (c) => !c.timecode && !here.has(cueKey(c.cue)) && !flaggedInList.has(cueKey(c.cue))
  )
  return { markers: merged, added: merged.length - kept.length, relabeled, unplaced }
}

/** The Scene write that labels the song's first flagged console cue with the song's title — only
 *  when that cue has no scene yet: a scene the operator typed is never overwritten or cleared.
 *  Flags not on the console are skipped. */
export function scenePlan(
  markers: SongMarker[],
  consoleCues: EosCue[],
  title: string
): { cue: string; scene: string }[] {
  const name = title.trim() // Eos trims scene names
  if (!name) return []
  const byKey = new Map(consoleCues.map((c) => [cueKey(c.cue), c]))
  const first = markers
    .map((m) => ({ t: m.t, c: byKey.get(cueKey(m.cue)) }))
    .filter((x): x is { t: number; c: EosCue } => x.c != null)
    .sort((a, b) => a.t - b.t)[0]
  return first && !first.c.scene.trim() ? [{ cue: first.c.cue, scene: name }] : []
}

export type CueStatus = 'On console' | 'New here' | 'Not on console' | 'Created · empty' | ''

/** How a flag compares with the console; '' while not connected (`onConsole` null). */
export function cueStatus(m: SongMarker, onConsole: Set<string> | null): CueStatus {
  if (!onConsole) return ''
  const there = onConsole.has(cueKey(m.cue))
  if (m.created) return there ? 'Created · empty' : 'New here'
  return there ? 'On console' : 'Not on console'
}
