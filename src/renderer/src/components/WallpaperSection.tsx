import { useState } from 'react'
import type { Device, WallpaperDisplay } from '../../../shared/types'
import { renderWallpaper, renderCombinedWallpaper } from '../lib/wallpaper'

const BLANK_DISPLAY: WallpaperDisplay = { width: 1920, height: 1080, black: false }

function fileSafe(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

interface Props {
  device: Device
  onChanged: () => void
}

/** Per-computer wallpaper setup + generator: one PNG per display (show logo
 *  centered, computer name under it, company logo top-right, colored background;
 *  "black" displays stay plain black). */
function WallpaperSection({ device, onChanged }: Props): React.JSX.Element {
  const [color, setColor] = useState(device.wallpaper?.color ?? '#1b1b1f')
  const [displays, setDisplays] = useState<WallpaperDisplay[]>(
    device.wallpaper?.displays?.length ? device.wallpaper.displays : [{ ...BLANK_DISPLAY }]
  )
  const [combined, setCombined] = useState(device.wallpaper?.combined ?? false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function persist(
    nextColor: string,
    nextDisplays: WallpaperDisplay[],
    nextCombined: boolean
  ): Promise<void> {
    await window.api.devices.setWallpaper(device.id, {
      color: nextColor,
      displays: nextDisplays,
      combined: nextCombined
    })
    onChanged()
  }
  function patchDisplay(i: number, patch: Partial<WallpaperDisplay>): void {
    const next = displays.map((d, idx) => (idx === i ? { ...d, ...patch } : d))
    setDisplays(next)
    persist(color, next, combined)
  }
  function addDisplay(): void {
    const next = [...displays, { ...BLANK_DISPLAY }]
    setDisplays(next)
    persist(color, next, combined)
  }
  function removeDisplay(i: number): void {
    const next = displays.filter((_, idx) => idx !== i)
    setDisplays(next)
    persist(color, next, combined)
  }
  function toggleCombined(v: boolean): void {
    setCombined(v)
    persist(color, displays, v)
  }

  async function generate(): Promise<void> {
    setBusy(true)
    setNote(null)
    try {
      const [showLogo, companyLogo, showName] = await Promise.all([
        window.api.showLogo.get(),
        window.api.companyLogo.get(),
        window.api.showName.get()
      ])
      const base = `${fileSafe(showName || 'Show')}_${fileSafe(device.name)}`
      const files: { name: string; dataUrl: string }[] = []
      if (combined) {
        const dataUrl = await renderCombinedWallpaper(
          displays,
          color,
          showLogo,
          companyLogo,
          device.name
        )
        const totalW = displays.reduce((s, d) => s + d.width, 0)
        const maxH = Math.max(...displays.map((d) => d.height))
        files.push({ name: `${base}_combined_${totalW}x${maxH}.png`, dataUrl })
      } else {
        for (let i = 0; i < displays.length; i++) {
          const d = displays[i]
          const dataUrl = await renderWallpaper({
            display: d,
            color,
            showLogo,
            companyLogo,
            computerName: device.name
          })
          files.push({
            name: `${base}_D${i + 1}_${d.width}x${d.height}${d.black ? '_black' : ''}.png`,
            dataUrl
          })
        }
      }
      const n = await window.api.wallpapers.save(files)
      if (n >= 0) setNote(`Saved ${n} wallpaper${n === 1 ? '' : 's'} to the chosen folder.`)
    } catch (e) {
      setNote(`Couldn’t generate: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wallpaper-section">
      <p className="muted">
        One wallpaper per display — show logo centered, computer name under it, company logo
        top-right, on this computer&rsquo;s color. Mark a display <strong>Black</strong> for a plain
        black background.
      </p>
      <label className="wp-color">
        Computer color
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          onBlur={() => persist(color, displays, combined)}
        />
        <code>{color}</code>
      </label>
      <label className="chk" style={{ margin: '0 0 10px' }}>
        <input type="checkbox" checked={combined} onChange={(e) => toggleCombined(e.target.checked)} />
        Combine displays into one spanning image (Windows) — leave off for one image per display
        (Mac)
      </label>
      {displays.map((d, i) => (
        <div className="wp-display" key={i}>
          <span className="wp-n">Display {i + 1}</span>
          <label>
            W
            <input
              type="number"
              min={1}
              value={d.width}
              onChange={(e) => patchDisplay(i, { width: Math.max(1, Number(e.target.value) || 0) })}
            />
          </label>
          <label>
            H
            <input
              type="number"
              min={1}
              value={d.height}
              onChange={(e) => patchDisplay(i, { height: Math.max(1, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={d.black}
              onChange={(e) => patchDisplay(i, { black: e.target.checked })}
            />
            Black
          </label>
          <button
            type="button"
            className="btn btn-small btn-danger"
            title="Remove display"
            onClick={() => removeDisplay(i)}
          >
            ×
          </button>
        </div>
      ))}
      <div className="signal-add" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-small" onClick={addDisplay}>
          + Add display
        </button>
        <button
          type="button"
          className="btn btn-small btn-primary"
          onClick={generate}
          disabled={busy || displays.length === 0}
        >
          {busy ? 'Generating…' : 'Generate wallpapers…'}
        </button>
      </div>
      {note && (
        <p className="muted" style={{ marginTop: 8 }}>
          {note}
        </p>
      )}
    </div>
  )
}

export default WallpaperSection
