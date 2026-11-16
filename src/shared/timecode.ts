// SMPTE timecode helpers (non-drop-frame only). Pure — shared by main and renderer.

export type Fps = 24 | 25 | 30

const pad = (n: number): string => String(n).padStart(2, '0')

export function framesToTc(frames: number, fps: Fps): string {
  const f = Math.max(0, Math.round(frames))
  const s = Math.floor(f / fps)
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % fps)}`
}

export function tcToFrames(tc: string, fps: Fps): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/.exec(tc.trim())
  if (!m) return null
  const [h, min, s, f] = m.slice(1).map(Number)
  if (h > 23 || min > 59 || s > 59 || f >= fps) return null
  return ((h * 60 + min) * 60 + s) * fps + f
}

/** Timecode of a moment `t` seconds into a song that starts at `offsetFrames`. */
export function songTc(offsetFrames: number, t: number, fps: Fps): string {
  return framesToTc(offsetFrames + Math.round(t * fps), fps)
}

/** Song 0 starts at 01:00:00:00, song 1 at 02:00:00:00, …; song 23 at 00:00:00:00, then it wraps. */
export function defaultOffset(order: number, fps: Fps): number {
  return ((order + 1) % 24) * 3600 * fps
}

/** The frames a song covers, [start, end); one hour while its length isn't known yet. */
export function songSpan(offsetFrames: number, durationSec: number, fps: Fps): [number, number] {
  return [
    offsetFrames,
    offsetFrames + (durationSec > 0 ? Math.ceil(durationSec * fps) : 3600 * fps)
  ]
}

/** A cue number that fits between two existing cues (either may be missing). */
export function nextCueNumber(prev: number | null, next: number | null): number {
  const r = (n: number): number => Math.round(n * 1000) / 1000 // Eos allows 3 decimals
  if (prev == null && next == null) return 1
  if (prev == null) return next! > 1 ? Math.ceil(next!) - 1 : r(next! / 2)
  if (next == null) return Math.floor(prev) + 1
  const whole = Math.floor(prev) + 1
  return whole < next ? whole : r((prev + next) / 2)
}
