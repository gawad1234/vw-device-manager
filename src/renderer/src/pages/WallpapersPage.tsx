import type { Device } from '../../../shared/types'
import DeviceSetupPage from '../components/DeviceSetupPage'
import WallpaperSection from '../components/WallpaperSection'

interface Props {
  devices: Device[]
  onChanged: () => void
}

/** Devices › Wallpapers: per-computer branded desktop wallpapers. */
function WallpapersPage({ devices, onChanged }: Props): React.JSX.Element {
  async function remove(d: Device): Promise<void> {
    if (!window.confirm(`Remove the wallpaper setup for "${d.name}"?`)) return
    await window.api.devices.setWallpaper(d.id, null)
    onChanged()
  }

  return (
    <DeviceSetupPage
      title="Wallpapers"
      intro="Branded desktop wallpapers per computer: show logo, computer name and company logo on the computer's color."
      devices={devices}
      isSetUp={(d) => !!d.wallpaper}
      summary={(d) => {
        const n = d.wallpaper?.displays.length ?? 0
        return `${n} display${n === 1 ? '' : 's'}`
      }}
      addLabel="+ Add computer…"
      onAdd={async (d) => {
        await window.api.devices.setWallpaper(d.id, {
          color: '#1b1b1f',
          displays: [{ width: 1920, height: 1080, black: false }],
          combined: false
        })
        onChanged()
      }}
      editor={(d) => (
        <>
          <WallpaperSection device={d} onChanged={onChanged} />
          <button
            type="button"
            className="btn btn-small btn-danger"
            style={{ marginTop: 14 }}
            onClick={() => remove(d)}
          >
            Remove wallpaper setup
          </button>
        </>
      )}
    />
  )
}

export default WallpapersPage
