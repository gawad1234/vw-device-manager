import { useEffect, useRef, useState } from 'react'
import type { EosCue, EosStatus, Song, SongMarker, TimecodeSettings } from '../../../shared/types'
import {
  framesToTc,
  nextCueNumber,
  songSpan,
  songTc,
  tcToFrames,
  type Fps
} from '../../../shared/timecode'
import {
  crossedMarkers,
  cueKey,
  cueStatus,
  importConsoleCues,
  scenePlan,
  syncFromConsole
} from '../../../shared/song-cues'
import '../assets/timecode.css'

const AUDIO_EXT = /\.(wav|mp3|aiff?|m4a|flac)$/i
const pad = (n: number): string => String(n).padStart(2, '0')
const mmss = (t: number): string => `${Math.floor(t / 60)}:${pad(Math.floor(t % 60))}`
const mmssd = (t: number): string => `${mmss(t)}.${Math.floor((t * 10) % 10)}`
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** One flag drag, for Cmd+Z / Cmd+Shift+Z. `onDesk`: its timecode was also sent to the console. */
type FlagMove = { songId: number; cue: string; from: number; to: number; onDesk: boolean }

const STATUS_BADGE: Record<string, string> = {
  'On console': 'badge badge-ok',
  'Created · empty': 'badge badge-warn',
  'New here': 'badge badge-warn',
  'Not on console': 'badge badge-open'
}

/** Lighting › Timecode: songs with cue flags, played here, firing cues on an Eos console. */
function TimecodePage({
  onPlayingChange
}: {
  /** told whenever playback starts or stops (App keeps the page mounted while playing) */
  onPlayingChange?: (playing: boolean) => void
}): React.JSX.Element {
  const [songs, setSongs] = useState<Song[]>([])
  const [selId, setSelId] = useState<number | null>(null)
  const [settings, setSettings] = useState<TimecodeSettings>({ host: '', fps: 30 })
  const [hostInput, setHostInput] = useState('')
  const [status, setStatus] = useState<EosStatus>({ state: 'offline', host: '' })
  // the console's cues for one song + list (`key`), so a switch never shows another song's
  const [cueState, setCueState] = useState<{ key: string; cues: EosCue[] } | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [armed, setArmed] = useState(false)
  const [drag, setDrag] = useState<{ i: number; t: number } | null>(null)
  const [startInput, setStartInput] = useState<string | null>(null)
  const [newCue, setNewCue] = useState<string | null>(null)
  const [newTc, setNewTc] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [sync, setSync] = useState<{ key: string; msg: string; unplaced: EosCue[] } | null>(null)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)

  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevT = useRef(0)
  // the latest songs, so a save after an await starts from the current song, not a stale copy
  const songsRef = useRef(songs)
  const latest = (id: number): Song | undefined => songsRef.current.find((s) => s.id === id)
  const undoRef = useRef<FlagMove[]>([])
  const redoRef = useRef<FlagMove[]>([])
  const sentScene = useRef('')
  const fireRef = useRef<{ markers: SongMarker[]; list: number; live: boolean }>({
    markers: [],
    list: 1,
    live: false
  })

  const curId = selId ?? songs[0]?.id ?? null
  const song = songs.find((s) => s.id === curId) ?? null
  const fps = settings.fps
  const connected = status.state === 'connected'
  const dur = song?.durationSec || buffer?.duration || 0
  const markers = song?.markers ?? []
  const hasSong = song != null
  const cueKeyNow = song ? `${song.id}:${song.cueList}` : ''
  const consoleCues = connected && cueState?.key === cueKeyNow ? cueState.cues : null
  useEffect(() => {
    songsRef.current = songs
    fireRef.current = { markers, list: song?.cueList ?? 1, live: armed && connected }
  })

  useEffect(() => {
    onPlayingChange?.(playing)
    return () => {
      if (playing) onPlayingChange?.(false) // also on unmount, which stops the audio
    }
  }, [playing, onPlayingChange])

  function saveSong(next: Song): void {
    songsRef.current = songsRef.current.map((s) => (s.id === next.id ? next : s))
    setSongs((all) => all.map((s) => (s.id === next.id ? next : s)))
    window.api.songs.update(next).catch((e) => setError(errText(e)))
  }

  function pick(id: number): void {
    if (id === curId) return
    setSelId(id)
    setBuffer(null)
    setPlaying(false)
    setT(0)
  }

  function seek(to: number): void {
    const v = Math.max(0, Math.min(dur, to))
    if (audioRef.current) audioRef.current.currentTime = v
    prevT.current = v // a jump never fires cues
    setT(v)
  }

  function togglePlay(): void {
    const a = audioRef.current
    if (!a || !audioUrl) return
    if (a.paused) {
      prevT.current = a.currentTime || -0.001 // from 0: just below it, so a flag at 0 fires
      a.play().catch((e) => setError(errText(e)))
      setPlaying(true)
    } else {
      a.pause()
      setPlaying(false)
    }
  }

  const loadSongs = (): void => {
    window.api.songs
      .list()
      .then(setSongs)
      .catch((e) => setError(errText(e)))
  }
  useEffect(() => {
    loadSongs()
    window.api.timecode.getSettings().then((s) => {
      setSettings(s)
      setHostInput(s.host)
    })
    window.api.eos.status().then(setStatus)
    const offData = window.api.onDataChanged(loadSongs)
    const offStatus = window.api.eos.onStatus(setStatus)
    return () => {
      offData()
      offStatus()
    }
  }, [])

  // The selected song's audio: an <audio> to play it and a decoded buffer for the waveform.
  const songFile = song ? `${song.id}/${song.file}` : null
  useEffect(() => {
    if (!song) return
    let url = ''
    let gone = false
    prevT.current = 0
    window.api.songs
      .audio(song.id)
      .then(async (bytes) => {
        if (gone) return
        url = URL.createObjectURL(new Blob([bytes])) // Blob copies, decodeAudioData detaches
        setAudioUrl(url)
        const ctx = new AudioContext()
        const buf = await ctx.decodeAudioData(bytes)
        void ctx.close()
        if (gone) return
        setBuffer(buf)
        const cur = latest(song.id)
        if (cur && Math.abs(buf.duration - cur.durationSec) > 0.01)
          saveSong({ ...cur, durationSec: buf.duration })
      })
      .catch((e) => setError(`Couldn’t load the audio for “${song.title}”: ${errText(e)}`))
    return () => {
      gone = true
      setAudioUrl(null)
      if (url) URL.revokeObjectURL(url)
    }
  }, [songFile])

  // Console cues for this song's list: status column + importing timecoded cues as flags.
  const refreshCues = (): void => {
    if (!connected || !song) return
    const key = `${song.id}:${song.cueList}`
    window.api.eos
      .cues(song.cueList)
      .then((cues) => {
        setCueState({ key, cues })
        const cur = latest(song.id)
        if (!cur) return
        const span = songSpan(cur.offsetFrames, cur.durationSec, fps)
        const merged = importConsoleCues(cur.markers, cues, span, fps)
        if (merged) saveSong({ ...cur, markers: merged })
      })
      .catch((e) => setError(errText(e)))
  }
  useEffect(refreshCues, [connected, song?.id, song?.cueList])
  useEffect(
    () =>
      window.api.eos.onCues((list) => {
        if (list === song?.cueList) refreshCues()
      }),
    [connected, song?.id, song?.cueList, fps]
  )

  // Playhead loop: fire every flag the song passed since the last read. A timer, not
  // requestAnimationFrame, which stops while the window is hidden or covered.
  useEffect(() => {
    let shown = 0
    const tick = (): void => {
      const a = audioRef.current
      if (a && !a.paused) {
        const now = a.currentTime
        const f = fireRef.current
        if (f.live)
          for (const m of crossedMarkers(f.markers, prevT.current, now))
            window.api.eos.fire(f.list, m.cue).catch((e) => setError(errText(e)))
        prevT.current = now
        // redraw ~30×/s, not on every 10 ms tick
        if (Math.abs(now - shown) >= 0.03) setT((shown = now))
      }
    }
    const id = setInterval(tick, 10)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const el = waveRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasSong])

  // Min/max of the first channel per pixel column.
  const peaks = useRef<Float32Array | null>(null)
  useEffect(() => {
    peaks.current = null
    if (!buffer || !width) return
    const data = buffer.getChannelData(0)
    // capped: a canvas can't be wider than 32767 px; past that the columns just stretch
    const cols = Math.min(32000, Math.floor(width * devicePixelRatio))
    const p = new Float32Array(cols * 2)
    const per = data.length / cols
    for (let c = 0; c < cols; c++) {
      let lo = 0
      let hi = 0
      const end = Math.min(data.length, Math.floor((c + 1) * per))
      for (let i = Math.floor(c * per); i < end; i++) {
        const v = data[i]
        if (v < lo) lo = v
        else if (v > hi) hi = v
      }
      p[c * 2] = lo
      p[c * 2 + 1] = hi
    }
    peaks.current = p
  }, [buffer, width])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const p = peaks.current
    const cols = p ? p.length / 2 : 0
    const h = cv.clientHeight * devicePixelRatio
    cv.width = cols
    cv.height = h
    const g = cv.getContext('2d')
    if (!g || !p) return
    const css = getComputedStyle(cv)
    const played = css.getPropertyValue('--accent').trim()
    const rest = css.getPropertyValue('--wave').trim()
    const playedCols = dur ? (t / dur) * cols : 0
    for (let c = 0; c < cols; c++) {
      g.fillStyle = c <= playedCols ? played : rest
      const y0 = ((1 - p[c * 2 + 1]) / 2) * h
      const y1 = ((1 - p[c * 2]) / 2) * h
      g.fillRect(c, y0, 1, Math.max(1, y1 - y0))
    }
  }, [t, buffer, width, dur])

  // Zoom keeps the playhead in the middle of the view.
  useEffect(() => {
    const el = scrollRef.current
    if (el && dur) el.scrollLeft = (t / dur) * el.scrollWidth - el.clientWidth / 2
  }, [zoom])

  // Playing while zoomed: turn the page when the playhead runs off the right edge.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing || zoom === 1 || !dur) return
    const x = (t / dur) * el.scrollWidth
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = x - 24
  }, [t, playing, zoom, dur])

  async function addSongs(paths: string[]): Promise<void> {
    const audio = paths.filter((p) => AUDIO_EXT.test(p))
    if (!audio.length) return
    try {
      const added = await window.api.songs.add(audio)
      setSongs((all) => [...all, ...added])
      if (curId == null && added.length) setSelId(added[0].id)
    } catch (e) {
      // songs.add saves the files that worked before throwing for the rest
      await window.api.songs.list().then(setSongs, () => {})
      setError(errText(e))
    }
  }

  const timeAt = (clientX: number): number => {
    const r = waveRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur
  }

  async function changeFps(next: Fps): Promise<void> {
    const s = { ...settings, fps: next }
    setSettings(s)
    await window.api.timecode.setSettings(s)
    // offsets are stored in frames: keep each song on the same hour
    for (const so of songs)
      saveSong({ ...so, offsetFrames: Math.round((so.offsetFrames / settings.fps) * next) })
  }

  async function connect(): Promise<void> {
    setError('')
    const host = hostInput.trim()
    if (!host) return setError('Type the console’s IP address first.')
    const s = { ...settings, host }
    setSettings(s)
    try {
      await window.api.timecode.setSettings(s)
      await window.api.eos.connect(host)
    } catch (e) {
      setError(errText(e))
    }
  }

  function saveStart(): void {
    if (!song || startInput == null) return
    const f = tcToFrames(startInput, fps)
    if (f == null) return setError(`“${startInput}” isn’t a timecode. Use HH:MM:SS:FF.`)
    setError('')
    setStartInput(null)
    saveSong({ ...song, offsetFrames: f })
  }

  // The last flag at or before the playhead, and the one after it.
  const sorted = [...markers].sort((a, b) => a.t - b.t)
  let lastIdx = -1
  sorted.forEach((m, i) => {
    if (m.t <= t) lastIdx = i
  })
  const nextMarker = sorted[lastIdx + 1]
  const num = (m?: SongMarker): number | null => (m && Number.isFinite(+m.cue) ? +m.cue : null)
  const defaultCue = String(nextCueNumber(num(sorted[lastIdx]), num(nextMarker)))
  const tcNow = song ? songTc(song.offsetFrames, t, fps) : framesToTc(0, fps)
  const onConsole = consoleCues ? new Set(consoleCues.map((c) => cueKey(c.cue))) : null

  // Sync from console: pull the whole list now, add/relabel flags, list cues with no timecode.
  const syncShown = sync && sync.key === cueKeyNow ? sync : null
  async function syncNow(): Promise<void> {
    if (!song || !connected) return
    setSyncing(true)
    setError('')
    try {
      const cues = await window.api.eos.cues(song.cueList)
      setCueState({ key: cueKeyNow, cues })
      const cur = latest(song.id)
      if (!cur) return
      const elsewhere = new Set(
        songsRef.current
          .filter((s) => s.id !== cur.id && s.cueList === cur.cueList)
          .flatMap((s) => s.markers.map((m) => cueKey(m.cue)))
      )
      const span = songSpan(cur.offsetFrames, cur.durationSec, fps)
      const r = syncFromConsole(cur.markers, cues, span, fps, elsewhere)
      if (r.added || r.relabeled) saveSong({ ...cur, markers: r.markers })
      const parts = [`${cues.length} cue${cues.length === 1 ? '' : 's'} on list ${song.cueList}`]
      parts.push(r.added ? `${r.added} new flag${r.added === 1 ? '' : 's'} here` : 'no new flags')
      if (r.relabeled) parts.push(`${r.relabeled} label${r.relabeled === 1 ? '' : 's'} updated`)
      setSync({ key: cueKeyNow, msg: parts.join(' · '), unplaced: r.unplaced })
    } catch (err) {
      setError(`Couldn’t read cue list ${song.cueList}: ${errText(err)}`)
    } finally {
      setSyncing(false)
    }
  }

  function placeAtPlayhead(c: EosCue): void {
    if (!song || !sync) return
    saveSong({ ...song, markers: [...markers, { cue: c.cue, label: c.label, t }] })
    setSync({ ...sync, unplaced: sync.unplaced.filter((u) => u !== c) })
  }

  async function createCue(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!song) return
    const cue = (newCue ?? defaultCue).trim()
    const frames = tcToFrames(newTc ?? tcNow, fps)
    if (!(Number(cue) > 0)) return setError(`“${cue}” isn’t a cue number.`)
    if (frames == null) return setError('That isn’t a timecode. Use HH:MM:SS:FF.')
    const at = (frames - song.offsetFrames) / fps
    if (at < 0 || (dur && at > dur))
      return setError(
        `That timecode is outside this song (${framesToTc(song.offsetFrames, fps)} on).`
      )
    if (markers.some((m) => cueKey(m.cue) === cueKey(cue)))
      return setError(`Cue ${cue} already has a flag in this song.`)
    // never let "Create" overwrite a cue that already exists or belongs to another song
    if (onConsole?.has(cueKey(cue)))
      return setError(
        `Cue ${cue} is already on the console’s cue list ${song.cueList}. Pick another number.`
      )
    const other = songs.find(
      (s) =>
        s.id !== song.id &&
        s.cueList === song.cueList &&
        s.markers.some((m) => cueKey(m.cue) === cueKey(cue))
    )
    if (other)
      return setError(
        `Cue ${cue} already has a flag in “${other.title}” on list ${song.cueList}. Pick another number.`
      )
    setError('')
    setNewCue(null)
    setNewTc(null)
    const label = newLabel.trim()
    setNewLabel('')
    saveSong({ ...song, markers: [...markers, { cue, label, t: at, created: true }] })
    if (!connected) return
    const tc = songTc(song.offsetFrames, at, fps)
    try {
      await window.api.eos.createCue(song.cueList, cue)
      await window.api.eos.setTimecode(song.cueList, cue, tc)
      // Sync from console copies console labels onto flags, so the name must reach the console too.
      if (label) await window.api.eos.setLabel(song.cueList, cue, label)
      // Read the list back: the console sends no errors, so this is the only proof the timecode stuck.
      const back = (await window.api.eos.cues(song.cueList)).find((c) => cueKey(c.cue) === cueKey(cue))
      refreshCues()
      if (!back) setError(`The flag is placed, but cue ${cue} isn’t on the console’s list ${song.cueList}.`)
      else if (!back.timecode)
        setError(`Cue ${cue} is on the console, but its timecode (${tc}) didn’t take. Drag its flag to resend it.`)
    } catch (err) {
      setError(`The flag is placed, but the console didn’t make cue ${cue}: ${errText(err)}`)
    }
  }

  // Scene: the song's first cue on the console carries the song's title (see scenePlan).
  useEffect(() => {
    if (!song || !consoleCues) return
    const plan = scenePlan(markers, consoleCues, song.title)
    const key = JSON.stringify([song.cueList, plan])
    if (!plan.length || key === sentScene.current) return // don't resend while the console catches up
    sentScene.current = key
    for (const p of plan)
      window.api.eos
        .setScene(song.cueList, p.cue, p.scene)
        .catch((e) => setError(`Couldn’t set the scene on cue ${p.cue}: ${errText(e)}`))
  }, [consoleCues, markers, song?.title, song?.cueList])

  /** Puts cue `cue`'s flag at `to` seconds, and its timecode event on the console when `onDesk`. */
  function moveFlag(s: Song, cue: string, to: number, onDesk: boolean): void {
    const k = cueKey(cue)
    saveSong({ ...s, markers: s.markers.map((x) => (cueKey(x.cue) === k ? { ...x, t: to } : x)) })
    if (onDesk && connected)
      window.api.eos
        .setTimecode(s.cueList, cue, songTc(s.offsetFrames, to, fps))
        .catch((e) => setError(`Moved the flag, but not cue ${cue} on the console: ${errText(e)}`))
  }

  function dropMarker(i: number, at: number): void {
    const m = sorted[i]
    if (!song || !m || Math.abs(at - m.t) < 1e-6) return // a click, not a move
    const onDesk = !!onConsole?.has(cueKey(m.cue))
    undoRef.current.push({ songId: song.id, cue: m.cue, from: m.t, to: at, onDesk })
    redoRef.current = []
    moveFlag(song, m.cue, at, onDesk)
  }

  function stepHistory(redo: boolean): void {
    const mv = (redo ? redoRef : undoRef).current.pop()
    if (!mv) return
    ;(redo ? undoRef : redoRef).current.push(mv)
    const s = latest(mv.songId)
    if (!s) return
    if (s.id !== curId) pick(s.id)
    moveFlag(s, mv.cue, redo ? mv.to : mv.from, mv.onDesk)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!waveRef.current?.offsetParent) return // page kept mounted but hidden (another tab)
      const target = e.target as HTMLElement
      const mod = e.metaKey || e.ctrlKey
      // Cmd+Z / Cmd+Shift+Z (Ctrl+Z / Ctrl+Y on Windows); text fields keep their own undo
      if (mod && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        if (target.closest('input, select, textarea')) return
        e.preventDefault()
        stepHistory(e.code === 'KeyY' || e.shiftKey)
      } else if (e.code === 'Space' && !mod) {
        if (target.closest('input, select, textarea, button')) return
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function removeMarker(m: SongMarker): void {
    if (song) saveSong({ ...song, markers: song.markers.filter((x) => x !== m) })
  }

  async function deleteSong(): Promise<void> {
    if (!song) return
    if (
      !confirm(
        `Delete “${song.title}” and its ${song.markers.length} flags? Its audio file is removed too.`
      )
    )
      return
    try {
      await window.api.songs.remove(song.id)
      audioRef.current?.pause()
      setPlaying(false)
      setSongs((all) => all.filter((s) => s.id !== song.id))
      setSelId(null)
      setBuffer(null)
      setT(0)
    } catch (e) {
      setError(errText(e))
    }
  }

  // two songs on one cue list whose timecode spans overlap would import/fire each other's cues
  const span = song ? songSpan(song.offsetFrames, dur, fps) : null
  const overlap =
    song &&
    span &&
    songs.find((s) => {
      if (s.id === song.id || s.cueList !== song.cueList) return false
      const [a, b] = songSpan(s.offsetFrames, s.durationSec, fps)
      return a < span[1] && span[0] < b
    })

  const ticks: number[] = []
  const shown = dur / zoom // seconds visible at once
  const step = shown > 600 ? 60 : shown > 120 ? 30 : shown > 40 ? 10 : shown > 15 ? 5 : 1
  for (let s = 0; s <= dur; s += step) ticks.push(s)
  const pct = (s: number): string => (dur ? `${(s / dur) * 100}%` : '0%')

  const pill =
    status.state === 'connected'
      ? { cls: 'pill ok', text: 'Console connected' }
      : status.state === 'connecting'
        ? { cls: 'pill warn', text: 'Connecting…' }
        : status.state === 'error'
          ? { cls: 'pill warn', text: 'Can’t reach the console' }
          : { cls: 'pill', text: 'Not connected' }

  return (
    <div
      className="page"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void addSongs([...e.dataTransfer.files].map((f) => window.api.songs.pathFor(f)))
      }}
    >
      <div className="page-header tc-header">
        <h2>Timecode</h2>
        <div className="page-header-actions">
          <div className="patch-stats tc-conn">
            <span className={pill.cls} title={status.error}>
              {pill.text}
            </span>
          </div>
          {connected && status.version && (
            <span className="mono muted tc-small">Eos {status.version}</span>
          )}
          <input
            className="mono tc-host"
            value={hostInput}
            placeholder="Console IP"
            aria-label="Console IP address"
            onChange={(e) => setHostInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void connect()}
          />
          {status.state === 'offline' ? (
            <button className="btn" type="button" onClick={() => void connect()}>
              Connect
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => void window.api.eos.disconnect()}>
              Disconnect
            </button>
          )}
          <select
            aria-label="Frame rate"
            value={fps}
            onChange={(e) => void changeFps(Number(e.target.value) as Fps)}
          >
            {[24, 25, 30].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            type="button"
            onClick={async () => void addSongs(await window.api.songs.pick())}
          >
            + Add songs…
          </button>
        </div>
      </div>
      <p className="muted tc-intro">
        Drop in each song, place a flag where each cue goes, and play it here. While Armed, the app
        fires each cue on the console as the song passes its flag.
      </p>

      {error && <div className="banner banner-error tc-banner">{error}</div>}
      {armed && song && (
        <div className="banner banner-warning tc-banner" role="status">
          Armed: cues fire on the console as the song plays. Turn off the console’s own timecode
          input for cue list {song.cueList} so no cue fires twice.
        </div>
      )}

      <div className="tc-layout">
        <section className="panel tc-songs" aria-label="Songs">
          <div className="tc-songs-head">
            <h3>Songs</h3>
            <span className="mono muted tc-small">{fps} fps</span>
          </div>
          {songs.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`tc-song${s.id === curId ? ' is-on' : ''}`}
              onClick={() => pick(s.id)}
            >
              <span className="tc-song-row">
                <span>
                  {i + 1}. {s.title}
                </span>
                <span className="mono muted tc-small">{mmss(s.durationSec)}</span>
              </span>
              <span className="tc-song-row muted tc-small">
                <span className="mono">{framesToTc(s.offsetFrames, fps)}</span>
                <span>{s.markers.length} cues</span>
              </span>
            </button>
          ))}
          <div className={`tc-drop${dragOver ? ' is-over' : ''}`}>
            <div className="tc-drop-title">Drop audio files here</div>
            <div>WAV, MP3, AIFF · each new song gets the next hour</div>
          </div>
        </section>

        {!song ? (
          <section className="tc-main">
            <div className="panel">
              <p className="muted">Add a song to start placing cues.</p>
            </div>
          </section>
        ) : (
          <section className="tc-main" aria-label="Song timeline">
            <div className="panel tc-panel">
              <div className="tc-song-fields">
                <div className="tc-title">
                  <div className="muted tc-small">Song {songs.indexOf(song) + 1}</div>
                  <div className="tc-song-title">{song.title}</div>
                </div>
                <label className="tc-field">
                  Starts at
                  <input
                    className="mono tc-tc"
                    aria-label="Timecode offset"
                    value={startInput ?? framesToTc(song.offsetFrames, fps)}
                    onChange={(e) => setStartInput(e.target.value)}
                    onBlur={saveStart}
                    onKeyDown={(e) => e.key === 'Enter' && saveStart()}
                  />
                </label>
                <label className="tc-field">
                  Cue list
                  <input
                    className="mono tc-num"
                    type="number"
                    min={1}
                    aria-label="Cue list"
                    value={song.cueList}
                    onChange={(e) =>
                      Number(e.target.value) >= 1 &&
                      saveSong({ ...song, cueList: Math.floor(Number(e.target.value)) })
                    }
                  />
                </label>
                <button
                  className="btn btn-small btn-danger"
                  type="button"
                  onClick={() => void deleteSong()}
                >
                  Delete song…
                </button>
              </div>
              {overlap && (
                <div className="banner banner-warning tc-banner" role="status">
                  Overlaps “{overlap.title}” on cue list {song.cueList} — change the start time.
                </div>
              )}
              <p className="muted tc-small tc-note">
                Flags keep their place in the song when you change the start time; only the
                timecodes shift.
              </p>
            </div>

            <div className="panel tc-panel">
              <div ref={scrollRef} className="tc-scroll">
                <div className="tc-ruler" style={{ width: `${zoom * 100}%` }}>
                  {ticks.map((s) => (
                    <span key={s} className="mono muted" style={{ left: pct(s) }}>
                      {mmss(s)}
                    </span>
                  ))}
                </div>
                <div
                  ref={waveRef}
                  className="tc-wave"
                  style={{ width: `${zoom * 100}%` }}
                  role="slider"
                  tabIndex={0}
                  aria-label="Song position"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(dur)}
                  aria-valuenow={Math.round(t)}
                  aria-valuetext={mmss(t)}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    seek(timeAt(e.clientX))
                  }}
                  onPointerMove={(e) => e.buttons === 1 && seek(timeAt(e.clientX))}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') seek(t - 1)
                    else if (e.key === 'ArrowRight') seek(t + 1)
                    else if (e.key === 'Home') seek(0)
                  }}
                >
                  <canvas ref={canvasRef} className="tc-canvas" aria-hidden="true" />
                  {sorted.map((m, i) => {
                    const st = cueStatus(m, onConsole)
                    const cls =
                      (st === 'Not on console'
                        ? ' is-orphan'
                        : i === lastIdx
                          ? ' is-current'
                          : '') + (drag?.i === i ? ' is-dragging' : '')
                    return (
                      <div
                        key={`${m.cue}-${i}`}
                        className={`tc-flag${cls}`}
                        style={{ left: pct(drag?.i === i ? drag.t : m.t) }}
                      >
                        <span
                          className="mono"
                          title={`Cue ${m.cue}${m.label ? ` · ${m.label}` : ''} — drag to move`}
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            e.currentTarget.setPointerCapture(e.pointerId)
                            setDrag({ i, t: m.t })
                          }}
                          onPointerMove={(e) => {
                            e.stopPropagation()
                            if (drag?.i === i) setDrag({ i, t: timeAt(e.clientX) })
                          }}
                          onPointerUp={(e) => {
                            e.stopPropagation()
                            if (drag?.i === i) dropMarker(i, drag.t)
                            setDrag(null)
                          }}
                        >
                          {m.cue}
                        </span>
                        {drag?.i === i && (
                          <div className="mono tc-flag-tc" aria-live="polite">
                            {songTc(song.offsetFrames, drag.t, fps)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <div className="tc-playhead" style={{ left: pct(t) }} aria-hidden="true" />
                </div>
              </div>

              <div className="tc-transport">
                <div className="tc-buttons">
                  <button
                    className="btn"
                    type="button"
                    aria-label="Back to start"
                    onClick={() => seek(0)}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      aria-hidden="true"
                      fill="currentColor"
                    >
                      <rect x="2" y="2" width="2" height="10" />
                      <path d="M12 2 L5 7 L12 12 Z" />
                    </svg>
                  </button>
                  <button
                    className="btn btn-primary tc-play"
                    type="button"
                    onClick={togglePlay}
                    disabled={!audioUrl}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      fill="currentColor"
                    >
                      {playing ? (
                        <>
                          <rect x="1.5" y="1" width="3" height="10" />
                          <rect x="7.5" y="1" width="3" height="10" />
                        </>
                      ) : (
                        <path d="M2 1 L11 6 L2 11 Z" />
                      )}
                    </svg>
                    {playing ? 'Pause' : 'Play'}
                  </button>
                </div>
                <div className="tc-clock">
                  <span className="mono muted">{mmssd(t)}</span>
                  <span className="mono tc-big">{tcNow}</span>
                </div>
                <div className="tc-zoom" role="group" aria-label="Waveform zoom">
                  <button
                    className="btn btn-small"
                    type="button"
                    aria-label="Zoom out"
                    title="Zoom out"
                    disabled={zoom <= 1}
                    onClick={() => setZoom(zoom / 2)}
                  >
                    −
                  </button>
                  <span className="mono muted tc-small" aria-live="polite">
                    {zoom}×
                  </span>
                  <button
                    className="btn btn-small"
                    type="button"
                    aria-label="Zoom in"
                    title="Zoom in to pull flags that are close together apart"
                    disabled={zoom >= 16}
                    onClick={() => setZoom(zoom * 2)}
                  >
                    +
                  </button>
                </div>
                <div className="tc-spacer" />
                <span className="muted tc-small">
                  Next:{' '}
                  <span className="mono tc-next">
                    {nextMarker
                      ? `Cue ${nextMarker.cue}${nextMarker.label ? ` · ${nextMarker.label}` : ''}`
                      : 'none'}
                  </span>
                </span>
                <button
                  type="button"
                  className={`btn tc-arm${armed ? ' is-on' : ''}`}
                  aria-pressed={armed}
                  disabled={!connected && !armed}
                  title={connected ? undefined : 'Connect to the console to fire cues.'}
                  onClick={() => setArmed(!armed)}
                >
                  {armed ? 'Armed · firing cues' : 'Arm: fire cues'}
                </button>
              </div>
            </div>

            <div className="panel tc-panel tc-cues">
              <div className="tc-cues-head">
                <h3>Cues in this song</h3>
                <button
                  className="btn btn-small"
                  type="button"
                  disabled={!connected || syncing}
                  title={connected ? undefined : 'Connect to the console first.'}
                  onClick={() => void syncNow()}
                >
                  {syncing ? 'Syncing…' : 'Sync from console'}
                </button>
              </div>
              {syncShown && <p className="muted tc-small">{syncShown.msg}</p>}
              <form className="tc-new" onSubmit={(e) => void createCue(e)}>
                <label className="tc-field">
                  New cue
                  <input
                    className="mono tc-num"
                    aria-label="New cue number"
                    value={newCue ?? defaultCue}
                    onChange={(e) => setNewCue(e.target.value)}
                  />
                </label>
                <label className="tc-field">
                  At timecode
                  <input
                    className="mono tc-tc"
                    aria-label="Timecode for the new cue"
                    value={newTc ?? tcNow}
                    onChange={(e) => setNewTc(e.target.value)}
                  />
                </label>
                <label className="tc-field">
                  Name
                  <input
                    aria-label="Name for the new cue"
                    placeholder="optional"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </label>
                <button className="btn btn-primary btn-small" type="submit">
                  + Create cue
                </button>
                <span className="muted tc-small tc-new-help">
                  Makes an empty cue (no levels) on the console with this name and timecode, and puts its flag here. Defaults to
                  the playhead and the next free number.
                </span>
              </form>
              <table className="table">
                <thead>
                  <tr>
                    <th>Cue</th>
                    <th>Label</th>
                    <th>Song time</th>
                    <th>Timecode</th>
                    <th>Console</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No cues yet. Create one above.
                      </td>
                    </tr>
                  )}
                  {sorted.map((m, i) => {
                    const st = cueStatus(m, onConsole)
                    const at = drag?.i === i ? drag.t : m.t // live while its flag is dragged
                    return (
                      <tr key={`${m.cue}-${i}`} className={i === lastIdx ? 'selected' : undefined}>
                        <td className="mono tc-cue">{m.cue}</td>
                        <td>{m.label}</td>
                        <td className="mono">{mmssd(at)}</td>
                        <td className="mono">{songTc(song.offsetFrames, at, fps)}</td>
                        <td>{st && <span className={STATUS_BADGE[st]}>{st}</span>}</td>
                        <td className="tc-place">
                          <button
                            className="btn btn-small"
                            type="button"
                            aria-label={`Delete the flag for cue ${m.cue}`}
                            title="Delete this flag (the console cue stays)"
                            onClick={() => removeMarker(m)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {syncShown && syncShown.unplaced.length > 0 && (
                <>
                  <h3 className="tc-unplaced-head">
                    On the console, no timecode yet ({syncShown.unplaced.length})
                  </h3>
                  <p className="muted tc-small">
                    Move the playhead to where a cue goes, then place it.
                  </p>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Cue</th>
                        <th>Label</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncShown.unplaced.map((c) => (
                        <tr key={c.uid || c.cue}>
                          <td className="mono tc-cue">{c.cue}</td>
                          <td>{c.label}</td>
                          <td className="tc-place">
                            <button
                              className="btn btn-small"
                              type="button"
                              onClick={() => placeAtPlayhead(c)}
                            >
                              Place at {mmssd(t)}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </section>
        )}
      </div>
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} preload="auto" />
      )}
    </div>
  )
}

export default TimecodePage
