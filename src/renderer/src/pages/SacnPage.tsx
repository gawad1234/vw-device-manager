import { useEffect, useState } from 'react'
import type { Device, SacnAdapter, SacnSnapshot } from '../../../shared/types'
import { isAccessory } from '../../../shared/lighting-checks'

interface Props {
  devices: Device[]
}

const POLL_MS = 500
const ADAPTER_KEY = 'sacn.adapter'

function loadAdapter(): string {
  try {
    return localStorage.getItem(ADAPTER_KEY) ?? ''
  } catch {
    return ''
  }
}

/** "1-4, 10" → [1,2,3,4,10]; junk ignored, capped so a typo can't join thousands of groups. */
function parseUniverses(text: string): number[] {
  const out = new Set<number>()
  for (const part of text.split(/[,\s]+/)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/)
    if (!m) continue
    const a = +m[1]
    const b = m[2] ? +m[2] : a
    for (let u = Math.max(1, a); u <= Math.min(b, 63999) && out.size < 256; u++) out.add(u)
  }
  return [...out]
}

/** Program › sACN: which systems are sending which universes, and the levels. */
function SacnPage({ devices }: Props): React.JSX.Element {
  const [snap, setSnap] = useState<SacnSnapshot | null>(null)
  const [patched, setPatched] = useState<number[]>([])
  const [extra, setExtra] = useState('')
  const [percent, setPercent] = useState(true)
  const [adapters, setAdapters] = useState<SacnAdapter[]>([])
  const [adapter, setAdapter] = useState(loadAdapter)
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    void window.api.sacn.adapters().then(setAdapters)
  }, [])
  function pickAdapter(a: string): void {
    setAdapter(a)
    try {
      localStorage.setItem(ADAPTER_KEY, a)
    } catch {
      /* remembered for this visit only */
    }
  }

  // the show's patched universes are always listened to; discovery adds the rest
  useEffect(() => {
    const load = (): void =>
      void window.api.fixtures.list().then((all) =>
        setPatched([
          ...new Set(
            all
              .filter((f) => !isAccessory(f))
              .map((f) => f.universe)
              .filter((u): u is number => u != null)
          )
        ])
      )
    load()
    return window.api.onDataChanged(load)
  }, [])

  const watch = [...new Set([...patched, ...parseUniverses(extra)])].sort((a, b) => a - b)
  const watchKey = watch.join(',')
  useEffect(() => {
    let alive = true
    const tick = (): void =>
      void window.api.sacn.scan(watch, adapter).then((s) => alive && setSnap(s))
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- watchKey stands for watch
  }, [watchKey, adapter])
  useEffect(() => () => void window.api.sacn.stop(), [])

  const deviceAt = (ip: string): string =>
    devices.find((d) => d.managementIp === ip || d.ports.some((p) => p.ipAddress === ip))?.name ??
    ''
  const who = (s: { name: string; ip: string }): string => {
    const d = deviceAt(s.ip)
    return `${s.name || 'Unnamed source'} — ${s.ip}${d ? ` (${d})` : ''}`
  }
  const show = (v: number): string => (percent ? String(Math.round((v * 100) / 255)) : String(v))

  // live universes plus the ones being listened to that are silent
  const live = new Map((snap?.universes ?? []).map((u) => [u.universe, u]))
  const list = [...new Set([...live.keys(), ...watch])].sort((a, b) => a - b)
  const current =
    picked != null && list.includes(picked)
      ? picked
      : (snap?.universes[0]?.universe ?? list[0] ?? null)

  function universeView(n: number, u?: SacnSnapshot['universes'][number]): React.JSX.Element {
    if (!u)
      return (
        <>
          <h3 style={{ marginTop: 0 }}>Universe {n}</h3>
          <p className="muted">Nothing is sending this universe on the chosen adapter.</p>
        </>
      )
    const up = u.levels?.filter((v) => v > 0).length ?? 0
    return (
      <>
        <div className="lx-universe-head">
          <h3 style={{ marginTop: 0 }}>Universe {n}</h3>
          <span className="muted">
            {u.levels ? `${up} / ${u.levels.length} channels above 0` : 'no level data'}
          </span>
        </div>
        <ul className="muted">
          {u.sources.map((s, i) => (
            <li key={s.cid}>
              {who(s)} · priority {s.priority} · {s.rate}/s
              {s.preview && ' · preview'}
              {i === 0 && u.sources.length > 1 && ' · in control'}
            </li>
          ))}
        </ul>
        {u.levels && (
          <div className="lx-grid" role="grid" aria-label={`Universe ${n} levels`}>
            {u.levels.map((v, k) => (
              <span
                key={k}
                title={`${k + 1}: ${v} (${Math.round((v * 100) / 255)}%)`}
                className="lx-cell"
                style={
                  v > 0
                    ? {
                        background: `color-mix(in srgb, var(--accent) ${20 + Math.round((v * 80) / 255)}%, var(--line-soft))`,
                        color: v > 140 ? 'var(--accent-ink)' : undefined
                      }
                    : undefined
                }
              >
                {v > 0 ? show(v) : k + 1}
              </span>
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>sACN</h2>
      </div>
      <div className="lx-universe-head">
        <span className={snap?.error ? 'error' : 'muted'} role="status">
          {!snap
            ? 'Starting…'
            : snap.error ||
              `Listening on port ${snap.port} · ${snap.sources.length} source${snap.sources.length === 1 ? '' : 's'} · ${snap.universes.length} universe${snap.universes.length === 1 ? '' : 's'} live`}
        </span>
        <label>
          Network adapter{' '}
          <select value={adapter} onChange={(e) => pickAdapter(e.target.value)}>
            <option value="">All adapters</option>
            {adapters.map((a) => (
              <option key={a.address} value={a.address}>
                {a.name} — {a.address}
              </option>
            ))}
            {adapter && !adapters.some((a) => a.address === adapter) && (
              <option value={adapter}>{adapter} (not connected — using all)</option>
            )}
          </select>
        </label>
        <label>
          Also listen to universes{' '}
          <input
            placeholder="e.g. 1-8, 20"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            aria-describedby="sacn-help"
          />
        </label>
        <label>
          <input type="checkbox" checked={percent} onChange={(e) => setPercent(e.target.checked)} />{' '}
          Show levels as %
        </label>
      </div>
      <p id="sacn-help" className="muted">
        Universes patched in this show, and any a console announces (sACN discovery), are listened
        to automatically. Add others here if a source doesn&apos;t announce them.
      </p>

      <h3>Sources</h3>
      {!snap?.sources.length ? (
        <p className="muted">No sACN heard yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>IP</th>
              <th>Device</th>
              <th>Sending</th>
              <th>Announced</th>
            </tr>
          </thead>
          <tbody>
            {snap.sources.map((s) => (
              <tr key={s.cid} title={`CID ${s.cid}`}>
                <td>{s.name || 'Unnamed source'}</td>
                <td className="mono">{s.ip}</td>
                <td>{deviceAt(s.ip)}</td>
                <td className="mono">{s.sending.join(', ') || '—'}</td>
                <td className="mono">{s.announced.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Universes</h3>
      {list.length === 0 ? (
        <p className="muted">No universes heard or listened to yet.</p>
      ) : (
        <div className="kit-layout">
          <div className="kit-list" role="listbox" aria-label="Universe">
            {list.map((n) => {
              const u = live.get(n)
              const on = u?.levels?.filter((v) => v > 0).length ?? 0
              return (
                <button
                  key={n}
                  type="button"
                  role="option"
                  aria-selected={n === current}
                  className={`kit-list-row${n === current ? ' active' : ''}`}
                  onClick={() => setPicked(n)}
                >
                  <span className="kit-trigger">Universe {n}</span>
                  <span className="muted kit-summary">
                    {u
                      ? `${u.sources[0].name || u.sources[0].ip}${u.sources.length > 1 ? ` +${u.sources.length - 1}` : ''} · ${on} ch up`
                      : 'silent'}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="kit-form">
            {current != null && universeView(current, live.get(current))}
          </div>
        </div>
      )}
    </div>
  )
}

export default SacnPage
